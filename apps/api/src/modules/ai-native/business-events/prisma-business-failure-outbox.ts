import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AiBusinessFailureOutbox, Prisma } from '@prisma/client';
import { AI_EVENTS_DRAFT_VERSION, type AiBusinessEventDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { returnExceptionSource } from './return-exception-source';

export const BUSINESS_FAILURE_OUTBOX = Symbol('BUSINESS_FAILURE_OUTBOX');
export type FailureScope = { tenantId: string; workspaceId: string };
export interface BusinessFailureOutboxParticipant {
  notification(tx: Prisma.TransactionClient, scope: FailureScope, id: string): Promise<void>;
  refund(tx: Prisma.TransactionClient, scope: FailureScope, id: string): Promise<void>;
  inspection?(tx: Prisma.TransactionClient, scope: FailureScope, id: string): Promise<void>;
  fulfillment?(tx: Prisma.TransactionClient, scope: FailureScope, orderId: string): Promise<ResourceFailureCapture>;
  opening?(tx: Prisma.TransactionClient, scope: FailureScope, configuration: ConfigurationFailureOrigin, sectionCode: string): Promise<ResourceFailureCapture>;
  openingConfiguration?(tx: Prisma.TransactionClient, scope: FailureScope, configuration: ConfigurationFailureOrigin): Promise<ResourceFailureCapture[]>;
}
export class BusinessFailureError extends Error {
  constructor(readonly code: 'unavailable' | 'conflict' | 'not_ready' | 'result_unknown' | 'invalid_input') { super(code); }
}

const resourceId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
const resourceRevision = z.number().int().min(1).max(4294967294);
const sourceHash = z.string().regex(/^[a-f0-9]{64}$/u);
const resourceTime = z.string().max(40).datetime({ offset: true });
const resourceScope = z.object({ tenantId: resourceId, workspaceId: resourceId }).strict();
export const configurationFailureOriginSchema = z.object({
  kind: z.enum(['tenant_profile', 'core_snapshot', 'business_settings']), id: resourceId
}).strict();
export type ConfigurationFailureOrigin = z.infer<typeof configurationFailureOriginSchema>;
const openingSection = z.enum(['workspace_profile', 'accounts_roles', 'fulfillment_network', 'business_rule',
  'business_calendar', 'item_groups', 'pricing_groups_rates', 'price_version', 'membership_base']);
const fulfillmentObservation = z.object({ scope: resourceScope, orderId: resourceId, assignmentRevision: resourceRevision,
  dueAt: resourceTime, locationId: resourceId, state: z.enum(['shortage', 'deliverable', 'unavailable']), sourceHash,
  policy: z.object({ id: resourceId, revision: resourceRevision, validFrom: resourceTime, expiresAt: resourceTime,
    lookAheadMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict().nullable()
}).strict();
const openingObservation = z.object({ scope: resourceScope,
  configuration: configurationFailureOriginSchema.extend({ rowRevision: resourceRevision }), defaultWorkspaceId: resourceId.nullable(), sourceHash,
  sections: z.array(z.object({ key: openingSection, state: z.enum(['missing', 'ready', 'unavailable']) }).strict()).length(9)
    .refine(rows => new Set(rows.map(row => row.key)).size === 9)
}).strict();
const resourceReferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('order_assignment'), id: resourceId, rowRevision: resourceRevision, sourceHash,
    dueAt: resourceTime, locationId: resourceId, policyId: resourceId, policyRevision: resourceRevision }).strict(),
  configurationFailureOriginSchema.extend({ rowRevision: resourceRevision, sourceHash, sectionCode: openingSection })
]);
export type ResourceFailureReference = z.infer<typeof resourceReferenceSchema>;
type ResourceFailureEventRow = Pick<AiBusinessFailureOutbox, 'id' | 'tenantId' | 'workspaceId' | 'eventType' | 'notificationId'
  | 'refundId' | 'inspectionId' | 'exceptionId' | 'orderId' | 'resourceRevision' | 'failureCode' | 'occurredAt'
  | 'traceId' | 'causationId' | 'deduplicationKey'>;
export type ResourceFailureCapture = { state: 'captured'; eventId: string } | {
  state: 'not_captured'; reason: 'source_unavailable' | 'not_current_failure';
};

/** Application-only bridge to original Core checks and versioned Outbox columns.
 * Readers return persisted references and current deterministic evidence, never
 * model/browser claims. The storage implementation must verify the forward
 * schema and use the supplied business transaction; no legacy-column fallback.
 * Opening reads revalidate the source; when capturing they retain the caller's
 * transaction, while ordinary current reads remain independent observations. */
export interface BusinessFailureResourcePorts {
  readFulfillment(scope: FailureScope, orderId: string, tx?: Prisma.TransactionClient): Promise<unknown>;
  readOpening(scope: FailureScope, configuration: ConfigurationFailureOrigin, tx?: Prisma.TransactionClient): Promise<unknown>;
  readBinding(event: AiBusinessFailureOutbox, tx?: Prisma.TransactionClient): Promise<unknown>;
  assertStorage(tx: Prisma.TransactionClient): Promise<void>;
  append(tx: Prisma.TransactionClient, input: { event: AiBusinessEventDraft; reference: ResourceFailureReference;
    expiresAt: Date; failureCode: 'resource_shortage' | 'missing_configuration' }): Promise<AiBusinessFailureOutbox>;
}

const parseResource = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(structuredClone(value));
  if (!parsed.success) throw new BusinessFailureError('unavailable');
  return parsed.data;
};
export function requireBusinessFailureResourcePorts(ports?: BusinessFailureResourcePorts) {
  if (ports && ['readFulfillment', 'readOpening', 'readBinding', 'assertStorage', 'append']
    .some(name => typeof ports[name as keyof BusinessFailureResourcePorts] !== 'function')) throw new BusinessFailureError('unavailable');
  return ports;
}
export const isResourceFailureEvent = (event: AiBusinessFailureOutbox) =>
  event.eventType === 'fulfillment.resource_shortage' || event.eventType === 'opening.missing_configuration';

export async function readBusinessFailureResourceBinding(event: AiBusinessFailureOutbox, ports: BusinessFailureResourcePorts,
  tx?: Prisma.TransactionClient): Promise<ResourceFailureReference> {
  const stored = parseResource(z.object({ eventId: z.string().uuid(), scope: resourceScope, reference: resourceReferenceSchema }).strict(),
    await ports.readBinding(event, tx));
  if (stored.eventId !== event.id || stored.scope.tenantId !== event.tenantId || stored.scope.workspaceId !== event.workspaceId
    || stored.reference.rowRevision !== event.resourceRevision || event.notificationId || event.refundId || event.inspectionId || event.exceptionId)
    throw new BusinessFailureError('unavailable');
  resourceFailureEvent(event, stored.reference);
  return stored.reference;
}

export async function readBusinessFailureResource(scope: FailureScope, reference: ResourceFailureReference,
  ports: BusinessFailureResourcePorts, now: Date, tx?: Prisma.TransactionClient) {
  if (!Number.isFinite(now.getTime())) throw new BusinessFailureError('unavailable');
  if (reference.kind === 'order_assignment') {
    const source = parseResource(fulfillmentObservation, await ports.readFulfillment(scope, reference.id, tx));
    if (requestFingerprint(source.scope) !== requestFingerprint(scope) || source.orderId !== reference.id
      || source.state === 'unavailable' || !source.policy) throw new BusinessFailureError('unavailable');
    const policy = source.policy, dueAt = Date.parse(source.dueAt), expiresAt = Date.parse(policy.expiresAt);
    if (Date.parse(policy.validFrom) >= expiresAt) throw new BusinessFailureError('unavailable');
    const current = Date.parse(policy.validFrom) <= now.getTime() && expiresAt > now.getTime()
      && dueAt > now.getTime() && dueAt - now.getTime() <= policy.lookAheadMs;
    const currentReference: ResourceFailureReference = { kind: reference.kind, id: source.orderId, rowRevision: source.assignmentRevision,
      sourceHash: requestFingerprint({ basis: source.sourceHash, policy }), dueAt: source.dueAt, locationId: source.locationId,
      policyId: policy.id, policyRevision: policy.revision };
    return { revision: source.assignmentRevision, failed: current && source.state === 'shortage', orderId: source.orderId,
      sourceHash: requestFingerprint(currentReference), capturedSourceHash: requestFingerprint(reference),
      reference: currentReference, expiresAt: new Date(Math.min(dueAt, expiresAt)) };
  }
  const origin = { kind: reference.kind, id: reference.id };
  const source = parseResource(openingObservation, await ports.readOpening(scope, origin, tx));
  if (requestFingerprint(source.scope) !== requestFingerprint(scope) || source.configuration.kind !== origin.kind
    || source.configuration.id !== origin.id || origin.kind === 'core_snapshot' && origin.id !== scope.workspaceId
    || origin.kind === 'tenant_profile' && (origin.id !== scope.tenantId || source.defaultWorkspaceId !== scope.workspaceId))
    throw new BusinessFailureError('unavailable');
  const section = source.sections.find(row => row.key === reference.sectionCode);
  if (!section || section.state === 'unavailable') throw new BusinessFailureError('unavailable');
  const currentReference: ResourceFailureReference = { ...source.configuration, sourceHash: source.sourceHash, sectionCode: section.key };
  return { revision: source.configuration.rowRevision, failed: section.state === 'missing', orderId: null,
    sourceHash: requestFingerprint(currentReference), capturedSourceHash: requestFingerprint(reference),
    reference: currentReference, expiresAt: new Date(now.getTime() + 86400000) };
}

export function resourceFailureEvent(row: ResourceFailureEventRow, reference: ResourceFailureReference): AiBusinessEventDraft {
  if (row.notificationId || row.refundId || row.inspectionId || row.exceptionId || row.resourceRevision !== reference.rowRevision)
    throw new BusinessFailureError('unavailable');
  const base = { draftVersion: AI_EVENTS_DRAFT_VERSION, eventId: row.id, eventVersion: '1' as const,
    scope: { kind: 'workspace' as const, tenantId: row.tenantId, workspaceId: row.workspaceId }, occurredAt: row.occurredAt.toISOString(),
    traceId: row.traceId, causationId: row.causationId, deduplicationKey: row.deduplicationKey, causalDepth: 1 };
  if (reference.kind === 'order_assignment' && row.eventType === 'fulfillment.resource_shortage'
    && row.orderId === reference.id && row.failureCode === 'resource_shortage') return { ...base, type: row.eventType,
    resource: { kind: 'order', id: reference.id, version: reference.rowRevision }, payload: { dueAt: reference.dueAt, locationId: reference.locationId } };
  if (reference.kind !== 'order_assignment' && row.eventType === 'opening.missing_configuration'
    && row.orderId === null && row.failureCode === 'missing_configuration') return { ...base, type: row.eventType,
    resource: { kind: 'configuration', id: reference.id, version: reference.rowRevision }, payload: { sectionCode: reference.sectionCode } };
  throw new BusinessFailureError('unavailable');
}

export class PrismaBusinessFailureOutbox implements BusinessFailureOutboxParticipant {
  constructor(private readonly clock: () => Date = () => new Date(), private readonly resources?: BusinessFailureResourcePorts) {
    requireBusinessFailureResourcePorts(resources);
  }

  async fulfillment(tx: Prisma.TransactionClient, scope: FailureScope, orderId: string): Promise<ResourceFailureCapture> {
    if (!this.resources) return { state: 'not_captured', reason: 'source_unavailable' };
    const raw = await this.resources.readFulfillment(scope, orderId, tx);
    if (raw === null || raw === undefined) return { state: 'not_captured', reason: 'source_unavailable' };
    const source = parseResource(fulfillmentObservation, raw);
    if (requestFingerprint(source.scope) !== requestFingerprint(scope) || source.orderId !== orderId) throw new BusinessFailureError('unavailable');
    if (source.state === 'unavailable' || !source.policy) return { state: 'not_captured', reason: 'source_unavailable' };
    const reference: ResourceFailureReference = { kind: 'order_assignment', id: orderId, rowRevision: source.assignmentRevision,
      sourceHash: requestFingerprint({ basis: source.sourceHash, policy: source.policy }), dueAt: source.dueAt,
      locationId: source.locationId, policyId: source.policy.id, policyRevision: source.policy.revision };
    return this.captureResource(tx, scope, reference);
  }

  async opening(tx: Prisma.TransactionClient, scope: FailureScope, configuration: ConfigurationFailureOrigin,
    sectionCode: string): Promise<ResourceFailureCapture> {
    if (!this.resources) return { state: 'not_captured', reason: 'source_unavailable' };
    const origin = parseResource(configurationFailureOriginSchema, configuration), section = parseResource(openingSection, sectionCode);
    const raw = await this.resources.readOpening(scope, origin, tx);
    if (raw === null || raw === undefined) return { state: 'not_captured', reason: 'source_unavailable' };
    const source = parseResource(openingObservation, raw);
    if (requestFingerprint(source.scope) !== requestFingerprint(scope) || source.configuration.kind !== origin.kind
      || source.configuration.id !== origin.id) throw new BusinessFailureError('unavailable');
    return this.captureResource(tx, scope, { ...source.configuration, sourceHash: source.sourceHash, sectionCode: section });
  }

  /** A configuration save observes the existing nine-section check once to
   * select actual missing sections. Every append still rechecks its same source
   * in the caller's transaction; unavailable sections never become failures. */
  async openingConfiguration(tx: Prisma.TransactionClient, scope: FailureScope,
    configuration: ConfigurationFailureOrigin): Promise<ResourceFailureCapture[]> {
    if (!this.resources) return [{ state: 'not_captured', reason: 'source_unavailable' }];
    const origin = parseResource(configurationFailureOriginSchema, configuration);
    const raw = await this.resources.readOpening(scope, origin, tx);
    if (raw === null || raw === undefined) return [{ state: 'not_captured', reason: 'source_unavailable' }];
    const source = parseResource(openingObservation, raw);
    if (requestFingerprint(source.scope) !== requestFingerprint(scope) || source.configuration.kind !== origin.kind
      || source.configuration.id !== origin.id) throw new BusinessFailureError('unavailable');
    const results: ResourceFailureCapture[] = [];
    for (const section of source.sections) {
      if (section.state !== 'missing') continue;
      results.push(await this.captureResource(tx, scope, { ...source.configuration,
        sourceHash: source.sourceHash, sectionCode: section.key }));
    }
    return results;
  }

  private async captureResource(tx: Prisma.TransactionClient, scope: FailureScope, reference: ResourceFailureReference): Promise<ResourceFailureCapture> {
    const ports = this.resources!, now = this.clock(), source = await readBusinessFailureResource(scope, reference, ports, now, tx);
    if (!source.failed) return { state: 'not_captured', reason: 'not_current_failure' };
    if (requestFingerprint(source.reference) !== requestFingerprint(reference)) throw new BusinessFailureError('conflict');
    await ports.assertStorage(tx);
    const traceId = requestFingerprint({ ...scope, kind: reference.kind, id: reference.id,
      ...(reference.kind === 'order_assignment' ? {} : { sectionCode: reference.sectionCode }) });
    const causationId = requestFingerprint({ traceId, reference }), eventType = reference.kind === 'order_assignment'
      ? 'fulfillment.resource_shortage' : 'opening.missing_configuration';
    const failureCode = reference.kind === 'order_assignment' ? 'resource_shortage' : 'missing_configuration';
    const row = { ...scope, id: randomUUID(), eventType, notificationId: null, refundId: null, inspectionId: null, exceptionId: null,
      orderId: source.orderId, resourceRevision: source.revision, failureCode, occurredAt: now, traceId, causationId,
      deduplicationKey: requestFingerprint({ eventType, causationId }) };
    // Once append is attempted, a lost receipt is not permission to retry with
    // another event or overwrite the original immutable reference.
    let saved: AiBusinessFailureOutbox;
    try {
      saved = await ports.append(tx, { event: resourceFailureEvent(row, reference), reference,
        expiresAt: source.expiresAt, failureCode });
      const stored = await readBusinessFailureResourceBinding(saved, ports, tx);
      if (saved.tenantId !== scope.tenantId || saved.workspaceId !== scope.workspaceId || saved.eventType !== eventType
        || saved.traceId !== traceId || saved.causationId !== causationId || saved.deduplicationKey !== row.deduplicationKey
        || requestFingerprint(stored) !== requestFingerprint(reference) || saved.occurredAt > now || saved.expiresAt > source.expiresAt)
        throw new BusinessFailureError('result_unknown');
      const latest = await readBusinessFailureResource(scope, reference, ports, this.clock(), tx);
      if (!latest.failed || requestFingerprint(latest.reference) !== requestFingerprint(reference)) throw new BusinessFailureError('result_unknown');
    } catch { throw new BusinessFailureError('result_unknown'); }
    return { state: 'captured', eventId: saved.id };
  }

  async notification(tx: Prisma.TransactionClient, scope: FailureScope, id: string) {
    const row = await tx.rentalNotificationLog.findFirst({ where: { id, ...scope }, select: {
      id: true, tenantId: true, workspaceId: true, revision: true, status: true, provider: true,
      nextAttemptAt: true, businessObjectType: true, businessObjectId: true } });
    if (!row || row.id !== id || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId) throw new BusinessFailureError('unavailable');
    if (!['failed', 'delivery_failed'].includes(row.status) || row.status === 'failed' && row.nextAttemptAt !== null
      || ['mock', 'local_mock', 'simulation'].includes(row.provider)) return;
    await this.append(tx, scope, { kind: 'notification', id, revision: row.revision,
      orderId: row.businessObjectType === 'order' ? row.businessObjectId : null });
  }

  async refund(tx: Prisma.TransactionClient, scope: FailureScope, id: string) {
    const row = await tx.rentalPaymentRefund.findFirst({ where: { id, ...scope }, select: {
      id: true, tenantId: true, workspaceId: true, revision: true, status: true, orderId: true,
      succeededAt: true, fundedAt: true, provider: true } });
    if (!row || row.id !== id || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId) throw new BusinessFailureError('unavailable');
    if (row.status !== 'failed' || row.succeededAt || row.fundedAt || ['mock', 'local_mock', 'simulation'].includes(row.provider)) return;
    await this.append(tx, scope, { kind: 'refund', id, revision: row.revision, orderId: row.orderId });
  }

  async inspection(tx: Prisma.TransactionClient, scope: FailureScope, id: string) {
    const row = await tx.rentalInspectionRecord.findFirst({ where: { id, ...scope } });
    if (!row || row.id !== id || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId) throw new BusinessFailureError('unavailable');
    if (row.stage !== 'return') return;
    if (!Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision > 4294967294 || !Array.isArray(row.exceptions)) throw new BusinessFailureError('unavailable');
    await tx.aiBusinessFailureOutbox.updateMany({ where: { ...scope, inspectionId: id, resourceRevision: { not: row.revision },
      status: { in: ['pending', 'claimed', 'retry_scheduled', 'ready'] } }, data: {
      status: 'expired', fence: { increment: 1 }, leaseOwner: null, leaseUntil: null, lastErrorCode: 'resource_changed_or_expired' } });
    for (const exception of row.exceptions) {
      if (!exception || typeof exception !== 'object' || Array.isArray(exception) || typeof exception.id !== 'string') continue;
      const source = returnExceptionSource(row, exception.id);
      if (!source) throw new BusinessFailureError('unavailable');
      if (!source.failed) continue;
      const previous = await tx.aiBusinessFailureOutbox.findFirst({ where: { ...scope, inspectionId: id, exceptionId: exception.id,
        OR: [{ status: 'closed' }, { automationInputs: { some: {} } }] } });
      if (previous) continue;
      const now = this.clock();
      if (!Number.isFinite(now.getTime())) throw new BusinessFailureError('unavailable');
      const eventType = 'inspection.return_exception';
      const traceId = requestFingerprint({ ...scope, inspectionId: id, exceptionId: exception.id });
      const causationId = requestFingerprint({ traceId, revision: row.revision });
      const deduplicationKey = requestFingerprint({ eventType, causationId });
      await tx.aiBusinessFailureOutbox.upsert({ where: { tenantId_workspaceId_deduplicationKey: { ...scope, deduplicationKey } }, update: {},
        create: { ...scope, id: randomUUID(), eventType, inspectionId: id, exceptionId: exception.id, orderId: row.orderId,
          notificationId: null, refundId: null,
          resourceRevision: row.revision, failureCode: 'review_pending', traceId, causationId, deduplicationKey,
          occurredAt: now, expiresAt: new Date(now.getTime() + 86400000), nextAttemptAt: now } });
    }
  }

  private async append(tx: Prisma.TransactionClient, scope: FailureScope,
    source: { kind: 'notification' | 'refund'; id: string; revision: number; orderId: string | null }) {
    if (!Number.isSafeInteger(source.revision) || source.revision < 1) throw new BusinessFailureError('unavailable');
    const now = this.clock();
    if (!Number.isFinite(now.getTime())) throw new BusinessFailureError('unavailable');
    const traceId = requestFingerprint({ ...scope, kind: source.kind, id: source.id });
    const causationId = requestFingerprint({ traceId, revision: source.revision });
    const eventType = source.kind === 'notification' ? 'notification.failed' : 'refund.failed';
    const deduplicationKey = requestFingerprint({ eventType, causationId });
    await tx.aiBusinessFailureOutbox.upsert({ where: { tenantId_workspaceId_deduplicationKey: { ...scope, deduplicationKey } },
      update: {}, create: { ...scope, id: randomUUID(), eventType,
        notificationId: source.kind === 'notification' ? source.id : null, refundId: source.kind === 'refund' ? source.id : null,
        inspectionId: null, exceptionId: null,
        resourceRevision: source.revision, orderId: source.orderId, failureCode: source.kind === 'notification' ? 'delivery_failed' : 'provider_failed',
        traceId, causationId, deduplicationKey, occurredAt: now, expiresAt: new Date(now.getTime() + 86400000), nextAttemptAt: now } });
  }
}
