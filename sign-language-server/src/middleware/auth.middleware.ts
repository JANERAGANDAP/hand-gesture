import { Request, Response, NextFunction } from "express";
import { verifyToken, AuthTokenPayload, AppRole } from "../utils/auth";
import prisma from "../config/prisma";

export interface AuthedRequest extends Request {
  user?: AuthTokenPayload;
}

/**
 * Verifies the Bearer token on the request and attaches the decoded
 * user to req.user. Also re-checks the database for the user's latest
 * role so role updates take effect immediately without requiring re-login.
 * Responds 401 if missing/invalid.
 */
export async function authenticate(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Authentication required",
    });
  }

  try {
    const user = verifyToken(token);
    if (typeof user.id === "number") {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true, name: true, email: true },
      });
      if (dbUser) {
        user.role = dbUser.role as AppRole;
        if (dbUser.name) user.name = dbUser.name;
        if (dbUser.email) user.email = dbUser.email;
      }
    }
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      error: "Invalid or expired session",
    });
  }
}

/**
 * Use after `authenticate`. Restricts a route to the given roles.
 * Example: router.delete("/:id", authenticate, requireRole("ADMIN"), handler)
 */
export function requireRole(...roles: AppRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: "You don't have permission to do this",
      });
    }
    return next();
  };
}
