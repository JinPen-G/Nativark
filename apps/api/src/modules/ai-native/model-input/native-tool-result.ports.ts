/** Server-only native tool-result seam. Public C03 carries frozen plan selectors;
 * native IDs/arguments and business result bytes stay behind current original
 * Task/Core evidence readers. No dispatch, retry, tool loop or budget lives here. */
import { z } from 'zod';
import { AI_GATEWAY_TOOL_RESULT_REFERENCE_VERSION, type AiExecutionContext,
  type AiGatewayIntentDraft, type AiGatewayToolResultReferenceDraft } from '@rental-os/shared';
import { ModelGatewayError, type GatewayContext, type ProtocolToolCall } from '../model-gateway.ports';
import { isGatewayIntent } from '../gateway-contract-validation';
import type { GatewayTextIntentBinding } from '../gateway-intent';
export type NativeToolTaskScene = GatewayTextIntentBinding & { nativeToolResults?: boolean };
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const nativeToolResultReferenceSchema = z.object({
  referenceVersion: z.literal(AI_GATEWAY_TOOL_RESULT_REFERENCE_VERSION),
  taskId: id.max(36), runId: id.max(36), modelRegistrationRef: id,
  toolRegistrationRef: id, callIndex: z.number().int().min(0).max(7)
}).strict().refine(value => value.modelRegistrationRef !== value.toolRegistrationRef);

/** Generic private function-call identity, not an SDK response object. */
export const nativeOrderToolCallSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  type: z.literal('function'), function: z.object({ name: z.literal('rental_order_explain'),
    arguments: z.string().min(1).max(16000) }).strict() }).strict();

export interface NativeToolCallBinding {
  invocationId: string;
  callIndex: number;
  configurationHash: string;
  inputHash: string;
  bindingHash: string;
  call: ProtocolToolCall;
}
export interface NativeToolCallBindingReader {
  readOriginal(context: AiExecutionContext, invocationId: string, callIndex: number): Promise<NativeToolCallBinding>;
}
export interface ResolvedNativeToolResult {
  version: 'native-tool-result-1';
  reference: AiGatewayToolResultReferenceDraft;
  /** Original source prompt, not a newly reconstructed/caller-supplied history. */
  originalIntent: AiGatewayIntentDraft;
  sourceInvocationId: string;
  sourceConfigurationHash: string;
  modelResultId: string;
  modelResultHash: string;
  toolResultId: string;
  toolResultHash: string;
  bindingHash: string;
  call: ProtocolToolCall;
  /** Original Core receipt payload, only after current business reobservation. */
  resultJson: string;
  evidenceHash: string;
}
const originalIntentSchema = z.custom<AiGatewayIntentDraft>(isGatewayIntent);
/** Closed private material returned by the original Task/Core resolver, never
 * accepted as C03 caller input. Provider encoding remains in its transport. */
export const resolvedNativeToolResultSchema = z.object({
  version: z.literal('native-tool-result-1'), reference: nativeToolResultReferenceSchema,
  originalIntent: originalIntentSchema, sourceInvocationId: id.max(36),
  sourceConfigurationHash: z.string().regex(/^[a-f0-9]{64}$/u),
  modelResultId: id, modelResultHash: z.string().regex(/^[a-f0-9]{64}$/u),
  toolResultId: id, toolResultHash: z.string().regex(/^[a-f0-9]{64}$/u),
  bindingHash: z.string().regex(/^[a-f0-9]{64}$/u), call: nativeOrderToolCallSchema,
  resultJson: z.string().min(1).max(262144).refine(value => {
    if (Buffer.byteLength(value, 'utf8') > 262144) return false;
    try { JSON.parse(value); return true; } catch { return false; }
  }), evidenceHash: z.string().regex(/^[a-f0-9]{64}$/u)
}).strict();

export interface NativeToolResultResolver {
  resolve(context: GatewayContext, reference: AiGatewayToolResultReferenceDraft, signal: AbortSignal): Promise<ResolvedNativeToolResult>;
  assertCurrent(context: GatewayContext, value: ResolvedNativeToolResult, signal: AbortSignal): Promise<void>;
}

/** Same C03 intent identity as text; only a registered native successor can use
 * the new content branch. This validates selectors, not their authority/results. */
export function nativeToolResultIntentFingerprint(value: AiGatewayIntentDraft,
  policy: { sceneCode: string; maxOutputTokens: number; orderExplainTool?: boolean; nativeToolResults?: boolean }) {
  const intent = structuredClone(value);
  if (!isGatewayIntent(intent) || policy.nativeToolResults !== true || policy.orderExplainTool !== true
    || intent.sceneCode !== policy.sceneCode || intent.maxOutputTokens > policy.maxOutputTokens
    || requestFingerprint(intent.requiredFeatures) !== requestFingerprint(['text', 'tools'])
    || intent.optionalFeatures.length || Buffer.byteLength(JSON.stringify(intent), 'utf8') > 262144) {
    throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  }
  const references = intent.messages.flatMap(message => message.content.filter(part => part.kind === 'tool_result_reference'));
  if (references.length !== 1 || intent.messages.some(message => message.content.some(part =>
    part.kind !== 'text' && (part.kind !== 'tool_result_reference' || message.role !== 'user' || message.content.length !== 1)))) {
    throw new ModelGatewayError('INVALID_REQUEST');
  }
  nativeToolResultReferenceSchema.parse(references[0].reference);
  return requestFingerprint({ intent, mode: 'invoke' });
}
