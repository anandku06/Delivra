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

const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
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

  // Start the BullMQ email worker
  const worker = startEmailWorker();
  console.log("📧 Email worker started");

  // Start Express server
  app.listen(env.PORT, () => {
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

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);

    // Close the worker (finishes current jobs)
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
