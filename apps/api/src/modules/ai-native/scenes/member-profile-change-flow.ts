/** Tenant-member discovery -> explicit person -> original ordinary-name workflow.
 * Reuses the membership Guard and the real profile change/Task/approval/Core
 * services. No booking/order permission, automatic same-name choice, full-profile
 * save, approval, policy creation or replacement of an unknown operation. */
import { HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { MembershipService } from '../../platform/membership.service';
import { ApprovedProfileRouteAuthority, type ApprovedProfileActor } from '../../platform/approved-profile-route.authority';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import type { AiSceneHttpRequest, composeRequestBoundProfileWorkflow } from './request-bound-scenes.application';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9._:-]+$/u), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const query = z.object({ limit: z.number().int().min(1).max(50), name: z.string().trim().min(1).max(191).optional(),
  customerId: id.optional(), cursor: id.optional() }).strict();
const locator = z.object({ customerId: id, requestKey: id.max(128) }).strict();
const intent = locator.extend({ query, selectionHash: hash, name: z.string().trim().min(1).refine(value => Array.from(value).length <= 120),
  expiresAt: z.string().datetime({ offset: true }) }).strict();
const preparation = intent.extend({ reviewHash: hash }).strict();
const member = z.object({ customerId: id, name: z.string().min(1).max(191), phoneMasked: z.string().max(64)
  .refine(value => value === '' || /^[0-9]{0,3}\*{3,}[0-9]{0,4}$/u.test(value)),
  membershipStatus: z.enum(['pending_activation', 'active', 'suspended', 'risk_restricted', 'exited', 'closed']) }).strict();
type Profiles = Pick<ReturnType<typeof composeRequestBoundProfileWorkflow>, 'readCurrent' | 'prepareChange' | 'readChange'
  | 'createTask' | 'readCreation' | 'start'>;
const parse = <S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> => {
  const parsed = schema.safeParse(structuredClone(value));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(parsed.data);
};

export function composeMemberProfileChangeFlow(input: { guard: Pick<ApiAuthGuard, 'canActivate'>;
  memberships: Pick<MembershipService, 'listPersonalProfileCandidatesPage'>; profiles: Profiles;
  db: Pick<PrismaClient, 'customerApprovedProfileChange'>; clock?: () => Date }) {
  for (const method of [input.guard?.canActivate, input.memberships?.listPersonalProfileCandidatesPage,
    input.profiles?.readCurrent, input.profiles?.prepareChange, input.profiles?.readChange,
    input.profiles?.createTask, input.profiles?.readCreation, input.profiles?.start,
    input.db?.customerApprovedProfileChange?.findUnique]) {
    if (typeof method !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
  const clock = input.clock ?? (() => new Date());
  const bind = (request: AiSceneHttpRequest) => freezeOriginalInput({ headers: { authorization: request?.headers?.authorization } });
  const authority = (request: AiSceneHttpRequest) => {
    const requestId = randomUUID();
    return new ApprovedProfileRouteAuthority(input.guard, { current: async () => {
      if (typeof request.headers.authorization !== 'string') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return { authorization: request.headers.authorization, audience: 'operator' as const, requestId };
    } });
  };
  const key = (actor: ApprovedProfileActor, command: z.infer<typeof locator>) =>
    `member-name-${requestFingerprint({ kind: 'member-profile-name', actor, customerId: command.customerId, requestKey: command.requestKey })}`;
  const page = (request: AiSceneHttpRequest, command: z.infer<typeof query>) => authority(request).withListRead(async (actor, revalidate) => {
    let observed;
    try { observed = await input.memberships.listPersonalProfileCandidatesPage(actor.tenantId, command); }
    catch (error) { if (error instanceof HttpException && [401, 403].includes(error.getStatus())) throw error;
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); }
    const rows = z.array(member).max(command.limit).safeParse(observed?.rows);
    if (!rows.success || typeof observed.truncated !== 'boolean' || new Set(rows.data.map(row => row.customerId)).size !== rows.data.length
      || command.customerId && rows.data.some(row => row.customerId !== command.customerId)
      || (observed.truncated ? rows.data.length !== command.limit || observed.nextCursor !== rows.data[rows.data.length - 1]?.customerId
        : observed.nextCursor !== undefined)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const at = clock(); if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    await revalidate();
    const material = { actor, query: command, rows: rows.data, truncated: observed.truncated,
      ...(observed.nextCursor ? { nextCursor: observed.nextCursor } : {}) };
    return freezeOriginalInput({ actor, selectionHash: requestFingerprint(material), page: {
      scope: { kind: 'tenant' as const, tenantId: actor.tenantId },
      taskContext: { kind: 'workspace' as const, tenantId: actor.tenantId, workspaceId: actor.workspaceId }, audience: 'operator' as const,
      candidates: rows.data, truncated: observed.truncated, ...(observed.nextCursor ? { nextCursor: observed.nextCursor } : {}),
      observedAt: at.toISOString(), sharing: 'tenant_member_master_not_workspace_order_access' as const } });
  });
  const selected = async (request: AiSceneHttpRequest, command: z.infer<typeof intent>) => {
    const found = await page(request, command.query);
    if (found.selectionHash !== command.selectionHash) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    const row = found.page.candidates.find(row => row.customerId === command.customerId);
    if (!row) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return { ...found, member: row };
  };
  const inspect = async (request: AiSceneHttpRequest, command: z.infer<typeof intent>) => {
    const before = await selected(request, command);
    return authority(request).withAuthorization('read', command.customerId, async (actor, revalidate) => {
      if (requestFingerprint(actor) !== requestFingerprint(before.actor)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const current = freezeOriginalInput(structuredClone(await input.profiles.readCurrent(request, { customerId: command.customerId })));
      if (current.customerId !== command.customerId || current.name !== before.member.name
        || !Number.isSafeInteger(current.ordinaryRevision) || current.ordinaryRevision < 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      const closing = await selected(request, command);
      if (requestFingerprint(closing.actor) !== requestFingerprint(actor)
        || requestFingerprint(await input.profiles.readCurrent(request, { customerId: command.customerId })) !== requestFingerprint(current))
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      await revalidate();
      const changeKey = key(actor, command), reviewHash = requestFingerprint({ actor, current, changeKey,
        selectionHash: before.selectionHash, requested: { name: command.name, expiresAt: command.expiresAt } });
      return { actor, current, changeKey, reviewHash };
    });
  };
  // Preparation/Task recovery locates the SAME original key and domain record.
  // It never reruns discovery or derives a new key from today's name/revision.
  const load = (request: AiSceneHttpRequest, command: z.infer<typeof locator>) => authority(request).withAuthorization('read', command.customerId,
    async (actor, revalidate) => {
      const changeKey = key(actor, command);
      const row = await input.db.customerApprovedProfileChange.findUnique({ where: { tenantId_customerId_actorId_changeKey: {
        tenantId: actor.tenantId, customerId: command.customerId, actorId: actor.actorId, changeKey } } });
      if (!row) { await revalidate(); return null; }
      if (row.tenantId !== actor.tenantId || row.workspaceId !== actor.workspaceId || row.actorId !== actor.actorId
        || row.customerId !== command.customerId || row.changeKey !== changeKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const reference = { customerId: row.customerId, changeId: row.id, changeHash: row.changeHash };
      const change = await input.profiles.readChange(request, reference); await revalidate();
      return freezeOriginalInput({ reference, change });
    });
  const verified = async (request: AiSceneHttpRequest, command: z.infer<typeof locator>, expected: NonNullable<Awaited<ReturnType<typeof load>>>) => {
    if (requestFingerprint(await load(request, command)) !== requestFingerprint(expected)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
  };
  return Object.freeze({ availability: 'available_for_explicit_member_name_workflow' as const,
    async discover(request: AiSceneHttpRequest, value: unknown) {
      const found = await page(bind(request), parse(query, value));
      return freezeOriginalInput({ page: found.page, selectionHash: found.selectionHash,
        selection: 'explicit_customer_choice_required' as const, persistence: 'not_attempted' as const });
    },
    async inspect(request: AiSceneHttpRequest, value: unknown) {
      const command = parse(intent, value), found = await inspect(bind(request), command);
      return freezeOriginalInput({ state: command.name === found.current.name ? 'no_change' as const : 'difference_ready' as const,
        customerId: command.customerId, ordinaryRevision: found.current.ordinaryRevision,
        fields: [{ field: 'name' as const, before: found.current.name, after: command.name,
          source: { kind: 'original_core_profile' as const, scope: { kind: 'tenant' as const, tenantId: found.actor.tenantId } } }],
        sharing: found.current.sharing, reviewHash: found.reviewHash, persistence: 'not_attempted' as const,
        sensitiveFields: 'use_original_verification_flow' as const, approval: 'not_granted' as const });
    },
    async prepare(request: AiSceneHttpRequest, value: unknown) {
      const command = parse(preparation, value), current = bind(request), found = await inspect(current, command);
      if (command.reviewHash !== found.reviewHash) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      if (command.name === found.current.name) return { state: 'no_change' as const, persistence: 'not_attempted' as const };
      let change;
      try { change = await input.profiles.prepareChange(current, { customerId: command.customerId, changeKey: found.changeKey,
        baseRevision: found.current.ordinaryRevision, name: command.name, expiresAt: command.expiresAt }); }
      catch (error) {
        if (error instanceof HttpException && error.getStatus() < 500) throw error;
        if (error instanceof AiTaskRepositoryError && ['AI_INVALID_INPUT', 'AI_ACCESS_DENIED', 'AI_REVISION_CONFLICT'].includes(error.code)) throw error;
        throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      }
      try {
        if ((await inspect(current, command)).reviewHash !== found.reviewHash || change.customerId !== command.customerId
          || change.baseRevision !== found.current.ordinaryRevision || change.fields.length !== 1 || change.fields[0].field !== 'name'
          || change.fields[0].before !== found.current.name || change.fields[0].after !== command.name) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      return freezeOriginalInput({ state: 'prepared' as const, change,
        reference: { customerId: change.customerId, changeId: change.changeId, changeHash: change.changeHash },
        task: 'not_created_by_preparation' as const, approval: 'fresh_explicit_approval_required' as const,
        businessUpdate: 'not_attempted' as const });
    },
    async readPrepared(request: AiSceneHttpRequest, value: unknown) {
      const found = await load(bind(request), parse(locator, value));
      return freezeOriginalInput(found ? { state: 'prepared' as const, ...found, execution: 'read_only_no_task_or_retry' as const }
        : { state: 'not_observed' as const, retryable: false as const });
    },
    async beginReview(request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) {
      const command = parse(locator.extend({ decision: z.literal('start_original_profile_review') }).strict(), value), current = bind(request);
      if (signal?.aborted) return { state: 'not_started' as const, reason: 'host_aborted' as const };
      const found = await load(current, command); if (!found) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const existing = await input.profiles.readCreation(current, found.reference); await verified(current, command, found);
      if (!('state' in existing.receipt) || existing.receipt.state === 'unknown') throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      if (existing.receipt.state === 'observed') return freezeOriginalInput({ reference: found.reference, originalTask: existing,
        execution: 'not_started_use_original_task' as const, nextAction: 'read_original_profile_task' as const });
      let created;
      try { created = await input.profiles.createTask(current, found.reference); }
      catch (error) { if (error instanceof HttpException && error.getStatus() < 500) throw error; throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      try { await verified(current, command, found); } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      if (!('replayed' in created.receipt) || !('taskId' in created.receipt) || !('runId' in created.receipt))
        throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      // A replay may refer to started, completed or unknown work. Never start
      // it again. The existing profile host supplies its recovery/approval UI.
      if (created.receipt.replayed || signal?.aborted) return freezeOriginalInput({ reference: found.reference, created,
        execution: 'not_started_use_original_task' as const, nextAction: 'read_original_profile_task' as const });
      let execution;
      try { execution = await input.profiles.start(current, found.reference, signal); await verified(current, command, found); }
      catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      return freezeOriginalInput({ reference: found.reference, created, execution,
        approval: 'not_granted_by_entry' as const, automaticRetry: false as const });
    },
    async readCreatedTask(request: AiSceneHttpRequest, value: unknown) {
      const command = parse(locator, value), current = bind(request), found = await load(current, command);
      if (!found) return { state: 'preparation_not_observed' as const, retryable: false as const };
      const created = await input.profiles.readCreation(current, found.reference); await verified(current, command, found);
      return freezeOriginalInput({ reference: found.reference, created, execution: 'read_only_no_create_or_start' as const });
    }
  });
}
