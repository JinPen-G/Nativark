/** Explicit next-step preview from the original committed order receipt.
 * The receipt selects the order; caller supplies only the original human
 * extension parameters/version. Reuses Core DTO, current read/extend Guards and
 * historical pricing. Never allocates, applies, pays, grants approval or runs a
 * model. A blocked preview is a Core decision, not failed/rolled-back execution. */
import type { RentalCoreController } from '../../rental-core/rental-core.controller';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiOrderExtensionPreviewService, aiOrderExtensionPreviewInputSchema } from '../tools/order-extension-preview.service';
import { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import type { AiOrderRouteCredentialSource } from '../order-route-context.authority';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import type { AiSceneHttpRequest, composeRequestBoundSelectedQuoteTask } from './request-bound-scenes.application';
import { z } from 'zod';

const commandSchema = aiOrderExtensionPreviewInputSchema.extend({ selection: z.unknown() }).strict();
export function composeSelectedOrderExtensionPreviewFlow(input: {
  orders: Pick<ReturnType<typeof composeRequestBoundSelectedQuoteTask>, 'readResult'>;
  core: Pick<RentalCoreService, 'readOrderFacts'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiOrderRouteCredentialSource;
  preview?: Pick<RentalCoreController, 'previewExtension'>;
  clock?: () => Date;
}) {
  if (typeof input.orders?.readResult !== 'function' || typeof input.core?.readOrderFacts !== 'function'
    || typeof input.guard?.canActivate !== 'function' || typeof input.credentials?.current !== 'function')
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return Object.freeze({
    async preview(request: AiSceneHttpRequest, value: unknown) {
      const parsed = commandSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const command = freezeOriginalInput(parsed.data);
      const boundRequest = freezeOriginalInput({ headers: { authorization: request?.headers?.authorization } });
      const read = () => input.orders.readResult(boundRequest, { selection: command.selection });
      const before = freezeOriginalInput(structuredClone(await read()));
      if (before.status !== 'committed') return freezeOriginalInput({ orderReceipt: before,
        preview: 'not_attempted' as const, execution: 'not_attempted' as const, model: 'not_called' as const });
      const credentials: AiOrderRouteCredentialSource = { current: async () => {
        const current = await input.credentials.current();
        if (typeof boundRequest.headers.authorization !== 'string') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return { ...current, authorization: boundRequest.headers.authorization };
      } };
      const orderId = before.order.id;
      const service = new AiOrderExtensionPreviewService(orderId, input.core,
        new AiOrderRouteContextAuthority(input.guard, credentials, orderId, input.clock),
        new AiBusinessReadRouteAuthority(input.guard, credentials, input.clock), input.preview, input.clock);
      const result = freezeOriginalInput(structuredClone(await service.read({ expectedOrderVersion: command.expectedOrderVersion,
        extension: command.extension })));
      if (result.orderId !== orderId || requestFingerprint(await read()) !== requestFingerprint(before))
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      return freezeOriginalInput({ orderReceipt: before, result, model: 'not_called' as const,
        nextAction: result.status === 'previewed' ? 'use_original_extension_application' as const : 'review_original_core_conditions' as const,
        businessExecution: 'not_attempted' as const, approval: 'not_granted' as const, automaticRetry: false as const });
    }
  });
}
