import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { findUserById, UserRecord } from '../db/authDb.js';

export interface JwtUserPayload {
  userId: string;
  email: string;
}

export function signUserToken(user: UserRecord): string {
  const payload: JwtUserPayload = {
    userId: user.id,
    email: user.email,
  };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as any,
  });
}

export function verifyUserToken(
  token: string
): { valid: boolean; payload?: JwtUserPayload; error?: string } {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtUserPayload;
    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Invalid or expired token' };
  }
}

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: UserRecord;
    }
  }
}

/** Extract Bearer token from header or cookie */
export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  // Check cookie if present
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/rr_auth_token=([^;]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

/** Middleware: require authenticated user */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  const result = verifyUserToken(token);
  if (!result.valid || !result.payload) {
    return res.status(401).json({ error: result.error || 'Invalid or expired authentication token.' });
  }

  const user = findUserById(result.payload.userId);
  if (!user) {
    return res.status(401).json({ error: 'User account not found.' });
  }

  req.user = user;
  next();
}

/** Middleware: attach user if token present, but do not block */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return next();
  }

  const result = verifyUserToken(token);
  if (result.valid && result.payload) {
    const user = findUserById(result.payload.userId);
    if (user) {
      req.user = user;
    }
  }
  next();
}
