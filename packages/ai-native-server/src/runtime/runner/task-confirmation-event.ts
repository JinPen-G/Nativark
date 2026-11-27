/** Original stored checkpoint and continuation acknowledgement envelopes. */
import { z } from 'zod';
import { AI_TASK_STATUSES_DRAFT } from '@rental-os/platform-contracts/ai-task';
const checkpointId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u);
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const aiTaskConfirmationEventSchema = z.object({ data: z.object({ from: z.enum(AI_TASK_STATUSES_DRAFT), to: z.enum(AI_TASK_STATUSES_DRAFT), reason: z.string() }).strict(),
  initiator: z.object({ kind: z.literal('worker'), id: z.string().min(1).max(191), actorKind: z.string(), actorId: z.string() }).strict(),
  confirmation: z.object({ checkpointRef: checkpointId, phaseId: checkpointId }).passthrough() }).passthrough();

export const confirmationContinuationSchema = z.object({ checkpointRef: id.max(36), stepId: id.max(36),
  stepRevision: z.number().int().positive().max(4294967294), decisionRef: id.max(36), decision: z.enum(['approved', 'rejected']),
  remainingActiveMs: z.number().int().min(1).max(86400000), remainingOutputBytes: z.number().int().min(1).max(16777216) }).strict();
export const aiTaskResumedConfirmationSchema = z.object({ data: z.object({ from: z.literal('waiting_confirmation'), to: z.literal('running'), reason: z.literal('resume') }).strict(),
  confirmation: confirmationContinuationSchema.extend({ phaseId: id.max(36), contentHash: hash, runId: id.max(36),
    runRevision: z.number().int().positive().max(4294967294), holderId: id, fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u) }).strict() }).passthrough();
