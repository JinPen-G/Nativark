/** Public tenant admission and dispatch ownership. New writes join the host's
 * strict Task boundary. An original token can still record its own outcome. */
import type { Prisma } from '@prisma/client';
import { InvocationAdmissionService, InvocationDispatchService, ModelGatewayError,
  admissionInputSchema, dispatchBindingSchema, type AiProfileScope } from '@rental-os/platform-server/ai-gateway';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { isStrictAiTaskTransactionBoundary, type AiTaskTransactionBoundary } from './task-transactions';
import { AiScopeRepository, type AiCurrentScopeAuthority } from './runtime/ai-scope.repository';
import { PrismaAdmissionPersistenceRepository } from './runtime/invocation-admission-persistence.repository';

export function createPublicTenantGatewayAdmission(input: {
  db: ConstructorParameters<typeof PrismaAdmissionPersistenceRepository>[0];
  identities: AiCurrentScopeAuthority;
  transactions: AiTaskTransactionBoundary<Prisma.TransactionClient>;
  clock?: () => Date;
}) {
  if (!isStrictAiTaskTransactionBoundary(input?.transactions) || typeof input.db?.$transaction !== 'function'
    || typeof input.identities?.resolve !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  const clock = input.clock ?? (() => new Date());
  const scopes = new AiScopeRepository(input.db, input.identities, clock);
  const repository = new PrismaAdmissionPersistenceRepository(input.db, input.transactions, 'tenant', clock);
  const admission = new InvocationAdmissionService(repository, clock, 'tenant'), dispatch = new InvocationDispatchService(repository);

  async function subject(target: { scope: AiProfileScope; actorId: string }) {
    const { context, scope } = await scopes.resolveCurrent();
    if (context.scope.kind !== 'tenant' || context.actor.kind !== 'user' || context.audience !== 'operator'
      || target.actorId !== context.actor.userId || target.scope.kind !== 'TENANT'
      || target.scope.id !== scope.id || target.scope.tenantId !== context.scope.tenantId) throw new ModelGatewayError('FORBIDDEN');
    const { requestId: _, authorizedAt: __, ...identity } = context;
    return requestFingerprint(identity);
  }

  return Object.freeze({
    admission: Object.freeze({ async admit(value: Parameters<InvocationAdmissionService['admit']>[0]) {
      const parsed = admissionInputSchema.safeParse(value);
      if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
      const command = structuredClone(parsed.data), before = await subject(command);
      const result = await admission.admit(command);
      return deliver(command, before, result);
    } }),
    dispatch: Object.freeze({ async claim(value: Parameters<InvocationDispatchService['claim']>[0]) {
      const parsed = dispatchBindingSchema.safeParse(value);
      if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
      const command = structuredClone(parsed.data), before = await subject(command);
      const result = await dispatch.claim(command);
      return deliver(command, before, result);
    }, finish: dispatch.finish.bind(dispatch) })
  });

  // The write may have committed while authority or the original deadline
  // changed. The caller cannot treat a withheld acknowledgement as permission.
  async function deliver<T extends { expiresAt: Date }>(target: Parameters<typeof subject>[0], before: string, result: T): Promise<T> {
    try {
      if (before === await subject(target) && result.expiresAt > clock()) return result;
    } catch { /* The original row remains available to reconciliation. */ }
    throw new ModelGatewayError('ACCOUNTING_PENDING');
  }
}
