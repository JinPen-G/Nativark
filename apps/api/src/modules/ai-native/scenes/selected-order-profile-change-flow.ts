/** Original committed order -> ordinary member-name change preparation.
 * The order only locates its personal member; independent current membership
 * read/write Guard/ALS and Core name revision still apply. No old order/customer
 * snapshot is rewritten. No task, approval or CAS executes here; explicit callers
 * continue through the existing profile workflow. Lost preparation is read by
 * the same server-derived Core change key, never a replacement key or retry. */
import { HttpException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import { ApprovedProfileRouteAuthority, type ApprovedProfileCredentials } from '../../platform/approved-profile-route.authority';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { requestRentalOrderVisibilityWhere } from '../../rental-core/rental-core-fact.repository';
import { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import type { AiSceneHttpRequest, composeRequestBoundSelectedQuoteTask, composeRequestBoundProfileWorkflow } from './request-bound-scenes.application';

const locator = z.object({ selection: z.unknown(), requestKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict();
const intent = locator.extend({ name: z.string().trim().min(1).refine(value => Array.from(value).length <= 120),
  expiresAt: z.string().datetime({ offset: true }) }).strict();
const prepare = intent.extend({ reviewHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
const parse = <S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> => {
  const parsed = schema.safeParse(structuredClone(value));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(parsed.data);
};

export function composeSelectedOrderProfileChangeFlow(input: {
  orders: Pick<ReturnType<typeof composeRequestBoundSelectedQuoteTask>, 'readResult'>;
  profiles: Pick<ReturnType<typeof composeRequestBoundProfileWorkflow>, 'readCurrent' | 'prepareChange' | 'readChange'>;
  db: Pick<PrismaClient, 'customerApprovedProfileChange' | 'rentalOrder'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: ApprovedProfileCredentials;
}) {
  for (const method of [input.orders?.readResult, input.profiles?.readCurrent, input.profiles?.prepareChange,
    input.profiles?.readChange, input.db?.customerApprovedProfileChange?.findUnique, input.db?.rentalOrder?.findFirst,
    input.guard?.canActivate, input.credentials?.current]) {
    if (typeof method !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
  const target = async (request: AiSceneHttpRequest, command: z.infer<typeof locator>) => {
    const receipt = freezeOriginalInput(structuredClone(await input.orders.readResult(request, { selection: command.selection })));
    if (receipt.status !== 'committed') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const credentials: ApprovedProfileCredentials = { current: async () => {
      const current = await input.credentials.current();
      if (typeof request.headers.authorization !== 'string') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return { ...current, authorization: request.headers.authorization };
    } };
    // The public receipt and R0 history intentionally omit customer identity.
    // Read only this persisted Core association under the original detail Guard
    // and Core visibility predicate; never load the mutable full aggregate.
    const orderBasis = await new AiOrderRouteContextAuthority(input.guard, credentials, receipt.order.id).withOrderRead(async context => {
      const { scope } = context;
      if (scope.kind !== 'workspace') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const read = () => input.db.rentalOrder.findFirst({ where: { id: receipt.order.id, tenantId: scope.tenantId,
        workspaceId: scope.workspaceId, ...requestRentalOrderVisibilityWhere() },
        select: { id: true, tenantId: true, workspaceId: true, quoteId: true, customerType: true, customerId: true, updatedAt: true } });
      const before = await read();
      if (!before || before.id !== receipt.order.id || before.quoteId !== receipt.order.quoteId
        || before.tenantId !== scope.tenantId || before.workspaceId !== scope.workspaceId
        || before.customerType !== 'personal' || !before.customerId) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      if (requestFingerprint(await read()) !== requestFingerprint(before)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      return freezeOriginalInput({ id: before.id, quoteId: before.quoteId, customerId: before.customerId,
        customerType: before.customerType, updatedAt: before.updatedAt });
    });
    const customerId = orderBasis.customerId;
    const changeKey = `order-name-${requestFingerprint({ orderId: receipt.order.id, customerId, requestKey: command.requestKey })}`;
    return { receipt, orderBasis, customerId, changeKey };
  };
  const inspect = async (request: AiSceneHttpRequest, command: z.infer<typeof intent>) => {
    const before = await target(request, command), current = freezeOriginalInput(structuredClone(
      await input.profiles.readCurrent(request, { customerId: before.customerId })));
    if (current.customerId !== before.customerId || !Number.isSafeInteger(current.ordinaryRevision) || current.ordinaryRevision < 1)
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    if (requestFingerprint(await target(request, command)) !== requestFingerprint(before)
      || requestFingerprint(await input.profiles.readCurrent(request, { customerId: before.customerId })) !== requestFingerprint(current))
      throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    return { ...before, current, reviewHash: requestFingerprint({ originalOrder: before.receipt, orderBasis: before.orderBasis, current,
      requested: { name: command.name, expiresAt: command.expiresAt }, changeKey: before.changeKey }) };
  };
  const bound = (request: AiSceneHttpRequest) => freezeOriginalInput({ headers: { authorization: request?.headers?.authorization } });
  return Object.freeze({
    async inspect(request: AiSceneHttpRequest, value: unknown) {
      const command = parse(intent, value), found = await inspect(bound(request), command);
      return freezeOriginalInput({ orderReceipt: found.receipt, customerId: found.customerId,
        fields: [{ field: 'name' as const, before: found.current.name, after: command.name }], ordinaryRevision: found.current.ordinaryRevision,
        sharing: found.current.sharing, reviewHash: found.reviewHash, persistence: 'not_attempted' as const, approval: 'not_granted' as const });
    },
    async prepare(request: AiSceneHttpRequest, value: unknown) {
      const command = parse(prepare, value), currentRequest = bound(request), found = await inspect(currentRequest, command);
      if (command.reviewHash !== found.reviewHash) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      let change;
      try { change = await input.profiles.prepareChange(currentRequest, { customerId: found.customerId, changeKey: found.changeKey,
        baseRevision: found.current.ordinaryRevision, name: command.name, expiresAt: command.expiresAt }); }
      catch (error) {
        if (error instanceof HttpException && error.getStatus() < 500) throw error;
        if (error instanceof AiTaskRepositoryError && ['AI_INVALID_INPUT', 'AI_ACCESS_DENIED', 'AI_REVISION_CONFLICT'].includes(error.code)) throw error;
        throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      }
      try { if ((await inspect(currentRequest, command)).reviewHash !== found.reviewHash) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT'); }
      catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      return freezeOriginalInput({ orderReceipt: found.receipt, change, reference: { customerId: change.customerId,
        changeId: change.changeId, changeHash: change.changeHash }, task: 'not_created' as const, approval: 'fresh_explicit_approval_required' as const,
        historicalOrder: 'not_rewritten' as const, businessNameUpdate: 'not_attempted' as const });
    },
    async readPrepared(request: AiSceneHttpRequest, value: unknown) {
      const command = parse(locator, value), currentRequest = bound(request), before = await target(currentRequest, command);
      const credentials: ApprovedProfileCredentials = { current: async () => {
        const current = await input.credentials.current();
        if (typeof currentRequest.headers.authorization !== 'string') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return { ...current, authorization: currentRequest.headers.authorization };
      } };
      const result = await new ApprovedProfileRouteAuthority(input.guard, credentials).withAuthorization('read', before.customerId, async (actor, revalidate) => {
        const row = await input.db.customerApprovedProfileChange.findUnique({ where: { tenantId_customerId_actorId_changeKey: {
          tenantId: actor.tenantId, customerId: before.customerId, actorId: actor.actorId, changeKey: before.changeKey } } });
        if (!row) { await revalidate(); return { state: 'not_observed' as const, retryable: false as const }; }
        if (row.tenantId !== actor.tenantId || row.workspaceId !== actor.workspaceId || row.actorId !== actor.actorId
          || row.customerId !== before.customerId || row.changeKey !== before.changeKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const reference = { customerId: row.customerId, changeId: row.id, changeHash: row.changeHash };
        const change = await input.profiles.readChange(currentRequest, reference); await revalidate();
        return { state: 'prepared' as const, reference, change, execution: 'read_only_no_task_or_approval_or_retry' as const };
      });
      if (requestFingerprint(await target(currentRequest, command)) !== requestFingerprint(before)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      return freezeOriginalInput({ orderReceipt: before.receipt, result });
    }
  });
}
