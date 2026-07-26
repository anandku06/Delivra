import { Router } from "express";
import { googleLogin, getMe } from "./auth.controller.js";
import { requireAuth } from "./auth.middleware.js";

const router = Router();

router.post("/google", googleLogin);
router.get("/me", requireAuth, getMe);

export default router;
