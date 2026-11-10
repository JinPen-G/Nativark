/** Fixed human member-name host. Resolves original change/Task/approval/Core
 * records from an id-only locator; no human/model registration or hash input.
 * Preparation is not approval, and unknown mutations are observed only. */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { AI_MEMBER_NAME_HTTP, AI_MEMBER_NAME_VERSION, aiMemberNameAvailabilityInput, aiMemberNameDiscoverInput,
  aiMemberNameSelection, aiMemberNamePrepareInput, aiMemberNameReadInput, aiMemberNameExecuteInput, aiMemberNameResponse,
  type AiMemberNameLocator, type AiMemberNameResponse } from '@rental-os/shared';
import type { MembershipService } from '../platform/membership.service';
import { ApprovedProfileRouteAuthority, type ApprovedProfileActor } from '../platform/approved-profile-route.authority';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { composeMemberProfileChangeFlow } from './scenes/member-profile-change-flow';
import { composeRequestBoundProfileWorkflow, type AiSceneHttpRequest } from './scenes/request-bound-scenes.application';
import type { ApprovedProfileApplicationDependencies } from './approval-execution/approved-profile-task.authority';
import { AiTaskRepositoryError } from './ai-task.repository';
import { AiTaskRunnerError } from './runner/ai-task-runner.service';
import { waitForTaskApplicationDependency, type AiTaskApplicationHost } from './runner/prisma-task-application';
import { TenantModelConfigurationAuthority } from './tenant-model-config.authority';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { freezeOriginalInput } from './task-request/original-request.validation';
import { respondAiScene } from './scenes/original-scenes.controller';
import { withRequestAbort } from './scenes/request-abort';
import { AiMemberNameAvailabilityDto, AiMemberNameDiscoverDto, AiMemberNameSelectionDto,
  AiMemberNamePrepareDto, AiMemberNameReadDto, AiMemberNameExecuteDto } from './member-name.dto';

export const AI_MEMBER_NAME_REQUESTS = Symbol('AI_MEMBER_NAME_REQUESTS');
export type MemberNameDependencies = Omit<ApprovedProfileApplicationDependencies, 'credentials'> & {
  memberships: Pick<MembershipService, 'listPersonalProfileCandidatesPage'> };
type Action = 'availability' | 'discover' | 'inspect' | 'prepare' | 'read' | 'execute';
const parse = <S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> => {
  const found = schema.safeParse(structuredClone(value)); if (!found.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(found.data);
};
const hash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));

export function composeMemberNameRequests(d: MemberNameDependencies, configuration: { enabled: boolean; host: AiTaskApplicationHost }) {
  const enabled = z.boolean().parse(configuration.enabled), host = Object.freeze(structuredClone(configuration.host));
  const clock = d.clock ?? (() => new Date());
  if (host.holderId !== d.holderId) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const call = (request: AiSceneHttpRequest, value: unknown, action: Action, signal?: AbortSignal) => {
    const command = action === 'availability' ? parse(aiMemberNameAvailabilityInput, value)
      : action === 'discover' ? parse(aiMemberNameDiscoverInput, value) : action === 'inspect' ? parse(aiMemberNameSelection, value)
        : action === 'prepare' ? parse(aiMemberNamePrepareInput, value) : action === 'execute' ? parse(aiMemberNameExecuteInput, value)
          : parse(aiMemberNameReadInput, value);
    const authorization = z.string().max(8192).regex(/^Bearer \S+$/u).safeParse(request?.headers?.authorization);
    if (!authorization.success) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const bound = Object.freeze({ headers: { authorization: authorization.data } });
    let active = true;
    return waitForTaskApplicationDependency(async () => {
      const assert = () => { if (!active || signal?.aborted) throw new AiTaskRepositoryError('AI_ACCESS_DENIED'); };
      const guard = { canActivate: async (...args: Parameters<typeof d.guard.canActivate>) => { assert(); return d.guard.canActivate(...args); } };
      const credentials = { current: async () => { assert(); return { authorization: authorization.data, audience: 'operator' as const, requestId }; } };
      const requestId = randomUUID();
      const route = new ApprovedProfileRouteAuthority(guard, credentials);
      const actor = await route.withListRead(async (actor, revalidate) => { await revalidate(); return actor; });
      const profiles = composeRequestBoundProfileWorkflow({ ...d, guard }, { enabled: true, audience: 'operator', host,
        taskPolicyConfiguration: { executionEnabled: enabled, ttlMs: 120000 } });
      // The original request host receives the same abort signal for every
      // consumed domain method. Late work cannot keep using this request key.
      const entryProfiles = { readCurrent: (r: AiSceneHttpRequest, v: unknown) => profiles.readCurrent(r, v, signal),
        prepareChange: (r: AiSceneHttpRequest, v: unknown) => profiles.prepareChange(r, v, signal),
        readChange: (r: AiSceneHttpRequest, v: unknown) => profiles.readChange(r, v, signal),
        createTask: (r: AiSceneHttpRequest, v: unknown) => profiles.createTask(r, v, signal),
        readCreation: (r: AiSceneHttpRequest, v: unknown) => profiles.readCreation(r, v, signal), start: profiles.start };
      const flow = composeMemberProfileChangeFlow({ db: d.db, guard, memberships: d.memberships, profiles: entryProfiles, clock });
      const base = (): AiMemberNameResponse => ({ contractVersion: AI_MEMBER_NAME_VERSION, observedAt: clock().toISOString(),
        newWorkEnabled: enabled, phase: 'availability', scope: { kind: 'tenant', tenantId: actor.tenantId }, locator: null,
        candidates: [], truncated: false, nextCursor: null, selectionHash: null, review: null, change: null, task: null,
        operation: null, retryable: false, sensitiveFields: 'use_original_verification_flow' });
      const manager = () => new TenantModelConfigurationAuthority(guard, credentials,
        new AiTaskCurrentIdentityAuthority(d.auth, credentials, clock)).authorize({ tenantId: actor.tenantId,
          workspaceId: actor.workspaceId, actorId: actor.actorId }, 'manage');
      const change = (value: { baseRevision: number; expiresAt: string; fields: Array<{ before: string; after: string }> }): NonNullable<AiMemberNameResponse['change']> => ({
        before: value.fields[0].before, after: value.fields[0].after, baseRevision: value.baseRevision, expiresAt: value.expiresAt,
        source: 'original_core_profile', sharing: 'tenant_member_master_not_workspace_order_access' });
      const locate = async (locator: AiMemberNameLocator) => {
        const found = await flow.readPrepared(bound, locator);
        if (found.state !== 'prepared') return null;
        assert(); return found;
      };
      const recipient = async (customerId: string) => {
        const result = await flow.discover(bound, { limit: 1, customerId });
        if (result.page.candidates.length !== 1 || result.page.candidates[0].customerId !== customerId)
          throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        return result.page.candidates;
      };
      const read = async (locator: AiMemberNameLocator): Promise<{ frame: AiMemberNameResponse; reference?: NonNullable<Awaited<ReturnType<typeof locate>>>['reference'] }> => {
        const found = await locate(locator), frame = { ...base(), locator };
        if (!found) return { frame: { ...frame, phase: 'not_observed' } };
        frame.candidates = await recipient(locator.customerId);
        frame.change = change(found.change); frame.phase = 'prepared';
        const created = await profiles.readCreation(bound, found.reference, signal);
        if (!('state' in created.receipt) || created.receipt.state !== 'observed' || !('task' in created.receipt) || !created.receipt.task)
          return { frame, reference: found.reference };
        frame.task = { taskId: created.receipt.task.taskId, runId: created.receipt.task.runId, status: null, revision: null,
          approval: 'not_observed', businessOutcome: 'not_observed', confirmationHash: null }; frame.phase = 'task_created';
        const admission = await profiles.readTaskActionAdmission(bound, found.reference, signal);
        if (admission.state !== 'recorded') return { frame, reference: found.reference };
        try {
          const observation = await profiles.readTaskObservation(bound, { original: found.reference }, signal);
          frame.task.status = observation.snapshot.status; frame.task.revision = observation.snapshot.revision; frame.phase = 'task_observed';
          if (observation.business.availability === 'available') {
            const business = observation.business.value;
            if (frame.candidates[0]?.name !== business.current.name) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
            frame.task.businessOutcome = business.businessOutcome;
            if (business.decision?.state === 'recorded') frame.task.approval = business.decision.approval.decision === 'approved' ? 'approved' : 'rejected';
            if (business.operation?.state === 'committed') {
              const receipt = business.operation.receipt;
              frame.operation = { receiptId: receipt.receiptId, resultRevision: receipt.resultRevision, resultName: receipt.resultName,
                committedAt: receipt.committedAt, source: 'original_core_operation_receipt' }; frame.phase = 'completed';
            } else if (business.confirmation && observation.snapshot.status === 'waiting_confirmation') {
              frame.phase = 'waiting_confirmation';
              frame.task.confirmationHash = hash({ locator, original: found.reference, change: business.change, current: business.current,
                taskId: frame.task.taskId, runId: frame.task.runId, revision: frame.task.revision,
                confirmation: business.confirmation, decision: business.decision });
            }
          }
        } catch (error) {
          if (error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED') frame.phase = 'task_read_unavailable';
          else throw error;
        }
        if (hash(await locate(locator)) !== hash(found)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        assert(); return { frame, reference: found.reference };
      };
      if (action === 'availability') return aiMemberNameResponse.parse(base());
      if (action === 'read') return aiMemberNameResponse.parse((await read(parse(aiMemberNameReadInput, command).locator)).frame);
      if (!enabled) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      if (action === 'discover') {
        const found = await flow.discover(bound, parse(aiMemberNameDiscoverInput, command).query);
        return aiMemberNameResponse.parse({ ...base(), phase: 'candidates', candidates: found.page.candidates,
          truncated: found.page.truncated, nextCursor: found.page.nextCursor ?? null, selectionHash: found.selectionHash });
      }
      if (action === 'inspect') {
        const selection = parse(aiMemberNameSelection, command), intent = { ...selection, expiresAt: new Date(clock().getTime() + 120000).toISOString() };
        const found = await flow.inspect(bound, intent);
        const changed = change({ baseRevision: found.ordinaryRevision, expiresAt: intent.expiresAt, fields: found.fields });
        const selected = await recipient(intent.customerId);
        if ((await flow.inspect(bound, intent)).reviewHash !== found.reviewHash || selected[0].name !== changed.before)
          throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        return aiMemberNameResponse.parse({ ...base(), phase: found.state, locator: { customerId: intent.customerId, requestKey: intent.requestKey },
          candidates: selected, change: changed, review: { intent, reviewHash: found.reviewHash, change: changed } });
      }
      if (action === 'prepare') {
        await manager();
        const input = parse(aiMemberNamePrepareInput, command), locator = { customerId: input.intent.customerId, requestKey: input.intent.requestKey };
        if (Date.parse(input.intent.expiresAt) - clock().getTime() > 120000) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
        // A fully read-only preflight can prove this request never delegated
        // preparation. Only that response permits new selection/review; any
        // failure after the write boundary keeps the original unknown locator.
        try {
          const fresh = await flow.inspect(bound, input.intent);
          if (fresh.reviewHash !== input.reviewHash) return aiMemberNameResponse.parse({ ...base(), locator, phase: 'difference_stale_not_saved' });
        } catch (error) {
          if (error instanceof AiTaskRepositoryError && error.code === 'AI_REVISION_CONFLICT')
            return aiMemberNameResponse.parse({ ...base(), locator, phase: 'difference_stale_not_saved' });
          throw error;
        }
        let entered = false;
        try {
          assert(); entered = true;
          const prepared = await flow.prepare(bound, { ...input.intent, reviewHash: input.reviewHash });
          if (prepared.state !== 'prepared') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
          assert(); await profiles.createTask(bound, prepared.reference, signal);
          assert(); await profiles.configureTaskActions(bound, { ...prepared.reference, decision: 'allow_original_member_name_task' }, signal);
          assert(); await profiles.start(bound, prepared.reference, signal);
          return aiMemberNameResponse.parse((await read(locator)).frame);
        } catch (error) { if (entered) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); throw error; }
      }
      await manager();
      const input = parse(aiMemberNameExecuteInput, command), current = await read(input.locator);
      if (current.frame.operation) return aiMemberNameResponse.parse(current.frame);
      if (!current.reference || current.frame.phase !== 'waiting_confirmation' || current.frame.task?.confirmationHash !== input.confirmationHash)
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      if (current.frame.task.approval === 'rejected') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      try {
        if (current.frame.task.approval !== 'approved') await profiles.decide(bound, { ...current.reference, decision: 'approve' }, signal);
        assert(); await profiles.continueConfirmation(bound, current.reference, signal);
        return aiMemberNameResponse.parse((await read(input.locator)).frame);
      } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
    }, action === 'prepare' || action === 'execute', signal).finally(() => { active = false; });
  };
  return Object.freeze({ availability: (r: AiSceneHttpRequest, v: unknown, s?: AbortSignal) => call(r, v, 'availability', s),
    discover: (r: AiSceneHttpRequest, v: unknown, s?: AbortSignal) => call(r, v, 'discover', s),
    inspect: (r: AiSceneHttpRequest, v: unknown, s?: AbortSignal) => call(r, v, 'inspect', s),
    prepare: (r: AiSceneHttpRequest, v: unknown, s?: AbortSignal) => call(r, v, 'prepare', s),
    read: (r: AiSceneHttpRequest, v: unknown, s?: AbortSignal) => call(r, v, 'read', s),
    execute: (r: AiSceneHttpRequest, v: unknown, s?: AbortSignal) => call(r, v, 'execute', s) });
}

@Controller(AI_MEMBER_NAME_HTTP.basePath)
export class AiMemberNameController {
  constructor(@Inject(AI_MEMBER_NAME_REQUESTS) private readonly requests: ReturnType<typeof composeMemberNameRequests>) {}
  private respond(request: IncomingMessage, body: unknown, action: Action) {
    // Nest's global whitelist may strip extra DTO fields. The original HTTP
    // body remains the closed-schema input; DTO metadata documents validation.
    const original = (request as IncomingMessage & { body?: unknown }).body ?? body;
    return respondAiScene(() => withRequestAbort(request, signal => this.requests[action](request, original, signal)), 'read_original_member_name_record');
  }
  @Post('availability') @HttpCode(200) @Header('Cache-Control', 'no-store')
  availability(@Req() r: IncomingMessage, @Body() v: AiMemberNameAvailabilityDto) { return this.respond(r, v, 'availability'); }
  @Post('discover') @HttpCode(200) @Header('Cache-Control', 'no-store')
  discover(@Req() r: IncomingMessage, @Body() v: AiMemberNameDiscoverDto) { return this.respond(r, v, 'discover'); }
  @Post('inspect') @HttpCode(200) @Header('Cache-Control', 'no-store')
  inspect(@Req() r: IncomingMessage, @Body() v: AiMemberNameSelectionDto) { return this.respond(r, v, 'inspect'); }
  @Post('prepare') @HttpCode(200) @Header('Cache-Control', 'no-store')
  prepare(@Req() r: IncomingMessage, @Body() v: AiMemberNamePrepareDto) { return this.respond(r, v, 'prepare'); }
  @Post('read') @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() r: IncomingMessage, @Body() v: AiMemberNameReadDto) { return this.respond(r, v, 'read'); }
  @Post('execute') @HttpCode(200) @Header('Cache-Control', 'no-store')
  execute(@Req() r: IncomingMessage, @Body() v: AiMemberNameExecuteDto) { return this.respond(r, v, 'execute'); }
}
