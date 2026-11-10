import { z } from 'zod';
import { assertAiReadContextBinding } from './tools/read-context-binding';
import { AI_CONTRACT_DRAFT_VERSION, RentalInventoryMode, type AiExecutionContext, type RentalAvailabilityResult, type RentalAvailabilityRequest } from '@rental-os/shared';
import type { RentalCoreService } from '../rental-core/rental-core.service';
import { ModelGatewayError } from './model-gateway.ports';
import type { AiBusinessReadAuthority } from './business-read-route.authority';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const aiAvailabilityReadInputSchema: z.ZodType<RentalAvailabilityRequest> = z.object({ locationId: id, startAt: z.string().datetime({ offset: true }), endAt: z.string().datetime({ offset: true }), lines: z.array(z.object({ itemGroupId: id, quantity: z.number().int().positive().max(100000) }).strict()).min(1).max(100) }).strict();
const resultLine = z.object({ itemGroupId: id, itemGroupCode: id, itemGroupName: z.string().min(1).max(191), inventoryMode: z.nativeEnum(RentalInventoryMode), requestedQuantity: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), availableQuantity: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), available: z.boolean(), reasons: z.array(z.string().max(191)).max(20) }).strict();
const result = z.object({ available: z.boolean(), locationId: id, startAt: z.string().datetime({ offset: true }), endAt: z.string().datetime({ offset: true }), lines: z.array(resultLine).max(100) }).strict();

/** Check Core's original request/result relationship, without calculating stock.
 * Shared bundle demand can make a line unavailable even when its independent
 * availableQuantity is sufficient. Only contradictory success is rejected. */
export function checkedAiAvailabilityResult(request: RentalAvailabilityRequest, value: unknown): RentalAvailabilityResult {
  const checked = result.safeParse(value);
  if (!checked.success || checked.data.locationId !== request.locationId || checked.data.startAt !== request.startAt
    || checked.data.endAt !== request.endAt || checked.data.lines.length !== request.lines.length
    || checked.data.available !== checked.data.lines.every(line => line.available)) throw new ModelGatewayError('INVALID_RESPONSE');
  checked.data.lines.forEach((line, index) => {
    const requested = request.lines[index];
    if (line.itemGroupId !== requested.itemGroupId || line.requestedQuantity !== requested.quantity
      || line.available && line.availableQuantity < line.requestedQuantity) throw new ModelGatewayError('INVALID_RESPONSE');
  });
  return checked.data;
}

export type AiAvailabilityReadAuthority = AiBusinessReadAuthority;
export interface AiAvailabilityReadProjection { contractVersion: typeof AI_CONTRACT_DRAFT_VERSION; requestId: string; audience: 'operator' | 'staff'; scope: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>; observedAt: string; result: RentalAvailabilityResult; }

/** Calls Core's bounded persisted read only; never initializes configuration,
 * writes sample stock, reserves inventory or creates an order. */
export class AiAvailabilityReadFactsService {
  constructor(private readonly core: Pick<RentalCoreService, 'readAvailability'>, private readonly authority: AiAvailabilityReadAuthority, private readonly clock: () => Date = () => new Date()) {
    if (typeof core?.readAvailability !== 'function' || typeof authority?.withRead !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  async read(value: unknown, expectedContext?: AiExecutionContext): Promise<AiAvailabilityReadProjection> {
    const parsed = aiAvailabilityReadInputSchema.safeParse(value); if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    return this.authority.withRead('availability', parsed.data, async context => {
    assertAiReadContextBinding(context, expectedContext);
    if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user' || (context.audience !== 'operator' && context.audience !== 'staff') || !('access' in context)) throw new ModelGatewayError('FORBIDDEN');
    if (context.access.locationScope.mode === 'selected' && !context.access.locationScope.locationIds.includes(parsed.data.locationId)) throw new ModelGatewayError('FORBIDDEN');
    const observed = this.clock(); if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) throw new ModelGatewayError('CONFIG_INVALID');
    const checked = checkedAiAvailabilityResult(parsed.data, await this.core.readAvailability(context.scope.tenantId, parsed.data));
    return { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: context.requestId, audience: context.audience, scope: context.scope, observedAt: observed.toISOString(), result: checked };
    });
  }
}
