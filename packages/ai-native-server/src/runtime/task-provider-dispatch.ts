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
      if (!invocation) throw new ModelGatewayError('FORBIDDEN');
      if (('tenantId' in context) !== ('workspaceId' in context)) throw new ModelGatewayError('FORBIDDEN');
      const workspace = 'tenantId' in context && 'workspaceId' in context;
      if (!workspace) {
        // The original platform probe authority already owns this transaction.
        // Confirm its stored SaaS task; an actor-only context cannot grant access.
        const task = await tx.aiTask.findFirst({ where: { id: taskId, scopeId: invocation.scopeId,
          scopeKind: 'PLATFORM', audience: 'OPERATOR', ownerKind: 'SAAS_ADMIN', ownerId: context.actorId,
          sceneCode: 'ai.capability.text', archivedAt: null } });
        if (!task) throw new ModelGatewayError('FORBIDDEN');
      }
      const scope = await tx.aiScope.findFirst({ where: workspace
        ? { id: invocation.scopeId, kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId }
        : { id: invocation.scopeId, kind: 'PLATFORM', scopeKey: 'platform', tenantId: null, workspaceId: null } });
      if (!scope || signal.aborted) throw new ModelGatewayError('FORBIDDEN');
    }), { isolationLevel: 'ReadCommitted', maxWait: 2500, timeout: 5000 });
  };
}
