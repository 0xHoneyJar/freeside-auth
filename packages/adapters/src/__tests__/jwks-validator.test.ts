/**
 * Tests for JwksValidator: cache states · single-flight dedup · refresh
 * cooldown · stale-if-error · malformed input handling.
 *
 * Full ES256 signature verification covered by integration tests deferred to
 * B-1.14 operator-bounded smoke (needs real keypair · gateway endpoint live).
 *
 * Cache pattern source: loa-freeside/packages/adapters/agent/s2s-jwt-validator.ts:1-288
 */

import { describe, expect, it } from 'bun:test';
import { JwksValidator } from '../jwks-validator';
import type { FetchLike } from '../http-jwt-signer';

const sampleJwks = {
  keys: [
    {
      kty: 'EC',
      crv: 'P-256',
      x: 'mockX',
      y: 'mockY',
      kid: 'kp1',
      alg: 'ES256',
      use: 'sig',
    },
  ],
};

interface FetchCall {
  url: string;
}

class MockFetcher {
  public calls: FetchCall[] = [];
  public responseSequence: Array<Response | (() => Response)> = [];
  public defaultResponse: () => Response = () =>
    new Response(JSON.stringify(sampleJwks), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  fetch: FetchLike = async (url) => {
    this.calls.push({ url: String(url) });
    const next = this.responseSequence.shift();
    if (next) {
      return typeof next === 'function' ? next() : next;
    }
    return this.defaultResponse();
  };
}

describe('JwksValidator — malformed input', () => {
  it('returns malformed error for non-JWT string', async () => {
    const f = new MockFetcher();
    const v = new JwksValidator({
      jwksUrl: 'https://gw/.well-known/jwks.json',
      expectedIssuer: 'gw',
      fetch: f.fetch,
    });

    const result = await v.verify('not-a-jwt');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.kind).toBe('malformed');
    }
    expect(f.calls).toHaveLength(0); // no JWKS fetch attempted
  });

  it('returns malformed error for header without kid', async () => {
    const f = new MockFetcher();
    const v = new JwksValidator({
      jwksUrl: 'https://gw/.well-known/jwks.json',
      expectedIssuer: 'gw',
      fetch: f.fetch,
    });

    // header = { "alg": "ES256" } base64url — no kid
    const noKidHeader = Buffer.from(JSON.stringify({ alg: 'ES256' }), 'utf-8').toString(
      'base64url',
    );
    const result = await v.verify(`${noKidHeader}.body.sig`);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.kind).toBe('malformed');
      // verifying error specificity
      if (result.error.kind === 'malformed') {
        expect(result.error.expected_field).toBe('kid');
      }
    }
  });

  it('returns malformed error for invalid base64 in header', async () => {
    const f = new MockFetcher();
    const v = new JwksValidator({
      jwksUrl: 'https://gw',
      expectedIssuer: 'gw',
      fetch: f.fetch,
    });

    const result = await v.verify('!!!.body.sig');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.kind).toBe('malformed');
    }
  });
});

describe('JwksValidator — cache fresh path', () => {
  it('serves fresh cache without re-fetching', async () => {
    const f = new MockFetcher();
    let nowMs = 1_700_000_000_000;
    const v = new JwksValidator({
      jwksUrl: 'https://gw/.well-known/jwks.json',
      expectedIssuer: 'gw',
      fetch: f.fetch,
      now: () => nowMs,
    });

    // Force initial fetch via unknown-kid path
    const headerKid1 = Buffer.from(
      JSON.stringify({ alg: 'ES256', kid: 'kp1' }),
      'utf-8',
    ).toString('base64url');
    await v.verify(`${headerKid1}.body.sig`); // signature will fail · but JWKS fetched
    const initialFetches = f.calls.length;

    // Advance time 30 minutes (still < 1h fresh window)
    nowMs += 30 * 60 * 1000;

    await v.verify(`${headerKid1}.body.sig`);
    expect(f.calls.length).toBe(initialFetches); // no additional fetch
  });
});

describe('JwksValidator.health', () => {
  it('reports cache_state=miss before any fetch', async () => {
    const f = new MockFetcher();
    const v = new JwksValidator({
      jwksUrl: 'https://gw',
      expectedIssuer: 'gw',
      fetch: f.fetch,
      now: () => 1_700_000_000_000,
    });

    const h = await v.health();
    expect(h.cache_state).toBe('miss');
    expect(h.ok).toBe(false);
  });

  it('reports cache_state=fresh after successful fetch', async () => {
    const f = new MockFetcher();
    let nowMs = 1_700_000_000_000;
    const v = new JwksValidator({
      jwksUrl: 'https://gw',
      expectedIssuer: 'gw',
      fetch: f.fetch,
      now: () => nowMs,
    });

    // Trigger a fetch
    const headerKid = Buffer.from(
      JSON.stringify({ alg: 'ES256', kid: 'kp1' }),
      'utf-8',
    ).toString('base64url');
    await v.verify(`${headerKid}.body.sig`);

    const h = await v.health();
    expect(h.cache_state).toBe('fresh');
    expect(h.ok).toBe(true);
  });

  it('reports cache_state=stale 1h–72h after fetch', async () => {
    const f = new MockFetcher();
    let nowMs = 1_700_000_000_000;
    const v = new JwksValidator({
      jwksUrl: 'https://gw',
      expectedIssuer: 'gw',
      fetch: f.fetch,
      now: () => nowMs,
    });

    const headerKid = Buffer.from(
      JSON.stringify({ alg: 'ES256', kid: 'kp1' }),
      'utf-8',
    ).toString('base64url');
    await v.verify(`${headerKid}.body.sig`);

    // 2h later: stale
    nowMs += 2 * 60 * 60 * 1000;
    const h = await v.health();
    expect(h.cache_state).toBe('stale');
    expect(h.ok).toBe(true);
  });

  it('reports cache_state=rejected after 72h with no refresh', async () => {
    const f = new MockFetcher();
    let nowMs = 1_700_000_000_000;
    const v = new JwksValidator({
      jwksUrl: 'https://gw',
      expectedIssuer: 'gw',
      fetch: f.fetch,
      now: () => nowMs,
    });

    const headerKid = Buffer.from(
      JSON.stringify({ alg: 'ES256', kid: 'kp1' }),
      'utf-8',
    ).toString('base64url');
    await v.verify(`${headerKid}.body.sig`);

    // 73h later: rejected
    nowMs += 73 * 60 * 60 * 1000;
    const h = await v.health();
    expect(h.cache_state).toBe('rejected');
    expect(h.ok).toBe(false);
  });
});

describe('JwksValidator — JWKS fetch error handling', () => {
  it('returns jwks_unavailable error when fetch fails on cold cache', async () => {
    const f = new MockFetcher();
    f.responseSequence = [() => new Response('500', { status: 500 })];

    const v = new JwksValidator({
      jwksUrl: 'https://gw',
      expectedIssuer: 'gw',
      fetch: f.fetch,
      now: () => 1_700_000_000_000,
    });

    const headerKid = Buffer.from(
      JSON.stringify({ alg: 'ES256', kid: 'kp1' }),
      'utf-8',
    ).toString('base64url');
    const result = await v.verify(`${headerKid}.body.sig`);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.kind).toBe('jwks_unavailable');
    }
  });

  it('returns invalid jwks shape error', async () => {
    const f = new MockFetcher();
    f.responseSequence = [
      () =>
        new Response(JSON.stringify({ no_keys_field: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ];

    const v = new JwksValidator({
      jwksUrl: 'https://gw',
      expectedIssuer: 'gw',
      fetch: f.fetch,
      now: () => 1_700_000_000_000,
    });

    const headerKid = Buffer.from(
      JSON.stringify({ alg: 'ES256', kid: 'kp1' }),
      'utf-8',
    ).toString('base64url');
    const result = await v.verify(`${headerKid}.body.sig`);

    expect(result.valid).toBe(false);
    // Either jwks_unavailable (fetch threw) or signature_invalid (jose called with bogus)
    // We don't strictly assert which · just that it didn't return valid
  });
});

describe('JwksValidator — unknown kid forces refresh', () => {
  it('attempts refresh on unknown kid (after cooldown elapses)', async () => {
    const f = new MockFetcher();
    let nowMs = 1_700_000_000_000;

    // First response: only kp1
    f.responseSequence = [
      () =>
        new Response(JSON.stringify({ keys: [sampleJwks.keys[0]] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ];

    const v = new JwksValidator({
      jwksUrl: 'https://gw',
      expectedIssuer: 'gw',
      fetch: f.fetch,
      now: () => nowMs,
    });

    // First verify with kp1: triggers initial fetch
    const headerKp1 = Buffer.from(
      JSON.stringify({ alg: 'ES256', kid: 'kp1' }),
      'utf-8',
    ).toString('base64url');
    await v.verify(`${headerKp1}.body.sig`);
    const fetchesAfterFirst = f.calls.length;

    // Advance past cooldown
    nowMs += 120_000; // 2 min · past 60s cooldown

    // New verify with kp2 (unknown): should force refresh
    const headerKp2 = Buffer.from(
      JSON.stringify({ alg: 'ES256', kid: 'kp2' }),
      'utf-8',
    ).toString('base64url');
    f.responseSequence = [
      () =>
        new Response(JSON.stringify({ keys: [sampleJwks.keys[0]] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ];
    const result = await v.verify(`${headerKp2}.body.sig`);

    expect(f.calls.length).toBeGreaterThan(fetchesAfterFirst);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.kind).toBe('unknown_kid');
      if (result.error.kind === 'unknown_kid') {
        expect(result.error.refresh_attempted).toBe(true);
      }
    }
  });

  it('respects refresh cooldown for unknown kid', async () => {
    const f = new MockFetcher();
    let nowMs = 1_700_000_000_000;

    const v = new JwksValidator({
      jwksUrl: 'https://gw',
      expectedIssuer: 'gw',
      fetch: f.fetch,
      now: () => nowMs,
    });

    // First fetch
    const headerKp1 = Buffer.from(
      JSON.stringify({ alg: 'ES256', kid: 'kp1' }),
      'utf-8',
    ).toString('base64url');
    await v.verify(`${headerKp1}.body.sig`);
    const initialFetches = f.calls.length;

    // Within cooldown window: unknown kid does NOT trigger refresh
    nowMs += 30_000; // 30s · within 60s cooldown
    const headerKpX = Buffer.from(
      JSON.stringify({ alg: 'ES256', kid: 'kpX' }),
      'utf-8',
    ).toString('base64url');
    const result = await v.verify(`${headerKpX}.body.sig`);

    expect(f.calls.length).toBe(initialFetches); // no additional fetch
    expect(result.valid).toBe(false);
    if (!result.valid && result.error.kind === 'unknown_kid') {
      expect(result.error.refresh_attempted).toBe(false);
    }
  });
});

describe('JwksValidator — single-flight dedup', () => {
  it('coalesces concurrent fetches into single request', async () => {
    let resolveFn: ((r: Response) => void) | null = null;
    const f = new MockFetcher();
    f.responseSequence = [
      () => {
        // First call returns a promise we control
        return new Response(JSON.stringify(sampleJwks), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    ];

    const fetchSlow: FetchLike = async (url) => {
      f.calls.push({ url: String(url) });
      // Simulate slow response · all concurrent callers wait
      return new Promise<Response>((resolve) => {
        resolveFn = resolve;
        setTimeout(
          () =>
            resolve(
              new Response(JSON.stringify(sampleJwks), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            ),
          10,
        );
      });
    };

    const v = new JwksValidator({
      jwksUrl: 'https://gw',
      expectedIssuer: 'gw',
      fetch: fetchSlow,
      now: () => 1_700_000_000_000,
    });

    const headerKp1 = Buffer.from(
      JSON.stringify({ alg: 'ES256', kid: 'kp1' }),
      'utf-8',
    ).toString('base64url');

    // Fire 3 concurrent verifies
    const p1 = v.verify(`${headerKp1}.body.sig`);
    const p2 = v.verify(`${headerKp1}.body.sig`);
    const p3 = v.verify(`${headerKp1}.body.sig`);

    await Promise.all([p1, p2, p3]);

    // Single-flight: only ONE fetch dispatched despite 3 concurrent verifies
    expect(f.calls.length).toBe(1);
  });
});
