# Shoal Web (Next.js API + Prisma)

Backend integration layer for **Shoal AI**, connecting the UI to **MiroFish** (Python swarm engine).

## Stack

- Next.js App Router (`app/api/*`)
- Prisma 7 + PostgreSQL (Vercel Postgres)
- MiroFish HTTP bridge + webhook receiver

## Setup

1. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

2. Set `DATABASE_URL` to your Postgres connection string (Vercel Postgres provides this automatically when linked).

3. Apply the schema:

   ```bash
   npm run db:migrate
   # or: npm run db:push
   ```

4. Seed the default dev user (matches `VITE_DEFAULT_USER_ID` in shoal-ui):

   ```bash
   npm run db:seed
   ```

5. Start the dev server:

   ```bash
   npm run dev
   ```

## API

### `POST /api/swarms`

Creates a swarm and dispatches it to MiroFish.

**Body**

```json
{
  "userId": "clx...",
  "premise": "Should we acquire Northwind Robotics at $480M?",
  "agentCount": 200
}
```

**Response `201`**

```json
{ "swarmId": "clx..." }
```

Flow: `PENDING` → engine dispatch → `RUNNING` (or `FAILED` if the engine is unreachable).

### `POST /api/webhooks/engine`

MiroFish calls this when a simulation finishes.

**Body**

```json
{
  "swarmId": "clx...",
  "reportData": { "verdict": "...", "agents": [] }
}
```

**Headers (production)**

- `x-engine-webhook-secret: <ENGINE_WEBHOOK_SECRET>`

Sets swarm `status` to `COMPLETED` and stores `reportData` in `resultData`.

## Environment

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `FRONTEND_ORIGIN` | Comma-separated shoal-ui URL(s) for CORS |
| `MIROFISH_ENGINE_URL` | Base URL of the Python engine |
| `MIROFISH_ENGINE_API_KEY` | Optional bearer token for engine requests |
| `ENGINE_WEBHOOK_SECRET` | Required in production for webhook auth |

## MiroFish contract (expected)

**Outbound** `POST {MIROFISH_ENGINE_URL}/ignite`

```json
{ "swarmId": "...", "premise": "..." }
```

**Inbound** `POST https://<your-app>/api/webhooks/engine`

```json
{ "swarmId": "...", "reportData": { ... } }
```
