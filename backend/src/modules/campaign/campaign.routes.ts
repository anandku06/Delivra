import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { getCampaignsHandler } from "../email/email.controller.js";

const router = Router();

router.use(requireAuth);
router.get("/", getCampaignsHandler);

export default router;
