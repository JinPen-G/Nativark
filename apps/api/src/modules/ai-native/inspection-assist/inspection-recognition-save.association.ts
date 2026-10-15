import { z } from 'zod';
import { inspectionId, inspectionTargetSchema } from './inspection-assist.validation';

/** Internal durable evidence only. Never accepted in an HTTP command or
 * exported as a candidate, permission, dispatch ticket or shared DTO. */
export const recognitionSaveReferenceSchema = inspectionTargetSchema.extend({
  templateId: inspectionId, draftId: inspectionId, inputId: inspectionId,
  expectedRevision: z.number().int().min(1).max(999), taskId: inspectionId,
  resultId: inspectionId, operationId: inspectionId,
}).strict();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const recognitionSaveAssociationSchema = z.object({
  version: z.literal(1), reference: recognitionSaveReferenceSchema,
  scope: z.object({ tenantId: inspectionId, workspaceId: inspectionId,
    ownerId: inspectionId, audience: z.enum(['staff', 'operator']) }).strict(),
  runId: inspectionId, stepId: inspectionId, actionId: inspectionId,
  actionInputId: inspectionId, inputHash: hash, resultHash: hash,
  inputFingerprint: hash, bindingFingerprint: hash, candidateHash: hash,
  commandHash: hash,
}).strict();
export type RecognitionSaveReference = z.infer<typeof recognitionSaveReferenceSchema>;
export type RecognitionSaveAssociation = z.infer<typeof recognitionSaveAssociationSchema>;
