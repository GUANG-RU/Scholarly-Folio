import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';

export interface OwnerAuthRequest extends Request {
  owner?: {
    uid: string;
    email: string;
    token: DecodedIdToken;
  };
}

const REVOKED_TOKENS = new Map<string, number>();

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function revokeIdToken(token: string): void {
  const now = Date.now();
  for (const [key, expiresAt] of REVOKED_TOKENS.entries()) {
    if (expiresAt <= now) {
      REVOKED_TOKENS.delete(key);
    }
  }
  REVOKED_TOKENS.set(hashToken(token), now + 60 * 60 * 1000);
}

export function isIdTokenRevoked(token: string): boolean {
  const expiresAt = REVOKED_TOKENS.get(hashToken(token));
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    REVOKED_TOKENS.delete(hashToken(token));
    return false;
  }
  return true;
}

export function getOptionalAllowlist(): string[] {
  const raw = (process.env.ALLOWED_EMAILS || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedOwnerEmail(
  email?: string | null,
  emailVerified?: boolean,
  allowlist: string[] = getOptionalAllowlist(),
): boolean {
  if (!email || emailVerified !== true) {
    return false;
  }
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    return false;
  }
  if (allowlist.length > 0) {
    return allowlist.includes(normalized);
  }
  return true;
}

export const requireOwnerSession = async (
  req: OwnerAuthRequest,
  res: Response,
  next: NextFunction,
) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing authentication token' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token || isIdTokenRevoked(token)) {
    return res.status(401).json({ error: 'Unauthorized: Empty or revoked authentication token' });
  }

  let decodedToken: DecodedIdToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(token);
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }

  if (!isAllowedOwnerEmail(decodedToken.email, decodedToken.email_verified)) {
    return res.status(403).json({
      error: 'Forbidden: Verified Google email is required to access the workspace',
    });
  }

  req.owner = {
    uid: decodedToken.uid,
    email: decodedToken.email!,
    token: decodedToken,
  };
  return next();
};
