# packages/ports — TS interface ports

Hexagonal-architecture ports per [[contracts-as-bridges]]. Consumers depend on these; adapters satisfy them. Swap adapters without touching the consumer.

## Planned ports

```ts
// IIdentityService — the persona/agent-facing surface
export interface IIdentityService {
  resolveWallet(wallet: WalletAddress, dynamicUserId?: string): Promise<ResolveResult>;
  resolveWallets(wallets: WalletAddress[]): Promise<ResolveResult[]>;
  linkCredential(userId: UserId, proof: CredentialProof): Promise<{ linked: boolean }>;
  registerNewUser(proof: CredentialProof): Promise<{ user_id: UserId }>;
}

// IJwksProvider — token verify side (mirrors loa-freeside/gateway issuer)
export interface IJwksProvider {
  fetchJwks(): Promise<Jwks>;
  verifyToken(token: string): Promise<JwtClaims>;
  // gateway-side issuance is in loa-freeside Rust; this port is verify-only
}

// ICredentialBridge — translate external proof → canonical CredentialProof
export interface ICredentialBridge<TExternal = unknown> {
  translate(external: TExternal): Promise<CredentialProof>;
  type: 'siwe' | 'passkey' | 'dynamic' | 'seedvault' | 'better-auth';
}
```

## Status: scaffolded

Port shapes drafted from the in-bot impl in `freeside-ruggy/apps/bot/src/agent/freeside_auth/server.ts`. Final shapes land when the engine extraction is staged — see `../../docs/INTEGRATION-PATH.md`.

## Consumers

- `freeside-identities/packages/adapters/*` — every adapter satisfies one or more ports
- `freeside-identities/packages/mcp-tools/*` — MCP tool specs wrap `IIdentityService`
- `freeside-identities/packages/engine/*` — pure logic functions consume ports for I/O
- `freeside-ruggy/apps/bot/src/agent/orchestrator.ts` — depends on the MCP surface, transitively on ports
- Future per-world identity adapters — implement `IIdentityService` against world-specific stores
