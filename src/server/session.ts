import { createHash, randomBytes } from 'node:crypto';

import type { CookieOptions } from 'express';

export const SESSION_COOKIE_NAME = 'gradion_session';
export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function sessionCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_LIFETIME_MS,
  };
}

export function clearSessionCookieOptions(secure: boolean): CookieOptions {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions(secure);
  return options;
}
