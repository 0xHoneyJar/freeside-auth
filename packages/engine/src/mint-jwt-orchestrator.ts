/**
 * MintJWTOrchestrator — per-tenant claims construction + delegated signing.
 *
 * Per SDD §12.3 (mint-as-orchestrator delegation pattern):
 *
 *   bot → engine.mintJwt({tenant_id, credential})
 *           ↓
 *           1. resolveCredential via TenantAdapter (mibera/cubquest-specific lookup)
 *           2. Construct JWTClaim (tenant-scoped sub · wallets[] · tenant · tier · etc)
 *           3. Delegate to JWTSigner.sign(claims)
 *               ↓
 *               HttpJWTSigner POSTs to loa-freeside/apps/gateway (Rust signer · canonical JWKS)
 *               ↓
 *               Returns ES256 JWT
 *           4. Return JWT to bot
 *
 * The orchestrator NEVER signs · per CLAUDE.md royal decree.
 *
 * Per Lock-3 (I3 Spine Seam · SDD §7): per-tenant heterogeneity dispatched
 * via TenantRegistry → adapter · NO `if (tenant === 'mibera')` here.
 *
 * Per SDD §13.1 D8 (PRD §13.1): mint endpoint REFUSES JWT issuance when:
 * - guild_id → tenant_id mapping not in registry (caught by getAdapter)
 * - resolved identity is from a tenant DIFFERENT than claimed (this code)
 * - operator-readable error: `tenant_mismatch: claimed=<x>, resolved=<y>`
 */

import { TierSchema, type JWTClaim, type JWTWallet, type Tier } from '@freeside-auth/protocol';
import type {
  TenantAdapter,
  TenantUserIdentity,
  CredentialInput,
  JWTSigner,
} from '@freeside-auth/ports';
import { TenantRegistry } from './tenant-registry';

export interface MintRequest {
  tenant_id: string;
  credential: CredentialInput;
  /** Optional caller-supplied tier override (e.g., 'public' for anon-fallback). */
  tier?: Tier;
}

export interface MintResult {
  jwt: string;
  claims: JWTClaim;
}

export class MintError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'no_identity'
      | 'tenant_mismatch'
      | 'sign_failed'
      | 'config_error',
    public readonly context?: Record<string, unknown>,
  ) {
    super(`[mint-orchestrator:${code}] ${message}`);
    this.name = 'MintError';
  }
}

export interface MintOrchestratorConfig {
  /** JWT issuer claim. Defaults to 'freeside-auth' but operator-overridable. */
  issuer?: string;
  /** Tier-claim default when adapter fetchClaims doesn't provide one. */
  defaultTier?: Tier;
  /** JWT TTL in seconds. Defaults to 3600 (1h) per Lock-8. */
  ttlSeconds?: number;
  /** UUID generator for jti. Defaults to crypto.randomUUID. Test override. */
  uuidv4?: () => string;
  /** Clock for tests. Defaults to Date.now() / 1000. */
  now?: () => number;
}

export class MintJWTOrchestrator {
  private readonly issuer: string;
  private readonly defaultTier: Tier;
  private readonly ttlSeconds: number;
  private readonly uuidv4: () => string;
  private readonly now: () => number;

  constructor(
    private readonly registry: TenantRegistry,
    private readonly signer: JWTSigner,
    config: MintOrchestratorConfig = {},
  ) {
    this.issuer = config.issuer ?? 'freeside-auth';
    this.defaultTier = config.defaultTier ?? 'verified';
    this.ttlSeconds = config.ttlSeconds ?? 3600;
    this.uuidv4 = config.uuidv4 ?? (() => crypto.randomUUID());
    this.now = config.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async mintJwt(request: MintRequest): Promise<MintResult> {
    // 1. Resolve adapter (throws UnknownTenantError if registry unaware)
    const adapter = this.registry.getAdapter(request.tenant_id);

    // 2. Resolve credential via adapter
    const identity = await adapter.resolveCredential(request.credential);
    if (!identity) {
      throw new MintError(
        `no identity resolved for credential type=${request.credential.type} in tenant=${request.tenant_id}`,
        'no_identity',
        { tenant_id: request.tenant_id, credential_type: request.credential.type },
      );
    }

    // 3. Tenant-boundary check (PRD §13.1 D8 · I6 invariant): resolved
    // identity MUST belong to claimed tenant. Defense against guild-id
    // confusion + cross-tenant escalation.
    if (identity.tenant_id !== request.tenant_id) {
      throw new MintError(
        `tenant_mismatch: claimed=${request.tenant_id}, resolved=${identity.tenant_id}`,
        'tenant_mismatch',
        {
          claimed: request.tenant_id,
          resolved: identity.tenant_id,
        },
      );
    }

    // 4. Fetch tenant-scoped claims (tier · custom fields)
    //
    // Cross-reviewer flatline + bridgebuilder (PR #1 · HIGH 2): the previous
    // unchecked cast `(tenantClaims.tier as Tier)` was a privilege-escalation
    // surface — any future adapter could DB-source an arbitrary tier value
    // bypassing TierSchema validation. Combined with the SQL identifier
    // surface (HIGH 1), this was the second half of the escalation chain.
    //
    // Defense: TierSchema.safeParse validates against the canonical enum
    // (`public | verified | bearer | initiate | keeper`). On failure the
    // adapter-supplied value is dropped · we fall through to caller's
    // `request.tier` and finally `this.defaultTier`. Adapter intent
    // recorded but never escalates.
    const tenantClaims = await adapter.fetchClaims(identity.user_id);
    const adapterTier = (() => {
      if (tenantClaims.tier === undefined) return undefined;
      const parsed = TierSchema.safeParse(tenantClaims.tier);
      return parsed.success ? parsed.data : undefined;
    })();
    const tier: Tier = adapterTier ?? request.tier ?? this.defaultTier;

    // 5. Construct JWTClaim
    const now = this.now();
    const wallets: JWTWallet[] = identity.wallets.map((w) => ({
      chain: w.chain,
      address: w.address,
    }));

    const claims: JWTClaim = {
      sub: identity.user_id,
      tenant: identity.tenant_id,
      wallets,
      iss: this.issuer,
      aud: identity.tenant_id, // tenant-bound audience per PRD §13.2 D9 / SDD §7 Lock
      exp: now + this.ttlSeconds,
      iat: now,
      jti: this.uuidv4(),
      v: 1,
      tier,
      display_name: identity.display_name,
      discord_id: identity.discord_id,
    };

    // 6. Delegate signing to JWTSigner (HttpJWTSigner → loa-freeside/apps/gateway)
    let jwt: string;
    try {
      jwt = await this.signer.sign(claims);
    } catch (e) {
      throw new MintError(
        `signer failed: ${(e as Error).message}`,
        'sign_failed',
        { cause: e },
      );
    }

    return { jwt, claims };
  }

  /**
   * Identity-only resolve · no JWT minted. Used by routes that need to know
   * the user but don't issue tokens. Same tenant-boundary guard as mintJwt.
   */
  async resolveIdentity(request: MintRequest): Promise<TenantUserIdentity> {
    const adapter = this.registry.getAdapter(request.tenant_id);
    const identity = await adapter.resolveCredential(request.credential);
    if (!identity) {
      throw new MintError(
        `no identity resolved for credential type=${request.credential.type} in tenant=${request.tenant_id}`,
        'no_identity',
        { tenant_id: request.tenant_id, credential_type: request.credential.type },
      );
    }
    if (identity.tenant_id !== request.tenant_id) {
      throw new MintError(
        `tenant_mismatch: claimed=${request.tenant_id}, resolved=${identity.tenant_id}`,
        'tenant_mismatch',
        { claimed: request.tenant_id, resolved: identity.tenant_id },
      );
    }
    return identity;
  }
}
