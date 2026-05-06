/**
 * JwksValidator — JWTVerifier impl with cache + stale-if-error.
 *
 * Source pattern: loa-freeside/packages/adapters/agent/s2s-jwt-validator.ts:1-288
 *
 * Cache strategy (per Lock-8 V1 revocation posture · SDD §11.1):
 *   Fresh: < 1h → serve cached
 *   Stale: 1h–72h → background refresh, serve stale on failure
 *   Rejected: > 72h stale without successful refresh → hard reject
 *   Unknown kid: force refresh (respects 60s cooldown)
 *   Single-flight dedup: one fetch at a time, all callers share result
 *
 * Per CLAUDE.md royal decree: this module is a VALIDATOR · the canonical
 * signer is loa-freeside/apps/gateway. JWKS endpoint URL is operator-
 * configured (typically `https://auth.0xhoneyjar.xyz/.well-known/jwks.json`
 * or wherever the gateway serves).
 *
 * Per SDD §11.4 + I6 invariant: this validator returns claims; consumers
 * MUST call `assertTenantBoundary(claims, expected_tenant)` before
 * authorizing. The validator does NOT enforce tenant — that's a request-
 * context concern.
 *
 * Per SDD §11.2: V2-ready `revocationLayer` extension point. V1 = no-op.
 */

import { jwtVerify, type JWK, type JWTPayload } from 'jose';
import {
  JWTClaimSchema,
  type JWTClaim,
} from '@freeside-auth/protocol';
import type {
  JWTVerifier,
  VerifyResult,
  RevocationLayer,
} from '@freeside-auth/ports';
import type { FetchLike } from './http-jwt-signer';

// ─── Config ────────────────────────────────────────────────────────────

export interface JwksValidatorConfig {
  /** JWKS endpoint URL. */
  jwksUrl: string;
  /** Expected JWT issuer (e.g., 'freeside-auth' or 'arrakis'). */
  expectedIssuer: string;
  /** Expected JWT audience (tenant-bound · e.g., 'mibera' for a mibera-scoped verifier). */
  expectedAudience?: string;
  /** Fresh cache TTL in ms. Default 1h. */
  jwksCacheTtlMs?: number;
  /** Max stale-if-error TTL in ms. Default 72h. */
  jwksStaleMaxMs?: number;
  /** Min interval between refresh attempts in ms. Default 60s. */
  jwksRefreshCooldownMs?: number;
  /** Clock-skew leeway in seconds. Default 30. */
  clockToleranceSec?: number;
  /** V2 revocation hook (default: always-allow). */
  revocationLayer?: RevocationLayer | null;
  /** Test-injectable fetch (default: globalThis.fetch). */
  fetch?: FetchLike;
  /** Test-injectable clock (default: Date.now). */
  now?: () => number;
}

interface JwksResponse {
  keys: JWK[];
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;
const SIXTY_SEC_MS = 60 * 1000;

// ─── JwksValidator ─────────────────────────────────────────────────────

export class JwksValidator implements JWTVerifier {
  private cachedJwks: JwksResponse | null = null;
  private lastSuccessfulFetch = 0;
  private lastRefreshAttempt = 0;
  private inflight: Promise<JwksResponse> | null = null;

  private readonly jwksUrl: string;
  private readonly expectedIssuer: string;
  private readonly expectedAudience: string | undefined;
  private readonly jwksCacheTtlMs: number;
  private readonly jwksStaleMaxMs: number;
  private readonly jwksRefreshCooldownMs: number;
  private readonly clockToleranceSec: number;
  private readonly revocationLayer: RevocationLayer | null;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(config: JwksValidatorConfig) {
    this.jwksUrl = config.jwksUrl;
    this.expectedIssuer = config.expectedIssuer;
    this.expectedAudience = config.expectedAudience;
    this.jwksCacheTtlMs = config.jwksCacheTtlMs ?? ONE_HOUR_MS;
    this.jwksStaleMaxMs = config.jwksStaleMaxMs ?? SEVENTY_TWO_HOURS_MS;
    this.jwksRefreshCooldownMs = config.jwksRefreshCooldownMs ?? SIXTY_SEC_MS;
    this.clockToleranceSec = config.clockToleranceSec ?? 30;
    this.revocationLayer = config.revocationLayer ?? null;
    this.fetchImpl = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = config.now ?? (() => Date.now());
  }

  async verify(token: string): Promise<VerifyResult> {
    // 1. Parse JWT header to get kid (no signature check yet)
    let kid: string | undefined;
    try {
      const parts = token.split('.');
      if (parts.length !== 3 || !parts[0]) {
        return { valid: false, error: { kind: 'malformed', expected_field: 'header' } };
      }
      const headerB64 = parts[0];
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'));
      kid = header.kid;
    } catch {
      return { valid: false, error: { kind: 'malformed', expected_field: 'header' } };
    }

    if (!kid) {
      return { valid: false, error: { kind: 'malformed', expected_field: 'kid' } };
    }

    // 2. Get JWKS (cached · refreshes if needed)
    let jwks: JwksResponse;
    try {
      jwks = await this.getJwks(kid);
    } catch {
      const ageMs = this.now() - this.lastSuccessfulFetch;
      return {
        valid: false,
        error: { kind: 'jwks_unavailable', stale_age_ms: ageMs },
      };
    }

    // 3. Find matching key by kid
    const jwk = jwks.keys.find((k) => k.kid === kid);
    if (!jwk) {
      // Force refresh (respects cooldown) and retry once
      const refreshAttempted = await this.tryForceRefresh();
      if (refreshAttempted && this.cachedJwks) {
        const refreshed = this.cachedJwks.keys.find((k) => k.kid === kid);
        if (refreshed) {
          return this.verifyWithKey(token, refreshed);
        }
      }
      return {
        valid: false,
        error: { kind: 'unknown_kid', kid, refresh_attempted: refreshAttempted },
      };
    }

    return this.verifyWithKey(token, jwk);
  }

  async health(): Promise<{
    ok: boolean;
    cache_state: 'fresh' | 'stale' | 'miss' | 'rejected';
    age_ms: number;
    last_refresh_ms: number;
  }> {
    const ageMs = this.now() - this.lastSuccessfulFetch;
    const cache_state = this.cachedJwks
      ? ageMs < this.jwksCacheTtlMs
        ? 'fresh'
        : ageMs < this.jwksStaleMaxMs
          ? 'stale'
          : 'rejected'
      : 'miss';
    const ok = cache_state === 'fresh' || cache_state === 'stale';
    return {
      ok,
      cache_state,
      age_ms: ageMs,
      last_refresh_ms: this.lastRefreshAttempt,
    };
  }

  // ─── helpers ─────────────────────────────────────────────────────────

  private async verifyWithKey(token: string, jwk: JWK): Promise<VerifyResult> {
    let payload: JWTPayload;
    try {
      const { jwtVerify: jvf, importJWK } = await import('jose');
      const key = await importJWK(jwk, 'ES256');
      const verifyOptions = {
        issuer: this.expectedIssuer,
        clockTolerance: this.clockToleranceSec,
        ...(this.expectedAudience ? { audience: this.expectedAudience } : {}),
      };
      const result = await jvf(token, key, verifyOptions);
      payload = result.payload;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === 'ERR_JWT_EXPIRED') {
        const exp = (e as unknown as { payload?: { exp?: number } }).payload?.exp ?? 0;
        return {
          valid: false,
          error: { kind: 'expired', exp_at: exp, now: Math.floor(this.now() / 1000) },
        };
      }
      if (err.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
        // jose returns this for issuer/audience mismatch · we surface specifically
        if (err.message?.includes('issuer')) {
          return {
            valid: false,
            error: {
              kind: 'wrong_issuer',
              got: '<see jose error>',
              expected: this.expectedIssuer,
            },
          };
        }
        if (err.message?.includes('audience')) {
          return {
            valid: false,
            error: {
              kind: 'wrong_audience',
              got: '<see jose error>',
              expected: this.expectedAudience ?? '<unspecified>',
            },
          };
        }
      }
      return { valid: false, error: { kind: 'signature_invalid' } };
    }

    // Validate against our schema
    const parsed = JWTClaimSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        valid: false,
        error: { kind: 'schema_mismatch', v: payload.v },
      };
    }

    const claims: JWTClaim = parsed.data;

    // Revocation check (V2 · V1 always-allow)
    if (this.revocationLayer) {
      const allowed = await this.revocationLayer.check(claims);
      if (!allowed) {
        return { valid: false, error: { kind: 'revoked', jti: claims.jti } };
      }
    }

    return { valid: true, claims };
  }

  private async getJwks(_requestedKid: string): Promise<JwksResponse> {
    const ageMs = this.now() - this.lastSuccessfulFetch;

    // Fresh: serve cached
    if (this.cachedJwks && ageMs < this.jwksCacheTtlMs) {
      return this.cachedJwks;
    }

    // Stale-but-recoverable window
    if (this.cachedJwks && ageMs < this.jwksStaleMaxMs) {
      // Background refresh (don't await on success path; serve stale)
      void this.refreshIfCooledDown();
      return this.cachedJwks;
    }

    // Cache miss or beyond stale window: must refresh now
    return this.refreshNow();
  }

  private async refreshNow(): Promise<JwksResponse> {
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = this.fetchJwks();
    try {
      const result = await this.inflight;
      this.cachedJwks = result;
      this.lastSuccessfulFetch = this.now();
      return result;
    } finally {
      this.lastRefreshAttempt = this.now();
      this.inflight = null;
    }
  }

  private async refreshIfCooledDown(): Promise<void> {
    const sinceLast = this.now() - this.lastRefreshAttempt;
    if (sinceLast < this.jwksRefreshCooldownMs) return;
    try {
      await this.refreshNow();
    } catch {
      // Suppress · we already returned stale to caller
    }
  }

  private async tryForceRefresh(): Promise<boolean> {
    const sinceLast = this.now() - this.lastRefreshAttempt;
    if (sinceLast < this.jwksRefreshCooldownMs) return false;
    try {
      await this.refreshNow();
      return true;
    } catch {
      return false;
    }
  }

  private async fetchJwks(): Promise<JwksResponse> {
    const res = await this.fetchImpl(this.jwksUrl);
    if (!res.ok) {
      throw new Error(`JWKS fetch failed: ${res.status}`);
    }
    const body = await res.json();
    if (!body || !Array.isArray((body as JwksResponse).keys)) {
      throw new Error('JWKS response shape invalid');
    }
    return body as JwksResponse;
  }
}

/** Re-export jwtVerify for callers that want raw access (rare). */
export { jwtVerify };
