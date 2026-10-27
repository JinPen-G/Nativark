import type { AiUsageAssociationDraft } from '@rental-os/shared';
import { modelRequestSchema, type GatewayContext, type ModelUsage } from '../model-gateway.ports';
import { BudgetError, type BudgetRecord } from './budget.ports';
import { BudgetService } from './budget.service';

/**
 * The legacy Gateway budget port is intentionally not implemented here: it
 * cannot carry a trusted run/step/action/priceVersion or usage evidence. This
 * port is the narrow composition boundary for the durable budget ledger.
 * Implementations must resolve from persisted task/dispatch facts; they must
 * not derive the association from request fields or keep it in a process Map.
 */
export interface BudgetGatewayInvocationBinding {
  actorId: string;
  association: AiUsageAssociationDraft;
  sceneCode: string;
  expiresAt: Date;
}

/** Aliases of the canonical gateway context union from model-gateway.ports. */
export type { PlatformGatewayContext } from '../model-gateway.ports';
export type BudgetGatewayContext = GatewayContext;
export { isPlatformGatewayContext } from '../model-gateway.ports';

export interface GatewayBudgetReserveRequest {
  callId: string; model: string; maxOutputTokens: number; intentHash: string;
  /** Computed from the actual server adapter's generation serialization. */
  countRequestHash?: string;
}
export interface BudgetGatewayBindingSource {
  resolveForReserve(context: Readonly<BudgetGatewayContext>, request: Readonly<GatewayBudgetReserveRequest>): Promise<BudgetGatewayInvocationBinding>;
  resolveForReservation(context: Readonly<BudgetGatewayContext>, reservationId: string): Promise<BudgetGatewayInvocationBinding>;
}

export interface BudgetGatewayLifecycle {
  reserve(context: Readonly<BudgetGatewayContext>, request: Readonly<GatewayBudgetReserveRequest>): Promise<string>;
  dispatch(context: Readonly<BudgetGatewayContext>, reservationId: string, eventKey: string): Promise<BudgetRecord>;
  settle(context: Readonly<BudgetGatewayContext>, reservationId: string, eventKey: string, evidenceRef: string): Promise<BudgetRecord>;
  release(context: Readonly<BudgetGatewayContext>, reservationId: string, eventKey: string): Promise<BudgetRecord>;
  markUnknown(context: Readonly<BudgetGatewayContext>, reservationId: string, eventKey: string, reason: string): Promise<BudgetRecord>;
  reconcile(context: Readonly<BudgetGatewayContext>, reservationId: string, eventKey: string, evidenceRef: string): Promise<BudgetRecord>;
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const boundedIdentifier = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);

function assertReserveRequest(request: Readonly<GatewayBudgetReserveRequest>) {
  if (!request || !boundedIdentifier(request.callId) || !modelRequestSchema.shape.model.safeParse(request.model).success
    || !Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > 32768) {
    throw new BudgetError('INVALID');
  }
}

function assertBinding(contextValue: Readonly<BudgetGatewayContext>, binding: Readonly<BudgetGatewayInvocationBinding>) {
  // Unwrap the readonly view: discriminating the union by field presence.
  const context = contextValue as BudgetGatewayContext;
  if (!binding || binding.actorId !== context.actorId || !(binding.expiresAt instanceof Date)
    || !Number.isFinite(binding.expiresAt.getTime()) || !binding.association || !binding.association.scope) throw new BudgetError('FORBIDDEN');
  const scope = binding.association.scope;
  // Discriminate by field presence: PlatformGatewayContext is structurally
  // wider than GatewayContext, so a type predicate cannot narrow negatively.
  // The workspace consumer context keeps charging its own workspace ledger;
  // the platform context is reserved for explicit SaaS/platform work.
  const validScope = !('tenantId' in context) && !('workspaceId' in context)
    ? scope.kind === 'platform'
    : 'tenantId' in context && 'workspaceId' in context && scope.kind === 'workspace'
      && scope.tenantId === context.tenantId && scope.workspaceId === context.workspaceId;
  if (!validScope || !binding.sceneCode || binding.association.idempotencyKey === '') throw new BudgetError('FORBIDDEN');
}

/**
 * Adapter for the new persistent budget account. It deliberately resolves
 * every mutation from the trusted source, so a restarted process does not
 * recover authorization or association from memory. The source is also the
 * place where the caller's current auth, task/run/step/action and dispatch
 * evidence are joined.
 */
export class BudgetGatewayAdapter implements BudgetGatewayLifecycle {
  constructor(private readonly budget: BudgetService, private readonly source: BudgetGatewayBindingSource) {
    if (!budget || !source?.resolveForReserve || !source.resolveForReservation) throw new BudgetError('UNAVAILABLE');
  }

  async reserve(context: Readonly<BudgetGatewayContext>, request: Readonly<GatewayBudgetReserveRequest>) {
    context = structuredClone(context);
    request = structuredClone(request);
    assertReserveRequest(request);
    const binding = structuredClone(await this.source.resolveForReserve(structuredClone(context), structuredClone(request)));
    assertBinding(context, binding);
    if (binding.association.idempotencyKey !== request.callId) throw new BudgetError('FORBIDDEN');
    const record = await this.budget.reserve({
      association: structuredClone(binding.association),
      callId: request.callId,
      sceneCode: binding.sceneCode,
      expiresAt: new Date(binding.expiresAt),
      ...(request.countRequestHash !== undefined ? { countRequestHash: request.countRequestHash } : {})
    });
    if (!same(record.association, binding.association) || record.callId !== request.callId || record.sceneCode !== binding.sceneCode) throw new BudgetError('FORBIDDEN');
    return record.id;
  }

  private async binding(context: Readonly<BudgetGatewayContext>, reservationId: string) {
    context = structuredClone(context);
    const binding = structuredClone(await this.source.resolveForReservation(structuredClone(context), reservationId));
    assertBinding(context, binding);
    return binding;
  }

  async dispatch(context: Readonly<BudgetGatewayContext>, reservationId: string, eventKey: string) {
    const binding = await this.binding(context, reservationId);
    return this.budget.dispatch(reservationId, binding.association, eventKey);
  }

  async settle(context: Readonly<BudgetGatewayContext>, reservationId: string, eventKey: string, evidenceRef: string) {
    const binding = await this.binding(context, reservationId);
    return this.budget.settle(reservationId, binding.association, eventKey, evidenceRef);
  }

  async release(context: Readonly<BudgetGatewayContext>, reservationId: string, eventKey: string) {
    const binding = await this.binding(context, reservationId);
    return this.budget.release(reservationId, binding.association, eventKey);
  }

  async markUnknown(context: Readonly<BudgetGatewayContext>, reservationId: string, eventKey: string, reason: string) {
    const binding = await this.binding(context, reservationId);
    return this.budget.markUnknown(reservationId, binding.association, eventKey, reason);
  }

  async reconcile(context: Readonly<BudgetGatewayContext>, reservationId: string, eventKey: string, evidenceRef: string) {
    const binding = await this.binding(context, reservationId);
    return this.budget.reconcile(reservationId, binding.association, eventKey, evidenceRef);
  }
}

/** Usage is intentionally not accepted by this adapter: evidenceRef must be
 * created by the persisted dispatch/usage source, not synthesized from a
 * provider response or caller-supplied token counts. */
export type BudgetGatewayUsageBoundary = Readonly<{ usage: ModelUsage; evidenceRef: string }>;
