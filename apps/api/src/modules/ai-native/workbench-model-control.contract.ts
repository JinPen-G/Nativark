/** Operator workbench model controls and immutable operation provenance.
 * These private contracts grant no task, model, field or business permission;
 * the request composition still supplies current authorization and Gateway. */
import { z } from 'zod';
import type { readTaskModelRunOrigin } from './task-input/prisma-task-input.repository';
import { AiTaskRepositoryError } from './ai-task.repository';

export const WORKBENCH_MODEL_CONTROL_VERSION = 'workbench-model-control-1' as const;
export const WORKBENCH_MODEL_CONTROL_ACTION = 'ai_native.workbench_model_control';
export const WORKBENCH_MODEL_CONTROL_MARKER = '__workbenchModelControl';
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.number().int().min(1).max(4294967294);
export const workbenchModelControlReferenceSchema = z.object({ taskId: id.max(36), operationId: id.max(128) }).strict();
export const workbenchModelControlCommandSchema = workbenchModelControlReferenceSchema.extend({
  kind: z.enum(['reinterpret', 'reformat']), expectedTaskRevision: revision,
  sourceRunId: id.max(36), sourceResultId: id.max(36), expectedPresentationRevision: revision,
}).strict();
export type WorkbenchModelControlCommand = z.infer<typeof workbenchModelControlCommandSchema>;
export type WorkbenchModelControlReference = z.infer<typeof workbenchModelControlReferenceSchema>;
export const workbenchModelControlPreparationKeySchema = z.object({ scopeId: id.max(36), taskId: id.max(36),
  runId: id.max(36), resourceOriginRunId: id.max(36) }).strict();
export type WorkbenchModelControlPreparationKey = z.infer<typeof workbenchModelControlPreparationKeySchema>;

/** The original source remains immutable. New presentation and run references
 * are separate from business input, original fields and any prior approval. */
export const workbenchModelControlReceiptSchema = z.object({
  version: z.literal(WORKBENCH_MODEL_CONTROL_VERSION), command: workbenchModelControlCommandSchema,
  commandHash: hash, operationLogId: id.max(36), tenantId: id, workspaceId: id, scopeId: id.max(36),
  ownerId: id, audience: z.literal('OPERATOR'), identityHash: hash,
  sceneCode: id, sceneVersion: id, inputRef: id, inputRevision: revision, inputHash: hash,
  runId: id.max(36), runSequence: revision, runTaskRevision: revision,
  resourceOriginRunId: id.max(36), sourceStepId: id.max(36), sourceInputId: id.max(36), sourceInputHash: hash,
  sourceResultHash: hash, materialHash: hash, fieldHash: hash,
  registrationRef: id, resourceRegistrationRef: id, presentationRevision: revision,
  budgetPolicyVersion: id, budgetPolicyHash: hash,
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type WorkbenchModelControlReceipt = z.infer<typeof workbenchModelControlReceiptSchema>;
export type WorkbenchModelControlOriginTransaction = Parameters<typeof readTaskModelRunOrigin>[0];
export type WorkbenchModelControlOriginAccess = Parameters<typeof readTaskModelRunOrigin>[1];
export type WorkbenchModelControlOriginKey = Parameters<typeof readTaskModelRunOrigin>[2];
export type WorkbenchModelControlOrigin = Awaited<ReturnType<typeof readTaskModelRunOrigin>> & {
  control?: { operationLogId: string; presentationRevision: number; sourceRunId: string; sourceResultId: string; resourceOriginRunId: string };
};
export type WorkbenchModelControlOriginReader = (tx: WorkbenchModelControlOriginTransaction,
  access: WorkbenchModelControlOriginAccess, key: WorkbenchModelControlOriginKey) => Promise<WorkbenchModelControlOrigin>;

export interface WorkbenchModelControlObservation extends WorkbenchModelControlReference {
  version: typeof WORKBENCH_MODEL_CONTROL_VERSION;
  status: 'not_observed' | 'registered' | 'running' | 'available' | 'failed' | 'unknown';
  operationLogId?: string;
  kind?: WorkbenchModelControlCommand['kind'];
  runId?: string;
  sourceRunId?: string;
  sourceResultId?: string;
  resultId?: string;
  presentationRevision?: number;
  /** Observation is never permission to repeat a model or business action. */
  nextAction: 'read_original_operation';
}

export function parseWorkbenchModelControl<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(structuredClone(value));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return parsed.data;
}
