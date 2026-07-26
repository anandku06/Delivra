import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  scheduleEmailsHandler,
  getScheduledEmailsHandler,
  getSentEmailsHandler,
  getCampaignsHandler,
  deleteScheduledEmailHandler,
} from "./email.controller.js";

const router = Router();

// All email routes require authentication
router.use(requireAuth);

router.post("/schedule", scheduleEmailsHandler);
router.get("/scheduled", getScheduledEmailsHandler);
router.get("/sent", getSentEmailsHandler);
router.delete("/:id", deleteScheduledEmailHandler);

export default router;
