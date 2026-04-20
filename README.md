# whatsapp-webhook

WhatsApp Cloud API webhook receiver with duplicate message protection, structured logging, and health checks.

## Endpoints

- `GET /webhook` - Meta verification callback.
- `POST /webhook` - Signed webhook receiver.
- `GET /health` - Basic health/readiness endpoint (includes DB check).

## Environment variables

- `APP_SECRET` - Meta app secret used to validate `X-Hub-Signature-256`.
- `VERIFY_TOKEN` - Verification token for `GET /webhook` handshake.
- `WHATSAPP_TOKEN` - Access token used when sending WhatsApp replies.
- `PHONE_NUMBER_ID` - WhatsApp Cloud API phone ID.
- `PORT` - HTTP port (default `3000`).
- `WHATSAPP_API_VERSION` - Graph API version (default `v21.0`).
- `DB_PATH` - SQLite database file location (default `./data/app.db`).

## Duplicate protection

Incoming webhook message IDs are persisted in the `processed_messages` table. If the same message ID is received again, processing is skipped and a safe response is returned.

## Logging

Structured JSON logs include:

- `requestId`
- `phone`
- `intent`
- `outcome`

Errors include stack traces in internal logs.
