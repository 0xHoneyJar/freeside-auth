/**
 * User entity (Zod TS binding).
 *
 * Per [[freeside-as-identity-spine]] doctrine: canonical user across chains,
 * tenants, and credential providers. Single `sub` bound to multi-wallet,
 * multi-credential, multi-tenant memberships.
 *
 * Profile DATA stays in midi (per freeside-auth/CLAUDE.md schemas-here-data-
 * in-midi rule); this module ships the SCHEMA only. Adapters in
 * `packages/adapters/` materialize User instances from per-tenant Postgres.
 */

import { z } from 'zod';
import { WalletSchema } from './wallet';

export const TenantSlugSchema = z.string().regex(/^[a-z][a-z0-9-]+$/, {
  message: 'tenant_slug must match ^[a-z][a-z0-9-]+$',
});

export const UserSchema = z.object({
  schema_version: z.literal('1.0').optional(),
  sub: z.string(),
  wallets: z.array(WalletSchema),
  tenant_memberships: z.array(TenantSlugSchema),
  created_at: z.string().datetime(),
}).strict();

export type User = z.infer<typeof UserSchema>;
