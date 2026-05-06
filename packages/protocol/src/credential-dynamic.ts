/**
 * DynamicCredentialProof (Zod TS binding).
 *
 * Dynamic SDK credential proof shape. Slice-B's primary credential path:
 * Discord users bind wallets via Dynamic Labs; bot reads `dynamic_user_id`
 * at session-start (via freeside-auth MCP); mint orchestrator resolves
 * identity via this proof shape against the per-tenant adapter.
 *
 * Direct path: `input.dynamic_user_id → midi_profiles.dynamic_user_id` (mibera)
 * or `→ profiles.dynamic_user_id` (cubquest). No SIWE proof needed since
 * Dynamic already attested the wallet binding.
 */

import { z } from 'zod';

export const DynamicVerifiedCredentialSchema = z.object({
  id: z.string().optional(),
  format: z.enum(['blockchain', 'email', 'social']).optional(),
  chain: z.string().optional(),
  address: z.string().optional(),
  wallet_provider: z.string().optional(),
}).passthrough();

export type DynamicVerifiedCredential = z.infer<typeof DynamicVerifiedCredentialSchema>;

export const DynamicCredentialProofSchema = z.object({
  schema_version: z.literal('1.0').optional(),
  type: z.literal('dynamic'),
  dynamic_user_id: z.string(),
  verified_credentials: z.array(DynamicVerifiedCredentialSchema).optional(),
}).strict();

export type DynamicCredentialProof = z.infer<typeof DynamicCredentialProofSchema>;
