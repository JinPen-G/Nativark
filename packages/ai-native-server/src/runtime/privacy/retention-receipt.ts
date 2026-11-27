/** Original retention receipt locators and the shared uncertain commit result. */
import { z } from 'zod';
export const aiRetentionReceiptSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
export const aiRetentionReceiptsSchema = z.object({ limit: z.number().int().min(1).max(50).default(20),
  before: z.string().datetime().optional() }).strict();
export class AiRetentionUnknown extends Error {
  readonly code = 'AI_RESULT_UNKNOWN'; readonly retryable = false;
  constructor() { super('AI_RESULT_UNKNOWN'); }
}

