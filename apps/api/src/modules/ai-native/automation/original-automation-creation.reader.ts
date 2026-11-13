/** Reads an original automation creation receipt under current human business
 * read access. Frozen inputs and the original owner/Run prove history; no current
 * policy, entitlement, anomaly check, input mutation or creation is performed. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION, AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT,
  type AiBusinessEventDraft, type AiExecutionContext, type AiAutomationTaskCreationObservationDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskCreationRepository } from '../ai-task-creation.repository';
import { aiTaskAccessFromContext } from '../ai-task.repository';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import type { BusinessFailureReadAuthority } from '../business-events/business-failure-read.authority';
import { AutomationError } from './prisma-automation.authority';

const uuid = z.string().uuid(), id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
const revision = z.number().int().min(1).max(4294967294), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const instant = z.date().refine(value => Number.isFinite(value.getTime()));
const command = z.object({ inputRef: uuid }).strict();
const payloadSchema = z.object({ version: z.literal('automation-input-1'), trust: z.literal('untrusted_data'),
  purpose: z.literal('review_only'), mode: z.enum(['shadow', 'manual_confirmation']), event: z.unknown(),
  subject: z.object({ id: id.max(36), authorizationRevision: revision }).strict(),
  policy: z.object({ id: id.max(36), revision, sceneCode: id.max(64), sceneVersion: id.max(64) }).strict(),
  authorityHash: hash }).strict();
const selectedTask = { id: true, scopeId: true, scopeKind: true, audience: true, ownerKind: true, ownerId: true,
  policyId: true, policyRevision: true, policyExpiresAt: true, creationKey: true, creationFingerprint: true,
  sceneCode: true, sceneVersion: true, inputRef: true, inputHash: true, inputRevision: true, traceId: true,
  contractVersion: true, status: true, revision: true, archivedAt: true,
  runs: { where: { sequence: 1 }, take: 2,
    select: { id: true, scopeId: true, taskId: true, sequence: true, actorKind: true, actorId: true, authorizedAt: true } }
} satisfies Prisma.AiTaskSelect;
type Task = Prisma.AiTaskGetPayload<{ select: typeof selectedTask }>;
type Db = Pick<PrismaClient, '$transaction' | 'aiAutomationInput' | 'aiBusinessFailureOutbox' | 'aiScope' | 'aiTask'>;
const semantics = { dispatchRequested: false as const, confirmationGranted: false as const,
  semantics: 'metadata_only_not_execution_permission' as const };
const unavailable = () => new AutomationError('unavailable');
// Dates must retain their recorded instants in delivery checks. This does not
// change the legacy creation/input fingerprint normalization.
const originalFingerprint = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
type Target = Awaited<ReturnType<OriginalAutomationCreationReader['load']>>;

export class OriginalAutomationCreationReader {
  constructor(private readonly db: Db, private readonly reads: BusinessFailureReadAuthority,
    private readonly clock: () => Date = () => new Date()) {}

  private async load(inputRef: string) {
    const { context, scope } = await this.reads.current(), now = this.clock();
    if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
      || !['operator', 'staff'].includes(context.audience) || !('access' in context) || !instant.safeParse(now).success) throw unavailable();
    const row = structuredClone(await this.db.aiAutomationInput.findFirst({ where: { id: inputRef, ...scope } }));
    if (!row || row.id !== inputRef || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
      || !id.max(36).safeParse(row.scopeId).success || row.inputRevision !== 1 || !revision.safeParse(row.reviewRevision).success
      || !['prepared', 'creation_unknown', 'linked'].includes(row.status) || !['open', 'closed'].includes(row.reviewStatus)
      || !instant.safeParse(row.expiresAt).success || !hash.safeParse(row.inputHash).success
      || !hash.safeParse(row.authorityHash).success || !hash.safeParse(row.deduplicationKey).success
      || !hash.safeParse(row.creationKey).success || !uuid.safeParse(row.eventId).success) throw unavailable();
    const payload = payloadSchema.safeParse(row.payload);
    if (!payload.success || requestFingerprint(row.payload) !== row.inputHash || payload.data.authorityHash !== row.authorityHash
      || payload.data.subject.id !== row.subjectId || payload.data.subject.authorizationRevision !== row.authorizationRevision
      || payload.data.policy.id !== row.policyId || payload.data.policy.revision !== row.policyRevision
      || payload.data.policy.sceneCode !== row.sceneCode || payload.data.policy.sceneVersion !== row.sceneVersion
      || row.creationKey !== requestFingerprint({ version: 'automation-creation-1', ...scope, policyId: row.policyId,
        policyRevision: row.policyRevision, eventId: row.eventId, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion })) throw unavailable();
    const columns = aiPersistenceScopeColumns(context.scope);
    const storedScope = structuredClone(await this.db.aiScope.findFirst({ where: { id: row.scopeId, ...columns } }));
    if (!storedScope || storedScope.id !== row.scopeId
      || Object.entries(columns).some(([key, value]) => storedScope[key as keyof typeof storedScope] !== value)) throw unavailable();
    const event = structuredClone(await this.db.aiBusinessFailureOutbox.findFirst({ where: { id: row.eventId, ...scope } }));
    if (!event || event.id !== row.eventId || event.tenantId !== scope.tenantId || event.workspaceId !== scope.workspaceId
      || event.resourceRevision !== row.resourceRevision || event.deduplicationKey !== row.deduplicationKey
      || !instant.safeParse(event.expiresAt).success || row.expiresAt > event.expiresAt) throw unavailable();
    let task: Task | null = null, taskReadable = true;
    try {
      // Do not filter a wrong owner into apparent absence. The frozen input's
      // original owner, policy and first Run are checked explicitly below.
      task = structuredClone(await this.db.aiTask.findFirst({ where: { scopeId: row.scopeId, creationKey: row.creationKey }, select: selectedTask }));
    } catch { taskReadable = false; }
    if (row.status === 'linked' ? !uuid.safeParse(row.taskId).success || !uuid.safeParse(row.runId).success
      : row.taskId !== null || row.runId !== null) throw unavailable();
    if (task) {
      const expected = { scopeId: row.scopeId, scopeKind: 'WORKSPACE', audience: 'AUTOMATION', ownerKind: 'AUTOMATION', ownerId: row.subjectId,
        policyId: row.policyId, policyRevision: row.policyRevision, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion,
        inputRef: row.id, inputHash: row.inputHash, inputRevision: row.inputRevision, creationKey: row.creationKey,
        traceId: row.id, contractVersion: AI_TASK_DRAFT_VERSION };
      if (Object.entries(expected).some(([key, value]) => task![key as keyof Task] !== value)
        || !uuid.safeParse(task.id).success || !instant.safeParse(task.policyExpiresAt).success
        || task.policyExpiresAt!.getTime() !== row.expiresAt.getTime() || !revision.safeParse(task.revision).success
        || !z.enum(AI_TASK_STATUSES_DRAFT).safeParse(task.status.toLowerCase()).success || task.runs.length !== 1) throw unavailable();
      const run = task.runs[0];
      if (!uuid.safeParse(run.id).success || run.scopeId !== row.scopeId || run.taskId !== task.id || run.sequence !== 1
        || run.actorKind !== 'AUTOMATION' || run.actorId !== row.subjectId || !instant.safeParse(run.authorizedAt).success
        || run.authorizedAt > now || run.authorizedAt >= row.expiresAt) throw unavailable();
      const ownership = JSON.stringify([columns, 'automation', 'AUTOMATION', row.subjectId,
        [row.policyId, row.policyRevision, row.expiresAt.toISOString()]]);
      if (task.creationFingerprint !== requestFingerprint({ version: 'ai-task-creation-1', scope: columns,
        audience: 'AUTOMATION', ownerKind: 'AUTOMATION', ownerId: row.subjectId, authorizationBinding: ownership,
        sceneCode: row.sceneCode, sceneVersion: row.sceneVersion, inputRef: row.id, inputRevision: row.inputRevision, inputHash: row.inputHash })) throw unavailable();
    }
    if (taskReadable && row.status === 'linked' && (!task || row.taskId !== task.id || row.runId !== task.runs[0].id)) throw unavailable();
    const principal = requestFingerprint({ actor: context.actor, audience: context.audience, scope: context.scope, access: context.access });
    return { row, event, storedScope, task, taskReadable, context, principal };
  }

  async readCreation(value: unknown): Promise<AiAutomationTaskCreationObservationDraft> {
    const parsed = command.safeParse(value);
    if (!parsed.success) throw new AutomationError('invalid_input');
    const inputRef = parsed.data.inputRef, before = await this.load(inputRef);
    const snapshot = (target: Target) => originalFingerprint({ row: target.row, event: target.event,
      scope: target.storedScope, task: target.task, taskReadable: target.taskReadable, principal: target.principal });
    const expected = snapshot(before);
    const currentTarget = async (original: AiBusinessEventDraft) => {
      const current = await this.load(inputRef);
      if (snapshot(current) !== expected) throw new AutomationError('result_unknown');
      const payload = payloadSchema.parse(current.row.payload);
      if (requestFingerprint(payload.event) !== requestFingerprint(original)) throw unavailable();
      const latest = (await this.reads.current()).context;
      if (requestFingerprint({ actor: latest.actor, audience: latest.audience, scope: latest.scope,
        access: 'access' in latest ? latest.access : null }) !== current.principal) throw unavailable();
      return current;
    };
    const uncertain = () => ({ state: 'unknown' as const, inputRef, inputStatus: before.row.status as 'prepared' | 'creation_unknown' | 'linked',
      creationKey: before.row.creationKey, retryable: false as const, nextAction: 'reconcile' as const, task: null, ...semantics });
    return this.reads.withOriginalEvent(before.event, async original => {
      const target = await currentTarget(original);
      let result: AiAutomationTaskCreationObservationDraft;
      if (!target.taskReadable) result = uncertain();
      else if (!target.task) result = { ...uncertain(), state: 'not_observed' };
      else {
        const run = target.task.runs[0], historicalAt = new Date(run.authorizedAt);
        // The private receipt reader validates the ORIGINAL Run instant,
        // without extending its expiry. Current human access is rechecked
        // around it and after the final business Guard; no grant escapes.
        const receipt = AiTaskCreationRepository.receiptReader(this.db, { resolve: async (sceneCode, reference) => {
          const current = await currentTarget(original);
          if (!current.task || sceneCode !== current.row.sceneCode || reference !== current.row.id) throw unavailable();
          const context: AiExecutionContext = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: current.row.id,
            authorizedAt: historicalAt.toISOString(), audience: 'automation', scope: current.context.scope,
            actor: { kind: 'automation', subjectId: current.row.subjectId, policyId: current.row.policyId,
              policyRevision: current.row.policyRevision, expiresAt: current.row.expiresAt.toISOString() }, access: current.context.access };
          aiTaskAccessFromContext(context, current.row.creationKey, historicalAt);
          return { context, sceneCode: current.row.sceneCode, sceneVersion: current.row.sceneVersion,
            inputRef: current.row.id, inputRevision: current.row.inputRevision, inputHash: current.row.inputHash };
        } }, () => new Date(historicalAt));
        const observed = await receipt.readCreation({ inputRef, sceneCode: target.row.sceneCode, creationKey: target.row.creationKey });
        if (observed.state !== 'observed') result = uncertain();
        else {
          if (observed.creationKey !== target.row.creationKey || observed.task.taskId !== target.task.id
            || observed.task.runId !== run.id || observed.task.status !== target.task.status.toLowerCase()
            || observed.task.revision !== target.task.revision || observed.task.replayed !== true) throw new AutomationError('result_unknown');
          result = { ...uncertain(), state: 'observed', nextAction: 'read_original_task', task: { ...observed.task,
            status: z.enum(AI_TASK_STATUSES_DRAFT).parse(observed.task.status) } };
        }
      }
      await currentTarget(original);
      return result;
    }, undefined, async original => { await currentTarget(original); });
  }
}
