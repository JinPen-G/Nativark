/** Current original task/Core admission immediately before a provider call.
 * Vault/connection awaits have completed; the provider is outside this short tx.
 * This never reconciles, changes dispatch ownership or replays a model request. */
import type { PrismaClient } from '@prisma/client';
import { ModelGatewayError, type GatewayContext, type ModelProtocolRequest } from './model-gateway.ports';
import { hasAiTaskTransactionAuthority, withAiTaskTransaction } from './task-transaction-authority';

export function createTaskProviderDispatchCheck(db: Partial<Pick<PrismaClient, '$transaction'>>, taskId: string) {
  return async (context: GatewayContext, request: Pick<ModelProtocolRequest, 'callId'>, signal: AbortSignal): Promise<void> => {
    if (!hasAiTaskTransactionAuthority()) return;
    if (signal.aborted) throw new ModelGatewayError('CANCELLED');
    if (!db.$transaction) throw new ModelGatewayError('CONFIG_INVALID');
    await db.$transaction(tx => withAiTaskTransaction(tx, { kind: 'invocation', callId: request.callId }, async () => {
      const invocation = await tx.aiGatewayInvocation.findFirst({ where: { callId: request.callId, taskId,
        actorId: context.actorId } });
      if (!invocation || !('tenantId' in context && 'workspaceId' in context)) throw new ModelGatewayError('FORBIDDEN');
      const scope = await tx.aiScope.findFirst({ where: { id: invocation.scopeId, kind: 'WORKSPACE',
        tenantId: context.tenantId, workspaceId: context.workspaceId } });
      if (!scope || signal.aborted) throw new ModelGatewayError('FORBIDDEN');
    }), { isolationLevel: 'ReadCommitted', maxWait: 2500, timeout: 5000 });
  };
}
