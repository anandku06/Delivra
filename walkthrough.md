# Delivra Backend — Walkthrough

## What Was Built

A complete **production-grade email scheduler backend** with all assignment requirements implemented:

| Requirement | Implementation |
|-------------|---------------|
| TypeScript + Express | ✅ Strict TS, Express 5 |
| PostgreSQL + ORM | ✅ Drizzle ORM, 4 tables |
| BullMQ + Redis (no cron) | ✅ Delayed jobs with deterministic IDs |
| Ethereal SMTP | ✅ Nodemailer with auto-account creation |
| Server restart persistence | ✅ Redis persists delayed jobs; worker reconnects |
| Configurable concurrency | ✅ `WORKER_CONCURRENCY` env var |
| Delay between emails | ✅ Computed per-recipient offsets |
| Hourly rate limiting | ✅ Redis Lua-scripted atomic counters |
| Idempotency | ✅ Deterministic job IDs + DB status checks |
| Google OAuth | ✅ ID token verification + JWT |

---

## File Map

```
e:\assignment\
├── docker-compose.yml              # Postgres 16 + Redis 7
└── backend/
    ├── package.json
    ├── tsconfig.json
    ├── drizzle.config.ts
    ├── .env / .env.example
    ├── .gitignore
    └── src/
        ├── app.ts                   # Express bootstrap + worker start
        ├── config/
        │   └── env.ts               # Zod-validated environment
        ├── db/
        │   ├── schema.ts            # users, senders, email_campaigns, scheduled_emails
        │   ├── index.ts             # Drizzle client
        │   ├── migrate.ts           # Migration runner
        │   └── seed.ts              # Seeds 2 Ethereal sender accounts
        ├── modules/
        │   ├── auth/
        │   │   ├── auth.service.ts      # Google verify, upsert, JWT
        │   │   ├── auth.middleware.ts    # requireAuth
        │   │   ├── auth.controller.ts   # POST /google, GET /me
        │   │   └── auth.routes.ts
        │   ├── email/
        │   │   ├── email.validator.ts   # Zod schemas, CSV parser
        │   │   ├── email.service.ts     # Schedule logic, queries
        │   │   ├── email.controller.ts  # REST handlers
        │   │   └── email.routes.ts
        │   └── campaign/
        │       └── campaign.routes.ts   # GET /campaigns
        ├── queue/
        │   ├── connection.ts        # IORedis factory
        │   ├── emailQueue.ts        # BullMQ Queue + addJob/reschedule
        │   └── rateLimiter.ts       # Redis Lua-based hourly limiter
        ├── workers/
        │   └── emailWorker.ts       # BullMQ Worker (the core engine)
        ├── sender/
        │   └── mailer.ts            # Nodemailer + Ethereal
        └── middleware/
            └── errorHandler.ts      # Global error handler
```

---

## Key Architecture Decisions

### Scheduling Flow
1. User posts `{ subject, body, recipients[], startTime, delay, hourlyLimit }`
2. Campaign + individual `scheduled_emails` rows created in Postgres
3. BullMQ delayed jobs enqueued with `delay = scheduledTime - now`
4. Worker fires when delay expires → checks rate limit → sends via Ethereal → updates DB

### Rate Limiting
- Redis key: `rate:{senderId}:{YYYYMMDDHH}`
- Atomic Lua script: `INCR` + `EXPIRE` in one operation
- When limit hit: job reschedules itself to the next hour window
- Safe across multiple concurrent workers

### Idempotency
- Job ID: `email:{scheduledEmailId}` — BullMQ rejects duplicates
- Worker also checks `if status === SENT → skip`
- Double protection against duplicate sends

### Restart Persistence
- BullMQ stores delayed jobs in Redis (which is volume-persisted via Docker)
- On restart, the Worker reconnects and picks up right where it left off
- No job recreation needed

---

## How to Start

```bash
# 1. Start infra
docker compose up -d

# 2. Install deps
cd backend
npm install

# 3. Generate + run migrations
npm run db:generate
npm run db:migrate

# 4. Seed sender accounts
npm run seed

# 5. Start dev server
npm run dev
```

The server will start on `http://localhost:3001`.

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/google` | ❌ | Google ID token → JWT |
| GET | `/api/auth/me` | ✅ | Current user profile |
| POST | `/api/emails/schedule` | ✅ | Schedule email batch |
| GET | `/api/emails/scheduled` | ✅ | List pending emails |
| GET | `/api/emails/sent` | ✅ | List sent/failed emails |
| GET | `/api/campaigns` | ✅ | List campaigns with stats |
| GET | `/api/health` | ❌ | Health check |
