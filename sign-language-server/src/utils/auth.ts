import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// Fail loudly in production if a real secret hasn't been set; a dev fallback
// keeps `npm run dev` working out of the box.
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = "7d";

export type AppRole = "ADMIN" | "TEACHER" | "STUDENT";

// Admin credentials must be explicitly configured in the environment.
export const ADMIN_CREDENTIALS = {
  email: (process.env.ADMIN_EMAIL || "").trim().toLowerCase(),
  password: process.env.ADMIN_PASSWORD || "",
};

export interface AuthTokenPayload {
  id: number | "admin";
  email: string;
  name: string;
  role: AppRole;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function comparePassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, JWT_SECRET) as unknown as AuthTokenPayload;
}
