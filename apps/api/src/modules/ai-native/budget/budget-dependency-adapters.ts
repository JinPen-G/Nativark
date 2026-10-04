import type { AiExecutionContext } from '@rental-os/shared';
import { BudgetError, type BudgetAction, type BudgetAuthority, type BudgetGrant, type BudgetPolicyKey, type BudgetRecord, type BudgetUsageEvidence } from './budget.ports';

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
    const item = snapshot.entitlements.find(entry => entry.code === featureCode);
    if (!item || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) throw new BudgetError('FORBIDDEN');
    return { available: item.available, revision: snapshot.revision };
  }
}

/** Uses the real request/job authority and subscription feature source supplied by the composition root. */
export class ServerBudgetAuthorityAdapter implements BudgetAuthority {
  constructor(private readonly source: BudgetAuthorizationSource, private readonly entitlements: BudgetEntitlementSource,
    private readonly featureCode = 'ai.native.use') {
    if (!source?.resolveContext || !source.authorize || !entitlements?.check) throw new BudgetError('UNAVAILABLE');
  }
  async resolve(action: BudgetAction, resource: Readonly<{ association?: unknown; reservationId?: string; policy?: BudgetPolicyKey }>): Promise<BudgetGrant> {
    const context = structuredClone(await this.source.resolveContext());
    const grant = await this.source.authorize(action, context, structuredClone(resource) as Record<string, unknown>);
    const entitlement = await this.entitlements.check(context, this.featureCode);
    if (!entitlement.available || !Number.isSafeInteger(entitlement.revision) || entitlement.revision < 1) throw new BudgetError('FORBIDDEN');
    if (!grant || typeof grant.authorizationKey !== 'string' || !grant.authorizationKey || !(grant.expiresAt instanceof Date)) throw new BudgetError('FORBIDDEN');
    return { context, authorizationKey: grant.authorizationKey, expiresAt: new Date(grant.expiresAt), entitled: true };
  }
}

export interface PersistedBudgetEvidenceSource {
  readDispatch(reservationId: string): Promise<{ state: 'not_dispatched' | 'dispatched' | 'unknown'; reservationId: string; callId: string; actorId: string; scopeKey: string }>;
  readUsage(reservationId: string, evidenceRef: string, reconcile: boolean): Promise<BudgetUsageEvidence & { reservationId: string; callId: string; actorId: string; scopeKey: string }>;
}
const scopeKey = (record: Readonly<BudgetRecord>) => `${record.scopeKind}:${record.scopeId}`;
function verify(record: Readonly<BudgetRecord>, row: { reservationId: string; callId: string; actorId: string; scopeKey: string }) {
  if (row.reservationId !== record.id || row.callId !== record.callId || !row.actorId || row.scopeKey !== scopeKey(record)) throw new BudgetError('FORBIDDEN');
}

/** Reads persisted dispatch/usage facts; caller strings never become evidence. */
export class PersistedBudgetEvidenceAdapter {
  constructor(private readonly source: PersistedBudgetEvidenceSource) {
    if (!source?.readDispatch || !source.readUsage) throw new BudgetError('UNAVAILABLE');
  }
  async dispatch(record: Readonly<BudgetRecord>) {
    const row = await this.source.readDispatch(record.id); verify(record, row); return row.state;
  }
  async usage(record: Readonly<BudgetRecord>, evidenceRef: string, reconcile: boolean) {
    if (!evidenceRef) throw new BudgetError('INVALID');
    const row = await this.source.readUsage(record.id, evidenceRef, reconcile); verify(record, row);
    if (!/^[a-f0-9]{64}$/.test(row.evidenceHash)) throw new BudgetError('UNAVAILABLE');
    return structuredClone(row);
  }
}

/** Composition roots without verified sources remain explicitly unavailable. */
export function unavailableBudgetDependencies(): never { throw new BudgetError('UNAVAILABLE'); }
