import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";

import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import authRoutes from "./modules/auth/auth.routes.js";
import emailRoutes from "./modules/email/email.routes.js";
import campaignRoutes from "./modules/campaign/campaign.routes.js";
import { startEmailWorker } from "./workers/emailWorker.js";
import { getTransporter } from "./sender/mailer.js";
import { recoverUnqueuedEmails } from "./modules/email/email.service.js";

const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(helmet());
app.use(
  cors({
    // Use the Zod-validated env value (fixes C19: previously used raw process.env)
    origin: env.FRONTEND_URL,
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "delivra-backend",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/campaigns", campaignRoutes);

// ─── Error Handler ────────────────────────────────────────────────────────────

app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────

async function start() {
  console.log("🚀 Starting Delivra backend...");

  // Initialize Ethereal SMTP transport
  try {
    await getTransporter();
  } catch (err) {
    console.error("⚠️ SMTP init failed — emails won't send:", err);
  }

  // Recover any SCHEDULED emails that were not enqueued due to a prior crash
  // (emails with bullJobId = NULL are safe to re-enqueue; addEmailJob uses
  // deterministic IDs so re-running on already-queued emails is a no-op)
  try {
    await recoverUnqueuedEmails();
  } catch (err) {
    console.error("⚠️ Recovery scan failed — some emails may be delayed:", err);
  }

  // Start the BullMQ email worker
  const worker = startEmailWorker();
  console.log("📧 Email worker started");

  // Start Express server and keep a reference for graceful shutdown
  const server = app.listen(env.PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║                                                  ║
║   🚀 Delivra Backend running on port ${env.PORT}        ║
║                                                  ║
║   API:    http://localhost:${env.PORT}/api             ║
║   Health: http://localhost:${env.PORT}/api/health      ║
║                                                  ║
╚══════════════════════════════════════════════════╝
    `);
  });

  /**
   * Graceful shutdown (C6 fix):
   * Previously the HTTP server was not closed before the worker, so new requests
   * could arrive while the worker was draining. The corrected order is:
   *   1. Stop accepting new HTTP connections (server.close)
   *   2. Let the worker finish any in-progress jobs (worker.close)
   *   3. Exit
   */
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);

    // 1. Stop accepting new connections
    server.close(() => {
      console.log("✅ HTTP server closed");
    });

    // 2. Finish in-flight jobs and close the worker
    await worker.close();
    console.log("✅ Worker closed");

    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((err) => {
  console.error("❌ Failed to start:", err);
  process.exit(1);
});

export default app;
