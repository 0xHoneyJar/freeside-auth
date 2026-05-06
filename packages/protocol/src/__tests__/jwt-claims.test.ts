/**
 * Tests for JWTClaim schema + assertTenantBoundary helper.
 *
 * Covers:
 * - Valid mibera claim parses
 * - Multi-chain wallets (cubquest shape) parses
 * - Invalid tenant pattern rejected
 * - Cross-tenant assertion throws TenantAssertionError (I6 invariant)
 * - Reserved fields (pool_id, byok, req_hash) optional and accepted
 */

import { describe, expect, it } from 'bun:test';
import {
  JWTClaimSchema,
  assertTenantBoundary,
  TenantAssertionError,
  type JWTClaim,
} from '../jwt-claims';

const validMiberaClaim: JWTClaim = {
  sub: 'midi-profiles-id-abc123',
  tenant: 'mibera',
  wallets: [{ chain: 'ethereum', address: '0x1234567890abcdef1234567890abcdef12345678' }],
  iss: 'arrakis',
  aud: 'mibera',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  jti: '550e8400-e29b-41d4-a716-446655440000',
  v: 1,
  tier: 'verified',
  display_name: '@soju',
  discord_id: '123456789012345678',
};

describe('JWTClaimSchema', () => {
  it('accepts valid mibera claim', () => {
    const parsed = JWTClaimSchema.parse(validMiberaClaim);
    expect(parsed.tenant).toBe('mibera');
    expect(parsed.wallets).toHaveLength(1);
  });

  it('accepts multi-chain wallets (cubquest shape)', () => {
    const cubquestClaim: JWTClaim = {
      ...validMiberaClaim,
      tenant: 'cubquest',
      aud: 'cubquest',
      wallets: [
        { chain: 'ethereum', address: '0xeeee...' },
        { chain: 'solana', address: 'So11111111111111111111111111111111111111112' },
      ],
    };
    const parsed = JWTClaimSchema.parse(cubquestClaim);
    expect(parsed.wallets).toHaveLength(2);
    expect(parsed.wallets[0]?.chain).toBe('ethereum');
    expect(parsed.wallets[1]?.chain).toBe('solana');
  });

  it('rejects invalid tenant pattern (uppercase)', () => {
    const invalidClaim = { ...validMiberaClaim, tenant: 'Mibera' };
    expect(() => JWTClaimSchema.parse(invalidClaim)).toThrow();
  });

  it('rejects invalid tenant pattern (starts with digit)', () => {
    const invalidClaim = { ...validMiberaClaim, tenant: '1mibera' };
    expect(() => JWTClaimSchema.parse(invalidClaim)).toThrow();
  });

  it('rejects v != 1 (forward-compat versioning)', () => {
    const invalidClaim = { ...validMiberaClaim, v: 2 };
    expect(() => JWTClaimSchema.parse(invalidClaim)).toThrow();
  });

  it('accepts reserved fields (pool_id, byok, req_hash) as optional', () => {
    const withReserved = {
      ...validMiberaClaim,
      pool_id: 'pool-abc',
      byok: true,
      req_hash: 'sha256:0xdeadbeef',
    };
    const parsed = JWTClaimSchema.parse(withReserved);
    expect(parsed.pool_id).toBe('pool-abc');
    expect(parsed.byok).toBe(true);
  });

  it('rejects unknown additional properties (.strict())', () => {
    const withExtra = { ...validMiberaClaim, hacker_field: 'pwn' };
    expect(() => JWTClaimSchema.parse(withExtra)).toThrow();
  });
});

describe('assertTenantBoundary (I6 invariant)', () => {
  it('returns claims when tenant matches', () => {
    const result = assertTenantBoundary(validMiberaClaim, 'mibera');
    expect(result).toBe(validMiberaClaim);
  });

  it('throws TenantAssertionError when tenant mismatches', () => {
    expect(() => assertTenantBoundary(validMiberaClaim, 'cubquest')).toThrow(
      TenantAssertionError,
    );
  });

  it('error carries got + expected for operator-readable diagnostics', () => {
    try {
      assertTenantBoundary(validMiberaClaim, 'cubquest');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TenantAssertionError);
      const err = e as TenantAssertionError;
      expect(err.got).toBe('mibera');
      expect(err.expected).toBe('cubquest');
      expect(err.message).toContain('claimed=mibera');
      expect(err.message).toContain('expected=cubquest');
    }
  });

  it('error name is TenantAssertionError (not generic Error)', () => {
    try {
      assertTenantBoundary(validMiberaClaim, 'wrong');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).name).toBe('TenantAssertionError');
    }
  });
});
