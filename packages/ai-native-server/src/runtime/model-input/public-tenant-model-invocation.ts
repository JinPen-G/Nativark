/** Public text steps use the original stored model input and Invocation. A
 * current scene and an exact published input are required for any new work. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { AI_TEXT_MODEL_STEP_CODE, AI_TOOL_DRAFT_VERSION } from '@rental-os/platform-contracts/ai-task';
import { isGatewayConfig, isGatewayIntent, ModelGatewayError, prepareGatewayTextIntent,
  type GatewayRoutingResolution, type GatewayTextIntentBinding, type PreparedGatewayTextIntent } from '@rental-os/platform-server/ai-gateway';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import type { AiExecutionContext, AiGatewayConfigReferenceDraft, AiGatewayIntentDraft } from '@rental-os/platform-contracts/ai-gateway';
import { BudgetError } from '../budget/budget.ports';
import { taskModelIdentity, taskModelInputBindingSchema } from './task-model-input-binding';

export type TenantModelStep = Pick<Prisma.AiStepGetPayload<{}>, 'id' | 'scopeId' | 'taskId' | 'runId' | 'actionId' | 'requestFingerprint' | 'toolCode' | 'toolVersion' | 'inputRef'>;
export interface TenantModelInput {
  mode: 'invoke' | 'stream'; intent: AiGatewayIntentDraft; configuration: AiGatewayConfigReferenceDraft;
  priceVersion: string; routingHash: string; identityHash: string; prepared: PreparedGatewayTextIntent;
  registrationRef: string; expiresAt: Date;
}
export function tenantModelStepCode(step: Pick<TenantModelStep, 'toolCode' | 'toolVersion'>) {
  return step.toolCode === AI_TEXT_MODEL_STEP_CODE && step.toolVersion === AI_TOOL_DRAFT_VERSION;
}

export function tenantRouteConfiguration(route: GatewayRoutingResolution) {
  const { profile, scope } = route.route, consumer = route.consumerScope;
  if (consumer.kind !== 'TENANT' || !consumer.tenantId || consumer.workspaceId !== undefined
    || profile.scopeId !== scope.id || profile.scopeKind !== scope.kind || profile.serviceMode !== route.selection.mode) throw new ModelGatewayError('FORBIDDEN');
  const base = { configId: profile.id, configRevision: profile.configRevision, credentialRef: profile.credentialRef,
    protocol: profile.protocol, provider: profile.provider, model: profile.model, tenantId: consumer.tenantId };
  if (route.selection.mode === 'platform_managed' && scope.kind === 'PLATFORM') {
    return { ...base, serviceMode: 'platform_managed' as const, configurationScope: { kind: 'platform' as const } };
  }
  if (route.selection.mode !== 'tenant_managed' || scope.kind !== 'TENANT' || scope.id !== consumer.id || scope.tenantId !== consumer.tenantId)
    throw new ModelGatewayError('CONFIG_INVALID');
  return { ...base, serviceMode: 'tenant_managed' as const,
    configurationScope: { kind: 'tenant' as const, tenantId: consumer.tenantId } };
}

export async function readPublicTenantModelInput(db: Pick<PrismaClient, 'aiTaskActionInput'>, step: TenantModelStep,
  context: AiExecutionContext, scene: GatewayTextIntentBinding, now: () => Date): Promise<TenantModelInput> {
  if (!tenantModelStepCode(step) || !step.inputRef || context.scope.kind !== 'tenant' || context.actor.kind !== 'user'
    || context.audience !== 'operator') throw new BudgetError('FORBIDDEN');
  const key = { id: step.inputRef, scopeId: step.scopeId, taskId: step.taskId, runId: step.runId,
    toolCode: step.toolCode, toolVersion: step.toolVersion, fingerprint: step.requestFingerprint };
  const row = await db.aiTaskActionInput.findFirst({ where: key });
  const parsed = taskModelInputBindingSchema.safeParse(row?.payload);
  if (!row || !parsed.success || Object.entries(key).some(([name, value]) => row[name as keyof typeof key] !== value)
    || !(row.expiresAt instanceof Date) || !(row.expiresAt > now())) throw new BudgetError('FORBIDDEN');
  const { intent, configuration, mode, identityHash } = parsed.data;
  if (!isGatewayIntent(intent) || !isGatewayConfig(configuration) || !('tenantId' in configuration)
    || configuration.tenantId !== context.scope.tenantId || identityHash !== taskModelIdentity(context)
    || intent.messages.some(message => message.content.some(part => part.kind !== 'text')))
    throw new BudgetError('FORBIDDEN');
  const { routeScene: _, ...policy } = scene;
  const prepared = prepareGatewayTextIntent(intent, policy, mode);
  if (prepared.intentHash !== step.requestFingerprint) throw new BudgetError('FORBIDDEN');
  return { ...parsed.data, intent, configuration, prepared, registrationRef: row.registrationRef, expiresAt: row.expiresAt };
}
