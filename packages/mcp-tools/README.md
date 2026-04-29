# packages/mcp-tools — MCP tool specs (agent surface)

The agent-callable surface for identity resolution. Tools exposed via Model Context Protocol so persona-bots (ruggy, future companion-bots) call them like any other MCP tool.

## Planned tools

| tool | purpose | impl source |
|---|---|---|
| `resolve_wallet` | Wallet → handle / discord_username / mibera_id / pfp / fallback. Cached 5min. Returns truncated 0x... when not found. | `IIdentityService.resolveWallet` |
| `resolve_wallets` | Batch resolver — returns array. Pre-fetches when composing prose mentioning multiple miberas. | `IIdentityService.resolveWallets` |
| `verify_token` | Verifies an ES256 JWT against the JWKS. Returns claims (`sub`, `wallets[]`, `tenant`, `tier`, etc.). | `IJwksProvider.verifyToken` |
| `link_wallet` (op-only) | Link a verified credential to an existing canonical user. Op-gated. | `IIdentityService.linkCredential` |

## Tool wrapper pattern

Per `freeside-quests/packages/mcp-tools/`:
- Two surfaces: **`createIdentitiesMcpServer(deps)`** for in-bot deployment (consumes ports directly) and **HTTP MCP server** wrapper for remote deployment.
- Same tool specs both surfaces. The server transport differs; the contract holds.

## Status: scaffolded

Today's working impl is the in-bot freeside_auth MCP at `freeside-ruggy/apps/bot/src/agent/freeside_auth/server.ts`. Once this package publishes:

```ts
// freeside-ruggy switches from in-bot impl to package consumer:
import { createIdentitiesMcpServer } from '@freeside-identities/mcp-tools';

const server = createIdentitiesMcpServer({
  identityService: pgMidiProfilesAdapter(env.RAILWAY_MIBERA_DATABASE_URL),
});

// orchestrator.ts mcpServers map gains:
//   freeside_auth: server   ←   was inline; now imported
```

## Persona-prompt composition

Tools land in agent prompts under the namespace `mcp__freeside_auth__*` (matches today's ruggy convention). When migrating: tool names stay stable so persona prompts don't break. Per [[score-vs-identity-boundary]] doctrine: persona surface is stable; backend swaps.

## Consumers

- `freeside-ruggy/apps/bot/src/agent/orchestrator.ts` — wires into mcpServers map
- Future `freeside-dixie` (B2B operator interface) — same MCP, different prompt context
- Future per-world persona-bots — same MCP surface
