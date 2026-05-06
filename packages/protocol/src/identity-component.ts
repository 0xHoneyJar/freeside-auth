/**
 * IdentityComponent (Zod TS binding).
 *
 * ECS Component attached to User entity per [[ecs-architecture-freeside]].
 * Carries credentials + presentation handles + social links + per-tenant
 * identity data.
 *
 * Composition rules:
 * - User Entity (canonical · this module)
 * - IdentityComponent (this Component · this module)
 * - Per-Wallet FactorEvent Components (score-mibera domain · NOT here)
 *
 * Per [[chat-medium-presentation-boundary]]: substrate truth (UUIDs, raw IDs)
 * MUST NEVER escape to chat render. Use `handle` + shortened wallet for
 * presentation; UUIDs stay in substrate logs.
 */

import { z } from 'zod';

export const CredentialTypeSchema = z.enum(['siwe', 'passkey', 'dynamic', 'seedvault', 'legacy']);
export type CredentialType = z.infer<typeof CredentialTypeSchema>;

export const BoundCredentialSchema = z.object({
  type: CredentialTypeSchema,
  credential_id: z.string(),
  linked_at: z.string().datetime().optional(),
}).strict();

export type BoundCredential = z.infer<typeof BoundCredentialSchema>;

export const IdentityComponentSchema = z.object({
  schema_version: z.literal('1.0').optional(),
  user_sub: z.string(),
  credentials: z.array(BoundCredentialSchema).optional(),
  handle: z.string().optional(),
  discord_id: z.string().optional(),
  discord_username: z.string().optional(),
  mibera_id: z.number().int().min(1).max(10000).optional(),
  pfp_url: z.string().url().optional(),
  pfp_attribution: z.string().optional(),
  bio: z.string().max(280).optional(),
}).strict();

export type IdentityComponent = z.infer<typeof IdentityComponentSchema>;
