import { createHash } from 'node:crypto';
import type { AiUsageAssociationDraft, AiUsageSettingsDraft } from '@rental-os/shared';
import { isAiStepExecutionContext } from '../task-contract-validation';
import { BudgetError, type BudgetAction, type BudgetAuthority, type BudgetEvidencePort, type BudgetGrant, type BudgetPolicyKey, type BudgetQuotePort, type BudgetRecord, type BudgetReserveCommand, type BudgetTransactionRepository } from './budget.ports';
import { assertPositiveQuantity, quantityAtoms } from './budget-quantity';
import { validateBudgetSettings } from './budget-settings';

function fingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical((item as Record<string, unknown>)[key])])) : item;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
const same = (a: unknown, b: unknown) => fingerprint(a) === fingerprint(b);
const identifier = (value: unknown, max = 191): value is string => typeof value === 'string' && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);

/** Explicitly assembled server service. Every authority call is action-specific.
 * Revalidation in the DB transaction is sequential, not an atomic auth/DB lock.
 * Gateway still owns the final dispatch winner and must reauthorize itself.
 */
export class BudgetService {
  constructor(private readonly repository: BudgetTransactionRepository, private readonly authority: BudgetAuthority,
    private readonly quotes: BudgetQuotePort, private readonly evidence: BudgetEvidencePort, private readonly clock: () => Date = () => new Date()) {
    if (!repository || ['settings', 'saveSettings', 'reserve', 'get', 'mutate'].some(name => typeof repository[name as keyof BudgetTransactionRepository] !== 'function')
      || typeof authority?.resolve !== 'function' || typeof quotes?.quote !== 'function' || typeof evidence?.dispatch !== 'function' || typeof evidence?.usage !== 'function') throw new BudgetError('UNAVAILABLE');
  }
  private now() {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new BudgetError('UNAVAILABLE');
    return now;
  }
  private validateAssociation(association: AiUsageAssociationDraft) {
    if (!association || !['requestId', 'runId', 'stepId', 'actionId', 'idempotencyKey', 'priceVersion'].every(key => identifier(association[key as keyof AiUsageAssociationDraft]))
      || !association.config || !identifier(association.config.configId) || !Number.isSafeInteger(association.config.configRevision) || association.config.configRevision < 1
      || !association.scope || !['platform', 'tenant', 'workspace'].includes(association.scope.kind)) throw new BudgetError('INVALID');
  }
  private async authorize(action: BudgetAction, resource: { association?: AiUsageAssociationDraft; reservationId?: string; policy?: BudgetPolicyKey }) {
    let grant: BudgetGrant;
    try { grant = structuredClone(await this.authority.resolve(action, structuredClone(resource))); }
    catch { throw new BudgetError('FORBIDDEN'); }
    const now = this.now(), context = grant?.context;
    if (!grant || !isAiStepExecutionContext(context) || !grant.entitled || !identifier(grant.authorizationKey)
      || !(grant.expiresAt instanceof Date) || grant.expiresAt <= now || Date.parse(context.authorizedAt) > now.getTime()
      || (context.actor.kind === 'automation' && Date.parse(context.actor.expiresAt) <= now.getTime())
      || (resource.association && !same(context.scope, resource.association.scope))) throw new BudgetError('FORBIDDEN');
    const { authorizedAt: _, requestId: __, ...identity } = context;
    return { grant, identityHash: fingerprint({ identity, authorizationKey: grant.authorizationKey }) };
  }
  private async session(action: BudgetAction, resource: { association?: AiUsageAssociationDraft; reservationId?: string; policy?: BudgetPolicyKey }) {
    const initial = await this.authorize(action, resource);
    return { ...initial, revalidate: async () => {
      const current = await this.authorize(action, resource);
      if (current.identityHash !== initial.identityHash) throw new BudgetError('FORBIDDEN');
    } };
  }
  async settings(key: BudgetPolicyKey) {
    const session = await this.session('settings_read', { policy: key });
    const result = await this.repository.settings(structuredClone(key));
    await session.revalidate();
    return result;
  }
  async saveSettings(key: BudgetPolicyKey, settings: AiUsageSettingsDraft, expectedRevision: number) {
    validateBudgetSettings(settings);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new BudgetError('INVALID');
    const session = await this.session('settings_write', { policy: key });
    return this.repository.saveSettings(structuredClone(key), structuredClone(settings), expectedRevision, session.revalidate);
  }
  async reserve(value: BudgetReserveCommand) {
    const command = structuredClone(value);
    this.validateAssociation(command.association);
    if (!identifier(command.callId, 128) || !identifier(command.sceneCode, 128) || !(command.expiresAt instanceof Date) || command.expiresAt <= this.now()) throw new BudgetError('INVALID');
    const session = await this.session('reserve', { association: command.association });
    const quote = structuredClone(await this.quotes.quote(command, session.grant));
    if (!same(quote.association, command.association) || quote.callId !== command.callId || quote.sceneCode !== command.sceneCode
      || !identifier(quote.model, 256) || !/^[a-f0-9]{64}$/.test(quote.evidenceHash) || !(quote.expiresAt instanceof Date) || quote.expiresAt <= this.now()
      || !Array.isArray(quote.policies) || quote.policies.length < 1 || quote.policies.length > 3
      || !quote.consumerScope || !identifier(quote.consumerScope.scopeId, 36) || !['PLATFORM', 'TENANT', 'WORKSPACE'].includes(quote.consumerScope.scopeKind)
      || !quote.policies.some(policy => policy.scopeId === quote.consumerScope.scopeId && policy.scopeKind === quote.consumerScope.scopeKind)) throw new BudgetError('INVALID');
    assertPositiveQuantity(quote.quantity);
    await session.revalidate();
    return this.repository.reserve(quote, command, session.identityHash, session.revalidate);
  }
  private async load(action: BudgetAction, id: string, association: AiUsageAssociationDraft) {
    this.validateAssociation(association);
    if (!identifier(id, 36)) throw new BudgetError('INVALID');
    const session = await this.session(action, { association, reservationId: id });
    const record = await this.repository.get(id, structuredClone(association));
    if (!record || !same(record.association, association)) throw new BudgetError('FORBIDDEN');
    await session.revalidate();
    return { record, session };
  }
  async read(id: string, association: AiUsageAssociationDraft) { return (await this.load('read', id, association)).record; }
  async dispatch(id: string, association: AiUsageAssociationDraft, eventKey: string) {
    const { record, session } = await this.load('dispatch', id, association);
    if (record.status !== 'reserved' || record.expiresAt <= this.now()) throw new BudgetError('UNAVAILABLE');
    if (record.dispatched) throw new BudgetError('PENDING_RECONCILIATION');
    return this.repository.mutate(record, { action: 'dispatch', eventKey }, session.revalidate);
  }
  async markUnknown(id: string, association: AiUsageAssociationDraft, eventKey: string, reason: string) {
    if (!identifier(reason, 128)) throw new BudgetError('INVALID');
    const { record, session } = await this.load('unknown', id, association);
    if (!record.dispatched && await this.evidence.dispatch(record) === 'not_dispatched') throw new BudgetError('INVALID');
    return this.repository.mutate(record, { action: 'unknown', eventKey, reason }, session.revalidate);
  }
  async release(id: string, association: AiUsageAssociationDraft, eventKey: string) {
    const { record, session } = await this.load('release', id, association);
    if (record.dispatched || record.status !== 'reserved' || await this.evidence.dispatch(record) !== 'not_dispatched') throw new BudgetError('PENDING_RECONCILIATION');
    await session.revalidate();
    return this.repository.mutate(record, { action: 'release', eventKey }, session.revalidate);
  }
  private async account(action: 'settle' | 'reconcile', id: string, association: AiUsageAssociationDraft, eventKey: string, evidenceRef: string) {
    if (!identifier(evidenceRef)) throw new BudgetError('INVALID');
    const { record, session } = await this.load(action, id, association);
    if (action === 'settle' && record.status === 'pending_reconciliation') throw new BudgetError('PENDING_RECONCILIATION');
    if (await this.evidence.dispatch(record) === 'not_dispatched') throw new BudgetError('INVALID');
    const usage = structuredClone(await this.evidence.usage(record, evidenceRef, action === 'reconcile'));
    quantityAtoms(usage.quantity);
    if (!/^[a-f0-9]{64}$/.test(usage.evidenceHash)) throw new BudgetError('INVALID');
    await session.revalidate();
    return this.repository.mutate(record, { action, eventKey, usage }, session.revalidate);
  }
  settle(id: string, association: AiUsageAssociationDraft, eventKey: string, evidenceRef: string) { return this.account('settle', id, association, eventKey, evidenceRef); }
  reconcile(id: string, association: AiUsageAssociationDraft, eventKey: string, evidenceRef: string) { return this.account('reconcile', id, association, eventKey, evidenceRef); }
}
