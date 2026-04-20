/**
 * Data access helpers for product/customer/order operations.
 *
 * Usage:
 *   const db = createDbApi(pgPool)
 *   await db.findProductByNameOrSku('SKU-123')
 */

function toMoneyNumber(value) {
  return Number.parseFloat(Number(value).toFixed(2));
}

function calculateOrderTotal(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('items[] must be a non-empty array');
  }

  const total = items.reduce((sum, item) => {
    const qty = Number(item.qty);
    const unitPrice = Number(item.unit_price ?? item.unitPrice);

    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error('Each item requires qty > 0');
    }

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error('Each item requires unit_price >= 0');
    }

    return sum + (qty * unitPrice);
  }, 0);

  return toMoneyNumber(total);
}

function createDbApi(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new Error('A pg-compatible pool/client factory is required');
  }

  async function findProductByNameOrSku(query) {
    const input = String(query || '').trim();
    if (!input) return [];

    const sql = `
      SELECT id, sku, name, description, price, stock_qty, active
      FROM products
      WHERE active = TRUE
        AND (sku = $1 OR name ILIKE '%' || $1 || '%')
      ORDER BY
        CASE WHEN sku = $1 THEN 0 ELSE 1 END,
        name ASC
      LIMIT 25
    `;

    const { rows } = await pool.query(sql, [input]);
    return rows;
  }

  async function createOrGetCustomerByPhone(phone) {
    const inputPhone = String(phone || '').trim();
    if (!inputPhone) {
      throw new Error('phone is required');
    }

    const sql = `
      INSERT INTO customers (phone)
      VALUES ($1)
      ON CONFLICT (phone)
      DO UPDATE SET phone = EXCLUDED.phone
      RETURNING id, phone, name, created_at
    `;

    const { rows } = await pool.query(sql, [inputPhone]);
    return rows[0];
  }

  async function createOrder(customerId, items) {
    if (!customerId) throw new Error('customerId is required');
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('items[] must be a non-empty array');
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Lock product rows in a stable order to prevent race conditions/deadlocks.
      const normalizedItems = items.map((item) => ({
        productId: Number(item.product_id ?? item.productId),
        qty: Number(item.qty),
      }));

      for (const item of normalizedItems) {
        if (!Number.isInteger(item.productId) || item.productId <= 0) {
          throw new Error('Each item requires a valid product_id');
        }
        if (!Number.isFinite(item.qty) || item.qty <= 0) {
          throw new Error('Each item requires qty > 0');
        }
      }

      normalizedItems.sort((a, b) => a.productId - b.productId);

      const pricedItems = [];
      for (const item of normalizedItems) {
        const productResult = await client.query(
          `
            SELECT id, price, stock_qty, active
            FROM products
            WHERE id = $1
            FOR UPDATE
          `,
          [item.productId],
        );

        const product = productResult.rows[0];
        if (!product) {
          throw new Error(`Product ${item.productId} not found`);
        }
        if (!product.active) {
          throw new Error(`Product ${item.productId} is inactive`);
        }
        if (Number(product.stock_qty) < item.qty) {
          throw new Error(`Insufficient stock for product ${item.productId}`);
        }

        const unitPrice = Number(product.price);
        const lineTotal = toMoneyNumber(unitPrice * item.qty);

        await client.query(
          `
            UPDATE products
            SET stock_qty = stock_qty - $1
            WHERE id = $2
          `,
          [item.qty, item.productId],
        );

        pricedItems.push({
          product_id: item.productId,
          qty: item.qty,
          unit_price: toMoneyNumber(unitPrice),
          line_total: lineTotal,
        });
      }

      const totalAmount = calculateOrderTotal(pricedItems);

      const orderResult = await client.query(
        `
          INSERT INTO orders (customer_id, status, total_amount)
          VALUES ($1, 'pending', $2)
          RETURNING id, customer_id, status, total_amount, created_at
        `,
        [customerId, totalAmount],
      );

      const order = orderResult.rows[0];

      for (const item of pricedItems) {
        await client.query(
          `
            INSERT INTO order_items (order_id, product_id, qty, unit_price, line_total)
            VALUES ($1, $2, $3, $4, $5)
          `,
          [order.id, item.product_id, item.qty, item.unit_price, item.line_total],
        );
      }

      await client.query('COMMIT');
      return {
        order,
        items: pricedItems,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    findProductByNameOrSku,
    createOrGetCustomerByPhone,
    createOrder,
    calculateOrderTotal,
  };
}

module.exports = {
  createDbApi,
  calculateOrderTotal,
};
