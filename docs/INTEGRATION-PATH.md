# INTEGRATION-PATH — staged cutover plan

> Today: ruggy has an in-bot freeside_auth MCP. midi has the resolve algorithm. loa-freeside/gateway has unconsumed JWKS. Three actors, no shared protocol.
> Goal: one sealed module everyone consumes. Sequenced extraction so no one breaks.

## Phase 0 — scaffold (this PR)

✅ Repo created. Six packages stubbed. Docs (INTENT, EXTRACTION-MAP, this file) authored. No code yet — intent + provenance only.

**Acceptance**: `gh repo view 0xHoneyJar/freeside-identities` returns the stubbed module. README links to all three docs. Doctrine pages cross-link bidirectionally.

## Phase 1 — protocol (~3 days)

Extract and ship the schemas. No runtime change anywhere; consumers can start typing against the protocol package.

Tasks:
1. Author `protocol/user.schema.json` + `.ts` (Zod) from midi `midi_profiles.Row`.
2. Author `protocol/identity-component.schema.json` + `.ts` (the row's content as a component).
3. Author `protocol/jwt-claims.schema.json` + `.ts` from `loa-freeside/apps/gateway` issuance — coordinate with janitooor to confirm shape stable.
4. Author `protocol/resolve-result.schema.json` from in-bot impl.
5. Author `protocol/credential-siwe.schema.json` (extract from sprawl-dashboard).
6. Stub `protocol/credential-dynamic.schema.json`, `protocol/credential-passkey.schema.json` (Better Auth pending), `protocol/credential-seedvault.schema.json` (Solana future).
7. Import `VERSIONING.md` from `loa-constructs/.claude/schemas/VERSIONING.md`.

**Acceptance**: `bun run --cwd packages/protocol typecheck` clean. `protocol` package buildable. JSON schemas validate via ajv against sample payloads.

## Phase 2 — ports + engine (~3 days)

Extract pure-logic algorithms. Fully testable without I/O. No runtime consumer change yet.

Tasks:
1. Author `ports/i-identity-service.ts`, `ports/i-jwks-provider.ts`, `ports/i-credential-bridge.ts`.
2. Extract `engine/resolve-tier.ts` from midi `lib/server/resolve-wallet.ts`. Replace direct supabase calls with port-interface calls. Logic identical.
3. Extract `engine/jwt-verify.ts` from `loa-freeside/packages/adapters/agent/s2s-jwt-validator.ts` (verify side — JWKS fetched by adapter, key passed in).
4. Extract `engine/truncate.ts` from in-bot impl.
5. Author `engine/__tests__/resolve-tier.test.ts` covering all 4 tiers + hold rules.

**Acceptance**: engine package has 80%+ unit-test coverage. Replays the same `[resolve] tier=...` logs midi produces today against fixture data.

## Phase 3 — adapters (~5 days)

Wire engine + ports to actual systems. ruggy's in-bot impl gets PUBLISHED here.

Tasks:
1. Author `adapters/pg-midi-profiles.ts`. Lift pg pool + cache + 4-tier resolve from `freeside-ruggy/apps/bot/src/agent/freeside_auth/server.ts`. Inject `IIdentityService` shape; consume `engine/resolve-tier.ts`.
2. Author `adapters/jwks-validator.ts`. Lift cache (1h fresh / 72h stale / 60s cooldown) from `loa-freeside/packages/adapters/agent/s2s-jwt-validator.ts`.
3. Author `adapters/credential-bridge-dynamic.ts`. Translate Dynamic SDK verified-credentials → canonical `CredentialProof[]`.
4. Author `adapters/credential-bridge-siwe.ts`. Translate sprawl-dashboard's SIWE flow → canonical proof.
5. Stub passkey + seedvault bridges (NEW — pending external lib readiness).

**Acceptance**: contract tests pass. Each adapter independently passes the IIdentityService / IJwksProvider / ICredentialBridge contract test suite.

## Phase 4 — mcp-tools (~2 days)

Wrap the adapters in the agent surface. ruggy migrates from in-bot impl to package consumer.

Tasks:
1. Author `mcp-tools/server.ts` — `createIdentitiesMcpServer({ identityService, jwksProvider? })` factory.
2. Tool specs: `resolve_wallet`, `resolve_wallets`, `verify_token`. Same shapes as today's in-bot impl so persona prompts don't break.
3. Migrate `freeside-ruggy/apps/bot/src/agent/orchestrator.ts` to import the package. Delete `apps/bot/src/agent/freeside_auth/`. One-line swap in mcpServers map.
4. Live-fire ruggy posts. Verify identity resolution still works end-to-end.
5. Tag `0.1.0` release.

**Acceptance**: ruggy live in production with `@freeside-identities/mcp-tools` as the source. No regression.

## Phase 5 — second consumer (~5 days)

Prove the package is reusable. Pick one:
- **Dixie** (B2B operator interface) — same MCP, different prompt context. Verifies persona-bot replication works.
- **Sprawl Dashboard** — Better Auth migration consumes the credential-bridge + JWKS validator. Verifies non-bot consumer pattern.

**Acceptance**: a non-ruggy consumer is in production using the package. Document any rough edges; bump to `0.2.0` if breaking changes needed.

## Phase 6 — UI (deferred, ~unknown)

Authored when freeside-dashboard's identity tab gets greenlit. Not in current sprint plan.

## Operational notes

- **Database secrets**: `RAILWAY_MIBERA_DATABASE_URL` is in `~/bonfire/.env` and freeside-ruggy's `.env`. Adapter consumes env directly; no hardcoding.
- **JWKS endpoint**: today `loa-freeside/apps/gateway` is deployed but URL inconsistent across consumers. Phase 3 includes a coordination ask: pin a stable JWKS URL (e.g. `freeside.<env>.local/.well-known/jwks.json`).
- **Backwards compatibility**: ruggy's persona prompt uses `mcp__freeside_auth__*` tool names. Phase 4 keeps this prefix stable. If we want to standardize on `mcp__identities__*`, that's a Phase 5+ migration.
- **Rotation reminders**: secrets pasted in chat (DISCORD_BOT_TOKEN, MCP_KEY, RAILWAY_MIBERA_DATABASE_URL) need rotation before any production-deploy phase. Independent of this module.

## Risk & mitigations

| risk | mitigation |
|---|---|
| midi schema changes mid-extraction | Phase 1 schema is read-only against midi today; coordinate with soju before Phase 3 cuts midi over to package |
| JWKS shape drift | janitooor confirms `jwt-claims.schema.json` stable before Phase 1 ships |
| Ruggy regression on Phase 4 swap | Live-fire suite (4 zones × 4 post types) before tagging release |
| Second-consumer integration friction | Phase 5 picks the consumer with clearest existing flow (probably Dixie); don't force Sprawl Dashboard if Better Auth migration isn't ready |
| Solana support shape unknown | Phase 1 stubs SeedVault; revisit when actual implementation lands |

## Sequenced this way because...

- **Schema-first** matches the [[contracts-as-bridges]] doctrine — sealed schemas before any runtime change.
- **Engine-before-adapter** isolates pure logic for unit testing.
- **Adapters-before-mcp** lets each backend independently pass contract tests.
- **MCP-before-second-consumer** validates ruggy's surface stable before generalizing.
- **UI-last** because no consumer asked yet.

Phase 0 → Phase 6 estimated 3-4 weeks of focused work, but most can land incrementally with no breaking change at any step.
