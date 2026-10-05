import type { AiExecutionContext } from '@rental-os/shared';
import { BudgetError, type BudgetAction, type BudgetAuthority, type BudgetGrant, type BudgetPolicyKey, type BudgetRecord, type BudgetUsageEvidence } from './budget.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { isAiStepExecutionContext } from '../task-contract-validation';
import { quantityAtoms } from './budget-quantity';

export interface BudgetAuthorizationSource {
  resolveContext(): Promise<AiExecutionContext>;
  authorize(action: BudgetAction, context: Readonly<AiExecutionContext>, resource: Readonly<Record<string, unknown>>): Promise<{ authorizationKey: string; expiresAt: Date }>;
}
export interface BudgetEntitlementSource {
  check(context: Readonly<AiExecutionContext>, featureCode: string): Promise<{ available: boolean; revision: number }>;
}

/**
 * Narrow adapter shape for SubscriptionService.readCategoryCommercialContext.
 * The composition root must execute the reader in its own transaction and
 * pass only the formal entitlement snapshot; this module never infers a plan.
 */
export interface SubscriptionBudgetEntitlementReader {
  read(tenantId: string, featureCode: string): Promise<{ revision: number; entitlements: ReadonlyArray<{ code: string; available: boolean }> }>;
}
export class SubscriptionBudgetEntitlementAdapter implements BudgetEntitlementSource {
  constructor(private readonly reader: SubscriptionBudgetEntitlementReader) {
    if (!reader?.read) throw new BudgetError('UNAVAILABLE');
  }
  async check(context: Readonly<AiExecutionContext>, featureCode: string) {
    const tenantId = context.scope.kind === 'tenant' ? context.scope.tenantId : context.scope.kind === 'workspace' ? context.scope.tenantId : null;
    if (!tenantId) throw new BudgetError('UNAVAILABLE');
    const snapshot = await this.reader.read(tenantId, featureCode);
    const items = snapshot?.entitlements?.filter(entry => entry.code === featureCode);
    if (!items || items.length !== 1 || typeof items[0].available !== 'boolean'
      || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) throw new BudgetError('FORBIDDEN');
    return { available: items[0].available, revision: snapshot.revision };
  }
}

/** Uses the real request/job authority and subscription feature source supplied by the composition root. */
export class ServerBudgetAuthorityAdapter implements BudgetAuthority {
  constructor(private readonly source: BudgetAuthorizationSource, private readonly entitlements: BudgetEntitlementSource,
    private readonly featureCode = 'ai.native.use') {
    if (!source?.resolveContext || !source.authorize || !entitlements?.check) throw new BudgetError('UNAVAILABLE');
  }
  async resolve(action: BudgetAction, resource: Readonly<{ association?: unknown; reservationId?: string; policy?: BudgetPolicyKey }>): Promise<BudgetGrant> {
    const snapshot = structuredClone(resource);
    const context = structuredClone(await this.source.resolveContext());
    const identity = (value: AiExecutionContext) => {
      if (!isAiStepExecutionContext(value)) throw new BudgetError('FORBIDDEN');
      const { requestId: _, authorizedAt: __, ...rest } = value;
      return requestFingerprint(rest);
    };
    const initial = identity(context);
    const grant = structuredClone(await this.source.authorize(action, structuredClone(context), structuredClone(snapshot)));
    const entitlement = structuredClone(await this.entitlements.check(structuredClone(context), this.featureCode));
    if (entitlement?.available !== true || !Number.isSafeInteger(entitlement.revision) || entitlement.revision < 1
      || !grant || typeof grant.authorizationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/.test(grant.authorizationKey)
      || !(grant.expiresAt instanceof Date) || !Number.isFinite(grant.expiresAt.getTime())) throw new BudgetError('FORBIDDEN');
    if (identity(await this.source.resolveContext()) !== initial) throw new BudgetError('FORBIDDEN');
    return { context, authorizationKey: requestFingerprint({ key: grant.authorizationKey, feature: this.featureCode, entitlementRevision: entitlement.revision }),
      expiresAt: new Date(grant.expiresAt), entitled: true };
  }
}

export interface BudgetEvidenceBinding {
  reservationId: string; requestId: string; runId: string; stepId: string; actionId: string; callId: string;
  actorId: string; scopeKey: string; sceneCode: string; configRevision: number; configurationHash: string; priceVersion: string;
}
export interface PersistedBudgetEvidenceSource {
  readDispatch(reservationId: string): Promise<BudgetEvidenceBinding & { state: 'not_dispatched' | 'dispatched' | 'unknown'; dispatchToken: string | null }>;
  readUsage(reservationId: string, evidenceRef: string, reconcile: boolean): Promise<BudgetUsageEvidence & BudgetEvidenceBinding & { dispatchToken: string }>;
}
function verify(record: Readonly<BudgetRecord>, row: BudgetEvidenceBinding) {
  if (!row || row.reservationId !== record.id || row.callId !== record.callId || row.actorId !== record.actorId
    || row.scopeKey !== `${record.scopeKind}:${record.scopeId}` || row.sceneCode !== record.sceneCode || row.requestId !== record.association.requestId
    || row.runId !== record.association.runId || row.stepId !== record.association.stepId || row.actionId !== record.association.actionId
    || row.configRevision !== record.association.config.configRevision || row.priceVersion !== record.association.priceVersion
    || row.configurationHash !== requestFingerprint(record.association.config)) throw new BudgetError('FORBIDDEN');
}

export class PersistedBudgetEvidenceAdapter {
  constructor(private readonly source: PersistedBudgetEvidenceSource) {
    if (typeof source?.readDispatch !== 'function' || typeof source?.readUsage !== 'function') throw new BudgetError('UNAVAILABLE');
  }
  private async dispatchRow(record: Readonly<BudgetRecord>) {
    const row = structuredClone(await this.source.readDispatch(record.id));
    verify(record, row);
    if (!['not_dispatched', 'dispatched', 'unknown'].includes(row.state)
      || (row.state === 'not_dispatched' ? row.dispatchToken !== null
        : typeof row.dispatchToken !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.dispatchToken))) throw new BudgetError('UNAVAILABLE');
    return row;
  }
  async dispatch(record: Readonly<BudgetRecord>) {
    return (await this.dispatchRow(structuredClone(record))).state;
  }
  async usage(record: Readonly<BudgetRecord>, evidenceRef: string, reconcile: boolean): Promise<BudgetUsageEvidence> {
    record = structuredClone(record);
    if (typeof evidenceRef !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/.test(evidenceRef)) throw new BudgetError('INVALID');
    const before = await this.dispatchRow(record);
    if (before.state === 'not_dispatched') throw new BudgetError('PENDING_RECONCILIATION');
    const row = structuredClone(await this.source.readUsage(record.id, evidenceRef, reconcile));
    verify(record, row);
    if (row.dispatchToken !== before.dispatchToken || typeof row.evidenceHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.evidenceHash)) throw new BudgetError('UNAVAILABLE');
    quantityAtoms(row.quantity);
    for (const tokens of [row.inputTokens, row.outputTokens]) {
      if (tokens !== undefined && (!Number.isSafeInteger(tokens) || tokens < 0)) throw new BudgetError('UNAVAILABLE');
    }
    const after = await this.dispatchRow(record);
    if (after.state === 'not_dispatched' || after.dispatchToken !== before.dispatchToken) throw new BudgetError('PENDING_RECONCILIATION');
    return { quantity: row.quantity, evidenceHash: row.evidenceHash,
      ...(row.inputTokens !== undefined ? { inputTokens: row.inputTokens } : {}),
      ...(row.outputTokens !== undefined ? { outputTokens: row.outputTokens } : {}) };
  }
}

/** Composition roots without verified sources remain explicitly unavailable. */
export function unavailableBudgetDependencies(): never { throw new BudgetError('UNAVAILABLE'); }
