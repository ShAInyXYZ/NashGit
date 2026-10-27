import rateLimit from 'express-rate-limit';

/** Protect login from brute-force attempts. */
export const loginLimiter = rateLimit({
  ipv6Subnet: 56,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Try again later.' },
});

/** Limit git transport requests to contain token brute-force cost. */
export const gitLimiter = rateLimit({
  ipv6Subnet: 56,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many git requests. Try again later.' },
});
