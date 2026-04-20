const PRODUCTS = [
  { sku: 'SKU123', name: 'Running Shoes', price: 79.99, stock: 12 },
  { sku: 'SKU456', name: 'Trail Shoes', price: 89.5, stock: 6 },
  { sku: 'SKU789', name: 'Walking Shoes', price: 64.25, stock: 0 },
  { sku: 'SKU321', name: 'Shoe Cleaner Kit', price: 12.0, stock: 20 },
];

function formatCurrency(value) {
  return `$${value.toFixed(2)}`;
}

function findProductBySkuOrName(query = '') {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return null;
  }

  const bySku = PRODUCTS.find((product) => product.sku.toLowerCase() === normalizedQuery);
  if (bySku) {
    return bySku;
  }

  return PRODUCTS.find((product) => product.name.toLowerCase() === normalizedQuery) || null;
}

function searchProducts(keyword = '', limit = 3) {
  const normalizedKeyword = keyword.trim().toLowerCase();

  if (!normalizedKeyword) {
    return [];
  }

  return PRODUCTS.filter((product) => {
    return (
      product.name.toLowerCase().includes(normalizedKeyword)
      || product.sku.toLowerCase().includes(normalizedKeyword)
    );
  }).slice(0, limit);
}

function formatSearchReply(keyword, matches) {
  if (matches.length === 0) {
    return `No products found for "${keyword}".`;
  }

  const lines = matches.map((product, index) => {
    return `${index + 1}. ${product.name} (${product.sku}) - ${formatCurrency(product.price)}`;
  });

  return [`Top matches for "${keyword}":`, ...lines].join('\n');
}

function formatPriceReply(product, requestedQuery) {
  if (!product) {
    return `Couldn't find a product for "${requestedQuery}".`;
  }

  const stockStatus = product.stock > 0 ? `In stock (${product.stock} available)` : 'Out of stock';
  return `${product.name} (${product.sku})\nPrice: ${formatCurrency(product.price)}\nStock: ${stockStatus}`;
}

function formatOrderReply(product, quantity) {
  if (!product) {
    return 'Unable to place order: product not found.';
  }

  if (product.stock < quantity) {
    return `Unable to place order: only ${product.stock} item(s) in stock for ${product.sku}.`;
  }

  const subtotal = product.price * quantity;
  const total = subtotal;
  const orderId = `ORD-${Date.now().toString().slice(-8)}`;

  return [
    `Order confirmed: ${orderId}`,
    `Item: ${product.name} (${product.sku}) x ${quantity}`,
    `Subtotal: ${formatCurrency(subtotal)}`,
    `Total: ${formatCurrency(total)}`,
  ].join('\n');
}

function formatHelpReply() {
  return 'Try: "search shoes", "price SKU123", "order SKU123 2".';
}

module.exports = {
  PRODUCTS,
  searchProducts,
  findProductBySkuOrName,
  formatSearchReply,
  formatPriceReply,
  formatOrderReply,
  formatHelpReply,
};
