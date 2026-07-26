import type { Request, Response } from "express";
import {
  verifyGoogleToken,
  upsertUser,
  generateJwt,
} from "./auth.service.js";

/**
 * POST /api/auth/google
 * Accepts { idToken } from the frontend Google sign-in,
 * verifies it, upserts the user, and returns a JWT.
 */
export async function googleLogin(
  req: Request,
  res: Response
): Promise<void> {
  const { idToken } = req.body;

  if (!idToken || typeof idToken !== "string") {
    res.status(400).json({ error: "idToken is required" });
    return;
  }

  try {
    const profile = await verifyGoogleToken(idToken);
    const user = await upsertUser(profile);
    const token = generateJwt(user);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
      },
    });
  } catch (err) {
    console.error("Google auth error:", err);
    res.status(401).json({ error: "Invalid Google token" });
  }
}

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's profile.
 */
export async function getMe(req: Request, res: Response): Promise<void> {
  const user = req.user!;

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
  });
}
