import { z } from 'zod';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
// The received admission table is workspace-only. Never silently collapse platform/tenant scopes into it.
export const admissionScopeSchema = z.object({
  id, kind: z.literal('WORKSPACE'), tenantId: id, workspaceId: id
}).strict();
export const admissionStatusSchema = z.enum(['admitted', 'revoked', 'cancelled', 'completed', 'unknown']);
export const admissionInputSchema = z.object({
  scope: admissionScopeSchema, actorId: id, callId: id.max(128), requestHash: z.string().min(1).max(128),
  profileId: id.max(36).nullable().optional(), expiresAt: z.date()
}).strict();
export const admissionRecordSchema = admissionInputSchema.extend({
  id: id.max(36), profileId: id.max(36).nullable(), status: admissionStatusSchema,
  dispatchId: id.max(128).nullable(), unknownReason: z.string().min(1).max(128).nullable(),
  admittedAt: z.date(), updatedAt: z.date(), revokedAt: z.date().nullable(), completedAt: z.date().nullable()
}).strict();
export const admissionPatchSchema = z.object({ dispatchId: id.max(128).nullable().optional(), unknownReason: z.string().min(1).max(128).nullable().optional() }).strict();
export const admissionCallIdSchema = id.max(128);
