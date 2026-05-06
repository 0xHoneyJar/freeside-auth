/**
 * Tests for PostgresSplitAdapter (mibera shape).
 *
 * Strategy: mock PgPoolLike to assert query construction + result mapping.
 * Live integration test deferred to operator-bounded smoke (B-1.14) against
 * actual mibera Railway DB (TENANT_MIBERA_DATABASE_URL).
 */

import { describe, expect, it } from 'bun:test';
import type { TenantConfig } from '@freeside-auth/engine';
import {
  PostgresSplitAdapter,
  type PgPoolLike,
  type MidiProfileRow,
} from '../postgres-split-adapter';

const miberaConfig: TenantConfig = {
  id: 'mibera',
  name: 'Mibera',
  substrate: 'postgres',
  shape: 'split',
  chains: ['ethereum'],
  dynamic_user_id_present: true,
  connection: { env_var: 'TENANT_MIBERA_DATABASE_URL' },
  user_table: {
    name: 'midi_profiles',
    wallet_column: 'wallet_address',
    dynamic_user_id_column: 'dynamic_user_id',
  },
  archive_only: false,
};

const sampleRow: MidiProfileRow = {
  id: 'midi-id-abc-123',
  dynamic_user_id: 'dyn-user-xyz',
  wallet_address: '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
  discord_id: '987654321098765432',
  discord_username: 'soju#1234',
  display_name: 'soju',
  twitter_handle: 'zksoju',
  created_at: '2026-01-01T00:00:00Z',
};

class MockPool implements PgPoolLike {
  public calls: Array<{ text: string; params?: unknown[] }> = [];
  public response: { rows: MidiProfileRow[] } = { rows: [] };

  async query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
    this.calls.push({ text, params });
    return this.response as unknown as { rows: T[] };
  }
}

describe('PostgresSplitAdapter constructor', () => {
  it('accepts valid mibera config', () => {
    const pool = new MockPool();
    const adapter = new PostgresSplitAdapter(miberaConfig, pool);
    expect(adapter.id).toBe('mibera');
    expect(adapter.config.shape).toBe('split');
  });

  it('rejects non-split shape', () => {
    const wrongShape = { ...miberaConfig, shape: 'unified' as const };
    const pool = new MockPool();
    expect(() => new PostgresSplitAdapter(wrongShape, pool)).toThrow(
      /shape='split'/,
    );
  });

  it('rejects missing user_table', () => {
    const noTable = { ...miberaConfig, user_table: undefined };
    const pool = new MockPool();
    expect(() => new PostgresSplitAdapter(noTable, pool)).toThrow(/user_table/);
  });
});

describe('PostgresSplitAdapter.resolveCredential — dynamic path', () => {
  it('queries by dynamic_user_id', async () => {
    const pool = new MockPool();
    pool.response = { rows: [sampleRow] };
    const adapter = new PostgresSplitAdapter(miberaConfig, pool);

    const result = await adapter.resolveCredential({
      type: 'dynamic',
      dynamic_user_id: 'dyn-user-xyz',
    });

    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]?.text).toContain('dynamic_user_id = $1');
    expect(pool.calls[0]?.text).toContain('midi_profiles');
    expect(pool.calls[0]?.params).toEqual(['dyn-user-xyz']);
    expect(result).not.toBeNull();
    expect(result?.tenant_id).toBe('mibera');
    expect(result?.user_id).toBe('midi-id-abc-123');
    expect(result?.wallets).toHaveLength(1);
    expect(result?.wallets[0]?.chain).toBe('ethereum');
    expect(result?.wallets[0]?.address).toBe('0xabcdef1234567890abcdef1234567890abcdef12'); // lowercased
    expect(result?.wallets[0]?.verified_via).toBe('dynamic');
    expect(result?.wallets[0]?.primary).toBe(true);
    expect(result?.discord_id).toBe('987654321098765432');
    expect(result?.display_name).toBe('soju');
  });

  it('returns null when no row found', async () => {
    const pool = new MockPool();
    pool.response = { rows: [] };
    const adapter = new PostgresSplitAdapter(miberaConfig, pool);

    const result = await adapter.resolveCredential({
      type: 'dynamic',
      dynamic_user_id: 'unknown',
    });

    expect(result).toBeNull();
  });
});

describe('PostgresSplitAdapter.resolveCredential — siwe path', () => {
  it('queries by lowercased wallet_address', async () => {
    const pool = new MockPool();
    pool.response = { rows: [sampleRow] };
    const adapter = new PostgresSplitAdapter(miberaConfig, pool);

    const result = await adapter.resolveCredential({
      type: 'siwe',
      wallet: { chain: 'ethereum', address: '0xABCDEF1234567890ABCDEF1234567890ABCDEF12' },
    });

    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]?.text).toContain('LOWER(wallet_address)');
    expect(pool.calls[0]?.text).toContain('LOWER($1)');
    expect(result?.user_id).toBe('midi-id-abc-123');
  });

  it('returns null for unsupported chain (slice-B mibera EVM only)', async () => {
    const pool = new MockPool();
    const adapter = new PostgresSplitAdapter(miberaConfig, pool);

    const result = await adapter.resolveCredential({
      type: 'siwe',
      wallet: { chain: 'solana', address: 'So11111111111111111111111111111111111111112' },
    });

    expect(result).toBeNull();
    expect(pool.calls).toHaveLength(0); // no query attempted
  });
});

describe('PostgresSplitAdapter.resolveCredential — V2 paths return null', () => {
  it('passkey returns null (V2)', async () => {
    const pool = new MockPool();
    const adapter = new PostgresSplitAdapter(miberaConfig, pool);
    const result = await adapter.resolveCredential({
      type: 'passkey',
      credential_id: 'cred-1',
    });
    expect(result).toBeNull();
  });

  it('email-otp returns null (V2)', async () => {
    const pool = new MockPool();
    const adapter = new PostgresSplitAdapter(miberaConfig, pool);
    const result = await adapter.resolveCredential({
      type: 'email-otp',
      email: 'test@example.com',
    });
    expect(result).toBeNull();
  });

  it('solana-sign returns null (mibera is EVM-only · cubquest handles solana)', async () => {
    const pool = new MockPool();
    const adapter = new PostgresSplitAdapter(miberaConfig, pool);
    const result = await adapter.resolveCredential({
      type: 'solana-sign',
      wallet: { chain: 'solana', address: 'So111...' },
      signature: 'sig',
    });
    expect(result).toBeNull();
  });
});

describe('PostgresSplitAdapter.fetchClaims', () => {
  it('returns CMP-safe claim subset', async () => {
    const pool = new MockPool();
    pool.response = { rows: [sampleRow] };
    const adapter = new PostgresSplitAdapter(miberaConfig, pool);

    const claims = await adapter.fetchClaims('midi-id-abc-123');

    expect(claims).toEqual({
      tier: 'verified',
      display_name: 'soju',
      discord_id: '987654321098765432',
    });
    // CMP-boundary: no raw row, no UUIDs, no wallet
    expect(claims.id).toBeUndefined();
    expect(claims.wallet_address).toBeUndefined();
  });

  it('returns empty object when user not found', async () => {
    const pool = new MockPool();
    pool.response = { rows: [] };
    const adapter = new PostgresSplitAdapter(miberaConfig, pool);

    const claims = await adapter.fetchClaims('unknown-id');
    expect(claims).toEqual({});
  });

  it('falls back to discord_username when display_name absent', async () => {
    const pool = new MockPool();
    pool.response = {
      rows: [{ ...sampleRow, display_name: null }],
    };
    const adapter = new PostgresSplitAdapter(miberaConfig, pool);

    const claims = await adapter.fetchClaims('midi-id-abc-123');
    expect(claims.display_name).toBe('soju#1234');
  });
});

describe('PostgresSplitAdapter.ping', () => {
  it('returns ok=true on successful query', async () => {
    const pool = new MockPool();
    const adapter = new PostgresSplitAdapter(miberaConfig, pool);

    const result = await adapter.ping();
    expect(result.ok).toBe(true);
    expect(result.substrate).toBe('postgres');
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    expect(pool.calls[0]?.text).toBe('SELECT 1');
  });

  it('returns ok=false when query throws', async () => {
    const failPool: PgPoolLike = {
      query: async () => {
        throw new Error('connection refused');
      },
    };
    const adapter = new PostgresSplitAdapter(miberaConfig, failPool);

    const result = await adapter.ping();
    expect(result.ok).toBe(false);
    expect(result.substrate).toBe('postgres');
  });
});
