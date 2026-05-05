/**
 * PostgresSplitAdapter — implements TenantAdapter for tenants with split shape.
 *
 * Slice-B target: mibera. Substrate shape: `dynamic_users` table separate from
 * per-app profile (`midi_profiles`). `dynamic_user_id` is the join column;
 * the `wallet_address` lives on midi_profiles.
 *
 * Resolve paths:
 * 1. Direct (input.dynamic_user_id) → `midi_profiles WHERE dynamic_user_id = $1`
 * 2. Wallet (input.wallet.address) → `midi_profiles WHERE wallet_address = $1` (lowercased)
 * 3. Discord (input.discord_id) → `midi_profiles WHERE discord_id = $1`
 *
 * Per Lock-2 (I2 Cyberdeck Seam): SQL is a side effect · this adapter lives
 * at L4 boundary (P3 Execution plane). Pure logic stays in @freeside-auth/engine.
 *
 * Per [[chat-medium-presentation-boundary]]: this adapter returns raw rows
 * (substrate truth). Callers MUST sanitize before chat-medium presentation.
 *
 * Source: substrate-of-record audit + tenant-adapter-foundation §lines 21+89-102.
 */

import type { Pool } from 'pg';
import type {
  TenantAdapter,
  TenantConfigShape,
  TenantUserIdentity,
  CredentialInput,
  PingResult,
} from '@freeside-auth/ports';
import type { Wallet } from '@freeside-auth/protocol';
import type { TenantConfig } from '@freeside-auth/engine';

/**
 * Subset of `pg.Pool` interface that this adapter requires. Allows test
 * substitution without importing the full `pg` package surface.
 */
export interface PgPoolLike {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  end?: () => Promise<void>;
}

/** Row shape returned from `midi_profiles` table. Adapter-internal type. */
export interface MidiProfileRow {
  id: string;
  dynamic_user_id: string | null;
  wallet_address: string | null;
  discord_id: string | null;
  discord_username: string | null;
  display_name: string | null;
  twitter_handle: string | null;
  created_at: string;
  [extra: string]: unknown;
}

export class PostgresSplitAdapter implements TenantAdapter {
  readonly id: string;
  readonly config: TenantConfigShape;
  private readonly pool: PgPoolLike;
  private readonly tableName: string;
  private readonly walletColumn: string;
  private readonly dynamicIdColumn: string;

  constructor(
    config: TenantConfig,
    pool: PgPoolLike,
  ) {
    if (config.shape !== 'split') {
      throw new Error(
        `PostgresSplitAdapter requires shape='split', got '${config.shape}' for tenant ${config.id}`,
      );
    }
    if (!config.user_table) {
      throw new Error(
        `PostgresSplitAdapter requires user_table config for tenant ${config.id}`,
      );
    }

    this.id = config.id;
    this.config = {
      id: config.id,
      name: config.name,
      substrate: config.substrate,
      shape: config.shape,
      chains: config.chains,
      dynamic_user_id_present: config.dynamic_user_id_present,
      archive_only: config.archive_only,
      connection: config.connection,
      user_table: config.user_table,
    };
    this.pool = pool;
    this.tableName = config.user_table.name;
    this.walletColumn = config.user_table.wallet_column;
    this.dynamicIdColumn = config.user_table.dynamic_user_id_column ?? 'dynamic_user_id';
  }

  async resolveCredential(input: CredentialInput): Promise<TenantUserIdentity | null> {
    // Path 1: direct dynamic_user_id lookup (Munkh's primary path · slice-B)
    if (input.type === 'dynamic') {
      const row = await this.fetchOne(
        `SELECT * FROM ${this.tableName} WHERE ${this.dynamicIdColumn} = $1 LIMIT 1`,
        [input.dynamic_user_id],
      );
      if (!row) return null;
      return this.rowToIdentity(row);
    }

    // Path 2: SIWE wallet lookup (V1.5 · direct wallet path for non-Discord origins)
    if (input.type === 'siwe' && input.wallet.chain === 'ethereum') {
      const row = await this.fetchOne(
        `SELECT * FROM ${this.tableName} WHERE LOWER(${this.walletColumn}) = LOWER($1) LIMIT 1`,
        [input.wallet.address],
      );
      if (!row) return null;
      return this.rowToIdentity(row);
    }

    // Path 3: passkey / email-otp / solana-sign — V2 (slice-B does not implement)
    return null;
  }

  async fetchClaims(userId: string): Promise<Record<string, unknown>> {
    const row = await this.fetchOne(
      `SELECT * FROM ${this.tableName} WHERE id = $1 LIMIT 1`,
      [userId],
    );
    if (!row) return {};
    // Project to JWT-safe claim subset · CMP-boundary preserved (no raw IDs)
    return {
      tier: 'verified',
      display_name: row.display_name ?? row.discord_username ?? null,
      discord_id: row.discord_id ?? null,
    };
  }

  async ping(): Promise<PingResult> {
    const start = Date.now();
    try {
      await this.pool.query('SELECT 1');
      return {
        ok: true,
        latency_ms: Date.now() - start,
        substrate: this.config.substrate,
      };
    } catch {
      return {
        ok: false,
        latency_ms: Date.now() - start,
        substrate: this.config.substrate,
      };
    }
  }

  // ─── helpers ─────────────────────────────────────────────────────────

  private async fetchOne(text: string, params: unknown[]): Promise<MidiProfileRow | null> {
    const result = await this.pool.query<MidiProfileRow>(text, params);
    return result.rows[0] ?? null;
  }

  private rowToIdentity(row: MidiProfileRow): TenantUserIdentity {
    const wallets: Wallet[] = [];
    if (row.wallet_address) {
      wallets.push({
        chain: 'ethereum',
        address: row.wallet_address.toLowerCase(),
        verified_via: row.dynamic_user_id ? 'dynamic' : 'legacy',
        linked_at: row.created_at,
        primary: true,
      });
    }

    return {
      tenant_id: this.id,
      user_id: row.id,
      wallets,
      display_name: row.display_name ?? row.discord_username ?? undefined,
      discord_id: row.discord_id ?? undefined,
      twitter_handle: row.twitter_handle ?? undefined,
      raw_row: row as Record<string, unknown>,
    };
  }
}
