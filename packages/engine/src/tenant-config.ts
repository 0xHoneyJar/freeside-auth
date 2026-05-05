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

export const TenantUserTableSchema = z.object({
  name: z.string(),
  wallet_column: z.string(),
  sol_address_column: z.string().optional(),
  dynamic_user_id_column: z.string().optional(),
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
