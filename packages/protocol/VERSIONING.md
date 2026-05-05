# Schema Versioning Policy

> Schemas are bridges. They survive longer than impls. The version field is how we keep the bridge load-bearing as it ages.

This is the governance discipline for evolving every schema in this directory. Imported verbatim from `loa-constructs/.claude/schemas/VERSIONING.md` (canonical source). Reference: `~/hivemind/wiki/concepts/contracts-as-bridges.md` and `composition-schema-as-bridge.md`.

---

## TL;DR

- `schema_version` is **enum-locked** on every schema (not a regex pattern). Explicit audit trail.
- **Minor bumps are additive only.** v1.0 documents must validate against v1.1 unchanged.
- **Major bumps require a migration plan** alongside the schema PR. No silent v1 → v2.
- The public `$id` URL stays stable across all versions. Major breakage is signaled in `schema_version`, never the URL.
- **One bridge, two homes.** The canonical `.schema.json` lives here in `freeside-auth/packages/protocol/src/`; consumers (registries, CIs, MCP wrappers, the Rust gateway in loa-freeside) reference these schemas.

---

## When to bump

| Change | Bump |
|--------|------|
| Add a new optional property | minor (`1.0` → `1.1`) |
| Add a new enum value to an existing field | minor |
| Add a new optional `$defs` block | minor |
| Tighten validation (new pattern, smaller `maxLength`) on a field | **major** — existing valid docs may now fail |
| Remove a property | **major** |
| Rename a property | **major** (with migration plan) |
| Change a `const` to an `enum` (additive) | minor |
| Change a property type | **major** |
| Tighten `additionalProperties: false` where it was previously `true` | **major** |
| Add a new required field | **major** — breaks all prior docs |
| Cosmetic edits (descriptions, `$comment`, examples) | no bump |

If unsure, ask: *would any existing valid document fail under the new schema?* If yes → major. If no → minor.

---

## How to bump

### Minor (additive)

1. Edit the `.schema.json` file. Add the new optional shape; do not change required fields.
2. Update `schema_version`:
   ```json
   "schema_version": { "type": "string", "enum": ["1.0", "1.1"] }
   ```
   Add the new version to the enum; **do not remove old versions**. Multi-version validation is the whole point.
3. Mark added fields with `// v1.1` in their `description` so a reader can date them.
4. Update the corresponding `.ts` (Zod) file to match the new shape. Add the field as optional.
5. Update this `VERSIONING.md` with the change in the changelog below.
6. Update `README.md` if the new field needs prose.
7. PR-merge as a single atomic change.

### Major (breaking)

1. Cut a new file: `<name>.v2.schema.json` + `<name>.v2.ts`. Both files coexist for the deprecation window.
2. Update `$id` on the v2 file: `https://loa.dev/schemas/freeside-auth/<name>.v2.schema.json`. **Do not change v1's `$id`.**
3. Write a migration plan in `grimoires/specs/<name>-v2-migration.md`:
   - what changed (diff)
   - automatic transformer (script that converts v1 docs → v2)
   - operator runbook (when to flip consumers · soak window · rollback path)
4. Coordinate with loa-freeside/apps/gateway (Rust) — the gateway's claims construction must update in lockstep with major JWT shape bumps.

---

## Cross-language sync

Per Lock-9 (SDD §12.7):
- `.schema.json` is the canonical cross-language contract
- `.ts` (Zod) is the TS binding · regenerated from JSON Schema or hand-aligned
- Rust gateway at `loa-freeside/apps/gateway` reads `.schema.json` directly (or via mirror)
- Conflicts between `.schema.json` and `.ts` → JSON Schema wins

When updating a schema:
1. Update `.schema.json` first (canonical)
2. Hand-align `.ts` to match (Zod doesn't have a JSON-Schema-to-Zod codegen we trust)
3. Run typecheck + tests
4. Notify loa-freeside maintainer of any major bump for Rust-side mirror

---

## Changelog

### 1.0 (2026-05-05) — slice-B convergence-spine initial author

7 schemas shipped:
- `user.schema.json + .ts` — canonical user entity
- `wallet.schema.json + .ts` — chain-scoped wallet (referenced from User.wallets[])
- `identity-component.schema.json + .ts` — ECS Component on User
- `jwt-claims.schema.json + .ts` — ES256 JWT claims (mirrors loa-freeside/apps/gateway)
- `credential-dynamic.schema.json + .ts` — Dynamic SDK credential proof
- `resolve-result.schema.json + .ts` — output of resolve_wallet 4-tier fallback
- `types.ts` — branded TS primitives (UserId · WalletAddress · CredentialId · TenantSlug · MiberaId · DiscordId)

Deferred (V2):
- `credential-siwe.schema.json + .ts` — direct SIWE proof (slice-B uses Dynamic-bound)
- `credential-passkey.schema.json + .ts` — passkey/WebAuthn (V2)
- `credential-seedvault.schema.json + .ts` — Solana SeedVault (V2 post-cubquest)
- `event.schema.json + .ts` — NATS identity events (V2)
