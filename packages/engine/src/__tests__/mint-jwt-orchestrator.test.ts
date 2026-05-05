/**
 * Tests for MintJWTOrchestrator: tenant-boundary guard · adapter dispatch ·
 * delegation pattern · error paths.
 *
 * Mocks TenantAdapter + JWTSigner so we exercise pure orchestration logic
 * without HTTP or DB.
 */

import { describe, expect, it } from 'bun:test';
import type {
  TenantAdapter,
  TenantUserIdentity,
  JWTSigner,
} from '@freeside-auth/ports';
import type { JWTClaim } from '@freeside-auth/protocol';
import {
  MintJWTOrchestrator,
  MintError,
} from '../mint-jwt-orchestrator';
import {
  TenantRegistry,
  UnknownTenantError,
} from '../tenant-registry';
import type { TenantConfig } from '../tenant-config';

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

const cubquestConfig: TenantConfig = {
  id: 'cubquest',
  name: 'CubQuests',
  substrate: 'postgres',
  shape: 'unified',
  chains: ['ethereum', 'solana'],
  dynamic_user_id_present: true,
  connection: { env_var: 'TENANT_CUBQUEST_DATABASE_URL' },
  user_table: {
    name: 'profiles',
    wallet_column: 'address',
    sol_address_column: 'sol_address',
    dynamic_user_id_column: 'dynamic_user_id',
  },
  archive_only: false,
};

interface MockAdapterState {
  resolveResult: TenantUserIdentity | null;
  fetchClaimsResult: Record<string, unknown>;
}

const mockAdapter = (
  config: TenantConfig,
  state: MockAdapterState,
): TenantAdapter => ({
  id: config.id,
  config: {
    id: config.id,
    name: config.name,
    substrate: config.substrate,
    shape: config.shape,
    chains: config.chains,
    dynamic_user_id_present: config.dynamic_user_id_present,
    archive_only: config.archive_only,
    connection: config.connection,
    user_table: config.user_table,
  },
  resolveCredential: async () => state.resolveResult,
  fetchClaims: async () => state.fetchClaimsResult,
  ping: async () => ({ ok: true, latency_ms: 1, substrate: config.substrate }),
});

class MockSigner implements JWTSigner {
  public lastClaims: JWTClaim | null = null;
  public shouldThrow: boolean = false;

  async sign(claims: JWTClaim): Promise<string> {
    if (this.shouldThrow) throw new Error('mock-signer-failed');
    this.lastClaims = claims;
    return `mock.jwt.${claims.jti}`;
  }
}

const miberaIdentity: TenantUserIdentity = {
  tenant_id: 'mibera',
  user_id: 'midi-id-abc',
  wallets: [
    {
      chain: 'ethereum',
      address: '0xabc',
      verified_via: 'dynamic',
      linked_at: '2026-05-04T00:00:00Z',
      primary: true,
    },
  ],
  display_name: 'soju',
  discord_id: '987654321',
};

describe('MintJWTOrchestrator.mintJwt — happy path', () => {
  it('mints JWT for mibera dynamic credential', async () => {
    const adapterState: MockAdapterState = {
      resolveResult: miberaIdentity,
      fetchClaimsResult: { tier: 'verified' },
    };

    let factoryCalled = 0;
    const registry = TenantRegistry.fromConfigs([miberaConfig], (c) => {
      factoryCalled++;
      return mockAdapter(c, adapterState);
    });
    const signer = new MockSigner();

    const orchestrator = new MintJWTOrchestrator(registry, signer, {
      issuer: 'freeside-auth',
      ttlSeconds: 3600,
      uuidv4: () => 'test-jti-1234',
      now: () => 1700000000,
    });

    const result = await orchestrator.mintJwt({
      tenant_id: 'mibera',
      credential: { type: 'dynamic', dynamic_user_id: 'dyn-abc' },
    });

    expect(factoryCalled).toBe(1);
    expect(result.jwt).toBe('mock.jwt.test-jti-1234');
    expect(result.claims.sub).toBe('midi-id-abc');
    expect(result.claims.tenant).toBe('mibera');
    expect(result.claims.aud).toBe('mibera');  // tenant-bound (PRD §13.2 D9)
    expect(result.claims.iss).toBe('freeside-auth');
    expect(result.claims.tier).toBe('verified');
    expect(result.claims.jti).toBe('test-jti-1234');
    expect(result.claims.iat).toBe(1700000000);
    expect(result.claims.exp).toBe(1700003600);
    expect(result.claims.v).toBe(1);
    expect(result.claims.wallets).toHaveLength(1);
    expect(result.claims.wallets[0]).toEqual({ chain: 'ethereum', address: '0xabc' });
    expect(result.claims.display_name).toBe('soju');
    expect(result.claims.discord_id).toBe('987654321');
    expect(signer.lastClaims).toEqual(result.claims);
  });

  it('preserves multi-chain wallets for cubquest', async () => {
    const cubquestIdentity: TenantUserIdentity = {
      tenant_id: 'cubquest',
      user_id: 'cub-id',
      wallets: [
        { chain: 'ethereum', address: '0xeth', verified_via: 'dynamic', linked_at: '2026-05-04T00:00:00Z' },
        { chain: 'solana', address: 'So111', verified_via: 'dynamic', linked_at: '2026-05-04T00:00:00Z' },
      ],
    };
    const adapterState: MockAdapterState = {
      resolveResult: cubquestIdentity,
      fetchClaimsResult: {},
    };

    const registry = TenantRegistry.fromConfigs([cubquestConfig], (c) =>
      mockAdapter(c, adapterState),
    );
    const signer = new MockSigner();
    const orchestrator = new MintJWTOrchestrator(registry, signer, {
      uuidv4: () => 'cub-jti',
      now: () => 1700000000,
    });

    const result = await orchestrator.mintJwt({
      tenant_id: 'cubquest',
      credential: { type: 'dynamic', dynamic_user_id: 'dyn-cub' },
    });

    expect(result.claims.wallets).toHaveLength(2);
    expect(result.claims.wallets[0]?.chain).toBe('ethereum');
    expect(result.claims.wallets[1]?.chain).toBe('solana');
    expect(result.claims.tenant).toBe('cubquest');
    expect(result.claims.aud).toBe('cubquest');
  });
});

describe('MintJWTOrchestrator.mintJwt — error paths', () => {
  it('throws UnknownTenantError when tenant not in registry', async () => {
    const registry = TenantRegistry.fromConfigs([miberaConfig], (c) =>
      mockAdapter(c, { resolveResult: null, fetchClaimsResult: {} }),
    );
    const signer = new MockSigner();
    const orchestrator = new MintJWTOrchestrator(registry, signer);

    await expect(
      orchestrator.mintJwt({
        tenant_id: 'nonexistent',
        credential: { type: 'dynamic', dynamic_user_id: 'x' },
      }),
    ).rejects.toThrow(UnknownTenantError);
  });

  it('throws MintError no_identity when adapter returns null', async () => {
    const registry = TenantRegistry.fromConfigs([miberaConfig], (c) =>
      mockAdapter(c, { resolveResult: null, fetchClaimsResult: {} }),
    );
    const signer = new MockSigner();
    const orchestrator = new MintJWTOrchestrator(registry, signer);

    try {
      await orchestrator.mintJwt({
        tenant_id: 'mibera',
        credential: { type: 'dynamic', dynamic_user_id: 'unknown' },
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(MintError);
      expect((e as MintError).code).toBe('no_identity');
    }
  });

  it('throws MintError tenant_mismatch when adapter returns identity for wrong tenant (PRD §13.1 D8)', async () => {
    const wrongTenantIdentity: TenantUserIdentity = {
      ...miberaIdentity,
      tenant_id: 'cubquest', // wrong! claimed mibera but resolved as cubquest
    };
    const registry = TenantRegistry.fromConfigs([miberaConfig], (c) =>
      mockAdapter(c, { resolveResult: wrongTenantIdentity, fetchClaimsResult: {} }),
    );
    const signer = new MockSigner();
    const orchestrator = new MintJWTOrchestrator(registry, signer);

    try {
      await orchestrator.mintJwt({
        tenant_id: 'mibera',
        credential: { type: 'dynamic', dynamic_user_id: 'dyn-abc' },
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(MintError);
      const err = e as MintError;
      expect(err.code).toBe('tenant_mismatch');
      expect(err.context?.claimed).toBe('mibera');
      expect(err.context?.resolved).toBe('cubquest');
      expect(err.message).toContain('claimed=mibera');
      expect(err.message).toContain('resolved=cubquest');
    }
  });

  it('throws MintError sign_failed when signer rejects', async () => {
    const registry = TenantRegistry.fromConfigs([miberaConfig], (c) =>
      mockAdapter(c, { resolveResult: miberaIdentity, fetchClaimsResult: {} }),
    );
    const signer = new MockSigner();
    signer.shouldThrow = true;
    const orchestrator = new MintJWTOrchestrator(registry, signer);

    try {
      await orchestrator.mintJwt({
        tenant_id: 'mibera',
        credential: { type: 'dynamic', dynamic_user_id: 'dyn-abc' },
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(MintError);
      expect((e as MintError).code).toBe('sign_failed');
      expect((e as MintError).message).toContain('mock-signer-failed');
    }
  });

  it('does NOT call signer when adapter returns null (no claims constructed)', async () => {
    const registry = TenantRegistry.fromConfigs([miberaConfig], (c) =>
      mockAdapter(c, { resolveResult: null, fetchClaimsResult: {} }),
    );
    const signer = new MockSigner();
    const orchestrator = new MintJWTOrchestrator(registry, signer);

    await expect(
      orchestrator.mintJwt({
        tenant_id: 'mibera',
        credential: { type: 'dynamic', dynamic_user_id: 'unknown' },
      }),
    ).rejects.toThrow();
    expect(signer.lastClaims).toBeNull();
  });
});

describe('MintJWTOrchestrator.resolveIdentity (no JWT minted)', () => {
  it('returns identity without calling signer', async () => {
    const registry = TenantRegistry.fromConfigs([miberaConfig], (c) =>
      mockAdapter(c, { resolveResult: miberaIdentity, fetchClaimsResult: {} }),
    );
    const signer = new MockSigner();
    const orchestrator = new MintJWTOrchestrator(registry, signer);

    const identity = await orchestrator.resolveIdentity({
      tenant_id: 'mibera',
      credential: { type: 'dynamic', dynamic_user_id: 'dyn-abc' },
    });

    expect(identity.tenant_id).toBe('mibera');
    expect(identity.user_id).toBe('midi-id-abc');
    expect(signer.lastClaims).toBeNull();
  });

  it('still enforces tenant-boundary guard (I6)', async () => {
    const wrong: TenantUserIdentity = { ...miberaIdentity, tenant_id: 'cubquest' };
    const registry = TenantRegistry.fromConfigs([miberaConfig], (c) =>
      mockAdapter(c, { resolveResult: wrong, fetchClaimsResult: {} }),
    );
    const signer = new MockSigner();
    const orchestrator = new MintJWTOrchestrator(registry, signer);

    try {
      await orchestrator.resolveIdentity({
        tenant_id: 'mibera',
        credential: { type: 'dynamic', dynamic_user_id: 'dyn-abc' },
      });
      expect.unreachable();
    } catch (e) {
      expect((e as MintError).code).toBe('tenant_mismatch');
    }
  });
});

describe('MintJWTOrchestrator.mintJwt — claim construction details', () => {
  it('uses adapter-provided tier when present', async () => {
    const registry = TenantRegistry.fromConfigs([miberaConfig], (c) =>
      mockAdapter(c, {
        resolveResult: miberaIdentity,
        fetchClaimsResult: { tier: 'keeper' },
      }),
    );
    const signer = new MockSigner();
    const orchestrator = new MintJWTOrchestrator(registry, signer, {
      uuidv4: () => 'jti',
      now: () => 1700000000,
    });

    const result = await orchestrator.mintJwt({
      tenant_id: 'mibera',
      credential: { type: 'dynamic', dynamic_user_id: 'x' },
    });
    expect(result.claims.tier).toBe('keeper');
  });

  it('falls back to request.tier when adapter has none', async () => {
    const registry = TenantRegistry.fromConfigs([miberaConfig], (c) =>
      mockAdapter(c, { resolveResult: miberaIdentity, fetchClaimsResult: {} }),
    );
    const signer = new MockSigner();
    const orchestrator = new MintJWTOrchestrator(registry, signer, {
      uuidv4: () => 'jti',
      now: () => 1700000000,
    });

    const result = await orchestrator.mintJwt({
      tenant_id: 'mibera',
      credential: { type: 'dynamic', dynamic_user_id: 'x' },
      tier: 'public',
    });
    expect(result.claims.tier).toBe('public');
  });

  it('falls back to defaultTier (verified) when neither adapter nor request', async () => {
    const registry = TenantRegistry.fromConfigs([miberaConfig], (c) =>
      mockAdapter(c, { resolveResult: miberaIdentity, fetchClaimsResult: {} }),
    );
    const signer = new MockSigner();
    const orchestrator = new MintJWTOrchestrator(registry, signer, {
      uuidv4: () => 'jti',
      now: () => 1700000000,
    });

    const result = await orchestrator.mintJwt({
      tenant_id: 'mibera',
      credential: { type: 'dynamic', dynamic_user_id: 'x' },
    });
    expect(result.claims.tier).toBe('verified');
  });
});
