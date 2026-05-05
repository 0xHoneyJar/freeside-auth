/**
 * JWTSigner port — interface for JWT signing.
 *
 * Per SDD §12.3 (mint-as-orchestrator delegation): the engine's mint
 * orchestrator constructs claims and delegates signing through this port.
 * The default implementation (HttpJWTSigner in @freeside-auth/adapters)
 * forwards to loa-freeside/apps/gateway (the canonical Rust signer per
 * CLAUDE.md royal decree).
 *
 * Test implementations sign in-process with an injected keypair · used to
 * unit-test the orchestrator without HTTP.
 *
 * Per Lock-2 (I2 Cyberdeck Seam): the orchestrator (P2 construct) holds
 * pure logic · this port is the boundary at which signing (a side effect)
 * happens at L4.
 */

import type { JWTClaim } from '@freeside-auth/protocol';

/**
 * Sign a constructed JWTClaim and return a serialized ES256 JWT string.
 *
 * Implementations:
 * - HttpJWTSigner: POSTs claims to a remote signer endpoint
 * - InMemoryJWTSigner: signs locally with an injected keypair (tests)
 */
export interface JWTSigner {
  /** Sign claims, return compact-serialized JWT. Throws SignerError on failure. */
  sign(claims: JWTClaim): Promise<string>;

  /** Optional: signer-specific health probe. Default impl returns ok=true. */
  ping?(): Promise<{ ok: boolean; latency_ms: number }>;
}

export class SignerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'gateway_unreachable'
      | 'gateway_rejected'
      | 'sign_failed'
      | 'unknown',
    public readonly cause?: unknown,
  ) {
    super(`[jwt-signer:${code}] ${message}`);
    this.name = 'SignerError';
  }
}
