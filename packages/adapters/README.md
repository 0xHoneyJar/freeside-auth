# packages/adapters — typed clients implementing ports

Concrete implementations of the ports against external systems. Swap freely without touching the consumer.

## Planned adapters

| file | impl of | wire / data source |
|---|---|---|
| `pg-midi-profiles.ts` | `IIdentityService` | Postgres pool against `RAILWAY_MIBERA_DATABASE_URL`, table `midi_profiles`. 4-tier resolve algorithm extracted from midi `lib/server/resolve-wallet.ts`. |
| `jwks-validator.ts` | `IJwksProvider` | HTTP fetch against `loa-freeside/apps/gateway` `/.well-known/jwks.json`. Cache 1h fresh / 72h stale-if-error / 60s refresh cooldown. Extracted from `loa-freeside/packages/adapters/agent/s2s-jwt-validator.ts`. |
| `credential-bridge-dynamic.ts` | `ICredentialBridge<DynamicVerifiedCredential>` | Translates Dynamic SDK's `verifiedCredentials[]` → canonical `CredentialProof[]`. Used by midi onboarding migration path. |
| `credential-bridge-better-auth.ts` | `ICredentialBridge<BetterAuthSession>` | Translates Better Auth session → canonical proof. For Sprawl Dashboard (currently SIWE direct). |
| `credential-bridge-siwe.ts` | `ICredentialBridge<SiweMessage>` | Translates raw SIWE signature → canonical SiwwCredentialProof. Used by Sprawl Dashboard. |
| `credential-bridge-seedvault.ts` | `ICredentialBridge<SolanaSeedVaultProof>` | Translates Solana SeedVault proof → canonical proof. Future (Solana support). |
| `pg-supabase-fallback.ts` | `IIdentityService` (legacy) | Reads supabase-shaped data for any consumer not yet on Railway. DEPRECATED on 2026-04-09. Kept for migration period only. |

## Status: scaffolded

`pg-midi-profiles.ts` content lives today in `freeside-ruggy/apps/bot/src/agent/freeside_auth/server.ts`. That file is the working impl; this adapter publishes it as a sealed package consumers can install.

`jwks-validator.ts` content lives today in `loa-freeside/packages/adapters/agent/s2s-jwt-validator.ts`. Same pattern — extract.

## Composition

- consumers wire one or more adapters into their app's IoC container
- `freeside-ruggy` will compose `pg-midi-profiles` (reads) until the JWKS issuance lands; then it'll compose `jwks-validator` for token-based reads
- Sprawl Dashboard composes `credential-bridge-siwe` + `pg-midi-profiles` (post-Better-Auth migration)
- Future worlds compose any combo of credential bridges + the resolver of choice
