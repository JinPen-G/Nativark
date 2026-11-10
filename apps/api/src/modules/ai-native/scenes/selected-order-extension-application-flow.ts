/** Original committed-order extension preview -> explicit request preparation
 * and original Core receipt read. This does NOT submit/pay an extension or grant
 * approval. Unknown stays read-only under the same key/body/originating actor. */
import { z } from 'zod';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { RentalCoreController } from '../../rental-core/rental-core.controller';
import type { RentalIdempotentActionService } from '../../rental-core/rental-idempotent-action.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { rentalOrderDueAt } from '../../rental-core/rental-carrier-shipment';
import { aiOrderExtensionPreviewInputSchema } from '../tools/order-extension-preview.service';
import { AiOrderRouteContextAuthority, type AiOrderRouteCredentialSource } from '../order-route-context.authority';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import type { AiSceneHttpRequest, composeRequestBoundSelectedQuoteTask } from './request-bound-scenes.application';
import { composeSelectedOrderExtensionPreviewFlow } from './selected-order-extension-preview-flow';

const commandSchema = aiOrderExtensionPreviewInputSchema.extend({ selection: z.unknown() }).strict();
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const date = z.string().datetime({ offset: true }), hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const status = z.enum(['pending_payment', 'effective', 'cancelled', 'expired']);
const extensionSchema = z.object({ id, tenantId: id, workspaceId: id, orderId: id, idempotencyKey: id,
  originalEndAt: date, newEndAt: date, status, payableAmount: z.number().finite().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/u) }).passthrough();
const hash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');

export function composeSelectedOrderExtensionApplicationFlow(input: {
  orders: Pick<ReturnType<typeof composeRequestBoundSelectedQuoteTask>, 'readResult'>;
  core: Pick<RentalCoreService, 'readOrderFacts' | 'listOrderExtensions'>;
  receipts: Pick<RentalIdempotentActionService, 'readReceipt'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiOrderRouteCredentialSource;
  preview: Pick<RentalCoreController, 'previewExtension'>;
  clock?: () => Date;
}) {
  if (typeof input.core?.listOrderExtensions !== 'function' || typeof input.receipts?.readReceipt !== 'function') throw unavailable();
  const preview = composeSelectedOrderExtensionPreviewFlow(input);
  const resolve = async (request: AiSceneHttpRequest, value: unknown) => {
    let command: z.infer<typeof commandSchema>;
    try {
      const candidate = structuredClone(value);
      if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > 65536) throw Error();
      command = freezeOriginalInput(commandSchema.parse(candidate));
    } catch { throw new AiTaskRepositoryError('AI_INVALID_INPUT'); }
    const bound = freezeOriginalInput({ headers: { authorization: request?.headers?.authorization } });
    const read = () => input.orders.readResult(bound, { selection: command.selection });
    const origin = freezeOriginalInput(structuredClone(await read()));
    if (origin.status !== 'committed') return { command, origin, read, found: null };
    const credentials: AiOrderRouteCredentialSource = { current: async () => {
      if (typeof bound.headers.authorization !== 'string') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return { ...await input.credentials.current(), authorization: bound.headers.authorization };
    } };
    const authority = new AiOrderRouteContextAuthority(input.guard, credentials, origin.order.id, input.clock);
    const binding = await authority.withOrderRead(async (context, orderId) => {
      if (context.scope.kind !== 'workspace') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const order = await input.core.readOrderFacts(context.scope.tenantId, orderId);
      if (order.id !== origin.order.id || order.tenantId !== context.scope.tenantId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return { scope: context.scope, actor: context.actor, audience: context.audience };
    });
    // Current permissions/time/order successor state are NOT in an original key.
    // The old expected version and exact human body remain original input data,
    // never current execution authority. Receipt reads do not reprice the body.
    const operationKey = `ai-extension-${hash({ version: 'selected-order-extension-1', ...binding,
      orderId: origin.order.id, selection: command.selection, expectedOrderVersion: command.expectedOrderVersion, extension: command.extension })}`;
    return { command, origin, read, found: { authority, operationKey, binding, orderId: origin.order.id } };
  };
  const inspect = async (request: AiSceneHttpRequest, value: unknown) => {
    const found = await resolve(request, value);
    if (!found.found) return { state: 'unavailable' as const, original: found.origin, execution: 'not_attempted' as const };
    const result = await preview.preview(request, found.command);
    if (!('result' in result) || result.result.status !== 'previewed') return { state: 'blocked' as const, original: result, execution: 'not_attempted' as const };
    if (hash(await found.read()) !== hash(found.origin)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    await found.found.authority.withOrderRead(async context => {
      if (hash({ scope: context.scope, actor: context.actor, audience: context.audience }) !== hash(found.found!.binding)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    });
    return { state: 'prepared' as const, orderId: found.found.orderId, operationKey: found.found.operationKey,
      reviewHash: hash({ binding: found.found.binding, operationKey: found.found.operationKey,
        source: result.result.source, preview: result.result.preview }),
      request: structuredClone(found.command.extension), preview: result.result.preview,
      execution: 'not_submitted' as const, inventory: 'not_reserved' as const,
      approval: 'not_granted' as const, validity: 'recheck_in_original_human_Core_application' as const };
  };
  return Object.freeze({
    inspect,
    async prepare(request: AiSceneHttpRequest, value: unknown) {
      const parsed = commandSchema.extend({ decision: z.literal('prepare_original_extension_request'), reviewHash: hashSchema }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const { decision: _decision, reviewHash, ...body } = parsed.data, current = await inspect(request, body);
      if (current.state !== 'prepared' || current.reviewHash !== reviewHash) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      // The hash is consistency evidence ONLY. Actual submission/pay/approval
      // remains the original human route; this function has no write callback.
      return freezeOriginalInput({ ...current, handoff: 'original_human_Core_extension_application_required' as const });
    },
    async readApplication(request: AiSceneHttpRequest, value: unknown) {
      const original = await resolve(request, value), found = original.found;
      if (!found) return freezeOriginalInput({ state: 'unknown' as const, operationKey: null, retryable: false as const,
        nextAction: 'read_original_order_receipt' as const, execution: 'read_only_no_submission' as const });
      const receipt = await found.authority.withOrderRead(async (context, orderId) => {
        if (context.scope.kind !== 'workspace' || orderId !== found.orderId
          || hash({ scope: context.scope, actor: context.actor, audience: context.audience }) !== hash(found.binding)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const scope = context.scope;
        return input.receipts.readReceipt({ tenantId: scope.tenantId, action: 'order.extend', key: found.operationKey, orderId,
          replay: async response => {
            if (!response || Buffer.byteLength(JSON.stringify(response), 'utf8') > 262144) throw unavailable();
            const recorded = z.object({ extension: extensionSchema }).passthrough().safeParse(response);
            if (!recorded.success) throw unavailable();
            const old = recorded.data.extension;
            if (old.tenantId !== scope.tenantId || old.workspaceId !== scope.workspaceId || old.orderId !== orderId
              || old.idempotencyKey !== found.operationKey || Date.parse(old.newEndAt) !== Date.parse(original.command.extension.newEndAt)) throw unavailable();
            const rows = await input.core.listOrderExtensions(scope.tenantId, orderId);
            if (rows.length > 100) throw unavailable();
            const matching = rows.filter(row => row.id === old.id && row.idempotencyKey === found.operationKey);
            if (matching.length !== 1) throw unavailable();
            const current = extensionSchema.safeParse(matching[0]);
            if (!current.success || current.data.tenantId !== old.tenantId || current.data.workspaceId !== old.workspaceId
              || current.data.orderId !== old.orderId || current.data.originalEndAt !== old.originalEndAt
              || current.data.newEndAt !== old.newEndAt || current.data.payableAmount !== old.payableAmount || current.data.currency !== old.currency) throw unavailable();
            const order = await input.core.readOrderFacts(scope.tenantId, orderId);
            if (order.id !== orderId || order.tenantId !== scope.tenantId) throw unavailable();
            const latest = await input.core.listOrderExtensions(scope.tenantId, orderId);
            const latestOrder = await input.core.readOrderFacts(scope.tenantId, orderId);
            if (latest.length > 100 || hash(latest.filter(row => row.id === old.id)) !== hash(matching)
              || hash(latestOrder) !== hash(order)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
            return { receipt: { extensionId: old.id, orderId, originalEndAt: old.originalEndAt, newEndAt: old.newEndAt,
              statusAtAcceptance: old.status, payableAmount: old.payableAmount, currency: old.currency },
              current: { status: current.data.status, orderVersion: order.updatedAt, dueAt: rentalOrderDueAt(order) } };
          } });
      });
      if (receipt) {
        const closed = await found.authority.withOrderRead(async context => {
          if (context.scope.kind !== 'workspace' || hash({ scope: context.scope, actor: context.actor, audience: context.audience }) !== hash(found.binding)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          const scope = context.scope;
          return input.receipts.readReceipt({ tenantId: scope.tenantId, action: 'order.extend', key: found.operationKey, orderId: found.orderId,
            replay: async response => {
              if (!response || Buffer.byteLength(JSON.stringify(response), 'utf8') > 262144) throw unavailable();
              const record = z.object({ extension: extensionSchema }).passthrough().parse(response).extension;
              if (record.tenantId !== scope.tenantId || record.workspaceId !== scope.workspaceId || record.orderId !== found.orderId
                || record.idempotencyKey !== found.operationKey) throw unavailable();
              return hash({ extensionId: record.id, orderId: record.orderId, originalEndAt: record.originalEndAt, newEndAt: record.newEndAt,
                statusAtAcceptance: record.status, payableAmount: record.payableAmount, currency: record.currency });
            } });
        });
        if (closed !== hash(receipt.receipt)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      }
      if (hash(await original.read()) !== hash(original.origin)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      return freezeOriginalInput({ state: receipt ? 'observed' as const : 'unknown' as const, operationKey: found.operationKey,
        ...(receipt ? receipt : {}), retryable: false as const, nextAction: 'read_original_extension_application' as const,
        payment: 'not_inferred' as const, fulfillment: 'not_inferred' as const,
        execution: 'read_only_no_submission_or_payment' as const });
    }
  });
}
