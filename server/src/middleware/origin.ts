import type { RequestHandler } from 'express';
import { config } from '../config.js';

/** SameSite cookies alone do not exclude another app on a sibling host/port. */
export const requireSameOrigin: RequestHandler = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (req.get('sec-fetch-site') === 'cross-site') {
    res.status(403).json({ error: 'Cross-origin API requests are not allowed' });
    return;
  }
  // Git and non-browser CLI clients do not send Origin. Browser requests that
  // do send one must match this host or the operator's configured public URL.
  if (origin) {
    const allowed = new Set([`${req.protocol}://${req.get('host')}`]);
    if (config.publicUrl) {
      try { allowed.add(new URL(config.publicUrl).origin); } catch { /* invalid configuration */ }
    }
    if (!allowed.has(origin)) {
      res.status(403).json({ error: 'Cross-origin API requests are not allowed' });
      return;
    }
  }
  next();
};
