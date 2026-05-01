---
title: Dynamic Global Wallet Kit — research synthesis
date: 2026-05-01
purpose: Ground freeside-auth positioning in concrete prior-art (Dynamic GWK) before sprint-1 ships. Operator-directed reference research.
operator_url: https://www.dynamic.xyz/blog/dynamic-global-wallet-kit
research_method: WebFetch + WebSearch (dig-search.ts returned 403 PERMISSION_DENIED on all Gemini fallback models)
verification: Citations preserved per source; inferences flagged `[INFERENCE]`; training-priors flagged `[TRAINING-PRIOR — verify]`
---

# Dynamic Global Wallet Kit — Research Synthesis (2026-05-01)

> Operator-directed reference dig. Goal: extract concrete signal that informs whether freeside-auth's design covers what GWK was trying to do, and where GWK's UX/DX failures point at gaps freeside-auth should explicitly address.

## A · What Global Wallet Kit IS

A toolkit Dynamic announced (and acquired-into-Fireblocks Oct 2025) that lets a brand/chain run a **branded embedded-wallet network** that shows up inside other apps. Bundles:

- **Branded "Log In With [Brand]" surface** — brand becomes a login option in third-party apps via existing wallet-discovery rails (RainbowKit, ConnectKit, Solana Wallet Adapter, WalletConnect)
- **Global Identities** — ENS handles under brand subdomain (e.g. `*.sophon.eth`)
- **Global Connectivity** — embedded wallets that "operate independently of the app they were created in" so the same wallet works across apps
- **Ecosystem Hub** — discover-apps + on/off-ramp surface for the brand
- **Security stack** — TEE key custody, Blockaid txn simulation, MFA, recovery
- **Multi-Chain Adapter** — 500+ wallets across EVM/Solana/Bitcoin/Sui/Base

**Pricing**: free up to 1,000 MAU; usage-tiered above that.

**Strategic context**: Fireblocks acquired Dynamic for ~$90M (Oct 2025) to complete its "custody-to-consumer" stack. **Roadmap is now optimized for fintech/enterprise custody-to-consumer flow, not indie builders.**

**Multi-tenant architecture** `[INFERENCE]`: each brand is a tenant inside Dynamic's hosted infra; tenant isolation mechanics not described publicly.

## B · The Promise

Stated pitch (https://www.dynamic.xyz/blog/dynamic-global-wallet-kit): *"Don't build apps, build worlds."*

1. Solve siloed embedded wallets (the NFT-mint-wallet that works nowhere else)
2. Let brands own identity — *"wallets should empower your brand—not ours—to take center stage"*
3. Frictionless cross-app navigation with one wallet + branded UX
4. Turn an app into an ecosystem in "minutes"

## C · The Reality (adoption + DX signal)

- **Adoption signal is thin.** Sophon and "The Arena" are the only named launch partners. Independent third-party case studies of GWK specifically: not findable.
- **Sophon shipped own SSO repo** (`sophon-org/sophon-account-sso` on GitHub) — `[INFERENCE]` they may have built around rather than purely on top of GWK. Source-level read needed to confirm.
- **Concrete DX bug** (DEV.to comparison): SDK v4.32.0 — `useIsLoggedIn()` does not flip false on wallet disconnect. Privy and Web3Auth handle correctly. Small but it's the canonical "feels broken" complaint.
- **Vendor-lock anxiety is the loudest critique** (Ethereum Magicians, TimDaub):
  > *"if I lead all my users to create an embedded wallet with privy [equivalent for Dynamic]…then for my site to function, I will have to continue integrating with privy."*
  Migration off requires fresh on-chain delegation txns per user → expensive UX.
- **Acquisition risk realized** — Dynamic is a Fireblocks product as of Oct 2025. Indie roadmap deprioritized.
- **Public discourse is immature** — too new (and now under acquisition reorg) for the field to have written a substantive engineering postmortem yet.

## D · Architecture Clues

| Concern | GWK answer |
|---|---|
| (1) Cross-app session | **No JWT/OIDC story disclosed.** Mechanism = "your wallet appears in their wallet picker" via RainbowKit/ConnectKit/WalletConnect. The "session" is the wallet connection itself, not a portable user-id token. |
| (2) Multi-wallet linking | Marketing claims "unified wallet experience"; mechanics undisclosed |
| (3) Tenant isolation | Not described publicly. `[INFERENCE]` hosted multi-tenant under Dynamic infra with brand-namespaced ENS subdomain |
| (4) Custom branding | **Strong** — branded UI, branded ENS subdomain, branded entry in wallet pickers. Actual product differentiator |
| (5) External builder onboarding | **Indirect** — builders integrate existing rails (RainbowKit/ConnectKit/WalletConnect); they don't adopt Dynamic SDK to *receive* a Dynamic-branded wallet. Brand-side adopts Dynamic SDK; consumer-side does not |

## E · Anti-Patterns Freeside-Auth Should Avoid

1. **Wallet-discovery as the only cross-app primitive.** GWK's "cross-app" is "your wallet shows up in their wallet picker." That's not session portability — it's wallet-picker UX.
2. **No public JWT/OIDC story.** Means no clean way for a *server* in app B to verify a user authenticated through brand A's identity. Forces every consumer to be a wallet-connect surface.
3. **Hosted lock-in by design.** Migrating off requires re-delegating keys per user.
4. **Disconnect-state desync** — small DX bugs erode trust.
5. **Ecosystem story collapses on acquisition.** Indie builders' "moat" got absorbed into Fireblocks' enterprise stack.
6. **MAU-pricing trap** `[TRAINING-PRIOR — verify]` — same growth-penalty pattern that bites Auth0 users.

## F · What freeside-auth Gets To Do Better

- **JWT/JWKS spine is the headline differentiator.** GWK has no documented portable session token. Freeside JWT signed at the loa-freeside Rust gateway means *any* server (any world, any external builder) can verify a Freeside-issued identity without adopting our SDK. **That's the cross-app primitive GWK skipped.**
- **Three-layer split (credential / identity / session)** maps cleanly to "brand A's wallet + canonical user_id + portable session" — GWK conflates these into "the wallet."
- **Per-world auth manifest (FR-4.1)** is honest about heterogeneity. GWK assumes every brand wants the same flow; Freeside lets THJ run SIWE-admin while Purupuru runs email-magic-link, sharing only the canonical user_id.
- **Canonical user (ULID) decoupled from wallet** sidesteps the "migration = re-delegate keys" anti-pattern. Wallet rotation doesn't break user_id continuity.
- **External-builder surface = standard JWKS + OIDC-shaped flow**, not "add our connector to your RainbowKit config." Lower integration cost on the *consumer* side, which is where GWK is weakest.
- **Better Auth as session backbone** — battle-tested OSS substrate; GWK's session story is proprietary and Fireblocks-owned.

### Where Dynamic is genuinely strong (don't pretend otherwise)

- **Multi-chain wallet UI polish across EVM/Solana/Bitcoin/Sui** — 500+ wallet support. **Freeside-auth probably should NOT try to out-build this** — treat Dynamic-as-credential-layer as a legitimate option in the per-world manifest.
- **TEE key custody + Blockaid txn simulation.** Infra commitments freeside-auth shouldn't replicate from scratch in V1.
- **Wallet-picker network effect** (RainbowKit/ConnectKit/WalletConnect plumbing already done).

### The honest framing

> **freeside-auth is not a Global-Wallet-Kit competitor at the credential layer — it's the identity/session layer GWK never built. The wallet-UX layer can remain Dynamic (or Reown AppKit, or Privy) on a per-world basis; freeside-auth owns the JWT/canonical-user spine that GWK leaves to "the wallet itself."**

This **softens the anti-Dynamic posture** in the existing PRD/SDD:
- ANTI-13 (no Dynamic in net-new) was about replacing the WHOLE STACK
- The research suggests: Dynamic credential UI stays legitimate per-world; we refuse Dynamic as the **spine** but not as a **credential adapter**
- FR-2.6 ("Dynamic legacy-migration only") wants refinement → Dynamic is one option among credential adapters; **no longer privileged as default but not banned either**

## G · Concrete amendments triggered

**PRD**:
1. **FR-2.6 refine** — Dynamic is per-world credential adapter (one of many), not just legacy-migration shim
2. **NEW NFR-1.6** — External builder surface = standard JWKS/OIDC (NOT "add our SDK"). Anti-pattern: forcing consumer-side SDK adoption (GWK does this; we don't)
3. **NEW ANTI-23** — Don't conflate wallet-discovery with cross-app session (GWK's primary architecture mistake)
4. **NEW NFR-4.4** — DX/UX bar = "external builder scaffolds own brand on freeside-auth in <60 minutes, integrates with their other apps without re-signup contamination" (operator-stated 2026-05-01)

**SDD**:
1. §4.5 `credential-bridge-dynamic.ts` — refine framing from "legacy-migration only" to "credential adapter (read-only post-migration); per-world choice"
2. §1.X — add subsection "What freeside-auth is NOT" naming the GWK boundary clearly
3. §0 — append Coordinate Amendment 2 (2026-05-01) — research synthesis pointer

**Seed**:
- §16 captures research synthesis + amendment manifest (durable cross-session reference)

## Verification flags

- `[INFERENCE]` Dynamic GWK tenant-isolation architecture — not publicly documented; verify with Dynamic docs/sales if it matters to Freeside positioning
- `[INFERENCE]` Sophon `sophon-account-sso` repo relationship to GWK — could be using GWK or building parallel; needs source-level read
- `[TRAINING-PRIOR — verify]` MAU-tier pricing trap pattern applied to Dynamic specifically; only the free-1k-MAU tier confirmed in the blog
- Could not find a public Hacker News thread or substantive engineering postmortem critiquing GWK in depth — operator should treat the public discourse as **immature signal**

## Sources (visited or surfaced via WebSearch)

- https://www.dynamic.xyz/blog/dynamic-global-wallet-kit *(operator URL, fetched)*
- https://www.dynamic.xyz/features/global-wallet *(fetched)*
- https://www.dynamic.xyz/blog/dynamic-is-joining-fireblocks
- https://www.theblock.co/post/375939/fireblocks-crypto-authentication-dynamic-web3
- https://www.coindesk.com/business/2025/10/23/fireblocks-acquires-dynamic-to-expand-on-chain-developer-stack
- https://dev.to/heyradcode/comparing-web3-wallet-onboarding-dynamicxyz-web3authio-and-privyio-1018
- https://ethereum-magicians.org/t/open-source-alternatives-to-privy-web3auth-and-dynamic/20209 *(fetched)*
- https://www.openfort.io/blog/privy-alternatives
- https://medium.com/@joalavedra/the-ultimate-web3-authentication-guide-2025-wallet-sign-in-embedded-wallets-and-choosing-the-d4eace54f951
- https://docs.reown.com/appkit/overview
- https://github.com/sophon-org/sophon-account-sso

## Process notes

- `dig-search.ts` (Gemini-backed) returned 403 PERMISSION_DENIED across all 3 fallback models (gemini-3-flash-preview / 2.5-flash / 2.0-flash) on 2026-05-01. Failure logged in seed §15 + memory.
- Fell back to WebFetch + WebSearch per CLAUDE.md fallback protocol.
- Operator may want to check Gemini API access (or migrate dig-search backend to a working provider).

---

*Research synthesis authored 2026-05-01 by background Agent (general-purpose) under operator-directed reference dig. Findings inform PRD/SDD amendment manifest §G.*
