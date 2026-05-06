/**
 * TenantConfig — Zod schema for per-tenant declarative configuration.
 *
 * Source: ~/Documents/GitHub/freeside-auth/grimoires/specs/tenant-adapter-foundation-2026-05-04.md
 * (operator-authored 5-axis schema · post-substrate-of-record-audit).
 *
 * 5 axes per tenant:
 * 1. substrate — postgres / turso / none
 * 2. shape — split (mibera) / unified (cubquest) / config (apdao) / legacy (henlo-old)
 * 3. chains — evm / solana / bitcoin (per [[score-vs-identity-boundary]] chain set)
 * 4. dynamic_user_id_present — true if Dynamic SDK ID column exists
 * 5. archive_only — true for historical-snapshot-only tenants
 *
 * Loaded from tenants.yaml at boot · validated · indexed by id · returned
 * via TenantRegistry.getAdapter(tenant_id).
 */

import { z } from 'zod';

export const TenantSubstrateSchema = z.enum(['postgres', 'turso', 'none']);
export type TenantSubstrate = z.infer<typeof TenantSubstrateSchema>;

export const TenantTableShapeSchema = z.enum(['split', 'unified', 'config', 'legacy']);
export type TenantTableShape = z.infer<typeof TenantTableShapeSchema>;

export const TenantChainSchema = z.enum(['ethereum', 'berachain', 'solana', 'bitcoin']);
export type TenantChain = z.infer<typeof TenantChainSchema>;

export const TenantConnectionSchema = z.object({
  env_var: z.string(),
  railway_project_id: z.string().optional(),
}).strict();

// Postgres identifier pattern · used by adapters that template-literal-
// interpolate table/column names into SQL (postgres-split-adapter etc.).
// Cross-reviewer flatline + bridgebuilder (PR #1 · HIGH) flagged the
// unconstrained-identifier path as a SQL-injection surface that today's
// operator-owned YAML closes but tomorrow's dynamic-tenant flow widens.
// Constraining at the Zod layer fails the manifest at boot rather than
// trusting the call sites · defense-in-depth.
//
// Pattern: PostgreSQL unquoted identifier rules — starts with letter or
// underscore · subsequent chars are letters / digits / underscore · max
// 63 chars (Postgres NAMEDATALEN-1). Quoted identifiers (containing dots,
// dashes, etc.) are NOT allowed in this contract — adapters must use
// unquoted identifiers exclusively.
const SqlIdentifierSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z_][a-z0-9_]*$/, {
    message:
      'must be a valid lowercase Postgres identifier: ^[a-z_][a-z0-9_]*$ (max 63 chars · no dashes · no dots)',
  });

export const TenantUserTableSchema = z.object({
  name: SqlIdentifierSchema,
  wallet_column: SqlIdentifierSchema,
  sol_address_column: SqlIdentifierSchema.optional(),
  dynamic_user_id_column: SqlIdentifierSchema.optional(),
}).strict();

export const TenantConfigSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]+$/, {
    message: 'tenant_id must match ^[a-z][a-z0-9-]+$',
  }),
  name: z.string(),
  substrate: TenantSubstrateSchema,
  shape: TenantTableShapeSchema,
  chains: z.array(TenantChainSchema),
  dynamic_user_id_present: z.boolean(),
  connection: TenantConnectionSchema,
  user_table: TenantUserTableSchema.optional(),
  archive_only: z.boolean().default(false),
}).strict();

export type TenantConfig = z.infer<typeof TenantConfigSchema>;

export const TenantRegistryFileSchema = z.object({
  tenants: z.array(TenantConfigSchema),
}).strict();

export type TenantRegistryFile = z.infer<typeof TenantRegistryFileSchema>;
