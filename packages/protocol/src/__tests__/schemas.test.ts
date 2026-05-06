/**
 * Tests for User · Wallet · IdentityComponent · DynamicCredentialProof ·
 * ResolveResult schemas. Coverage: positive parse + .strict() rejection +
 * branded type round-trip.
 */

import { describe, expect, it } from 'bun:test';
import { UserSchema, type User } from '../user';
import { WalletSchema, type Wallet } from '../wallet';
import { IdentityComponentSchema, type IdentityComponent } from '../identity-component';
import {
  DynamicCredentialProofSchema,
  type DynamicCredentialProof,
} from '../credential-dynamic';
import { ResolveResultSchema, type ResolveResult } from '../resolve-result';
import { UserId, WalletAddress, MiberaId, TenantSlug } from '../types';

describe('WalletSchema', () => {
  it('accepts valid EVM wallet', () => {
    const w: Wallet = {
      chain: 'ethereum',
      address: '0x1234567890abcdef1234567890abcdef12345678',
      verified_via: 'dynamic',
      linked_at: '2026-05-04T00:00:00Z',
    };
    expect(() => WalletSchema.parse(w)).not.toThrow();
  });

  it('accepts solana wallet (cubquest)', () => {
    const w: Wallet = {
      chain: 'solana',
      address: 'So11111111111111111111111111111111111111112',
      verified_via: 'dynamic',
      linked_at: '2026-05-04T00:00:00Z',
    };
    expect(() => WalletSchema.parse(w)).not.toThrow();
  });

  it('rejects unknown chain', () => {
    const w = { chain: 'ripple', address: 'rXXX', verified_via: 'siwe', linked_at: '2026-05-04T00:00:00Z' };
    expect(() => WalletSchema.parse(w)).toThrow();
  });

  it('rejects invalid datetime format', () => {
    const w = { chain: 'ethereum', address: '0x...', verified_via: 'dynamic', linked_at: 'not-a-date' };
    expect(() => WalletSchema.parse(w)).toThrow();
  });
});

describe('UserSchema', () => {
  it('accepts valid user', () => {
    const u: User = {
      sub: 'midi-id-abc',
      wallets: [
        { chain: 'ethereum', address: '0xabc', verified_via: 'dynamic', linked_at: '2026-05-04T00:00:00Z' },
      ],
      tenant_memberships: ['mibera'],
      created_at: '2026-05-04T00:00:00Z',
    };
    expect(() => UserSchema.parse(u)).not.toThrow();
  });

  it('accepts multi-tenant user', () => {
    const u: User = {
      sub: 'midi-id-multi',
      wallets: [{ chain: 'ethereum', address: '0xabc', verified_via: 'dynamic', linked_at: '2026-05-04T00:00:00Z' }],
      tenant_memberships: ['mibera', 'cubquest'],
      created_at: '2026-05-04T00:00:00Z',
    };
    expect(() => UserSchema.parse(u)).not.toThrow();
  });

  it('rejects invalid tenant pattern', () => {
    const u = {
      sub: 'midi-id-abc',
      wallets: [],
      tenant_memberships: ['MIBERA'],
      created_at: '2026-05-04T00:00:00Z',
    };
    expect(() => UserSchema.parse(u)).toThrow();
  });
});

describe('IdentityComponentSchema', () => {
  it('accepts minimal component (just user_sub)', () => {
    const c: IdentityComponent = { user_sub: 'midi-id-abc' };
    expect(() => IdentityComponentSchema.parse(c)).not.toThrow();
  });

  it('accepts full component with mibera binding', () => {
    const c: IdentityComponent = {
      user_sub: 'midi-id-abc',
      credentials: [{ type: 'dynamic', credential_id: 'dyn-user-123', linked_at: '2026-05-04T00:00:00Z' }],
      handle: '@soju',
      discord_id: '123456789012345678',
      mibera_id: 507,
      pfp_url: 'https://assets.0xhoneyjar.xyz/Mibera/grails/mongolian.webp',
      bio: 'cave art that woke up',
    };
    expect(() => IdentityComponentSchema.parse(c)).not.toThrow();
  });

  it('rejects mibera_id out of range (>10000)', () => {
    const c = { user_sub: 'x', mibera_id: 10001 };
    expect(() => IdentityComponentSchema.parse(c)).toThrow();
  });

  it('rejects bio over 280 chars (Discord-medium budget)', () => {
    const c = { user_sub: 'x', bio: 'a'.repeat(281) };
    expect(() => IdentityComponentSchema.parse(c)).toThrow();
  });
});

describe('DynamicCredentialProofSchema', () => {
  it('accepts minimal Dynamic proof', () => {
    const p: DynamicCredentialProof = { type: 'dynamic', dynamic_user_id: 'dyn-abc-123' };
    expect(() => DynamicCredentialProofSchema.parse(p)).not.toThrow();
  });

  it('accepts proof with verified_credentials', () => {
    const p: DynamicCredentialProof = {
      type: 'dynamic',
      dynamic_user_id: 'dyn-abc-123',
      verified_credentials: [
        { id: 'cred-1', format: 'blockchain', chain: 'ethereum', address: '0xabc' },
        { id: 'cred-2', format: 'social', wallet_provider: 'twitter' },
      ],
    };
    expect(() => DynamicCredentialProofSchema.parse(p)).not.toThrow();
  });

  it('rejects type !== "dynamic"', () => {
    const p = { type: 'siwe', dynamic_user_id: 'x' };
    expect(() => DynamicCredentialProofSchema.parse(p)).toThrow();
  });
});

describe('ResolveResultSchema', () => {
  it('accepts found-via-primary result', () => {
    const r: ResolveResult = {
      found: true,
      wallet: {
        chain: 'ethereum',
        address: '0xabc',
        verified_via: 'dynamic',
        linked_at: '2026-05-04T00:00:00Z',
      },
      handle: '@soju',
      mibera_id: 507,
      resolved_via: 'primary',
    };
    expect(() => ResolveResultSchema.parse(r)).not.toThrow();
  });

  it('accepts anon fallback (found=false)', () => {
    const r: ResolveResult = {
      found: false,
      resolved_via: 'anon',
    };
    expect(() => ResolveResultSchema.parse(r)).not.toThrow();
  });

  it('rejects unknown resolved_via', () => {
    const r = { found: true, resolved_via: 'mystery-tier' };
    expect(() => ResolveResultSchema.parse(r)).toThrow();
  });
});

describe('Branded types', () => {
  it('UserId brand erases to string at runtime', () => {
    const id = UserId('midi-abc');
    expect(typeof id).toBe('string');
    expect(String(id)).toBe('midi-abc');
  });

  it('WalletAddress brand erases to string at runtime', () => {
    const addr = WalletAddress('0xabc');
    expect(typeof addr).toBe('string');
  });

  it('MiberaId brand erases to number at runtime', () => {
    const id = MiberaId(507);
    expect(typeof id).toBe('number');
    expect(Number(id)).toBe(507);
  });

  it('TenantSlug brand erases to string at runtime', () => {
    const t = TenantSlug('mibera');
    expect(String(t)).toBe('mibera');
  });
});
