import { z } from 'zod';
import type { ApprovedSettingsNotifications } from './approved-settings-change.ports';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const settingsHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const settingsNotificationsSchema = z.object({
  enabledEvents: z.array(z.string().min(1).max(191)).max(64).refine(values => new Set(values).size === values.length),
  editableChannels: z.array(z.enum(['sms', 'app_push', 'wechat', 'email'])).min(1).max(4).refine(values => new Set(values).size === values.length)
}).strict() satisfies z.ZodType<ApprovedSettingsNotifications>;
export const prepareSettingsChangeSchema = z.object({ changeKey: id.max(128), baseRevision: z.number().int().min(1).max(4294967294),
  notifications: settingsNotificationsSchema, expiresAt: z.string().datetime({ offset: true }) }).strict();
export const settingsChangeReferenceSchema = z.object({ changeId: id.max(36), changeHash: settingsHashSchema }).strict();
export const settingsApprovalReferenceSchema = z.object({ proposalId: id, proposalRevision: z.number().int().min(1).max(4294967294),
  approvalId: id, reviewedPayloadHash: settingsHashSchema }).strict();
export const commitSettingsChangeSchema = settingsChangeReferenceSchema.extend({ operationKey: id, approval: settingsApprovalReferenceSchema }).strict();
export const readSettingsOperationSchema = z.object({ operationKey: id }).strict();
