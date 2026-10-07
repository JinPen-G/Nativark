import { z } from 'zod';
import { AI_TEXT_MODEL_STEP_CODE, type AiExecutionContext, type AiGatewayConfigReferenceDraft, type AiGatewayIntentDraft } from '@rental-os/shared';
import { isGatewayConfig, isGatewayIntent } from '../gateway-contract-validation';
import { prepareGatewayTextIntent, type GatewayTextIntentPolicy } from '../gateway-intent';
import type { GatewayRoutingResolution } from '../gateway-routing.service';
import { ModelGatewayError } from '../model-gateway.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

export const TASK_TEXT_MODEL_TOOL = AI_TEXT_MODEL_STEP_CODE;
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const taskModelMaterialSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']),
    content: z.array(z.object({ kind: z.literal('text'), text: z.string().max(32000) }).strict()).min(1).max(64)
  }).strict()).min(1).max(64),
  maxOutputTokens: z.number().int().min(1).max(32768)
}).strict();
const storedSchema = z.object({ mode: z.literal('invoke'), intent: z.unknown(), configuration: z.unknown(),
  priceVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u), routingHash: hash, identityHash: hash }).strict();

export function taskModelIdentity({ requestId: _, authorizedAt: __, ...context }: AiExecutionContext) {
  return requestFingerprint(context);
}

export function parseTaskModelInput(value: unknown, policy: GatewayTextIntentPolicy) {
  const parsed = storedSchema.parse(structuredClone(value));
  if (!isGatewayIntent(parsed.intent) || !isGatewayConfig(parsed.configuration)) throw new ModelGatewayError('INVALID_REQUEST');
  const input = { ...parsed, intent: parsed.intent, configuration: parsed.configuration };
  prepareGatewayTextIntent(input.intent, policy, input.mode);
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 262144) throw new ModelGatewayError('INVALID_REQUEST');
  return input;
}
export type TaskModelInput = ReturnType<typeof parseTaskModelInput>;

export function taskModelFingerprint(input: TaskModelInput, policy: GatewayTextIntentPolicy) {
  return prepareGatewayTextIntent(input.intent, { sceneCode: policy.sceneCode, maxOutputTokens: policy.maxOutputTokens }, input.mode).intentHash;
}

export function taskModelIntent(taskId: string, runId: string, registrationRef: string, sceneCode: string,
  material: z.infer<typeof taskModelMaterialSchema>): AiGatewayIntentDraft {
  return { draftVersion: 'ain-c03-draft-2',
    requestId: `model-${requestFingerprint({ taskId, runId, registrationRef })}`, sceneCode,
    messages: material.messages, maxOutputTokens: material.maxOutputTokens, requiredFeatures: ['text'], optionalFeatures: [] };
}

export function taskModelConfiguration(route: GatewayRoutingResolution): AiGatewayConfigReferenceDraft {
  const context = route.context, profile = route.route.profile, owner = route.route.scope;
  if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
    || !['operator', 'staff'].includes(context.audience) || route.consumerScope.kind !== 'WORKSPACE'
    || route.consumerScope.tenantId !== context.scope.tenantId || route.consumerScope.workspaceId !== context.scope.workspaceId
    || profile.scopeId !== owner.id || profile.scopeKind !== owner.kind || profile.serviceMode !== route.selection.mode) {
    throw new ModelGatewayError('FORBIDDEN');
  }
  const base = { configId: profile.id, configRevision: profile.configRevision, credentialRef: profile.credentialRef,
    protocol: profile.protocol, provider: profile.provider, model: profile.model, tenantId: context.scope.tenantId };
  let result: AiGatewayConfigReferenceDraft;
  if (route.selection.mode === 'platform_managed' && owner.kind === 'PLATFORM') {
    result = { ...base, serviceMode: 'platform_managed', configurationScope: { kind: 'platform' } };
  } else if (route.selection.mode === 'tenant_managed' && owner.kind === 'TENANT' && owner.tenantId === context.scope.tenantId) {
    result = { ...base, serviceMode: 'tenant_managed', configurationScope: { kind: 'tenant', tenantId: context.scope.tenantId } };
  } else throw new ModelGatewayError('CONFIG_INVALID');
  if (!isGatewayConfig(result)) throw new ModelGatewayError('CONFIG_INVALID');
  return result;
}
