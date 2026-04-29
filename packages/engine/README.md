# packages/engine — headless identity logic

Pure functions. No I/O. Adapters wrap; engine reasons. Extracted from midi's `lib/server/resolve-wallet.ts` + the in-bot freeside_auth impl in freeside-ruggy.

## Planned modules

| file | purpose | source |
|---|---|---|
| `resolve-tier.ts` | 4-tier wallet → profile resolve. Tier 1: dynamic_user_id (outage-safe). Tier 2: additional_wallets jsonb. Tier 3: score-api wallet_groups (network-dependent). Tier 4: direct wallet_address. Hold rules for ambiguous states. | `mibera-dimensions/lib/server/resolve-wallet.ts` |
| `link-credential.ts` | Add a credential to a canonical user. Validates uniqueness, refuses to link a credential already on a different user (collision = supersession decision). | new — partially in midi onboarding |
| `merge-identities.ts` | When two canonical users discover they're the same person (rare; happens when a wallet is linked across two onboarding flows). Supersession-aware merge per [[freeside-as-identity-spine]] doctrine. | new |
| `jwt-verify.ts` | Verify ES256 JWT signature against a JwksKey. Validate exp / nbf / iss / aud. Pure — adapter does the JWKS fetch. | extracted from `loa-freeside/packages/adapters/agent/s2s-jwt-validator.ts` |
| `truncate.ts` | Render fallback `0xb307...d8` from full address. Shared utility. | extracted from in-bot impl |

## Status: scaffolded

The 4-tier algorithm is canonical in midi and battle-tested with security telemetry (logs `[resolve] tier=...`, `[resolve] SECURITY: dynamicUserId_mismatch`, etc.). Extraction preserves the logic; the I/O wraps move to `adapters/pg-midi-profiles.ts`.

## Why pure-functions

Per hexagonal architecture: engine is testable without a database. Adapters are testable against the ports. Consumers compose. No tier of the system imports both wire-fetch + business logic.

## Consumers

- `adapters/pg-midi-profiles.ts` — uses `resolve-tier.ts` after fetching rows
- `adapters/jwks-validator.ts` — uses `jwt-verify.ts` after fetching JWKS
- `mcp-tools/*` — wraps adapter calls, returns shaped results
- Tests — engine has the heaviest unit-test coverage; adapters get integration tests; mcp-tools get contract tests
