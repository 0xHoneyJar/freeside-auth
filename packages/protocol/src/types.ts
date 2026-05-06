/**
 * Branded TS types for identity overlay primitives.
 *
 * Purpose: prevent accidental cross-domain mixing (e.g., assigning a wallet
 * address to a user_id field). Brands are erased at runtime — pure type-time
 * safety.
 *
 * Per [[freeside-as-identity-spine]] doctrine + freeside-auth/CLAUDE.md ECS
 * placement: User entity owned here, Wallet entity owned by score-mibera but
 * referenced via WalletAddress brand.
 */

declare const brand: unique symbol;

/** Tenant-scoped canonical user ID. Sourced from per-tenant adapter (e.g., midi_profiles.id for mibera). */
export type UserId = string & { readonly [brand]: 'UserId' };
export const UserId = (s: string): UserId => s as UserId;

/** Wallet address (canonical lowercase for EVM, base58 for Solana). Chain-scoped via Wallet.chain. */
export type WalletAddress = string & { readonly [brand]: 'WalletAddress' };
export const WalletAddress = (s: string): WalletAddress => s as WalletAddress;

/** Per-credential opaque ID (e.g., Dynamic SDK dynamic_user_id, passkey credentialId). */
export type CredentialId = string & { readonly [brand]: 'CredentialId' };
export const CredentialId = (s: string): CredentialId => s as CredentialId;

/** Tenant slug. Pattern: `^[a-z][a-z0-9-]+$`. Examples: `mibera`, `cubquest`, `apdao`, `honeyjar`. */
export type TenantSlug = string & { readonly [brand]: 'TenantSlug' };
export const TenantSlug = (s: string): TenantSlug => s as TenantSlug;

/** Mibera token ID (1-10000, the on-chain Grail/Mibera identifier). */
export type MiberaId = number & { readonly [brand]: 'MiberaId' };
export const MiberaId = (n: number): MiberaId => n as MiberaId;

/** Discord user snowflake ID (string, since JS numbers can't hold the full 64-bit precision). */
export type DiscordId = string & { readonly [brand]: 'DiscordId' };
export const DiscordId = (s: string): DiscordId => s as DiscordId;

/** Chain identifier — narrow set per [[score-vs-identity-boundary]]. */
export type ChainId = 'ethereum' | 'berachain' | 'solana' | 'bitcoin';

/** Tier names per loa-freeside/apps/gateway issuance. Slice-B uses subset. */
export type Tier = 'public' | 'verified' | 'bearer' | 'initiate' | 'keeper';
