import rateLimit, { Options } from "express-rate-limit";
import type { Request, Response } from "express";
function rateLimitedResponse(req: Request, res: Response) {
  res.status(429).json({
    success: false,
    error: "Too many requests — please slow down and try again shortly.",
    retryAfterSeconds: Math.ceil(
      (res.getHeader("Retry-After") as number) || 10,
    ),
  });
}
const baseOptions: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitedResponse,
};
export const recognitionLimiter = rateLimit({
  ...baseOptions,
  windowMs: 10_000,
  limit: 45,
});
export const aiLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60_000,
  limit: 15,
});
export const uploadLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60_000,
  limit: 30,
});
export const generalLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60_000,
  limit: 300,
});
