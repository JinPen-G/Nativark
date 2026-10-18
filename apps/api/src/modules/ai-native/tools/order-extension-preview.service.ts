/** Current authorized extension preview, not an extension application.
 * Reuses the human Core DTO/controller and its historical pricing/availability
 * rules. Never calculates money, persists a quote, reserves stock or pays. */
import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { z } from 'zod';
import type { AiExecutionContext, RentalOrderExtensionPreview } from '@rental-os/shared';
import type { RentalCoreController } from '../../rental-core/rental-core.controller';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { RentalOrderExtensionDto } from '../../rental-core/rental-order-request.dto';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import type { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import { assertAiReadContextBinding } from './read-context-binding';

const absoluteTime = z.string().max(64).datetime({ offset: true });
export const aiOrderExtensionPreviewInputSchema = z.object({
  expectedOrderVersion: absoluteTime,
  extension: z.object({ newEndAt: absoluteTime,
    services: z.array(z.object({ serviceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u),
      quantity: z.number().finite().min(1), scheduledStartAt: absoluteTime.optional(), scheduledEndAt: absoluteTime.optional(),
      serviceLocationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u).optional()
    }).strict()).max(50).optional(), memo: z.string().max(2000).optional()
  }).strict()
}).strict();
const previewSchema = z.object({ orderId: z.string(), originalEndAt: absoluteTime, newEndAt: absoluteTime,
  billableUnits: z.number().finite().nonnegative(), rentalAmount: z.number().finite(), serviceAmount: z.number().finite(),
  depositDelta: z.number().finite(), preAuthDelta: z.number().finite(), payableAmount: z.number().finite(),
  currency: z.string().regex(/^[A-Z]{3}$/u), settlementMode: z.enum(['immediate', 'monthly']), paymentRequired: z.boolean(),
  chargeLines: z.array(z.unknown()).max(1000), calendarSnapshot: z.array(z.unknown()).max(1000),
  ruleVersion: z.string().min(1).max(191)
}).passthrough();
const previewKeys = ['orderId', 'originalEndAt', 'newEndAt', 'billableUnits', 'rentalAmount', 'serviceAmount',
  'depositDelta', 'preAuthDelta', 'payableAmount', 'currency', 'settlementMode', 'paymentRequired', 'chargeLines',
  'calendarSnapshot', 'ruleVersion', 'serviceSnapshots', 'priceVersionId', 'priceVersion', 'executionBasis', 'pricingSnapshot'] as const;

export class AiOrderExtensionPreviewService {
  constructor(private readonly orderId: string, private readonly core: Pick<RentalCoreService, 'getOrder'>,
    private readonly orderAuthority: Pick<AiOrderRouteContextAuthority, 'withOrderRead'>,
    private readonly routes: Pick<AiBusinessReadRouteAuthority, 'withExtensionPreview'>,
    private readonly preview?: Pick<RentalCoreController, 'previewExtension'>,
    private readonly clock: () => Date = () => new Date()) {}

  async read(value: unknown, expectedContext?: AiExecutionContext) {
    let supplied: unknown;
    try {
      supplied = structuredClone(value);
      if (Buffer.byteLength(JSON.stringify(supplied), 'utf8') > 32768) throw Error();
    } catch { throw new ModelGatewayError('INVALID_REQUEST'); }
    const parsed = aiOrderExtensionPreviewInputSchema.safeParse(supplied);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const command = parsed.data, dto = plainToInstance(RentalOrderExtensionDto, command.extension);
    expectedContext = expectedContext === undefined ? undefined : structuredClone(expectedContext);
    if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }).length) throw new ModelGatewayError('INVALID_REQUEST');
    // Never substitute a hand-written price or current quote for this source.
    if (typeof this.preview?.previewExtension !== 'function') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const preview = this.preview;
    return this.routes.withExtensionPreview(this.orderId, structuredClone(command.extension), async (context, request) => {
      assertAiReadContextBinding(context, expectedContext);
      const readOrder = async () => {
        const order = await this.orderAuthority.withOrderRead(async (current, orderId) => {
          assertAiReadContextBinding(current, context);
          if (orderId !== this.orderId || current.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
          const order = structuredClone(await this.core.getOrder(current.scope.tenantId, orderId));
          if (order.id !== orderId || order.tenantId !== current.scope.tenantId) throw new ModelGatewayError('FORBIDDEN');
          return order;
        });
        if (order.updatedAt !== command.expectedOrderVersion) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        return order;
      };
      const before = await readOrder();
      let result: Awaited<ReturnType<RentalCoreController['previewExtension']>> | undefined, blocked: number | undefined;
      try { result = structuredClone(await preview.previewExtension(request, this.orderId, dto)); }
      catch (error) {
        if (!(error instanceof HttpException) || ![400, 409].includes(error.getStatus())) throw error;
        // Do not reflect arbitrary Core exception strings or infer eligibility.
        blocked = error.getStatus();
      }
      const after = await readOrder();
      if (requestFingerprint(before) !== requestFingerprint(after)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      const now = this.clock();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ModelGatewayError('INVALID_RESPONSE');
      const common = { orderId: this.orderId, scope: structuredClone(context.scope), observedAt: now.toISOString(),
        source: { kind: 'core_extension_preview' as const, orderVersion: before.updatedAt,
          inputFingerprint: requestFingerprint(command.extension) },
        persistence: 'not_persisted' as const, inventory: 'not_reserved' as const,
        approval: 'not_granted' as const, execution: 'not_attempted' as const,
        validity: 'observation_only_recheck_in_original_business_flow' as const };
      if (blocked !== undefined) return { ...common, status: 'blocked' as const, reason: 'core_validation_failed' as const, coreStatus: blocked };
      const checked = previewSchema.safeParse(result);
      if (!checked.success || result?.orderId !== this.orderId || result.newEndAt !== command.extension.newEndAt
        || Buffer.byteLength(JSON.stringify(result), 'utf8') > 131072) throw new ModelGatewayError('INVALID_RESPONSE');
      const projection = Object.fromEntries(previewKeys.filter(key => result[key] !== undefined).map(key => [key, result[key]])) as unknown as RentalOrderExtensionPreview;
      return { ...common, status: 'previewed' as const, preview: projection };
    });
  }
}
