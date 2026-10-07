import { z } from 'zod';

export class InspectionAssistError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'ACCESS_DENIED' | 'BINDING_CHANGED' | 'TEMPLATE_UNAVAILABLE' | 'CAPABILITY_UNSUPPORTED' | 'STORAGE_UNAVAILABLE' | 'REVISION_CONFLICT' | 'RECONCILIATION_REQUIRED') {
    super(code);
  }
}

export const inspectionId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const inspectionTargetSchema = z.object({
  orderId: inspectionId,
  allocationId: inspectionId,
  stage: z.enum(['pickup', 'return']),
}).strict();
export type InspectionTarget = z.infer<typeof inspectionTargetSchema>;

export function parseInspectionInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new InspectionAssistError('INVALID_INPUT');
  return result.data;
}
