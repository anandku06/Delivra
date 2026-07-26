import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users, type User } from "../../db/schema.js";
import { env } from "../../config/env.js";

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

interface GoogleProfile {
  googleId: string;
  name: string;
  email: string;
  avatar: string | null;
}

/**
 * Verify a Google ID token and extract the user profile.
 */
export async function verifyGoogleToken(
  idToken: string
): Promise<GoogleProfile> {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error("Invalid Google token: no payload");
  }

  return {
    googleId: payload.sub,
    name: payload.name ?? "Unknown",
    email: payload.email ?? "",
    avatar: payload.picture ?? null,
  };
}

/**
 * Insert or update a user record based on their Google ID.
 * Returns the full user record.
 */
export async function upsertUser(profile: GoogleProfile): Promise<User> {
  // Try to find existing user
  const existing = await db.query.users.findFirst({
    where: eq(users.googleId, profile.googleId),
  });

  if (existing) {
    // Update name/email/avatar in case they changed
    const [updated] = await db
      .update(users)
      .set({
        name: profile.name,
        email: profile.email,
        avatar: profile.avatar,
      })
      .where(eq(users.googleId, profile.googleId))
      .returning();

    return updated!;
  }

  // Create new user
  const [newUser] = await db
    .insert(users)
    .values({
      googleId: profile.googleId,
      name: profile.name,
      email: profile.email,
      avatar: profile.avatar,
    })
    .returning();

  return newUser!;
}

/**
 * Generate a JWT for the authenticated user.
 */
export function generateJwt(user: User): string {
  return jwt.sign(
    { userId: user.id, email: user.email },
    env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

/**
 * Verify and decode a JWT token.
 */
export function verifyJwt(token: string): { userId: string; email: string } {
  return jwt.verify(token, env.JWT_SECRET) as {
    userId: string;
    email: string;
  };
}

/**
 * Find a user by their ID.
 */
export async function getUserById(userId: string): Promise<User | undefined> {
  return db.query.users.findFirst({
    where: eq(users.id, userId),
  });
}
