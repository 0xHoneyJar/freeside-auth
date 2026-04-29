# packages/protocol — sealed identity schemas

Wire-format contracts for the identity overlay. Bridges every `freeside-identities` consumer (worlds, ruggy, future persona-bots, dashboards, the loa-freeside gateway) to a single coherent vocabulary.

## Status: scaffolded; content extraction pending

Sources: `loa-freeside/packages/adapters/agent/s2s-jwt-validator.ts` (JWT claims shape), `mibera-dimensions/types/supabase.ts` `midi_profiles` row schema (User shape), `vault/wiki/concepts/freeside-as-identity-spine.md` (canonical claims doc). Per `../../docs/EXTRACTION-MAP.md`.

## Planned contents (post-extraction)

| file | purpose |
|---|---|
| `user.schema.json` + `.ts` (Zod) | Canonical user — `sub` (user_id), `wallets[]`, `created_at`, `tenant_memberships[]` |
| `wallet.schema.json` + `.ts` | Wallet entity — `chain`, `address`, `linked_at`, `verified_via` (credential type) |
| `identity-component.schema.json` + `.ts` | The Component on User — `credentials[]`, `handle`, `discord_id`, `discord_username`, `mibera_id`, `pfp_*`, `bio` |
| `jwt-claims.schema.json` + `.ts` | ES256 JWT claims — `sub`, `wallets[]`, `tenant`, `tier`, `pool_id?`, `nft_id?`, `byok?`, `req_hash?`, `iss`, `aud`, `exp`. Mirrors `loa-freeside/apps/gateway` issuance shape. |
| `credential-siwe.schema.json` + `.ts` | SIWE credential proof — `address`, `chain_id`, `message`, `signature`, `nonce`, `issued_at` |
| `credential-passkey.schema.json` + `.ts` | Passkey proof (FIDO2/WebAuthn) — `credentialId`, `publicKey`, `signCount`, `attestation` |
| `credential-dynamic.schema.json` + `.ts` | Dynamic SDK proof — `dynamic_user_id`, `verified_credentials[]` |
| `credential-seedvault.schema.json` + `.ts` | Solana SeedVault proof — `pubkey`, `signature`, `message`, `seed_id` (planned, not yet shipped upstream) |
| `resolve-result.schema.json` + `.ts` | Output of resolve_wallet — `{found, wallet, handle, discord_*, mibera_id, pfp_url, fallback, resolved_via}` |
| `event.schema.json` + `.ts` | NATS events — `identities.user.created`, `identities.credential.linked`, `identities.handle.updated`. NEW. |
| `types.ts` | Branded TS types — `UserId`, `WalletAddress`, `CredentialId`, `TenantSlug`, `MiberaId` |
| `VERSIONING.md` | Schema governance imported from loa-constructs |

## Governance

Same as `freeside-worlds/packages/protocol/VERSIONING.md` — imported verbatim from `loa-constructs/.claude/schemas/VERSIONING.md`. Major bumps require new file + migration plan + stable `$id`.

## Consumers (post-extraction)

- `freeside-identities/packages/ports/` — type ports off these schemas
- `freeside-identities/packages/adapters/pg-midi-profiles.ts` — validates over wire from Railway PG
- `freeside-identities/packages/adapters/jwks-validator.ts` — validates JWT claims against this schema
- `freeside-identities/packages/mcp-tools/` — agent-callable surface
- `freeside-ruggy/apps/bot/src/agent/freeside_auth/` — current in-bot proxy; replaces with `mcp-tools/` consumer
- `loa-freeside/apps/gateway/` (Rust) — issuance side mirrors these claims (cross-language schema sync via JSON Schema, not Zod)
- Any future world's auth flow — verifies tokens against `jwt-claims.schema.json`
