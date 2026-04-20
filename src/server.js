const crypto = require('crypto');
const express = require('express');
const dotenv = require('dotenv');

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
  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return res.status(200).json({ status: 'ignored', reason: 'No message payload' });
    }

    const senderPhone = message.from;
    const messageText = message.text?.body;

    console.log('Incoming WhatsApp message', {
      from: senderPhone,
      text: messageText,
      type: message.type,
    });

    if (senderPhone && messageText) {
      await sendWhatsAppMessage(senderPhone, `You said: ${messageText}`);
    }

    return res.status(200).json({ status: 'received' });
  } catch (error) {
    console.error('Webhook processing failed', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});

module.exports = {
  app,
  sendWhatsAppMessage,
  validateRequestSignature,
};
