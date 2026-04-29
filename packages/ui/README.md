# packages/ui — shared admin React components

Future — for embedding in freeside-dashboard's identity tab. V0.1 of `freeside-auth` ships protocol + ports + adapters + mcp-tools + engine. UI lands once a downstream consumer (freeside-dashboard) needs admin views.

## Planned components

| component | purpose |
|---|---|
| `<LinkWalletFlow>` | Multi-step credential-link wizard. Wraps Dynamic / passkey / SIWE flows behind a unified UI. |
| `<CredentialsList>` | Show all linked credentials for a canonical user. Revoke / re-link affordances. |
| `<IdentityDebug>` | Op-only debugger: which tier resolved this wallet? what's in the cache? what does score-api report? |
| `<HandleEdit>` | Operator surface to update display_name on `midi_profiles` (coordination with midi onboarding). |
| `<TenantPicker>` | When a user belongs to multiple tenants (THJ + Purupuru + Sprawl), pick which to act in. |

## Status: deferred

Per `docs/INTEGRATION-PATH.md`, UI is V0.2+. The first consumer (freeside-dashboard's identity tab) hasn't been authored. Until then this package is intent-only.

## Style

Tailwind + shadcn/ui per ecosystem convention. Theme tokens from each consuming app's design system — UI ships unstyled primitives + sensible defaults.

## Composes with

- `freeside-dashboard` — primary consumer (when identity tab lands)
- Per-world admin surfaces — opt-in
- `freeside-quests/packages/ui` — sibling pattern; identical structural conventions
