/**
 * JWTVerifier port — interface for JWT verification.
 *
 * Per CLAUDE.md royal decree: "this module ships a *validator* + claims
 * schema, NOT a signer." The verifier is the canonical concern of
 * freeside-auth.
 *
 * Per SDD §11.4 + I6 invariant (PRD §13.4): consumers MUST call
 * `assertTenantBoundary(claims, expected_tenant)` after verification.
 * Verify lib returns claims; consumer asserts boundary.
 *
 * Per SDD §11.2: verifier exposes a V2-ready `revocationLayer` extension
 * point (NO-OP in V1 · jti denylist plugs in V2 without contract change).
 *
 * Source pattern: loa-freeside/packages/adapters/agent/s2s-jwt-validator.ts:1-288
 * - Fresh < 1h cache
 * - Stale 1h–72h with stale-if-error
 * - Single-flight dedup
 * - 60s refresh cooldown
 * - Hard reject > 72h stale
 */

import type { JWTClaim } from '@freeside-auth/protocol';

/** Result discriminated union from verify(). */
export type VerifyResult =
  | { valid: true; claims: JWTClaim }
  | { valid: false; error: VerifyError };

export type VerifyError =
  | { kind: 'expired'; exp_at: number; now: number; jitter_ms?: number }
  | { kind: 'unknown_kid'; kid: string; refresh_attempted: boolean }
  | { kind: 'malformed'; expected_field: string }
  | { kind: 'wrong_audience'; got: string; expected: string }
  | { kind: 'wrong_issuer'; got: string; expected: string }
  | { kind: 'signature_invalid' }
  | { kind: 'jwks_unavailable'; stale_age_ms: number }
  | { kind: 'revoked'; jti: string }   // V2 path · revocation hook
  | { kind: 'schema_mismatch'; v: unknown };

/**
 * Verifies JWTs against JWKS (cached + stale-if-error · per Lock-8 V1
 * revocation posture).
 *
 * Implementations:
 * - JwksValidator: HTTP fetch JWKS endpoint · cache + dedup
 * - InMemoryVerifier: verifies against injected JWKS (tests)
 */
export interface JWTVerifier {
  /** Verify a compact-serialized JWT · return claims (verified) or error. */
  verify(token: string): Promise<VerifyResult>;

  /** Health probe: are we able to reach JWKS? Returns latency + cache state. */
  health?(): Promise<{
    ok: boolean;
    cache_state: 'fresh' | 'stale' | 'miss' | 'rejected';
    age_ms: number;
    last_refresh_ms: number;
  }>;
}

/**
 * Optional revocation layer (V2). V1 ships with `revocationLayer = null`
 * (always-allow). V2 plugs in jti denylist or NATS push subscriber per SDD
 * §11.5 D-H/D-I/D-J distillation candidates.
 */
export interface RevocationLayer {
  /** Returns true if the claim's jti is allowed (not revoked). */
  check(claims: JWTClaim): Promise<boolean>;
}
