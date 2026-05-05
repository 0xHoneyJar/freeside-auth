/**
 * ResolveResult (Zod TS binding).
 *
 * Output of resolve_wallet (4-tier fallback algorithm). Drives bot UX:
 * avatar selection · handle display · verification badge · fallback messaging.
 *
 * Per [[chat-medium-presentation-boundary]]: substrate IDs (raw addresses,
 * UUIDs) MUST NOT escape via this shape's display fields. The bot consumes
 * `handle` (presentation) and `wallet.address` (substrate, never rendered raw).
 *
 * Source: `mibera-dimensions/lib/server/resolve-wallet.ts:56-331` (canonical
 * 4-tier algorithm; extracts to freeside-auth/packages/engine/resolve-tier.ts
 * in slice-B B-1.2 work).
 */

import { z } from 'zod';
import { WalletSchema } from './wallet';

export const ResolvedViaSchema = z.enum([
  'primary',
  'fallback-discord',
  'fallback-handle',
  'fallback-wallet',
  'anon',
]);
export type ResolvedVia = z.infer<typeof ResolvedViaSchema>;

export const ResolveResultSchema = z.object({
  schema_version: z.literal('1.0').optional(),
  found: z.boolean(),
  wallet: WalletSchema.optional(),
  handle: z.string().optional(),
  discord_id: z.string().optional(),
  discord_username: z.string().optional(),
  mibera_id: z.number().int().min(1).max(10000).optional(),
  pfp_url: z.string().url().optional(),
  fallback: z.boolean().optional(),
  resolved_via: ResolvedViaSchema,
}).strict();

export type ResolveResult = z.infer<typeof ResolveResultSchema>;
