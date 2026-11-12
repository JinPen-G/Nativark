import { z } from 'zod';
import type { PrismaClient, AiAutomationInput } from '@prisma/client';
import { AI_CONTRACT_DRAFT_VERSION, AI_EVENTS_DRAFT_VERSION, AI_TOOL_CODES, AI_TOOL_DRAFT_VERSION,
  type AiExecutionContext, type AiUsageSettingsDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { validateBudgetSettings } from '../budget/budget-settings';
import type { SubscriptionBudgetEntitlementAdapter } from '../budget/budget-dependency-adapters';
import type { AiTaskCreationAuthority } from '../ai-task-creation.repository';
import { aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import { returnExceptionSource } from '../business-events/return-exception-source';
import type { BusinessFailureReadAuthority, FailureSource } from '../business-events/business-failure-read.authority';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
const revision = z.number().int().min(1).max(4294967294);
const permissions = z.array(z.enum(['system:integration:manage', 'rental-os:finance:view', 'rental-os:order:view'])).min(1).max(3)
  .refine(values => new Set(values).size === values.length);
const locationScope = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all'), locationIds: z.tuple([]) }).strict(),
  z.object({ mode: z.literal('selected'), locationIds: z.array(id).min(1).max(100).refine(values => new Set(values).size === values.length) }).strict()
]);
const subjectSchema = z.object({ id: id.max(36), tenantId: id, workspaceId: id, authorizationRevision: revision,
  enabled: z.literal(true), permissions, locationScope, expiresAt: z.date(), revokedAt: z.null() });
const policySchema = z.object({ id: id.max(36), tenantId: id, workspaceId: id, subjectId: id.max(36), revision,
  mode: z.enum(['shadow', 'manual_confirmation']), sceneCode: id.max(64), sceneVersion: id.max(64),
  allowedEventTypes: z.array(z.enum(['notification.failed', 'refund.failed', 'inspection.return_exception',
    'fulfillment.resource_shortage', 'opening.missing_configuration'])).min(1).max(5).refine(values => new Set(values).size === values.length),
  maxTasksPerDay: z.number().int().min(1).max(10000), cooldownSeconds: z.number().int().min(1).max(86400),
  validFrom: z.date(), expiresAt: z.date(), revokedAt: z.null() });
const eventSchema = z.object({ id: z.string().uuid(), tenantId: id, workspaceId: id,
  eventType: z.enum(['notification.failed', 'refund.failed', 'inspection.return_exception', 'fulfillment.resource_shortage',
    'opening.missing_configuration']), notificationId: id.nullable(), refundId: id.nullable(),
  inspectionId: id.nullish(), exceptionId: id.nullish(),
  resourceRevision: revision, orderId: id.nullable(), failureCode: z.enum(['delivery_failed', 'provider_failed', 'review_pending',
    'resource_shortage', 'missing_configuration']),
  traceId: id, causationId: id, deduplicationKey: z.string().regex(/^[a-f0-9]{64}$/u),
  occurredAt: z.date(), expiresAt: z.date(), status: z.enum(['pending', 'claimed', 'retry_scheduled', 'ready']) });
const toolsSchema = z.array(z.object({ code: z.string().refine(value => AI_TOOL_CODES.some(code => code === value)),
  version: z.literal(AI_TOOL_DRAFT_VERSION) }).strict()).min(1).max(30)
  .refine(values => new Set(values.map(value => value.code)).size === values.length);
export type AutomationReadDb = Pick<PrismaClient, 'aiAutomationSubject' | 'aiAutomationPolicy' | 'aiAutomationInput'
  | 'aiBusinessFailureOutbox' | 'businessWorkspace' | 'rentalNotificationLog' | 'rentalPaymentRefund' | 'rentalOrder' | 'rentalInspectionRecord'
  | 'aiScope' | 'aiBudgetPolicy' | 'aiTaskPlanPolicy'>;

export class AutomationError extends Error {
  readonly retryable = false;
  constructor(readonly code: 'unavailable' | 'invalid_input' | 'limit_reached' | 'result_unknown') { super(code); }
}
const unavailable = () => new AutomationError('unavailable');
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw unavailable();
  return result.data;
};
export type AutomationSnapshot = Awaited<ReturnType<PrismaAutomationAuthority['snapshot']>>;

export class PrismaAutomationAuthority implements AiTaskCreationAuthority {
  private readonly policyId: string;
  constructor(private readonly db: AutomationReadDb, policyId: string,
    private readonly entitlements: SubscriptionBudgetEntitlementAdapter, private readonly clock: () => Date = () => new Date(),
    private readonly humanReads?: BusinessFailureReadAuthority) {
    this.policyId = parse(id.max(36), policyId);
  }

  async inspect(eventId: string, db: AutomationReadDb = this.db) {
    const now = this.clock(), human = await this.humanReads?.current();
    const policy = parse(policySchema, await db.aiAutomationPolicy.findUnique({ where: { id: this.policyId } }));
    const scope = { tenantId: policy.tenantId, workspaceId: policy.workspaceId };
    if (human && (human.scope.tenantId !== scope.tenantId || human.scope.workspaceId !== scope.workspaceId)) throw unavailable();
    if (policy.id !== this.policyId || policy.validFrom > now || policy.expiresAt <= now) throw unavailable();
    const subject = parse(subjectSchema, await db.aiAutomationSubject.findFirst({ where: { id: policy.subjectId, ...scope } }));
    if (subject.id !== policy.subjectId || subject.tenantId !== scope.tenantId || subject.workspaceId !== scope.workspaceId
      || subject.expiresAt <= now) throw unavailable();
    // Independent subjects have no user session for tenant freezing to revoke.
    // Read the current tenant with its workspace; a live policy/space alone must
    // never authorize new automated work for a frozen or disabled tenant.
    const workspace = await db.businessWorkspace.findFirst({ where: { tenantId: scope.tenantId, id: scope.workspaceId,
      status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
      select: { id: true, tenantId: true, status: true, tenant: { select: { id: true, status: true } } } });
    if (!workspace || workspace.tenantId !== scope.tenantId || workspace.id !== scope.workspaceId || workspace.status !== 'ACTIVE'
      || workspace.tenant?.id !== scope.tenantId || workspace.tenant.status !== 'ACTIVE') throw unavailable();
    const eventRow = await db.aiBusinessFailureOutbox.findFirst({ where: { id: eventId, ...scope } });
    const event = parse(eventSchema, eventRow);
    if (event.id !== eventId || event.tenantId !== scope.tenantId || event.workspaceId !== scope.workspaceId
      || event.occurredAt > now || event.expiresAt <= now || !policy.allowedEventTypes.includes(event.eventType)) throw unavailable();
    // The HTTP consumer needs BOTH the human's original resource read and the
    // existing automation policy below. Read access never becomes a grant.
    let originalSource: FailureSource | undefined;
    if (this.humanReads) {
      if (!eventRow || event.status !== 'ready') throw unavailable();
      originalSource = await this.humanReads.withEvent(eventRow, async source => structuredClone(source));
    }
    let sourceRevision: number, orderId: string | null, sourceHash: string | undefined;
    if (event.eventType !== 'inspection.return_exception' && (event.inspectionId || event.exceptionId)) throw unavailable();
    if (event.eventType === 'fulfillment.resource_shortage' || event.eventType === 'opening.missing_configuration') {
      // New resource kinds require the original guarded Core/configuration
      // reader. Human read authority supplements, never replaces, the current
      // automation subject, policy, scope, entitlement and budget below.
      if (!originalSource?.failed || !originalSource.resourceEvent || !originalSource.sourceHash
        || originalSource.sourceHash !== originalSource.capturedSourceHash || event.notificationId || event.refundId
        || !subject.permissions.includes('rental-os:order:view')) throw unavailable();
      const material = originalSource.resourceEvent;
      if (material.type !== event.eventType || material.eventId !== event.id || material.resource.version !== event.resourceRevision
        || material.scope.kind !== 'workspace' || material.scope.tenantId !== scope.tenantId || material.scope.workspaceId !== scope.workspaceId)
        throw unavailable();
      sourceRevision = originalSource.revision;
      orderId = originalSource.orderId;
      sourceHash = originalSource.sourceHash;
    } else if (event.eventType === 'notification.failed') {
      if (!event.notificationId || event.refundId || event.failureCode !== 'delivery_failed'
        || !subject.permissions.includes('system:integration:manage')) throw unavailable();
      const row = await db.rentalNotificationLog.findFirst({ where: { id: event.notificationId, ...scope }, select: {
        id: true, tenantId: true, workspaceId: true, revision: true, status: true, nextAttemptAt: true, provider: true, businessObjectType: true, businessObjectId: true } });
      if (!row || row.id !== event.notificationId || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
        || !['failed', 'delivery_failed'].includes(row.status) || row.status === 'failed' && row.nextAttemptAt !== null
        || ['mock', 'local_mock', 'simulation'].includes(row.provider)) throw unavailable();
      sourceRevision = row.revision;
      orderId = row.businessObjectType === 'order' ? row.businessObjectId : null;
    } else if (event.eventType === 'refund.failed') {
      if (!event.refundId || event.notificationId || event.failureCode !== 'provider_failed'
        || !subject.permissions.includes('rental-os:finance:view')) throw unavailable();
      const row = await db.rentalPaymentRefund.findFirst({ where: { id: event.refundId, ...scope }, select: {
        id: true, tenantId: true, workspaceId: true, revision: true, status: true, orderId: true, provider: true, succeededAt: true, fundedAt: true } });
      if (!row || row.id !== event.refundId || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
        || row.status !== 'failed' || row.succeededAt || row.fundedAt || ['mock', 'local_mock', 'simulation'].includes(row.provider)) throw unavailable();
      sourceRevision = row.revision;
      orderId = row.orderId;
    } else {
      if (!event.inspectionId || !event.exceptionId || !event.orderId || event.notificationId || event.refundId
        || event.failureCode !== 'review_pending' || !subject.permissions.includes('rental-os:order:view')) throw unavailable();
      const row = await db.rentalInspectionRecord.findFirst({ where: { id: event.inspectionId, ...scope, orderId: event.orderId } });
      if (!row || row.id !== event.inspectionId || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
        || row.orderId !== event.orderId) throw unavailable();
      const source = returnExceptionSource(row, event.exceptionId);
      if (!source?.failed) throw unavailable();
      sourceRevision = source.revision;
      orderId = source.orderId;
      sourceHash = source.sourceHash;
    }
    if (sourceRevision !== event.resourceRevision || orderId !== event.orderId) throw unavailable();
    let orderLocations: string[] = [];
    if (orderId) {
      if (!subject.permissions.includes('rental-os:order:view')) throw unavailable();
      const order = await db.rentalOrder.findFirst({ where: { id: orderId, ...scope },
        select: { id: true, tenantId: true, workspaceId: true, fulfillmentLocationId: true, returnLocationId: true } });
      if (!order || order.id !== orderId || order.tenantId !== scope.tenantId || order.workspaceId !== scope.workspaceId) throw unavailable();
      orderLocations = [order.fulfillmentLocationId, ...(order.returnLocationId ? [order.returnLocationId] : [])];
      if (subject.locationScope.mode === 'selected') {
        const allowed = subject.locationScope.locationIds;
        if (orderLocations.some(location => !allowed.includes(location))) throw unavailable();
      }
    } else if (subject.locationScope.mode !== 'all') throw unavailable();
    const effectiveScope = { kind: 'workspace' as const, ...scope };
    const expectedScopes = [aiPersistenceScopeColumns({ kind: 'platform' }), aiPersistenceScopeColumns({ kind: 'tenant', tenantId: scope.tenantId }), aiPersistenceScopeColumns(effectiveScope)];
    const gates: Array<{ id: string; revision: number;
      key: { scopeId: string; scopeKind: ReturnType<typeof aiPersistenceScopeColumns>['kind']; sceneCode: string }; settings: AiUsageSettingsDraft }> = [];
    let scopeId = '';
    for (const expected of expectedScopes) {
      const storedScope = await db.aiScope.findFirst({ where: expected });
      if (!storedScope || Object.entries(expected).some(([key, value]) => storedScope[key as keyof typeof storedScope] !== value)) throw unavailable();
      if (expected.kind === 'WORKSPACE') scopeId = storedScope.id;
      const key = { scopeId: storedScope.id, scopeKind: storedScope.kind, sceneCode: policy.sceneCode };
      const row = await db.aiBudgetPolicy.findUnique({ where: { scopeId_scopeKind_sceneCode: key } });
      if (!row || Object.entries(key).some(([name, value]) => row[name as keyof typeof row] !== value)
        || row.enabled !== true || !revision.safeParse(row.configRevision).success) throw unavailable();
      const settings = structuredClone(row.settingsJson) as unknown as AiUsageSettingsDraft;
      validateBudgetSettings(settings);
      const requiredScope = expected.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId: scope.tenantId };
      if (requestFingerprint(settings.scope) !== requestFingerprint(requiredScope) || settings.sceneCode !== policy.sceneCode
        || !settings.allowedScenes.includes(policy.sceneCode) || !settings.allowedModels.length || settings.budget.state !== 'limited'
        || settings.maxConcurrent < 1 || settings.maxCallsPerRun < 1 || !Object.values(settings.gates).every(gate => gate.enabled)) throw unavailable();
      gates.push({ id: row.id, revision: row.configRevision, key, settings });
    }
    if (!gates[0].settings.allowedModels.some(model => gates.every(gate => gate.settings.allowedModels.includes(model)))) throw unavailable();
    const planKey = { scopeId, sceneCode: policy.sceneCode, sceneVersion: policy.sceneVersion };
    const plan = await db.aiTaskPlanPolicy.findFirst({ where: planKey });
    if (!plan || Object.entries(planKey).some(([name, value]) => plan[name as keyof typeof plan] !== value)
      || !plan.enabled || plan.expiresAt <= now || !revision.safeParse(plan.revision).success) throw unavailable();
    const limits = parse(aiTaskRunnerLimitsSchema, plan.limits), tools = parse(toolsSchema, plan.allowedTools);
    if (limits.maxStepMs > limits.maxTotalMs || gates.some(gate => limits.maxCalls > gate.settings.maxCallsPerRun
      || limits.maxConcurrent > gate.settings.maxConcurrent)) throw unavailable();
    const expiresAt = new Date(Math.min(subject.expiresAt.getTime(), policy.expiresAt.getTime(), event.expiresAt.getTime(), plan.expiresAt.getTime()));
    const context: AiExecutionContext = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: event.id,
      authorizedAt: now.toISOString(), audience: 'automation', scope: effectiveScope,
      actor: { kind: 'automation', subjectId: subject.id, policyId: policy.id, policyRevision: policy.revision, expiresAt: expiresAt.toISOString() },
      access: { dataScope: 'all', permissions: subject.permissions, locationScope: subject.locationScope } };
    const eventBase = { draftVersion: AI_EVENTS_DRAFT_VERSION, eventId: event.id, eventVersion: '1', scope: effectiveScope,
      occurredAt: event.occurredAt.toISOString(), traceId: event.traceId, causationId: event.causationId, deduplicationKey: event.deduplicationKey, causalDepth: 1 };
    const originalEvent = originalSource?.resourceEvent;
    const material = event.eventType === 'fulfillment.resource_shortage' && originalEvent?.type === event.eventType
      ? { ...eventBase, type: event.eventType, resource: { kind: 'order', id: originalEvent.resource.id, version: event.resourceRevision },
        payload: { dueAt: originalEvent.payload.dueAt, locationId: originalEvent.payload.locationId } }
      : event.eventType === 'opening.missing_configuration' && originalEvent?.type === event.eventType
        ? { ...eventBase, type: event.eventType, resource: { kind: 'configuration', id: originalEvent.resource.id, version: event.resourceRevision },
          payload: { sectionCode: originalEvent.payload.sectionCode } }
      : event.eventType === 'notification.failed'
      ? { ...eventBase, type: event.eventType, resource: { kind: 'notification', id: event.notificationId!, version: event.resourceRevision }, payload: { failureCode: 'delivery_failed' } }
      : event.eventType === 'refund.failed'
        ? { ...eventBase, type: event.eventType, resource: { kind: 'refund', id: event.refundId!, version: event.resourceRevision }, payload: { orderId: orderId!, failureCode: 'provider_failed' } }
        : { ...eventBase, type: event.eventType, resource: { kind: 'inspection', id: event.inspectionId!, version: event.resourceRevision }, payload: { orderId: orderId!, exceptionId: event.exceptionId! } };
    if (event.eventType === 'fulfillment.resource_shortage' || event.eventType === 'opening.missing_configuration') {
      // Budget/plan reads may outlive the first source check. Never return a
      // proposal/task input after the original resource or nine-item basis changed.
      await this.humanReads!.withEvent(eventRow!, async latest => {
        if (requestFingerprint(latest) !== requestFingerprint(originalSource)) throw unavailable();
      });
    }
    const policyEvidence = { ...policy, validFrom: policy.validFrom.toISOString(), expiresAt: policy.expiresAt.toISOString() };
    const subjectEvidence = { ...subject, expiresAt: subject.expiresAt.toISOString() };
    const materialHash = requestFingerprint({ subject: subjectEvidence, policy: policyEvidence, event: material, ...(sourceHash ? { sourceHash } : {}), expiresAt: expiresAt.toISOString(), orderLocations,
      scopeId, gates, plan: { ...planKey, revision: plan.revision, limits, tools, expiresAt: plan.expiresAt.toISOString() } });
    const key = { ...scope, policyId: policy.id, policyRevision: policy.revision, eventId: event.id };
    return { policy, subject, event, context, scopeId, expiresAt, key, materialHash,
      creationKey: requestFingerprint({ version: 'automation-creation-1', ...key, sceneCode: policy.sceneCode, sceneVersion: policy.sceneVersion }),
      payload: { version: 'automation-input-1', trust: 'untrusted_data', purpose: 'review_only', mode: policy.mode, event: material,
        subject: { id: subject.id, authorizationRevision: subject.authorizationRevision },
        policy: { id: policy.id, revision: policy.revision, sceneCode: policy.sceneCode, sceneVersion: policy.sceneVersion } } };
  }

  async snapshot(eventId: string) {
    try {
      const before = await this.inspect(eventId);
      const entitlement = await this.entitlements.check(before.context, 'ai.native.use');
      if (!entitlement.available) throw unavailable();
      const current = await this.inspect(eventId);
      if (before.materialHash !== current.materialHash) throw unavailable();
      const authorityHash = requestFingerprint({ materialHash: current.materialHash, entitlement });
      const payload = { ...current.payload, authorityHash };
      return { ...current, authorityHash, payload, inputHash: requestFingerprint(payload) };
    } catch (error) {
      if (error instanceof AutomationError) throw error;
      throw unavailable();
    }
  }

  verifyInput(row: AiAutomationInput, current: AutomationSnapshot) {
    const exact = { ...current.key, scopeId: current.scopeId, subjectId: current.subject.id,
      authorizationRevision: current.subject.authorizationRevision, resourceRevision: current.event.resourceRevision,
      deduplicationKey: current.event.deduplicationKey, sceneCode: current.policy.sceneCode, sceneVersion: current.policy.sceneVersion,
      creationKey: current.creationKey, authorityHash: current.authorityHash, inputHash: current.inputHash, inputRevision: 1 };
    if (Object.entries(exact).some(([name, value]) => row[name as keyof typeof row] !== value)
      || row.expiresAt.getTime() !== current.expiresAt.getTime() || requestFingerprint(row.payload) !== current.inputHash
      || row.reviewStatus !== 'open' || !['prepared', 'creation_unknown', 'linked'].includes(row.status)
      || (row.status === 'linked' ? !row.taskId || !row.runId : row.taskId !== null || row.runId !== null)) throw unavailable();
  }

  async input(inputRef: string) {
    if (!z.string().uuid().safeParse(inputRef).success) throw new AutomationError('invalid_input');
    const human = await this.humanReads?.current();
    const inputKey = { id: inputRef, policyId: this.policyId, ...(human ? human.scope : {}) };
    const row = await this.db.aiAutomationInput.findFirst({ where: inputKey });
    if (!row || row.id !== inputRef) throw unavailable();
    const current = await this.snapshot(row.eventId);
    this.verifyInput(row, current);
    const again = await this.db.aiAutomationInput.findFirst({ where: inputKey });
    if (!again || again.id !== inputRef) throw unavailable();
    const latest = await this.snapshot(again.eventId);
    if (latest.authorityHash !== current.authorityHash) throw unavailable();
    this.verifyInput(again, latest);
    return { row: again, snapshot: latest };
  }

  async resolve(sceneCode: string, inputRef: string) {
    const { row, snapshot } = await this.input(inputRef);
    if (sceneCode !== row.sceneCode) throw unavailable();
    return { context: { ...snapshot.context, requestId: row.id }, creationAllowed: true as const,
      sceneCode: row.sceneCode, sceneVersion: row.sceneVersion, inputRef: row.id, inputRevision: row.inputRevision, inputHash: row.inputHash };
  }
}
