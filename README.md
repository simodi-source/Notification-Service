# Simodi Notification Service

Plain Node.js worker that consumes notification jobs from Redis (BullMQ) and delivers email (SendGrid), push (FCM), and future SMS/WhatsApp channels.

## Prerequisites

- Node.js 20+
- Redis reachable from both the main API and this worker (ElastiCache, Redis Cloud, etc.)
- Shared MongoDB with the main backend

## Setup

```bash
cd notification-service
cp .env.example .env
# Edit .env with REDIS_URL, MONGODB_URI, SendGrid, Firebase paths
npm install
npm start
```

## Main API

The TypeScript backend enqueues jobs via `notification-client.ts` when `REDIS_URL` is set. See `backend/.env.example`.

Test enqueue (API machine, Redis required):

```bash
cd ../backend
npm run enqueue-test-notification -- <userId> trade.executed
```

## Job contract

Queue name: `notifications`. Payload fields: `event`, `templateCode`, `idempotencyKey`, `payload`, optional `userId`, `recipientEmail`, `channels`. BullMQ `jobId` = `idempotencyKey`. Defaults: 5 attempts, exponential backoff 2s. See `src/queue/job-contract.js` and `backend/src/types/notification.ts`.

## Deploy (separate EC2)

Run with PM2 or systemd:

```bash
npm install --production
NODE_ENV=production npm start
```

Outbound only: Redis, MongoDB, SendGrid, FCM. No inbound HTTP required in v1.
