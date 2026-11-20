import { z } from 'zod';
import { AI_SCENE_REQUEST_DRAFT_VERSION, AI_SCENE_REQUEST_MAX_BYTES, AI_QUOTE_GOAL_DRAFT_VERSION, AI_QUOTE_GOAL_LIMITS,
  type AiSceneRequestCreateDraft, type AiSceneRequestBody } from '@rental-os/shared';
import { aiQuoteCandidateInputSchema } from '../tools/quote-candidate-preparation.service';
import { AiTaskRepositoryError } from '../ai-task.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const common = { draftVersion: z.literal(AI_SCENE_REQUEST_DRAFT_VERSION), requestKey: id.max(128) };
export const originalQuoteGoalInputSchema = z.object({ kind: z.literal('quote_goal'),
  draftVersion: z.literal(AI_QUOTE_GOAL_DRAFT_VERSION), goalText: z.string().min(1).max(AI_QUOTE_GOAL_LIMITS.goalCharacters)
    .refine(value => value.trim().length > 0) }).strict();
const bodies = [
  z.object({ ...common, sceneCode: z.literal('order_explanation'), input: z.object({ orderId: id, question: z.enum(['status', 'fees', 'payments', 'next_steps']) }).strict() }).strict(),
  z.object({ ...common, sceneCode: z.literal('opening_diagnosis'), input: z.object({ sections: z.array(id).min(1).max(9).refine(value => new Set(value).size === value.length) }).strict() }).strict(),
  z.object({ ...common, sceneCode: z.literal('quote_clarification'), input: z.union([
    z.object({ candidate: aiQuoteCandidateInputSchema }).strict(), originalQuoteGoalInputSchema]) }).strict()
] as const;
const create = z.discriminatedUnion('sceneCode', bodies);
const reissue = z.discriminatedUnion('sceneCode', [bodies[0].extend({ previousInputRef: z.string().uuid() }), bodies[1].extend({ previousInputRef: z.string().uuid() }), bodies[2].extend({ previousInputRef: z.string().uuid() })]);
export const originalRequestReferenceSchema = z.object({ draftVersion: z.literal(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: z.string().uuid() }).strict();
export function freezeOriginalInput<T>(input: T): T {
  if (input && typeof input === 'object') { Object.values(input).forEach(freezeOriginalInput); Object.freeze(input); }
  return input;
}
export function parseOriginalRequest(value: unknown, isReissue = false): AiSceneRequestCreateDraft & { previousInputRef?: string } {
  const parsed = (isReissue ? reissue : create).safeParse(value);
  if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const input = parsed.data;
  if (input.sceneCode === 'opening_diagnosis') input.input.sections.sort();
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > AI_SCENE_REQUEST_MAX_BYTES) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(input);
}
export function originalBody(value: AiSceneRequestBody): AiSceneRequestBody {
  return { sceneCode: value.sceneCode, input: value.input } as AiSceneRequestBody;
}
