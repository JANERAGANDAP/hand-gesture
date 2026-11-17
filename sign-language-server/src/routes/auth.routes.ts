import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import prisma from "../config/prisma";
import { generalLimiter } from "../middleware/rateLimiters";
import {
  authenticate,
  AuthedRequest,
  requireRole,
} from "../middleware/auth.middleware";
import {
  ADMIN_CREDENTIALS,
  comparePassword,
  hashPassword,
  signToken,
} from "../utils/auth";

const router = Router();
router.use(generalLimiter);

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Decides TEACHER vs STUDENT for a brand-new account. Role is NEVER taken
// from the request body — it's derived server-side from the admin-managed
// TeacherInvite allowlist. No matching invite => STUDENT, always.
// Marks the invite as used so the same email can't be "re-invited" implicitly.
async function resolveRoleForNewUser(
  normalizedEmail: string,
): Promise<"TEACHER" | "STUDENT"> {
  const invite = await prisma.teacherInvite.findUnique({
    where: { email: normalizedEmail },
  });
  if (!invite) return "STUDENT";

  if (!invite.usedAt) {
    await prisma.teacherInvite.update({
      where: { email: normalizedEmail },
      data: { usedAt: new Date() },
    });
  }
  return "TEACHER";
}

function publicUser(user: {
  id: number | "admin";
  name: string;
  email: string;
  role: string;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

// Self-register with name, email, password, and optional role (STUDENT or TEACHER).
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role: requestedRole } = req.body ?? {};
    if (
      !name ||
      typeof name !== "string" ||
      !email ||
      typeof email !== "string" ||
      !password ||
      typeof password !== "string" ||
      password.length < 6
    ) {
      return res.status(400).json({
        success: false,
        error: "Name, email, and a password of at least 6 characters are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail === ADMIN_CREDENTIALS.email) {
      return res.status(400).json({
        success: false,
        error: "This email is reserved for administrator",
      });
    }

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "An account with this email already exists",
      });
    }

    // Auto STUDENT when registering. (Only becomes TEACHER if explicitly invited by Admin via TeacherInvite)
    const role: "TEACHER" | "STUDENT" = await resolveRoleForNewUser(normalizedEmail);

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        password: await hashPassword(password),
        role,
      },
    });

    const token = signToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: role as "TEACHER" | "STUDENT",
    });

    return res.status(201).json({
      success: true,
      token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({
      success: false,
      error: "Registration failed",
    });
  }
});

// Handles both the admin's fixed credentials and teacher DB accounts.
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    if (
      normalizedEmail === ADMIN_CREDENTIALS.email &&
      password === ADMIN_CREDENTIALS.password
    ) {
      const token = signToken({
        id: "admin",
        email: ADMIN_CREDENTIALS.email,
        name: "Administrator",
        role: "ADMIN",
      });
      return res.json({
        success: true,
        token,
        user: publicUser({
          id: "admin",
          name: "Administrator",
          email: ADMIN_CREDENTIALS.email,
          role: "ADMIN",
        }),
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (!user || !user.password || !(await comparePassword(password, user.password))) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password",
      });
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as "TEACHER" | "STUDENT" | "ADMIN",
    });

    return res.json({
      success: true,
      token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({
      success: false,
      error: "Login failed",
    });
  }
});

// "Continue with Google" — verifies the ID token the frontend got from
// Google Identity Services, then finds-or-creates an account. Google only
// proves identity (the email), never role — role comes from
// resolveRoleForNewUser exactly as it does for password registration, so a
// teacher and a student signing in with Google both land in the right place
// without ever being asked "which one are you?" (a self-reported answer
// there would be trivially fakeable). The admin account never signs in this way.
router.post("/google", async (req, res) => {
  try {
    const { credential } = req.body ?? {};
    if (!credential || typeof credential !== "string") {
      return res.status(400).json({
        success: false,
        error: "Missing Google credential",
      });
    }
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({
        success: false,
        error: "Google sign-in is not configured on this server",
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      return res.status(401).json({
        success: false,
        error: "Invalid Google token",
      });
    }

    const normalizedEmail = payload.email.toLowerCase();
    if (normalizedEmail === ADMIN_CREDENTIALS.email) {
      return res.status(403).json({
        success: false,
        error: "The admin account can't sign in with Google",
      });
    }

    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      const role = await resolveRoleForNewUser(normalizedEmail);
      user = await prisma.user.create({
        data: {
          name: payload.name || normalizedEmail.split("@")[0],
          email: normalizedEmail,
          googleId: payload.sub,
          role,
        },
      });
    } else if (!user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId: payload.sub },
      });
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as "TEACHER" | "STUDENT" | "ADMIN",
    });

    return res.json({
      success: true,
      token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error("Google auth error:", err);
    return res.status(401).json({
      success: false,
      error: "Google sign-in failed",
    });
  }
});

// Admin-only: view and manage the teacher allowlist. This is the ONLY way
// an account ever becomes TEACHER via self-service registration/Google —
// there is deliberately no endpoint that lets a user grant themselves or
// anyone else a role.
router.get(
  "/teacher-invites",
  authenticate,
  requireRole("ADMIN"),
  async (_req, res) => {
    const invites = await prisma.teacherInvite.findMany({
      orderBy: { createdAt: "desc" },
    });
    return res.json({ success: true, invites });
  },
);

router.post(
  "/teacher-invites",
  authenticate,
  requireRole("ADMIN"),
  async (req: AuthedRequest, res) => {
    const { email } = req.body ?? {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({ success: false, error: "Email is required" });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail === ADMIN_CREDENTIALS.email) {
      return res.status(400).json({ success: false, error: "This email is reserved" });
    }

    try {
      const invite = await prisma.teacherInvite.upsert({
        where: { email: normalizedEmail },
        update: {},
        create: {
          email: normalizedEmail,
          invitedBy: req.user?.email ?? "admin",
        },
      });

      // If the account already exists (e.g. they already signed up as a
      // STUDENT before being invited), promote it immediately rather than
      // waiting for them to log in again.
      const existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (existingUser && existingUser.role !== "TEACHER") {
        await prisma.user.update({
          where: { email: normalizedEmail },
          data: { role: "TEACHER" },
        });
        if (!invite.usedAt) {
          await prisma.teacherInvite.update({
            where: { email: normalizedEmail },
            data: { usedAt: new Date() },
          });
        }
      }

      return res.status(201).json({ success: true, invite });
    } catch (err) {
      console.error("Create teacher invite error:", err);
      return res.status(500).json({ success: false, error: "Failed to create invite" });
    }
  },
);

router.delete(
  "/teacher-invites/:email",
  authenticate,
  requireRole("ADMIN"),
  async (req: AuthedRequest, res) => {
    const normalizedEmail = decodeURIComponent(String(req.params.email))
      .trim()
      .toLowerCase();
    try {
      await prisma.teacherInvite.delete({ where: { email: normalizedEmail } });
      return res.json({ success: true });
    } catch {
      return res.status(404).json({ success: false, error: "Invite not found" });
    }
  },
);

router.get("/me", authenticate, (req: AuthedRequest, res) => {
  return res.json({
    success: true,
    user: req.user,
  });
});

export default router;
