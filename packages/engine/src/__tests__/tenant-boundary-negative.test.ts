/**
 * tenant-boundary-negative.test.ts — cross-tenant security regression
 * suite (cycle-B sprint-1 · B-1.16 · AC-B1.16).
 *
 * Validates the I6 (Tenant-Boundary Assertion) invariant across all the
 * paths a malicious or misrouted JWT might escalate cross-tenant access:
 *
 *   TBN-1: mibera credential resolves cubquest identity → MintJWTOrchestrator
 *          throws MintError(tenant_mismatch). The mint endpoint REFUSES
 *          to issue a JWT when the resolved identity's tenant doesn't
 *          match the claimed tenant. (PRD §13.1 D8 · I6 · sprint §13.3)
 *
 *   TBN-2: assertTenantBoundary throws TenantAssertionError when
 *          claims.tenant !== expected_tenant. Every consumer of verifyJwt
 *          MUST call this (or equivalent) before authorizing. The helper
 *          lives in @freeside-auth/protocol so all downstream verifiers
 *          (freeside-quests Sietch · loa-finn dispatch · ruggy MCP) share
 *          one assertion path.
 *
 *   TBN-3: token-swap defense — modifying claims.tenant in a signed token
 *          breaks the signature · the standard JWT verifier rejects.
 *          Tested at the conceptual level: the assertTenantBoundary helper
 *          operates on parsed claims AFTER signature verification, so the
 *          token-swap path is closed at the signature layer (jwks-validator).
 *
 *   TBN-4: positive control · same JWKS (single keypair · Lock-8) verifies
 *          tokens for both tenants correctly when claims match.
 *
 * # Cross-pack coverage (Sietch-side · NOT in this file)
 *
 *   Sietch Layer with expired JWT → recoverable verify_error (NOT anon-fallback)
 *   Sietch Layer with malformed JWT → recoverable verify_error (NOT anon-fallback)
 *
 * Both covered in `freeside-quests/packages/engine/src/__tests__/sietch.test.ts`
 * (cycle-B B-1.9). The Sietch Layer is the consumer of @freeside-auth/protocol's
 * VerifyError shape; testing the consumer-side mapping there is more direct
 * than mocking it from this side.
 *
 * Refs: bd-re39.1.16 · sprint-convergence-spine-2026-05-04 §13.3
 *       sdd-convergence-spine-2026-05-04 §11.4 + §13.4
 */

import { describe, expect, it } from 'bun:test';
import {
  assertTenantBoundary,
  TenantAssertionError,
  type JWTClaim,
  type TenantSlug,
} from '@freeside-auth/protocol';
import type {
  TenantAdapter,
  TenantUserIdentity,
  JWTSigner,
} from '@freeside-auth/ports';
import {
  MintJWTOrchestrator,
  MintError,
} from '../mint-jwt-orchestrator';
import { TenantRegistry } from '../tenant-registry';
import type { TenantConfig } from '../tenant-config';

// ---------------------------------------------------------------------------
// Fixtures (mirroring mint-jwt-orchestrator.test.ts shapes)
// ---------------------------------------------------------------------------

const miberaConfig: TenantConfig = {
  id: 'mibera' as TenantSlug,
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
  id: 'cubquest' as TenantSlug,
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

const mockAdapter = (
  config: TenantConfig,
  resolveResult: TenantUserIdentity | null,
): TenantAdapter => ({
  id: config.id,
  config,
  resolveCredential: async () => resolveResult,
  fetchClaims: async () => ({}),
  ping: async () => ({ ok: true, latency_ms: 1, substrate: config.substrate }),
});

class MockSigner implements JWTSigner {
  public lastClaims: JWTClaim | null = null;
  async sign(claims: JWTClaim): Promise<string> {
    this.lastClaims = claims;
    return `mock.jwt.${claims.jti}`;
  }
}

const buildClaims = (tenant: string, jti = 'test-jti-001'): JWTClaim => ({
  schema_version: '1.0',
  sub: 'user-' + tenant,
  tenant,
  wallets: [{ chain: 'ethereum', address: '0xabc' }],
  iss: 'freeside-auth',
  aud: tenant,
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  jti,
  v: 1,
});

// ---------------------------------------------------------------------------
// TBN-1 — Mint refuses cross-tenant identity resolution
// ---------------------------------------------------------------------------

describe('TBN-1 · mint refuses cubquest identity claimed as mibera (PRD §13.1 D8)', () => {
  it('MintJWTOrchestrator throws tenant_mismatch when adapter returns wrong-tenant identity', async () => {
    // Adversarial scenario: caller claims tenant_id='mibera' but the
    // adapter's resolveCredential returns an identity tagged with
    // tenant_id='cubquest' (e.g., misrouted DB lookup · stale cache ·
    // operator misconfig). The orchestrator's I6 guard MUST refuse.
    const wrongTenantIdentity: TenantUserIdentity = {
      tenant_id: 'cubquest', // adversarial · claimed mibera
      user_id: 'cub-001',
      wallets: [
        {
          chain: 'ethereum',
          address: '0xdef',
          verified_via: 'dynamic',
          linked_at: '2026-05-04T00:00:00Z',
        },
      ],
    };
    const registry = TenantRegistry.fromConfigs([miberaConfig], (c) =>
      mockAdapter(c, wrongTenantIdentity),
    );
    const signer = new MockSigner();
    const orchestrator = new MintJWTOrchestrator(registry, signer);

    let caught: MintError | null = null;
    try {
      await orchestrator.mintJwt({
        tenant_id: 'mibera',
        credential: { type: 'dynamic', dynamic_user_id: 'dyn-abc' },
      });
    } catch (e) {
      caught = e as MintError;
    }

    expect(caught).toBeInstanceOf(MintError);
    expect(caught?.code).toBe('tenant_mismatch');
    expect(caught?.context?.claimed).toBe('mibera');
    expect(caught?.context?.resolved).toBe('cubquest');
    // Critical: signer was NEVER called (no JWT exists for adversary to use)
    expect(signer.lastClaims).toBeNull();
  });

  it('reverse direction: cubquest mint with mibera-claiming identity also refused', async () => {
    const wrongTenantIdentity: TenantUserIdentity = {
      tenant_id: 'mibera',
      user_id: 'mib-001',
      wallets: [
        {
          chain: 'ethereum',
          address: '0xdef',
          verified_via: 'dynamic',
          linked_at: '2026-05-04T00:00:00Z',
        },
      ],
    };
    const registry = TenantRegistry.fromConfigs([cubquestConfig], (c) =>
      mockAdapter(c, wrongTenantIdentity),
    );
    const signer = new MockSigner();
    const orchestrator = new MintJWTOrchestrator(registry, signer);

    await expect(
      orchestrator.mintJwt({
        tenant_id: 'cubquest',
        credential: { type: 'dynamic', dynamic_user_id: 'dyn-x' },
      }),
    ).rejects.toThrow(MintError);
    expect(signer.lastClaims).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TBN-2 — assertTenantBoundary helper (consumer-side I6 enforcement)
// ---------------------------------------------------------------------------

describe('TBN-2 · assertTenantBoundary throws when claims.tenant ≠ expected_tenant', () => {
  it('throws TenantAssertionError on tenant mismatch', () => {
    const claims = buildClaims('mibera');
    let caught: TenantAssertionError | null = null;
    try {
      assertTenantBoundary(claims, 'cubquest');
    } catch (e) {
      caught = e as TenantAssertionError;
    }
    expect(caught).toBeInstanceOf(TenantAssertionError);
    expect(caught?.got).toBe('mibera');
    expect(caught?.expected).toBe('cubquest');
    expect(caught?.message).toContain('tenant_assertion_failed');
  });

  it('returns claims unchanged on match (positive control)', () => {
    const claims = buildClaims('mibera');
    const checked = assertTenantBoundary(claims, 'mibera');
    expect(checked).toBe(claims);
  });

  it('reverse direction: cubquest claim against expected mibera also rejects', () => {
    const claims = buildClaims('cubquest');
    expect(() => assertTenantBoundary(claims, 'mibera')).toThrow(
      TenantAssertionError,
    );
  });

  it('TenantAssertionError carries got + expected for telemetry', () => {
    const err = new TenantAssertionError('mibera', 'cubquest');
    expect(err.got).toBe('mibera');
    expect(err.expected).toBe('cubquest');
    expect(err.name).toBe('TenantAssertionError');
    expect(err.message).toContain('claimed=mibera');
    expect(err.message).toContain('expected=cubquest');
  });
});

// ---------------------------------------------------------------------------
// TBN-3 — Token-swap defense (signature is the load-bearing barrier)
// ---------------------------------------------------------------------------

describe('TBN-3 · token-swap defense (signature ≠ tampered claims)', () => {
  it('assertTenantBoundary operates on parsed claims · signature is the prior gate', () => {
    // Conceptual test: a malicious actor with a signed mibera JWT cannot
    // simply edit `tenant: 'cubquest'` in the payload — that would break
    // the signature. JWKS verification (jwks-validator.ts) is the gate
    // that catches the tampered token BEFORE assertTenantBoundary sees it.
    //
    // This test documents the layering: assertTenantBoundary trusts that
    // its input came from a verified token. The contract is enforced by
    // freeside-auth/packages/adapters/jwks-validator.ts (B-1.4 · existing
    // tests cover malformed/expired/unknown_kid cases).
    const claims = buildClaims('mibera');
    // After signature verify · the verifier returned these claims
    // verbatim from the signed payload. The downstream consumer asserts
    // tenant boundary. If the signature was forged, the verifier would
    // have errored before reaching this code path.
    expect(() => assertTenantBoundary(claims, 'mibera')).not.toThrow();
    // Token-swap simulation: imagine the adversary modified the payload
    // to claim cubquest. The verifier would reject because the signature
    // wouldn't match the new payload. This assertion fires AFTER verify.
    const swapped = { ...claims, tenant: 'cubquest' };
    expect(() => assertTenantBoundary(swapped as JWTClaim, 'mibera')).toThrow(
      TenantAssertionError,
    );
  });
});

// ---------------------------------------------------------------------------
// TBN-4 — Positive control · single JWKS verifies both tenants correctly
// ---------------------------------------------------------------------------

describe('TBN-4 · positive control · single JWKS shape works for multiple tenants (Lock-8)', () => {
  it('mibera and cubquest claims share the same shape · same verifier code path', () => {
    // Single keypair (Lock-8 V1) means the same JWKS verifies tokens for
    // every tenant. The CLAIMS differ; the verification doesn't. This test
    // confirms there's no per-tenant verifier branch that could be bypassed.
    const miberaClaims = buildClaims('mibera');
    const cubquestClaims = buildClaims('cubquest');

    // Both share the same required fields · same shape · same VERSION (v=1)
    expect(miberaClaims.v).toBe(cubquestClaims.v);
    expect(typeof miberaClaims.jti).toBe(typeof cubquestClaims.jti);
    expect(typeof miberaClaims.exp).toBe(typeof cubquestClaims.exp);

    // Each verifies against its own tenant
    expect(() => assertTenantBoundary(miberaClaims, 'mibera')).not.toThrow();
    expect(() => assertTenantBoundary(cubquestClaims, 'cubquest')).not.toThrow();

    // And cross-asserts fail symmetrically
    expect(() => assertTenantBoundary(miberaClaims, 'cubquest')).toThrow();
    expect(() => assertTenantBoundary(cubquestClaims, 'mibera')).toThrow();
  });

  it('mint orchestrator serves both tenants with the same delegation pattern', async () => {
    // Both registries delegate signing the same way · per-tenant logic is
    // confined to resolveCredential · mint behavior is uniform.
    const miberaIdentity: TenantUserIdentity = {
      tenant_id: 'mibera',
      user_id: 'mib-1',
      wallets: [
        {
          chain: 'ethereum',
          address: '0xa',
          verified_via: 'dynamic',
          linked_at: '2026-05-04T00:00:00Z',
        },
      ],
    };
    const cubquestIdentity: TenantUserIdentity = {
      tenant_id: 'cubquest',
      user_id: 'cub-1',
      wallets: [
        {
          chain: 'ethereum',
          address: '0xb',
          verified_via: 'dynamic',
          linked_at: '2026-05-04T00:00:00Z',
        },
        {
          chain: 'solana',
          address: 'So111',
          verified_via: 'dynamic',
          linked_at: '2026-05-04T00:00:00Z',
        },
      ],
    };

    const miberaRegistry = TenantRegistry.fromConfigs([miberaConfig], (c) =>
      mockAdapter(c, miberaIdentity),
    );
    const cubquestRegistry = TenantRegistry.fromConfigs([cubquestConfig], (c) =>
      mockAdapter(c, cubquestIdentity),
    );
    const signer = new MockSigner();

    const miberaResult = await new MintJWTOrchestrator(miberaRegistry, signer, {
      uuidv4: () => 'mib-jti',
      now: () => 1700000000,
    }).mintJwt({
      tenant_id: 'mibera',
      credential: { type: 'dynamic', dynamic_user_id: 'dyn-mib' },
    });
    const cubquestResult = await new MintJWTOrchestrator(
      cubquestRegistry,
      signer,
      { uuidv4: () => 'cub-jti', now: () => 1700000000 },
    ).mintJwt({
      tenant_id: 'cubquest',
      credential: { type: 'dynamic', dynamic_user_id: 'dyn-cub' },
    });

    expect(miberaResult.claims.tenant).toBe('mibera');
    expect(miberaResult.claims.aud).toBe('mibera');
    expect(cubquestResult.claims.tenant).toBe('cubquest');
    expect(cubquestResult.claims.aud).toBe('cubquest');

    // Both follow the same shape (no per-tenant claim divergence beyond data)
    expect(Object.keys(miberaResult.claims).sort()).toEqual(
      Object.keys(cubquestResult.claims).sort(),
    );
  });
});
