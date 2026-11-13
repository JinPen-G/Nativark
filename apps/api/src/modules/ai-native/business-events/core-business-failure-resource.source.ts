/** Original Core facts for the two approved resource event kinds. No inventory
 * algorithm, text-derived anomaly, policy default, transaction, model or worker
 * is created here. Capture uses the caller's transaction; ordinary reads remain
 * independent observations and recheck the same source and current ALS scope. */
import { ConflictException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { RentalCoreOrderStatus, type RentalOrder } from '@rental-os/shared';
import { getRequestIdentity } from '../../../common/request-identity';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ACTIVE_ASSIGNMENTS, allocationComplete } from '../../rental-core/rental-allocation-policy';
import { isIssuedRuleVersion, matchRuleVersionAt } from '../../rental-core/rental-rule-version-chain';
import { businessDateKey, businessYearFromDateKey } from '../../rental-core/rental-business-day';
import { createPrismaBusinessFailureResourceStorage } from './prisma-business-failure-resource-store';
import { BusinessFailureError, configurationFailureOriginSchema, type BusinessFailureResourcePorts,
  type ConfigurationFailureOrigin, type FailureScope } from './prisma-business-failure-outbox';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
const revision = z.number().int().min(1).max(4294967294), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const instant = z.string().max(40).datetime({ offset: true });
const scopeSchema = z.object({ tenantId: id, workspaceId: id }).strict();
const count = z.number().int().nonnegative().safe();
const section = z.enum(['workspace_profile', 'accounts_roles', 'fulfillment_network', 'business_rule',
  'business_calendar', 'item_groups', 'pricing_groups_rates', 'price_version', 'membership_base']);
const cause = z.object({ version: z.literal('rental-fulfillment-issue-1'),
  code: z.enum(['resource_shortage', 'assigned_resource_unavailable', 'configuration_unavailable', 'allocation_incomplete']) }).strict();
const issueSchema = scopeSchema.extend({ orderId: id, assignmentRevision: revision, orderUpdatedAt: instant,
  startAt: instant, fulfillmentLocationId: id, state: z.literal('issue_recorded'), issueSource: cause.optional(), sourceHash: hash.optional() }).strict();
export type CoreRecordedFulfillmentIssue = z.infer<typeof issueSchema>;

export const coreFulfillmentNearPolicySchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), id, revision, scope: scopeSchema, validFrom: instant, expiresAt: instant,
    lookAheadMs: z.number().int().positive().safe() }).strict()
]);
export interface CoreFulfillmentNearPolicySource {
  /** Server publication only. The caller's request/assignment preferences are
   * never a policy; this callback must return the current explicit publication. */
  read(scope: FailureScope): Promise<unknown>;
}
const readinessSchema = scopeSchema.extend({ readiness: scopeSchema.extend({ ready: z.boolean(),
  items: z.array(z.object({ key: section, done: z.boolean(), unavailable: z.boolean().optional(),
    optional: z.boolean().optional() }).passthrough()).length(9).refine(items => new Set(items.map(item => item.key)).size === 9)
}).passthrough(), observations: z.object({ startedAt: instant, completedAt: instant,
  consistency: z.enum(['caller_transaction_reads', 'independent_persisted_reads']) }).strict(),
  categoryBinding: z.object({ categoryVersionId: id, categoryAdoptionRevision: z.number().int().min(0).max(4294967294) }).strict()
}).passthrough();
export type CoreTenantReadinessSource = z.infer<typeof readinessSchema>;
const coreFactsSchema = scopeSchema.extend({ categoryCode: id, timeZone: z.string().min(1).max(100),
  enabledItemGroupCount: count, serviceableLocationCount: count,
  pricingGroups: z.array(z.object({ id, name: z.string().min(1).max(191) }).passthrough()).max(10000)
    .refine(rows => new Set(rows.map(row => row.id)).size === rows.length) }).passthrough();
const businessFactsSchema = scopeSchema.extend({
  ruleVersions: z.array(z.object({ id, version: id, status: z.enum(['draft', 'pending', 'published', 'superseded', 'void']),
    effectiveFrom: instant.optional() }).passthrough()).max(2).refine(rows => new Set(rows.map(row => row.id)).size === rows.length),
  publishedCalendarYears: z.array(z.number().int().min(1).max(9999)).max(3),
  pricedGroupIds: z.array(id).max(10000), operationsAccounts: count, hasActiveRole: z.boolean(),
  priceVersion: z.object({ sequence: revision, effectiveFrom: instant }).strict().nullable()
}).passthrough();

/** These are existing original Core ports; optional methods express rollout
 * absence, not a permissive fallback. Structural declarations keep the adapter
 * compilable until the fixed Core methods are integrated by the owner. */
export interface CoreBusinessFailureResourceDependencies {
  db: PrismaClient;
  allocation?: { readRecordedFulfillmentIssue?(tenantId: string, orderId: string,
    tx: Prisma.TransactionClient): Promise<CoreRecordedFulfillmentIssue | undefined> };
  facts?: { findOrder(tenantId: string, orderId: string, tx?: Prisma.TransactionClient): Promise<RentalOrder | undefined> };
  business?: { readTenantReadinessSource?(tenantId: string, tx?: Prisma.TransactionClient): Promise<unknown> };
  coreConfiguration?: { readReadinessCoreFacts?(tenantId: string, workspaceId: string, tx?: Prisma.TransactionClient): Promise<unknown> };
  businessConfiguration?: { readReadinessBusinessFacts?(tenantId: string, workspaceId: string, at: Date,
    calendarYears: readonly number[], tx?: Prisma.TransactionClient): Promise<unknown> };
  memberships?: { countPlans(tenantId: string, tx?: Prisma.TransactionClient): Promise<number> };
  nearPolicy?: CoreFulfillmentNearPolicySource;
  clock?: () => Date;
}
const unavailable = () => new BusinessFailureError('unavailable');
const conflict = () => new BusinessFailureError('conflict');
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(structuredClone(value));
  if (!result.success) throw unavailable();
  return result.data;
};
const same = (left: unknown, right: unknown) => requestFingerprint(left) === requestFingerprint(right);

export class CoreBusinessFailureResourceSource implements BusinessFailureResourcePorts {
  private readonly clock: () => Date;
  private readonly storage: ReturnType<typeof createPrismaBusinessFailureResourceStorage>;
  constructor(private readonly dependencies: CoreBusinessFailureResourceDependencies) {
    if (!dependencies || typeof dependencies.db?.$queryRaw !== 'function'
      || dependencies.clock !== undefined && typeof dependencies.clock !== 'function') throw unavailable();
    this.clock = dependencies.clock ?? (() => new Date());
    this.storage = createPrismaBusinessFailureResourceStorage(dependencies.db, this.clock);
  }
  private now() {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw unavailable();
    return now;
  }
  private binding(value: FailureScope) {
    const scope = parse(scopeSchema, value), identity = structuredClone(getRequestIdentity());
    if (!identity || identity.tenantId !== scope.tenantId || identity.workspaceId !== scope.workspaceId
      || !id.safeParse(identity.userId).success || identity.isSaasAdmin === true
      || identity.audience !== undefined && !['operator', 'staff'].includes(identity.audience)) throw unavailable();
    const fingerprint = requestFingerprint(identity);
    const current = () => {
      if (requestFingerprint(getRequestIdentity() ?? null) !== fingerprint) throw unavailable();
    };
    return { scope, current };
  }
  private async wait<T>(current: () => void, read: () => Promise<T>) {
    current(); const value = structuredClone(await read()); current(); return value;
  }

  async readFulfillment(value: FailureScope, orderId: string, tx?: Prisma.TransactionClient) {
    const { scope, current } = this.binding(value), d = this.dependencies;
    if (!id.safeParse(orderId).success || typeof d.allocation?.readRecordedFulfillmentIssue !== 'function'
      || typeof d.facts?.findOrder !== 'function') throw unavailable();
    const observe = async () => {
      if (!d.nearPolicy) return undefined;
      if (typeof d.nearPolicy.read !== 'function') throw unavailable();
      const raw = await this.wait(current, () => d.nearPolicy!.read(structuredClone(scope)));
      if (raw === null || raw === undefined) return undefined;
      const published = parse(coreFulfillmentNearPolicySchema, raw), now = this.now();
      if (!published.enabled) return undefined;
      if (!same(published.scope, scope) || Date.parse(published.validFrom) >= Date.parse(published.expiresAt)) throw unavailable();
      if (Date.parse(published.validFrom) > now.getTime() || Date.parse(published.expiresAt) <= now.getTime()) return undefined;
      const issueValue = await this.wait(current, () => d.allocation!.readRecordedFulfillmentIssue!(scope.tenantId, orderId, tx ?? d.db));
      const order = await this.wait(current, () => d.facts!.findOrder(scope.tenantId, orderId, tx));
      if (!order) return undefined;
      if (order.id !== orderId || order.tenantId !== scope.tenantId || !revision.safeParse(order.assignment?.revision).success
        || !instant.safeParse(order.updatedAt).success || !instant.safeParse(order.startAt).success
        || !id.safeParse(order.fulfillmentLocationId).success || !Array.isArray(order.allocations)
        || !Array.isArray(order.reservations) || order.allocations.length > 10000 || order.reservations.length > 10000) throw unavailable();
      const tuple = { ...scope, orderId, assignmentRevision: order.assignment!.revision, orderUpdatedAt: order.updatedAt,
        startAt: order.startAt, fulfillmentLocationId: order.fulfillmentLocationId, status: order.status };
      let state: 'shortage' | 'deliverable', sourceHash: string;
      if (issueValue !== undefined && issueValue !== null) {
        const issue = parse(issueSchema, issueValue);
        if (Object.entries(tuple).some(([key, v]) => key !== 'status' && issue[key as keyof CoreRecordedFulfillmentIssue] !== v)) throw conflict();
        if (!issue.issueSource || !issue.sourceHash || issue.issueSource.code !== 'resource_shortage') return undefined;
        const storedCause = cause.safeParse((order.assignment as unknown as Record<string, unknown>).issueSource);
        if (![RentalCoreOrderStatus.Reserved, RentalCoreOrderStatus.ReadyForPickup].includes(order.status)
          || !storedCause.success || !same(storedCause.data, issue.issueSource)) throw conflict();
        if (issue.sourceHash !== requestFingerprint({ ...tuple, issueSource: issue.issueSource })) throw conflict();
        state = 'shortage'; sourceHash = issue.sourceHash;
      } else {
        // Absence also means missing/unclassified/out-of-stage. Only the Core's
        // recorded ready state and last completed scan can prove resolution;
        // use its allocation predicate, never recompute inventory availability.
        const assignment = order.assignment!, history = assignment.history;
        const last = Array.isArray(history) && history.length <= 10000 ? history[history.length - 1] : undefined;
        if (order.status !== RentalCoreOrderStatus.ReadyForPickup || assignment.issue !== undefined
          || (assignment as unknown as Record<string, unknown>).issueSource !== undefined
          || !last || last.action !== 'exception_resolved' || last.actor !== '分配检查' || last.at !== order.updatedAt
          || !id.safeParse(last.id).success || !instant.safeParse(last.at).success || Date.parse(last.at) > now.getTime()
          || !order.allocations.some(row => ACTIVE_ASSIGNMENTS.includes(row.status) && Number.isFinite(row.quantity) && row.quantity > 0)
          || !allocationComplete(order, true)) return undefined;
        state = 'deliverable'; sourceHash = requestFingerprint({ ...tuple, evidence: { id: last.id, action: last.action, at: last.at,
          allocation: 'original_locked_assignment_complete', state: 'recorded_core_ready' } });
      }
      // Core reads can outlive the publication window checked before them.
      // Expiry still cannot establish resolution or authorize a new capture.
      const completedAt = this.now().getTime();
      if (Date.parse(published.validFrom) > completedAt || Date.parse(published.expiresAt) <= completedAt
        || Date.parse(order.startAt) <= completedAt) return undefined;
      return { scope, orderId, assignmentRevision: tuple.assignmentRevision, dueAt: order.startAt,
        locationId: order.fulfillmentLocationId, state, sourceHash,
        policy: { id: published.id, revision: published.revision, validFrom: published.validFrom,
          expiresAt: published.expiresAt, lookAheadMs: published.lookAheadMs } };
    };
    const before = await observe(), after = await observe();
    if (!same(before, after)) throw conflict();
    current(); return after;
  }

  private async configuration(scope: FailureScope, origin: ConfigurationFailureOrigin, reader: Prisma.TransactionClient | PrismaClient) {
    let rows: unknown[];
    if (origin.kind === 'tenant_profile') {
      if (origin.id !== scope.tenantId) throw unavailable();
      rows = await reader.$queryRaw(Prisma.sql`SELECT p.tenantId, w.id AS workspaceId, p.tenantId AS id,
        p.configurationRevision AS rowRevision, w.isDefault, w.defaultMarker FROM tenant_rental_profiles p
        JOIN business_workspaces w ON w.tenantId = p.tenantId WHERE p.tenantId = ${scope.tenantId}
        AND w.id = ${scope.workspaceId} AND w.isDefault = TRUE AND w.defaultMarker = 'default' LIMIT 2`);
    } else {
      if (origin.id !== scope.workspaceId) throw unavailable();
      const table = origin.kind === 'core_snapshot' ? Prisma.sql`rental_core_state_snapshots` : Prisma.sql`rental_tenant_business_settings`;
      const column = origin.kind === 'core_snapshot' ? Prisma.sql`c.configurationRevision` : Prisma.sql`c.settingsRevision`;
      rows = await reader.$queryRaw(Prisma.sql`SELECT c.tenantId, c.workspaceId, c.workspaceId AS id, ${column} AS rowRevision,
        w.isDefault, w.defaultMarker FROM ${table} c JOIN business_workspaces w ON w.tenantId = c.tenantId AND w.id = c.workspaceId
        WHERE c.tenantId = ${scope.tenantId} AND c.workspaceId = ${scope.workspaceId} LIMIT 2`);
    }
    if (!Array.isArray(rows) || rows.length > 1) throw unavailable();
    if (!rows.length) return undefined;
    const row = parse(scopeSchema.extend({ id, rowRevision: revision, isDefault: z.union([z.boolean(), z.literal(0), z.literal(1)]),
      defaultMarker: z.string().nullable() }).strict(), rows[0]);
    if (!same({ tenantId: row.tenantId, workspaceId: row.workspaceId }, scope) || row.id !== origin.id) throw unavailable();
    return { configuration: { ...origin, rowRevision: row.rowRevision },
      defaultWorkspaceId: row.isDefault && row.defaultMarker === 'default' ? scope.workspaceId : null };
  }

  async readOpening(value: FailureScope, configuration: ConfigurationFailureOrigin, tx?: Prisma.TransactionClient) {
    const { scope, current } = this.binding(value), origin = parse(configurationFailureOriginSchema, configuration), d = this.dependencies;
    if (typeof d.business?.readTenantReadinessSource !== 'function' || typeof d.coreConfiguration?.readReadinessCoreFacts !== 'function'
      || typeof d.businessConfiguration?.readReadinessBusinessFacts !== 'function') throw unavailable();
    const observe = async () => {
      const stored = await this.wait(current, () => this.configuration(scope, origin, tx ?? d.db));
      if (!stored) return undefined;
      const envelope = parse(readinessSchema, await this.wait(current, () => d.business!.readTenantReadinessSource!(scope.tenantId, tx)));
      if (!same({ tenantId: envelope.tenantId, workspaceId: envelope.workspaceId }, scope)
        || !same({ tenantId: envelope.readiness.tenantId, workspaceId: envelope.readiness.workspaceId }, scope)
        || envelope.observations.consistency !== (tx ? 'caller_transaction_reads' : 'independent_persisted_reads')
        || Date.parse(envelope.observations.startedAt) > Date.parse(envelope.observations.completedAt)
        || Date.parse(envelope.observations.completedAt) > this.now().getTime()) throw unavailable();
      const at = new Date(envelope.observations.completedAt), core = parse(coreFactsSchema,
        await this.wait(current, () => d.coreConfiguration!.readReadinessCoreFacts!(scope.tenantId, scope.workspaceId, tx)));
      const startAt = `${at.getFullYear()}-01-01T00:00:00.000Z`, endAt = `${at.getFullYear() + 1}-12-31T23:59:59.000Z`;
      const startYear = businessYearFromDateKey(businessDateKey(startAt, core.timeZone));
      const endYear = businessYearFromDateKey(businessDateKey(new Date(Date.parse(endAt) - 1).toISOString(), core.timeZone));
      const years = Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
      const business = parse(businessFactsSchema, await this.wait(current,
        () => d.businessConfiguration!.readReadinessBusinessFacts!(scope.tenantId, scope.workspaceId, at, years, tx)));
      if (!same({ tenantId: core.tenantId, workspaceId: core.workspaceId }, scope)
        || !same({ tenantId: business.tenantId, workspaceId: business.workspaceId }, scope)) throw unavailable();
      const states = new Map<z.infer<typeof section>, 'missing' | 'ready' | 'unavailable'>();
      const set = (key: z.infer<typeof section>, ready: boolean) => states.set(key, ready ? 'ready' : 'missing');
      set('workspace_profile', Boolean(core.categoryCode));
      set('accounts_roles', business.operationsAccounts > 0 && business.hasActiveRole);
      set('fulfillment_network', core.serviceableLocationCount > 0);
      const activeRules = business.ruleVersions.filter(row => isIssuedRuleVersion(row.status) && row.effectiveFrom && Date.parse(row.effectiveFrom) <= at.getTime());
      if (!activeRules.length) states.set('business_rule', 'missing');
      else {
        try { matchRuleVersionAt(business.ruleVersions, at.toISOString()); states.set('business_rule', 'ready'); }
        catch (error) { if (!(error instanceof ConflictException)) throw error; states.set('business_rule', 'unavailable'); }
      }
      set('business_calendar', business.publishedCalendarYears.length > 0);
      set('item_groups', core.enabledItemGroupCount > 0);
      set('pricing_groups_rates', core.pricingGroups.length > 0 && core.pricingGroups.every(row => business.pricedGroupIds.includes(row.id)));
      set('price_version', business.priceVersion !== null);
      const memberItem = envelope.readiness.items.find(item => item.key === 'membership_base')!;
      let memberCount: number | undefined;
      if (memberItem.unavailable) states.set('membership_base', 'unavailable');
      else if (typeof d.memberships?.countPlans !== 'function') states.set('membership_base', 'unavailable');
      else { memberCount = parse(count, await this.wait(current, () => d.memberships!.countPlans(scope.tenantId, tx))); set('membership_base', memberCount > 0); }
      const sections = envelope.readiness.items.map(item => {
        const state = item.unavailable ? 'unavailable' as const : states.get(item.key)!;
        if (!state || state !== 'unavailable' && item.done !== (state === 'ready')) throw conflict();
        return { key: item.key, state };
      });
      const latest = await this.wait(current, () => this.configuration(scope, origin, tx ?? d.db));
      if (!same(stored, latest)) throw conflict();
      return { scope, ...stored, sections, sourceHash: requestFingerprint({ scope, ...stored, sections,
        categoryBinding: envelope.categoryBinding, core, business, ...(memberCount === undefined ? {} : { memberCount }) }) };
    };
    const before = await observe(), after = await observe();
    if (!same(before, after)) throw conflict();
    current(); return after;
  }

  readBinding(...args: Parameters<BusinessFailureResourcePorts['readBinding']>) { return this.storage.readBinding(...args); }
  assertStorage(...args: Parameters<BusinessFailureResourcePorts['assertStorage']>) { return this.storage.assertStorage(...args); }
  append(...args: Parameters<BusinessFailureResourcePorts['append']>) { return this.storage.append(...args); }
}
