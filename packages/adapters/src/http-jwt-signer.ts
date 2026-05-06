/**
 * HttpJWTSigner — JWTSigner impl that delegates to a remote signer endpoint.
 *
 * Per SDD §12.3: this is the slice-B default for the mint orchestrator's
 * delegation pattern. Operator points it at loa-freeside/apps/gateway (Rust
 * canonical signer) when ready; until then, can point at any conformant
 * `/issue` endpoint (e.g., a local dev signer).
 *
 * Per CLAUDE.md royal decree: this module does NOT sign locally. Signing
 * is delegated through HTTP to the canonical Rust gateway.
 *
 * Contract (assumed shape · gateway must expose an endpoint matching this):
 *   POST <gatewayUrl>/issue
 *   Authorization: Bearer <gatewaySecret>
 *   Content-Type: application/json
 *   Body: { claims: JWTClaim }
 *   →
 *   200 OK
 *   Body: { jwt: string }
 *
 * If the gateway exposes a different shape, swap in a different JWTSigner
 * impl · the orchestrator only knows the port.
 */

import type { JWTClaim } from '@freeside-auth/protocol';
import { type JWTSigner, SignerError } from '@freeside-auth/ports';

/** Narrow fetch shape · sidesteps Bun's `preconnect` requirement on `typeof fetch`. */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface HttpJWTSignerConfig {
  /** Gateway base URL (e.g., 'https://auth.0xhoneyjar.xyz' or 'http://localhost:9000'). */
  gatewayUrl: string;
  /** Path appended to gatewayUrl. Default '/issue'. */
  issuePath?: string;
  /** Optional bearer secret for gateway-to-gateway auth. */
  gatewaySecret?: string;
  /** Request timeout ms. Default 5000. */
  timeoutMs?: number;
  /** Test-injectable fetch. Default globalThis.fetch. */
  fetch?: FetchLike;
}

export class HttpJWTSigner implements JWTSigner {
  private readonly gatewayUrl: string;
  private readonly issuePath: string;
  private readonly gatewaySecret?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(config: HttpJWTSignerConfig) {
    this.gatewayUrl = config.gatewayUrl.replace(/\/$/, '');
    this.issuePath = config.issuePath ?? '/issue';
    this.gatewaySecret = config.gatewaySecret;
    this.timeoutMs = config.timeoutMs ?? 5000;
    this.fetchImpl = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  async sign(claims: JWTClaim): Promise<string> {
    const url = `${this.gatewayUrl}${this.issuePath}`;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (this.gatewaySecret) {
        headers['authorization'] = `Bearer ${this.gatewaySecret}`;
      }

      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ claims }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '<no body>');
        throw new SignerError(
          `gateway rejected: ${res.status} ${res.statusText} (body: ${body.slice(0, 200)})`,
          'gateway_rejected',
        );
      }

      const data = (await res.json()) as { jwt?: unknown };
      if (typeof data.jwt !== 'string' || data.jwt.length === 0) {
        throw new SignerError(
          'gateway response missing jwt field',
          'gateway_rejected',
        );
      }

      return data.jwt;
    } catch (e) {
      if (e instanceof SignerError) throw e;
      const err = e as { name?: string; message?: string };
      if (err.name === 'AbortError') {
        throw new SignerError(
          `gateway timeout after ${this.timeoutMs}ms`,
          'gateway_unreachable',
          e,
        );
      }
      throw new SignerError(
        `gateway unreachable: ${err.message ?? 'unknown'}`,
        'gateway_unreachable',
        e,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async ping(): Promise<{ ok: boolean; latency_ms: number }> {
    const start = Date.now();
    const url = `${this.gatewayUrl}/health`;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { signal: ctrl.signal });
      return { ok: res.ok, latency_ms: Date.now() - start };
    } catch {
      return { ok: false, latency_ms: Date.now() - start };
    } finally {
      clearTimeout(timeout);
    }
  }
}
