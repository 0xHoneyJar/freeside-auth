/**
 * TenantAdapter port — interface for per-tenant identity resolution.
 *
 * Per [[freeside-as-identity-spine]]: each tenant has a different substrate
 * shape (split / unified / config / legacy). Adapters in
 * `@freeside-auth/adapters` implement this interface against per-tenant
 * Postgres (or other substrate). The TenantRegistry in
 * `@freeside-auth/engine` returns the right adapter for each request.
 *
 * Per SDD §12.4: ports = interfaces; adapters = implementations.
 */

import type { Wallet, Chain } from '@freeside-auth/protocol';

/** Input shape for credential resolution. Discriminated union per credential type. */
export type CredentialInput =
  | { type: 'siwe'; wallet: { chain: Chain; address: string }; siwe_proof?: string }
  | { type: 'passkey'; credential_id: string }
  | { type: 'dynamic'; dynamic_user_id: string; tenant_id?: string }
  | { type: 'email-otp'; email: string }
  | { type: 'solana-sign'; wallet: { chain: 'solana'; address: string }; signature: string };

/** Identity resolved from credential lookup. tenant-scoped. */
export interface TenantUserIdentity {
  tenant_id: string;
  user_id: string;             // tenant-scoped (e.g., midi_profiles.id)
  wallets: Wallet[];
  display_name?: string;
  discord_id?: string;
  twitter_handle?: string;
  raw_row?: Record<string, unknown>;  // full row for downstream use
}

/** Health check result. */
export interface PingResult {
  ok: boolean;
  latency_ms: number;
  substrate: string;
}

/**
 * Per-tenant adapter for credential → identity resolution.
 *
 * Implementations:
 * - PostgresSplitAdapter (mibera · `dynamic_users` ↔ `midi_profiles`)
 * - PostgresUnifiedAdapter (cubquest · `profiles` with multi-chain)
 * - PostgresConfigAdapter (apdao · governance · no user table · null on resolve)
 * - PostgresLegacyAdapter (henlo-old · archive · throws on resolve)
 */
export interface TenantAdapter {
  readonly id: string;
  readonly config: TenantConfigShape;

  /** Resolve credential → canonical user identity in tenant scope. Returns null if not found. */
  resolveCredential(input: CredentialInput): Promise<TenantUserIdentity | null>;

  /** Fetch tenant-scoped claims to embed in JWT (e.g., role, tier, custom fields). */
  fetchClaims(userId: string): Promise<Record<string, unknown>>;

  /** Health check · gates Layer-1 smoke. */
  ping(): Promise<PingResult>;
}

/** Forward-declared shape; full Zod schema lives in @freeside-auth/engine/tenant-config. */
export interface TenantConfigShape {
  id: string;
  name: string;
  substrate: 'postgres' | 'turso' | 'none';
  shape: 'split' | 'unified' | 'config' | 'legacy';
  chains: Chain[];
  dynamic_user_id_present: boolean;
  archive_only: boolean;
  connection: { env_var: string; railway_project_id?: string };
  user_table?: {
    name: string;
    wallet_column: string;
    sol_address_column?: string;
    dynamic_user_id_column?: string;
  };
}
