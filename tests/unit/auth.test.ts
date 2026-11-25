import { describe, expect, it } from 'vitest';
import {
  isAllowedOwnerEmail,
  isIdTokenRevoked,
  revokeIdToken,
} from '../../src/middleware/auth.ts';

describe('auth/verification', () => {
  it('allows any verified Google email when no restrictive allowlist is set', () => {
    expect(isAllowedOwnerEmail('sgz0905116141@gmail.com', true, [])).toBe(true);
    expect(isAllowedOwnerEmail('colleague@university.edu', true, [])).toBe(true);
  });

  it('rejects unverified or invalid emails', () => {
    expect(isAllowedOwnerEmail('sgz0905116141@gmail.com', false, [])).toBe(false);
    expect(isAllowedOwnerEmail('colleague@university.edu', undefined, [])).toBe(false);
    expect(isAllowedOwnerEmail(null, true, [])).toBe(false);
    expect(isAllowedOwnerEmail('   ', true, [])).toBe(false);
  });

  it('respects optional allowlist when explicitly configured', () => {
    expect(
      isAllowedOwnerEmail('lab-peer@university.edu', true, ['lab-peer@university.edu']),
    ).toBe(true);
    expect(
      isAllowedOwnerEmail('outsider@example.com', true, ['lab-peer@university.edu']),
    ).toBe(false);
  });

  it('immediately revokes logged-out ID tokens locally without Identity Toolkit IAM calls', () => {
    const sampleToken = 'sample-jwt-token-123';
    expect(isIdTokenRevoked(sampleToken)).toBe(false);
    revokeIdToken(sampleToken);
    expect(isIdTokenRevoked(sampleToken)).toBe(true);
  });
});
