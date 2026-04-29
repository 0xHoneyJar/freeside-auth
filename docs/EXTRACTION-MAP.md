# EXTRACTION-MAP — per-file source paths

Every package's "where does this come from" — exact file paths so extraction is mechanical, not creative.

## protocol/

| target file | source path | notes |
|---|---|---|
| `protocol/user.schema.json` | NEW | Derived from midi `types/supabase.ts` `midi_profiles.Row` shape, then split into User (canonical) + IdentityComponent (the row's content). |
| `protocol/wallet.schema.json` | NEW | Derived from `additional_wallets` jsonb shape + chain config. |
| `protocol/identity-component.schema.json` | `mibera-dimensions/types/supabase.ts` `midi_profiles.Row` | Full row → component fields. Drop `id`, `created_at`, `updated_at` (those are User-level metadata). |
| `protocol/jwt-claims.schema.json` | `loa-freeside/packages/adapters/agent/s2s-jwt-validator.ts` (claims interface) + `vault/wiki/concepts/freeside-as-identity-spine.md` | Mirror exactly the Rust gateway's issued JWT. Validate against an issued token before publishing schema. |
| `protocol/credential-siwe.schema.json` | `sprawl-world/apps/dashboard/src/lib/server/auth/siwe.ts` (verify shape) | Sprawl Dashboard is the only SIWE consumer today. Schema reflects siwe@3.0.0. |
| `protocol/credential-passkey.schema.json` | NEW (Better Auth passkey plugin reference) | Wait for Better Auth migration to land before locking shape. |
| `protocol/credential-dynamic.schema.json` | `mibera-dimensions/contexts/AuthContext.tsx` (Dynamic SDK usage) | Current verifiedCredentials[] shape. |
| `protocol/credential-seedvault.schema.json` | NEW (Solana SeedVault docs) | Future. Stub until Solana support active. |
| `protocol/resolve-result.schema.json` | `freeside-ruggy/apps/bot/src/agent/freeside_auth/server.ts` `ResolvedWallet` interface | Direct port. |

## ports/

| target file | source path | notes |
|---|---|---|
| `ports/i-identity-service.ts` | `freeside-ruggy/apps/bot/src/agent/freeside_auth/server.ts` (mcp tool signatures) | Generalize the MCP tool shape into a port interface. |
| `ports/i-jwks-provider.ts` | `loa-freeside/packages/adapters/agent/s2s-jwt-validator.ts` (validator interface) | Same shape, generalized. |
| `ports/i-credential-bridge.ts` | NEW | One generic interface; per-credential adapters bind to it. |

## adapters/

| target file | source path | notes |
|---|---|---|
| `adapters/pg-midi-profiles.ts` | `freeside-ruggy/apps/bot/src/agent/freeside_auth/server.ts` (pg pool + tier query logic) + `mibera-dimensions/lib/server/resolve-wallet.ts` (Tier 3 wallet_groups call) | Merge the in-bot impl + midi's tier-3 score-api call. |
| `adapters/jwks-validator.ts` | `loa-freeside/packages/adapters/agent/s2s-jwt-validator.ts` | Direct extraction. |
| `adapters/credential-bridge-dynamic.ts` | `mibera-dimensions/contexts/AuthContext.tsx` + `mibera-dimensions/middleware.ts` (JWT decode → claims) | Translate Dynamic verified-credentials → canonical `CredentialProof[]`. |
| `adapters/credential-bridge-siwe.ts` | `sprawl-world/apps/dashboard/src/lib/server/auth/siwe.ts` | Translate SIWE message+sig → canonical proof. |
| `adapters/credential-bridge-better-auth.ts` | NEW | Awaits Better Auth migration. |
| `adapters/credential-bridge-seedvault.ts` | NEW | Future (Solana). |

## mcp-tools/

| target file | source path | notes |
|---|---|---|
| `mcp-tools/server.ts` (createIdentitiesMcpServer) | `freeside-ruggy/apps/bot/src/agent/freeside_auth/server.ts` | Lift the `createSdkMcpServer` block. Make `IIdentityService` a constructor parameter. |
| `mcp-tools/tool-resolve-wallet.ts` | same source | Tool spec only; logic in adapter. |
| `mcp-tools/tool-resolve-wallets.ts` | same source | Same. |
| `mcp-tools/tool-verify-token.ts` | `loa-freeside/packages/adapters/agent/s2s-jwt-validator.ts` | New MCP wrapper around existing verify call. |

## engine/

| target file | source path | notes |
|---|---|---|
| `engine/resolve-tier.ts` | `mibera-dimensions/lib/server/resolve-wallet.ts` `resolveProfileWallet` function | Direct extraction. Replace I/O calls with port interface calls. Pure logic remains. |
| `engine/jwt-verify.ts` | `loa-freeside/packages/adapters/agent/s2s-jwt-validator.ts` (verify side) | Pure — JWKS fetched by adapter, key passed in. |
| `engine/link-credential.ts` | NEW | Logic for linking a credential to a canonical user, with collision detection. Partially in midi onboarding. |
| `engine/truncate.ts` | `freeside-ruggy/apps/bot/src/agent/freeside_auth/server.ts` `truncate()` helper | Direct extraction. |

## ui/

Deferred to V0.2+. No extraction yet — components are NEW when authored.

## Coordination contacts

| repo / file | owner | when extracting |
|---|---|---|
| `mibera-dimensions/lib/server/resolve-wallet.ts` | soju | coordinate cutover so midi reads from this package post-extraction |
| `loa-freeside/apps/gateway/` | janitooor | confirm JWT claims shape stable before locking `jwt-claims.schema.json` |
| `loa-freeside/packages/adapters/agent/s2s-jwt-validator.ts` | janitooor | extract under his watch |
| `sprawl-world/apps/dashboard/src/lib/server/auth/siwe.ts` | soju | sprawl-dashboard's eventual cutover to this package |
