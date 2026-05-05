/**
 * Wallet entity (Zod TS binding).
 *
 * Mirrors `wallet.schema.json` (canonical JSON Schema · cross-language source-
 * of-truth). Per Lock-9 (SDD §12.7): JSON Schema wins on conflict.
 *
 * Owned by score-mibera per [[score-vs-identity-boundary]]; referenced here
 * via address+chain pair. This module's User.wallets[] joins to score's
 * Wallet entity.
 */

import { z } from 'zod';

export const ChainSchema = z.enum(['ethereum', 'berachain', 'solana', 'bitcoin']);
export type Chain = z.infer<typeof ChainSchema>;

export const VerifiedViaSchema = z.enum(['siwe', 'passkey', 'dynamic', 'seedvault', 'legacy']);
export type VerifiedVia = z.infer<typeof VerifiedViaSchema>;

export const WalletSchema = z.object({
  schema_version: z.literal('1.0').optional(),
  chain: ChainSchema,
  address: z.string(),
  verified_via: VerifiedViaSchema,
  linked_at: z.string().datetime(),
  primary: z.boolean().optional(),
}).strict();

export type Wallet = z.infer<typeof WalletSchema>;
