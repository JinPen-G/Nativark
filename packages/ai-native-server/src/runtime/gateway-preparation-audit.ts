/** Original preparation receipt ID. It binds the already registered
 * Invocation to one OperationLog entry, without granting dispatch. */
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import type { AiGatewayInvocation } from '@prisma/client';

export function gatewayPreparationLogId(scopeId: string, invocationId: string) {
  const digest = requestFingerprint({ version: 'ai-gateway-audit-intent-1', scopeId, invocationId });
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function gatewayPreparationReceipt(invocation: Pick<AiGatewayInvocation,
  'id' | 'scopeId' | 'taskId' | 'runId' | 'stepId' | 'actionId' | 'stepFingerprint' | 'actorId' | 'callId' | 'mode'
  | 'intentHash' | 'registrationHash' | 'configurationHash' | 'sceneCode' | 'priceVersion' | 'maxOutputTokens'>,
tenantId: string, requestHash: string, profileHash: string) {
  return { id: gatewayPreparationLogId(invocation.scopeId, invocation.id), tenantId, workspaceId: null, userId: invocation.actorId,
    action: 'ai.gateway.prepared', detail: { version: 'ai-gateway-audit-intent-1', taskId: invocation.taskId, invocationId: invocation.id,
      runId: invocation.runId, stepId: invocation.stepId, actionId: invocation.actionId, stepFingerprint: invocation.stepFingerprint,
      callId: invocation.callId, mode: invocation.mode, intentHash: invocation.intentHash, registrationHash: invocation.registrationHash,
      configurationHash: invocation.configurationHash, requestHash, profileHash,
      sceneCode: invocation.sceneCode, priceVersion: invocation.priceVersion, maxOutputTokens: invocation.maxOutputTokens,
      observation: 'prepared_not_admitted_or_dispatched' } };
}
