# Delivra — Full-Stack Email Job Scheduler

A **production-grade email scheduler service + dashboard** built for the ReachInbox hiring assignment. Schedule, queue, and send emails at scale with rate limiting, persistence, and a clean dashboard UI.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?logo=next.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white)
![BullMQ](https://img.shields.io/badge/BullMQ-E63946?logo=redis&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)

---

## 🚀 Features

### Backend
- **Email Scheduling via BullMQ** — delayed jobs with configurable timing (no cron)
- **Persistence** — emails survive server restarts; future emails still send at the correct time
- **Rate Limiting** — configurable `MAX_EMAILS_PER_HOUR` enforced via Redis counters
- **Worker Concurrency** — configurable concurrent job processing (`WORKER_CONCURRENCY=5`)
- **Delay Between Sends** — minimum 2-second gap between individual emails (configurable)
- **Idempotency** — duplicate job IDs prevent the same email from being sent twice
- **Multi-sender Support** — round-robin sender selection from the `senders` table
- **Ethereal SMTP** — fake email sending for testing (auto-creates accounts on first boot)
- **Google OAuth** — real Google login with JWT session tokens
- **Delete Scheduled Emails** — cancel unsent emails and remove BullMQ jobs

### Frontend
- **Google OAuth Login** — real Google sign-in with user profile display
- **Dashboard** — header with user info, sidebar tabs, auto-refreshing tables
- **Scheduled Emails Tab** — view pending emails with status badges and delete functionality
- **Sent Emails Tab** — view sent/failed emails with timestamps
- **Compose Email Modal** — subject, body, CSV/TXT file upload for recipients, scheduling controls
- **Loading & Empty States** — shimmer skeletons and friendly empty messages
- **Toast Notifications** — success/error feedback for all actions
- **Responsive Design** — works on desktop and mobile

---

## 🏗 Architecture

```
┌─────────────────────┐     ┌─────────────────────────────────────┐
│   Next.js Frontend  │────▶│   Express.js Backend (port 3001)    │
│   (port 3000)       │     │                                     │
│                     │     │   ┌─────────────┐  ┌─────────────┐  │
│  • Google Login     │     │   │  Auth Module │  │ Email Module│  │
│  • Dashboard        │     │   │  (JWT/OAuth) │  │ (CRUD/API)  │  │
│  • Compose Modal    │     │   └─────────────┘  └──────┬──────┘  │
│  • Email Tables     │     │                           │         │
└─────────────────────┘     │                    ┌──────▼──────┐  │
                            │                    │   BullMQ    │  │
                            │                    │   Queue     │  │
                            │                    └──────┬──────┘  │
                            │                           │         │
                            │                    ┌──────▼──────┐  │
                            │                    │  Email      │  │
                            │                    │  Worker     │  │
                            │                    └──────┬──────┘  │
                            └───────────────────────────┼─────────┘
                                                        │
                            ┌───────────┐        ┌──────▼──────┐
                            │ PostgreSQL│        │   Redis     │
                            │ (data)    │        │ (jobs/rate  │
                            │           │        │  limiting)  │
                            └───────────┘        └─────────────┘
                                                        │
                                                 ┌──────▼──────┐
                                                 │  Ethereal   │
                                                 │  SMTP       │
                                                 └─────────────┘
```

### How Scheduling Works

1. User submits a campaign via the **Compose Modal** (subject, body, recipients, start time, delay, hourly limit)
2. Backend creates a **campaign** record and individual **scheduled_email** rows in PostgreSQL
3. For each email, a **BullMQ delayed job** is created with a computed delay based on:
   - Start time offset
   - Delay between emails (e.g., 2 seconds)
   - Hourly limit chunking (emails beyond the limit are pushed to the next hour window)
4. When the delay expires, the **worker** picks up the job and sends via Ethereal SMTP
5. The email status is updated to `SENT` or `FAILED` in the database

### How Persistence Works

- All scheduled emails are stored in **PostgreSQL** with their exact `scheduled_time`
- BullMQ jobs are backed by **Redis** with persistence enabled
- On server restart, the BullMQ worker automatically resumes processing delayed jobs
- Jobs are **not duplicated** — deterministic job IDs (`email-{uuid}`) ensure idempotency

### How Rate Limiting Works

- **Hourly chunking**: When scheduling, emails are grouped into hourly windows based on `hourlyLimit`
  - Example: 500 recipients with `hourlyLimit=200` → emails 0-199 in hour 0, 200-399 in hour 1, 400-499 in hour 2
- **Redis-backed counters**: The rate limiter uses Redis keys with TTL to track sends per hour window per sender
- **Graceful handling**: When the limit is hit, jobs are delayed to the next available hour window (not dropped)
- **Configurable**: `MAX_EMAILS_PER_HOUR` and `DEFAULT_DELAY_SECONDS` via environment variables

---

## 📦 Tech Stack

| Layer      | Technology                                       |
|------------|--------------------------------------------------|
| Frontend   | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Backend    | Express 5, TypeScript, Zod validation            |
| Database   | PostgreSQL 16, Drizzle ORM                       |
| Queue      | BullMQ (Redis-backed)                            |
| Auth       | Google OAuth 2.0, JWT                            |
| SMTP       | Ethereal Email (fake SMTP for testing)           |
| Infra      | Docker Compose (Postgres + Redis)                |

---

## 🛠 Setup & Running

### Prerequisites

- **Node.js** v18+
- **Docker** (for PostgreSQL and Redis)
- **Google Cloud Project** with OAuth 2.0 credentials

### 1. Clone the repo

```bash
git clone https://github.com/anandku06/Delivra.git
cd Delivra
```

### 2. Start infrastructure (PostgreSQL + Redis)

```bash
docker compose up -d
```

### 3. Configure environment variables

**Backend** — copy and edit `backend/.env.example`:
```bash
cp backend/.env.example backend/.env
```

Update these values in `backend/.env`:
```env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

**Frontend** — create `frontend/.env.local`:
```env
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id
```

> **Google OAuth Setup**: Create credentials at [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
> - Application type: Web application
> - Authorized JavaScript origins: `http://localhost:3000`
> - Authorized redirect URIs: `http://localhost:3000`

### 4. Setup the backend

```bash
cd backend
npm install
npm run db:migrate    # Run database migrations
npm run seed          # Create Ethereal test sender accounts
```

### 5. Start the backend

```bash
npm run dev           # Starts on http://localhost:3001
```

### 6. Setup and start the frontend

```bash
cd ../frontend
npm install
npm run dev           # Starts on http://localhost:3000
```

### 7. Open the app

Visit **http://localhost:3000** — sign in with Google and start scheduling emails!

---

## 📂 Project Structure

```
Delivra/
├── backend/
│   ├── src/
│   │   ├── app.ts                    # Express server entry point
│   │   ├── config/env.ts             # Environment variable parsing
│   │   ├── db/
│   │   │   ├── schema.ts             # Drizzle ORM schema (users, senders, campaigns, emails)
│   │   │   ├── migrate.ts            # Migration runner
│   │   │   └── seed.ts               # Seed Ethereal sender accounts
│   │   ├── modules/
│   │   │   ├── auth/                 # Google OAuth + JWT authentication
│   │   │   ├── email/                # Email scheduling, listing, deletion
│   │   │   └── campaign/             # Campaign listing with aggregated stats
│   │   ├── queue/
│   │   │   ├── emailQueue.ts         # BullMQ queue + job creation
│   │   │   ├── connection.ts         # Redis connection factory
│   │   │   └── rateLimiter.ts        # Redis-backed rate limiting
│   │   ├── workers/emailWorker.ts    # BullMQ worker (processes email jobs)
│   │   └── sender/mailer.ts          # Nodemailer transport (Ethereal SMTP)
│   ├── drizzle/                      # Generated SQL migrations
│   └── package.json
├── frontend/
│   ├── app/
│   │   ├── globals.css               # Tailwind v4 theme + custom animations
│   │   ├── layout.tsx                # Root layout with Inter font
│   │   ├── page.tsx                  # Entry — Login or Dashboard
│   │   └── providers.tsx             # Google OAuth + Auth + Toast providers
│   ├── components/
│   │   ├── login-page.tsx            # Google OAuth login screen
│   │   ├── dashboard.tsx             # Main dashboard orchestrator
│   │   ├── header.tsx                # Top bar (logo, compose, user dropdown)
│   │   ├── sidebar.tsx               # Scheduled/Sent tab navigation
│   │   ├── scheduled-table.tsx       # Scheduled emails table + delete
│   │   ├── sent-table.tsx            # Sent emails table
│   │   ├── compose-modal.tsx         # Email compose form + CSV upload
│   │   ├── status-badge.tsx          # Color-coded status pills
│   │   └── empty-state.tsx           # Empty state + loading skeleton
│   ├── lib/
│   │   ├── api.ts                    # API client with JWT auth
│   │   ├── auth-context.tsx          # React auth context
│   │   └── types.ts                  # TypeScript interfaces
│   └── package.json
└── docker-compose.yml                # PostgreSQL + Redis containers
```

---

## 🔧 Configuration

All values are configurable via environment variables:

| Variable               | Default | Description                            |
|------------------------|---------|----------------------------------------|
| `PORT`                 | `3001`  | Backend server port                    |
| `DATABASE_URL`         | —       | PostgreSQL connection string           |
| `REDIS_URL`            | —       | Redis connection string                |
| `GOOGLE_CLIENT_ID`     | —       | Google OAuth Client ID                 |
| `GOOGLE_CLIENT_SECRET` | —       | Google OAuth Client Secret             |
| `JWT_SECRET`           | —       | Secret for signing JWT tokens          |
| `WORKER_CONCURRENCY`   | `5`     | Number of concurrent BullMQ workers    |
| `DEFAULT_DELAY_SECONDS`| `2`     | Minimum delay between individual sends |
| `MAX_EMAILS_PER_HOUR`  | `200`   | Maximum emails sent per hour           |

---

## 📋 API Endpoints

| Method   | Endpoint             | Auth | Description                      |
|----------|----------------------|------|----------------------------------|
| `POST`   | `/api/auth/google`   | No   | Google OAuth login               |
| `GET`    | `/api/auth/me`       | Yes  | Get current user profile         |
| `POST`   | `/api/emails/schedule` | Yes | Schedule a batch of emails       |
| `GET`    | `/api/emails/scheduled` | Yes | List pending/scheduled emails   |
| `GET`    | `/api/emails/sent`   | Yes  | List sent/failed emails          |
| `DELETE` | `/api/emails/:id`    | Yes  | Delete a scheduled email         |
| `GET`    | `/api/campaigns`     | Yes  | List campaigns with stats        |
| `GET`    | `/api/health`        | No   | Health check                     |

---

## ⚡ Behavior Under Load

When 1000+ emails are scheduled for roughly the same time:

1. Emails are **chunked by hourly limit** — with `hourlyLimit=200`, only 200 are scheduled per hour window
2. BullMQ processes jobs with **configurable concurrency** (default: 5 parallel workers)
3. A **minimum delay** (default: 2s) is enforced between individual sends
4. If the rate limit is hit mid-processing, jobs are **rescheduled** to the next available window
5. All state is persisted in PostgreSQL + Redis — no data loss on restart

---

## 📝 Assumptions & Trade-offs

- **Ethereal Email**: All emails are sent to Ethereal's fake SMTP — no real emails are delivered. Check sent emails at [ethereal.email](https://ethereal.email).
- **Single-server**: The current setup runs on a single Node.js process. For horizontal scaling, Redis-backed BullMQ naturally supports multiple workers across instances.
- **Hourly chunking at schedule time**: Rate limiting is pre-computed when scheduling rather than dynamically at send time. This simplifies the architecture but means changing the hourly limit after scheduling requires re-creating the campaign.
- **JWT in localStorage**: For simplicity. In production, HTTP-only cookies would be more secure.

---

## 📄 License

This project was built as part of the ReachInbox / Outbox Labs hiring assignment.
