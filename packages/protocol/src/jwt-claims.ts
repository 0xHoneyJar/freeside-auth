/**
 * JWTClaim (Zod TS binding).
 *
 * Mirrors `jwt-claims.schema.json` (canonical · cross-language contract). The
 * Rust gateway at `loa-freeside/apps/gateway` is the canonical signer per
 * CLAUDE.md royal decree; this schema is what both signer (Rust) and verifiers
 * (TS) honor.
 *
 * Per SDD §11.1 Lock-8: V1 ships single keypair operator-rotated; jti denylist
 * is V2.
 *
 * Per SDD §11.4 + I6 invariant: every `verifyJwt` consumer MUST assert
 * `claims.tenant === expected_tenant` for the request context BEFORE
 * authorizing. The verify lib returns claims; consumers do the assertion.
 *
 * Source reference: `loa-freeside/packages/adapters/agent/jwt-service.ts:142-200`.
 */

import { z } from 'zod';

export const JWTWalletSchema = z.object({
  chain: z.enum(['ethereum', 'berachain', 'solana', 'bitcoin']),
  address: z.string(),
}).strict();

export type JWTWallet = z.infer<typeof JWTWalletSchema>;

export const TierSchema = z.enum(['public', 'verified', 'bearer', 'initiate', 'keeper']);
export type Tier = z.infer<typeof TierSchema>;

export const JWTClaimSchema = z.object({
  schema_version: z.literal('1.0').optional(),

  // Identity claims (required)
  sub: z.string(),
  tenant: z.string().regex(/^[a-z][a-z0-9-]+$/),
  wallets: z.array(JWTWalletSchema),
  iss: z.string(),
  aud: z.string(),
  exp: z.number().int(),
  iat: z.number().int(),
  jti: z.string().uuid(),
  v: z.literal(1),

  // Optional identity fields
  tier: TierSchema.optional(),
  display_name: z.string().optional(),
  discord_id: z.string().optional(),
  nft_id: z.number().int().optional(),

  // Reserved · loa-freeside execution-context (slice-B does not populate)
  pool_id: z.string().optional(),
  byok: z.boolean().optional(),
  req_hash: z.string().optional(),
}).strict();

export type JWTClaim = z.infer<typeof JWTClaimSchema>;

/**
 * Tenant-boundary assertion helper (I6 invariant · SDD §11.4 + §13.4).
 *
 * Every consumer of verifyJwt MUST call this (or equivalent) before authorizing.
 * Returns the claims if the tenant matches; throws otherwise.
 *
 * @example
 * ```ts
 * const claims = await verifyJwt(token);
 * const checked = assertTenantBoundary(claims, expectedTenant);
 * // proceed with checked.sub, checked.wallets, etc
 * ```
 */
export function assertTenantBoundary(
  claims: JWTClaim,
  expectedTenant: string,
): JWTClaim {
  if (claims.tenant !== expectedTenant) {
    throw new TenantAssertionError(claims.tenant, expectedTenant);
  }
  return claims;
}

export class TenantAssertionError extends Error {
  constructor(
    public readonly got: string,
    public readonly expected: string,
  ) {
    super(`tenant_assertion_failed: claimed=${got}, expected=${expected}`);
    this.name = 'TenantAssertionError';
  }
}
