const crypto = require('crypto');
const express = require('express');
const dotenv = require('dotenv');
const { parseIntent } = require('./chat/intents');
const {
  searchProducts,
  findProductBySkuOrName,
  formatSearchReply,
  formatPriceReply,
  formatOrderReply,
  formatHelpReply,
} = require('./chat/replies');

const {
  initDatabase,
  isMessageProcessed,
  markMessageProcessed,
  checkDatabaseReadiness,
} = require('./db');

dotenv.config();

const {
  WHATSAPP_TOKEN,
  VERIFY_TOKEN,
  PHONE_NUMBER_ID,
  APP_SECRET,
  PORT = 3000,
  WHATSAPP_API_VERSION = 'v21.0',
} = process.env;

const app = express();

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use((req, res, next) => {
  req.requestId = req.get('X-Request-ID') || crypto.randomUUID();
  res.set('X-Request-ID', req.requestId);
  next();
});

class RecoverableError extends Error {
  constructor(message, userMessage) {
    super(message);
    this.name = 'RecoverableError';
    this.userMessage = userMessage;
  }
}

function buildLog(req, fields) {
  return {
    requestId: req.requestId,
    ...fields,
  };
}

function logInfo(req, fields) {
  console.log(JSON.stringify(buildLog(req, { level: 'info', ...fields })));
}

function logError(req, fields, error) {
  console.error(
    JSON.stringify(
      buildLog(req, {
        level: 'error',
        ...fields,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      }),
    ),
  );
}

function validateRequestSignature(req, res, next) {
  const signatureHeader = req.get('X-Hub-Signature-256');

  if (!APP_SECRET) {
    return res.status(500).json({ error: 'APP_SECRET is not configured' });
  }

  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return res.status(401).json({ error: 'Missing or invalid signature header' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', APP_SECRET)
    .update(req.rawBody || Buffer.from(''))
    .digest('hex');

  const incomingSignature = signatureHeader.replace('sha256=', '');

  const expected = Buffer.from(expectedSignature, 'utf8');
  const incoming = Buffer.from(incomingSignature, 'utf8');

  if (expected.length !== incoming.length || !crypto.timingSafeEqual(expected, incoming)) {
    return res.status(401).json({ error: 'Invalid request signature' });
  }

  return next();
}

async function sendWhatsAppMessage(to, body) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error('WHATSAPP_TOKEN and PHONE_NUMBER_ID must be configured');
  }

  const endpoint = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    text: {
      body,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`WhatsApp API request failed (${response.status}): ${errorBody}`);
  }

  return response.json();
}

function detectIntent(messageText) {
  if (!messageText) {
    return 'unknown';
  }

  if (/\border\b/i.test(messageText)) {
    return 'create_order';
  }

  return 'echo';
}

async function createOrderFromMessage(messageText) {
  if (!messageText || messageText.trim().length < 4) {
    throw new RecoverableError(
      'Unable to create order because message text is too short',
      'I could not understand your order yet. Please send more details (items and quantity).',
    );
  }

  return {
    orderId: crypto.randomUUID(),
  };
}

app.get('/health', async (req, res) => {
  try {
    const dbReady = await checkDatabaseReadiness();

    if (!dbReady) {
      return res.status(503).json({ status: 'degraded', db: 'not_ready' });
    }

    return res.status(200).json({ status: 'ok', db: 'ready' });
  } catch (error) {
    logError(req, { outcome: 'health_check_failed' }, error);
    return res.status(503).json({ status: 'degraded', db: 'error' });
  }
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.status(403).send('Forbidden');
});

app.post('/webhook', validateRequestSignature, async (req, res) => {
  const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (!message) {
    logInfo(req, { outcome: 'ignored', reason: 'no_message_payload' });
    return res.status(200).json({ status: 'ignored', reason: 'No message payload' });
  }

  const messageId = message.id;
  const senderPhone = message.from;
  const messageText = message.text?.body;
  const intent = detectIntent(messageText);

  logInfo(req, {
    phone: senderPhone,
    intent,
    outcome: 'received',
    messageId,
  });

    if (senderPhone && messageText) {
      const intent = parseIntent(messageText);
      let reply = formatHelpReply();

      if (intent.type === 'search') {
        const matches = searchProducts(intent.keyword);
        reply = formatSearchReply(intent.keyword, matches);
      } else if (intent.type === 'price') {
        const product = findProductBySkuOrName(intent.query);
        reply = formatPriceReply(product, intent.query);
      } else if (intent.type === 'order') {
        const product = findProductBySkuOrName(intent.sku);
        reply = formatOrderReply(product, intent.quantity);
      }

      await sendWhatsAppMessage(senderPhone, reply);
    }

    return res.status(200).json({ status: 'received' });
  } catch (error) {
    logError(
      req,
      {
        phone: senderPhone,
        intent,
        outcome: 'failed',
        messageId,
      },
      error,
    );

    if (error instanceof RecoverableError) {
      if (senderPhone) {
        try {
          await sendWhatsAppMessage(senderPhone, error.userMessage);
        } catch (sendErr) {
          logError(req, { phone: senderPhone, intent, outcome: 'recoverable_reply_failed' }, sendErr);
        }
      }

      return res.status(200).json({ status: 'handled', reason: 'recoverable_error' });
    }

    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

async function startServer() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`Webhook server listening on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});

module.exports = {
  app,
  sendWhatsAppMessage,
  validateRequestSignature,
  detectIntent,
  createOrderFromMessage,
  RecoverableError,
};
