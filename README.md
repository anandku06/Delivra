# Delivra — Email Scheduling & Campaign Management

Delivra is a full-stack email scheduling platform that allows users to create email campaigns, upload recipient lists, schedule emails, and track their status through a centralized dashboard. It uses background job processing and Redis-backed rate limiting to manage scheduled email delivery reliably.

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-000000?logo=next.js&logoColor=white" />
  <img alt="Express.js" src="https://img.shields.io/badge/Express.js-000000?logo=express&logoColor=white" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white" />
  <img alt="Redis" src="https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white" />
  <img alt="BullMQ" src="https://img.shields.io/badge/BullMQ-E63946?logo=redis&logoColor=white" />
  <img alt="Docker" src="https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white" />
</p>

## ✨ Features

- **Email Scheduling:** Schedule email campaigns for a specific start time.
- **Bulk Recipient Import:** Upload recipient lists using CSV or TXT files.
- **Background Job Processing:** Process scheduled emails asynchronously using BullMQ workers.
- **Rate Limiting:** Enforce hourly email limits with Redis-backed atomic operations.
- **Retry Mechanism:** Automatically retry failed jobs with exponential backoff.
- **Campaign Management:** View campaign summaries and monitor email statuses.
- **Email Cancellation:** Cancel emails that have not yet been sent.
- **Google Authentication:** Authenticate users using Google OAuth 2.0 and JWT.
- **Persistent Storage:** Store campaign and email information in PostgreSQL.
- **Containerized Infrastructure:** Run PostgreSQL and Redis locally using Docker Compose.

## 🏗️ Architecture

```text
              Next.js Dashboard
                     |
                     | REST API + JWT
                     v
                Express.js API
                     |
          +----------+----------+
          |                     |
          v                     v
      PostgreSQL           Google OAuth
          |
          | Scheduled Email Records
          |
          v
      BullMQ Queue <------> Redis
          |
          v
      Email Worker
          |
          v
    Redis Rate Limiter
          |
          v
      SMTP Transport
```

## 🔄 How It Works

1. The user signs in and creates an email campaign.
2. Recipient details and scheduling preferences are submitted to the backend.
3. Campaign and email records are stored in PostgreSQL.
4. BullMQ creates delayed jobs backed by Redis.
5. Background workers process jobs when they become eligible.
6. Redis-backed rate limiting controls the sending frequency.
7. If an hourly limit is reached, the job is rescheduled for a later time.
8. Email statuses are updated so users can track scheduled, sent, and failed messages.

## ⚙️ Reliability and Job Processing

Delivra uses several mechanisms to make background email processing more reliable:

- **Persistent Job Scheduling:** Stores email records in PostgreSQL and queued jobs in Redis.
- **Idempotent Job Creation:** Uses deterministic job IDs to help prevent duplicate queue entries.
- **Exponential Backoff:** Retries failed jobs with progressively increasing delays.
- **Atomic Rate Limiting:** Uses Redis Lua scripting to update rate-limit counters atomically.
- **Configurable Worker Concurrency:** Controls how many jobs can be processed concurrently.
- **Automatic Rescheduling:** Delays jobs when the configured hourly sending limit is reached.
- **Email Status Tracking:** Maintains email and campaign status information in the database.

## 🛠️ Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind CSS |
| Backend | Node.js, Express.js, TypeScript |
| Database | PostgreSQL, Drizzle ORM |
| Background Jobs | BullMQ |
| Queue and Rate Limiting | Redis, Lua |
| Authentication | Google OAuth 2.0, JWT |
| Email Transport | Nodemailer, Ethereal SMTP |
| Infrastructure | Docker Compose |

## 🚀 Getting Started

### Prerequisites

Make sure you have the following installed:

- Node.js 18 or later
- npm
- Docker and Docker Compose
- Google OAuth 2.0 credentials

### 1. Clone the Repository

```bash
git clone https://github.com/anandku06/Delivra.git
cd Delivra
```

### 2. Start PostgreSQL and Redis

```bash
docker compose up -d
```

### 3. Configure Environment Variables

Create the backend environment file:

```bash
cp backend/.env.example backend/.env
```

Configure the required database, Redis, Google OAuth, JWT, SMTP, and frontend URL values in `backend/.env`.

Create `frontend/.env.local` and add your Google OAuth client ID:

```env
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id
```

Ensure your Google OAuth client is configured with the appropriate local development origin.

### 4. Set Up the Backend

```bash
cd backend
npm install
npm run db:migrate
npm run seed
npm run dev
```

The backend runs on port `3001` by default.

### 5. Set Up the Frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser and sign in with Google.

> Note: The commands above assume the repository's package scripts and environment template are available as described. Refer to the actual project configuration if a command or variable name differs.

## 🔌 API Overview

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/google` | Authenticate with Google |
| `GET` | `/api/auth/me` | Retrieve the authenticated user's profile |
| `POST` | `/api/emails/schedule` | Schedule a batch of emails |
| `GET` | `/api/emails/scheduled` | Retrieve scheduled emails |
| `GET` | `/api/emails/sent` | Retrieve sent and failed emails |
| `DELETE` | `/api/emails/:id` | Cancel a pending email |
| `GET` | `/api/campaigns` | Retrieve campaigns and summary counts |
| `GET` | `/api/health` | Check API health |

Authenticated endpoints require a valid JWT session.

## 📁 Project Structure

```text
Delivra/
├── backend/
│   └── src/
│       ├── config/       # Environment configuration
│       ├── db/           # Database schema, migrations, seed data
│       ├── middleware/   # Request middleware and error handling
│       ├── modules/
│       │   ├── auth/     # Authentication and JWT
│       │   ├── email/    # Email scheduling and management
│       │   └── campaign/ # Campaign endpoints
│       ├── queue/        # BullMQ queue and rate limiting
│       ├── sender/       # SMTP transport configuration
│       └── workers/      # Background email workers
├── frontend/
│   ├── app/              # Next.js routes and providers
│   ├── components/       # Dashboard and reusable UI
│   └── lib/              # API client, auth context, shared types
└── docker-compose.yml    # PostgreSQL and Redis services
```

## 🔐 Configuration

Common environment variables include:

| Variable | Purpose |
|---|---|
| `PORT` | Backend API port |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `JWT_SECRET` | JWT signing secret |
| `WORKER_CONCURRENCY` | Number of jobs processed concurrently |
| `DEFAULT_DELAY_SECONDS` | Default delay between email sends |
| `MAX_EMAILS_PER_HOUR` | Configured hourly sending limit |

Refer to `backend/.env.example` for the complete list of supported variables.

## 🧪 Email Testing

The project uses **Ethereal SMTP** as a test email transport. This allows email messages to be inspected during development without delivering them to real recipients by default.

For real email delivery, configure a suitable SMTP provider and review its sending limits, authentication requirements, and production settings.

## 🔮 Future Improvements

- Integration with production email providers.
- Delivery analytics and campaign performance metrics.
- Email templates and reusable campaign drafts.
- More detailed worker monitoring and operational logging.
- Deployment configuration for independently scalable workers.

## 📄 License

No license has been specified yet.
