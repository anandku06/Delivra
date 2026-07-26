# ReachInbox Internship Assignment -- System Design

## 1. Objective

Build a production-grade email scheduling platform that: - Accepts email
scheduling requests. - Persists them in PostgreSQL. - Uses BullMQ +
Redis delayed jobs (no cron). - Sends emails through Ethereal SMTP. -
Survives server restarts. - Supports configurable concurrency,
throttling, and hourly rate limits. - Provides a dashboard for
scheduling and monitoring.

------------------------------------------------------------------------

# 2. High-Level Architecture

``` text
                 +----------------------+
                 |      React/Next      |
                 |   Dashboard (TS)     |
                 +----------+-----------+
                            |
                        REST APIs
                            |
                    +-------v--------+
                    | Express Backend|
                    +-------+--------+
                            |
        +-------------------+------------------+
        |                                      |
+-------v-------+                      +-------v--------+
| PostgreSQL    |                      | Redis          |
| Email Records |                      | BullMQ Queues  |
+---------------+                      +-------+--------+
                                               |
                                        Delayed Jobs
                                               |
                                        +------v------+
                                        | Bull Worker |
                                        +------+------+
                                               |
                                        Nodemailer +
                                         Ethereal SMTP
```

------------------------------------------------------------------------

# 3. Backend Modules

-   auth/
-   email/
-   scheduler/
-   queue/
-   worker/
-   sender/
-   database/
-   config/

------------------------------------------------------------------------

# 4. Database Schema

## users

-   id
-   google_id
-   name
-   email
-   avatar

## senders

-   id
-   name
-   smtp_host
-   smtp_port
-   smtp_user
-   smtp_password
-   daily_limit
-   enabled

## email_campaigns

-   id
-   subject
-   body
-   start_time
-   delay_between_emails
-   hourly_limit
-   created_by

## scheduled_emails

-   id
-   campaign_id
-   sender_id
-   recipient
-   scheduled_time
-   status
-   bull_job_id
-   attempts
-   sent_at
-   error

Statuses: - SCHEDULED - PROCESSING - SENT - FAILED - DELAYED

------------------------------------------------------------------------

# 5. Queue Design

Queue: - email-send

Job Payload: - emailId - senderId - recipient - subject - body

Job ID: email:{emailId}

Using deterministic IDs guarantees idempotency.

------------------------------------------------------------------------

# 6. Scheduling Flow

1.  User uploads CSV.
2.  Backend validates emails.
3.  Campaign created.
4.  Individual scheduled_email rows inserted.
5.  BullMQ delayed jobs created.
6.  Redis stores jobs.
7.  Worker executes when delay expires.
8.  Email sent.
9.  DB updated.

------------------------------------------------------------------------

# 7. Restart Recovery

BullMQ persists delayed jobs in Redis.

On restart: - Worker reconnects. - Existing jobs continue. - No
recreation required.

------------------------------------------------------------------------

# 8. Concurrency

Environment variable:

WORKER_CONCURRENCY=5

Worker:

-   Processes 5 jobs simultaneously.
-   Safe because BullMQ locks jobs.

------------------------------------------------------------------------

# 9. Delay Between Emails

Each campaign contains:

delay_between_emails

Scheduling offsets each recipient:

start start+delay start+2\*delay

No cron required.

------------------------------------------------------------------------

# 10. Hourly Rate Limiting

Redis key:

rate:{senderId}:{YYYYMMDDHH}

Flow: - Increment atomically. - If below limit -\> send. - Else: -
compute next hour - move job - preserve order

Safe across multiple workers.

------------------------------------------------------------------------

# 11. Idempotency

-   Unique Bull Job ID
-   DB status verification
-   Ignore already SENT emails

------------------------------------------------------------------------

# 12. API Design

POST /auth/google

POST /emails/schedule

GET /emails/scheduled

GET /emails/sent

GET /campaigns

------------------------------------------------------------------------

# 13. Frontend

Pages: - Login - Dashboard - Compose Modal

Components: - Header - Sidebar - Email Table - Upload - Date Picker -
Toasts

------------------------------------------------------------------------

# 14. CSV Flow

Upload

↓

Parse

↓

Validate

↓

Preview Count

↓

Submit

↓

Backend schedules jobs

------------------------------------------------------------------------

# 15. Docker

docker-compose

-   postgres
-   redis
-   backend
-   frontend

------------------------------------------------------------------------

# 16. Environment Variables

DATABASE_URL

REDIS_URL

GOOGLE_CLIENT_ID

GOOGLE_CLIENT_SECRET

ETHEREAL_USER

ETHEREAL_PASS

WORKER_CONCURRENCY

DEFAULT_DELAY_SECONDS

MAX_EMAILS_PER_HOUR

------------------------------------------------------------------------

# 17. Recommended Tech

Backend: - Express - TypeScript - Drizzle ORM - PostgreSQL - BullMQ -
Redis - Nodemailer - Zod

Frontend: - Next.js - TailwindCSS - TanStack Query - React Hook Form -
Zod

Infra: - Docker Compose

------------------------------------------------------------------------

# 18. Folder Structure

``` text
reachinbox-assignment
│
├── backend
│   ├── src
│   │   ├── modules
│   │   ├── queue
│   │   ├── workers
│   │   ├── db
│   │   ├── config
│   │   └── app.ts
│
├── frontend
│   ├── app
│   ├── components
│   ├── hooks
│   ├── services
│   ├── types
│   └── utils
│
└── docker-compose.yml
```

------------------------------------------------------------------------

# 19. Future Improvements

-   Multiple queues
-   Retry strategy
-   Dead-letter queue
-   Priority emails
-   Multi-tenant isolation
-   Metrics (Prometheus)
-   Bull Board
-   OpenTelemetry tracing

------------------------------------------------------------------------

# 20. Interview Talking Points

-   BullMQ chosen over cron for persistence.
-   Redis stores delayed jobs.
-   PostgreSQL is source of truth.
-   Workers are stateless.
-   Redis counters implement distributed rate limiting.
-   Deterministic Job IDs provide idempotency.
-   Docker makes the stack reproducible.
