/**
 * Tests for HttpJWTSigner: request shape · response parsing · error mapping.
 *
 * Mocks fetch; live integration deferred to operator-bounded smoke against
 * loa-freeside/apps/gateway when /issue endpoint is exposed.
 */

import { describe, expect, it } from 'bun:test';
import type { JWTClaim } from '@freeside-auth/protocol';
import { SignerError } from '@freeside-auth/ports';
import { HttpJWTSigner, type FetchLike } from '../http-jwt-signer';

const sampleClaims: JWTClaim = {
  sub: 'midi-id-abc',
  tenant: 'mibera',
  wallets: [{ chain: 'ethereum', address: '0xabc' }],
  iss: 'freeside-auth',
  aud: 'mibera',
  exp: 1700003600,
  iat: 1700000000,
  jti: 'test-jti',
  v: 1,
};

const okResponse = (jwt: string) =>
  new Response(JSON.stringify({ jwt }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('HttpJWTSigner.sign', () => {
  it('POSTs claims to gateway/issue and returns JWT', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const mockFetch: FetchLike = async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return okResponse('signed.jwt.token');
    };

    const signer = new HttpJWTSigner({
      gatewayUrl: 'https://auth.0xhoneyjar.xyz',
      fetch: mockFetch,
    });

    const jwt = await signer.sign(sampleClaims);

    expect(jwt).toBe('signed.jwt.token');
    expect(capturedUrl).toBe('https://auth.0xhoneyjar.xyz/issue');
    expect(capturedInit?.method).toBe('POST');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    const body = JSON.parse(capturedInit?.body as string);
    expect(body.claims).toEqual(sampleClaims);
  });

  it('strips trailing slash from gatewayUrl', async () => {
    let capturedUrl: string | undefined;
    const mockFetch: FetchLike = async (url) => {
      capturedUrl = String(url);
      return okResponse('jwt');
    };

    const signer = new HttpJWTSigner({
      gatewayUrl: 'https://auth.0xhoneyjar.xyz/',
      fetch: mockFetch,
    });

    await signer.sign(sampleClaims);
    expect(capturedUrl).toBe('https://auth.0xhoneyjar.xyz/issue');
  });

  it('honors custom issuePath', async () => {
    let capturedUrl: string | undefined;
    const mockFetch: FetchLike = async (url) => {
      capturedUrl = String(url);
      return okResponse('jwt');
    };

    const signer = new HttpJWTSigner({
      gatewayUrl: 'https://gw',
      issuePath: '/v1/mint',
      fetch: mockFetch,
    });

    await signer.sign(sampleClaims);
    expect(capturedUrl).toBe('https://gw/v1/mint');
  });

  it('attaches Bearer authorization when gatewaySecret set', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const mockFetch: FetchLike = async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return okResponse('jwt');
    };

    const signer = new HttpJWTSigner({
      gatewayUrl: 'https://gw',
      gatewaySecret: 'shh-secret-token',
      fetch: mockFetch,
    });

    await signer.sign(sampleClaims);
    expect(capturedHeaders?.['authorization']).toBe('Bearer shh-secret-token');
  });

  it('omits authorization header when no gatewaySecret', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const mockFetch: FetchLike = async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return okResponse('jwt');
    };

    const signer = new HttpJWTSigner({ gatewayUrl: 'https://gw', fetch: mockFetch });
    await signer.sign(sampleClaims);
    expect(capturedHeaders?.['authorization']).toBeUndefined();
  });
});

describe('HttpJWTSigner.sign — error paths', () => {
  it('throws SignerError gateway_rejected on 4xx/5xx', async () => {
    const mockFetch: FetchLike = async () =>
      new Response('bad request', { status: 400, statusText: 'Bad Request' });

    const signer = new HttpJWTSigner({ gatewayUrl: 'https://gw', fetch: mockFetch });

    try {
      await signer.sign(sampleClaims);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SignerError);
      expect((e as SignerError).code).toBe('gateway_rejected');
      expect((e as SignerError).message).toContain('400');
    }
  });

  it('throws SignerError gateway_rejected when response missing jwt field', async () => {
    const mockFetch: FetchLike = async () =>
      new Response(JSON.stringify({ wrong_field: 'oops' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const signer = new HttpJWTSigner({ gatewayUrl: 'https://gw', fetch: mockFetch });

    try {
      await signer.sign(sampleClaims);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SignerError);
      expect((e as SignerError).code).toBe('gateway_rejected');
      expect((e as SignerError).message).toContain('missing jwt field');
    }
  });

  it('throws SignerError gateway_rejected when jwt is empty string', async () => {
    const mockFetch: FetchLike = async () =>
      new Response(JSON.stringify({ jwt: '' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const signer = new HttpJWTSigner({ gatewayUrl: 'https://gw', fetch: mockFetch });

    await expect(signer.sign(sampleClaims)).rejects.toThrow(SignerError);
  });

  it('throws SignerError gateway_unreachable on network error', async () => {
    const mockFetch: FetchLike = async () => {
      throw new Error('econnrefused');
    };

    const signer = new HttpJWTSigner({ gatewayUrl: 'https://gw', fetch: mockFetch });

    try {
      await signer.sign(sampleClaims);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SignerError);
      expect((e as SignerError).code).toBe('gateway_unreachable');
      expect((e as SignerError).message).toContain('econnrefused');
    }
  });
});

describe('HttpJWTSigner.ping', () => {
  it('returns ok=true on 2xx /health', async () => {
    const mockFetch: FetchLike = async (url) => {
      expect(String(url)).toContain('/health');
      return new Response('', { status: 200 });
    };
    const signer = new HttpJWTSigner({ gatewayUrl: 'https://gw', fetch: mockFetch });
    const result = await signer.ping();
    expect(result.ok).toBe(true);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('returns ok=false on network error', async () => {
    const mockFetch: FetchLike = async () => {
      throw new Error('down');
    };
    const signer = new HttpJWTSigner({ gatewayUrl: 'https://gw', fetch: mockFetch });
    const result = await signer.ping();
    expect(result.ok).toBe(false);
  });
});
