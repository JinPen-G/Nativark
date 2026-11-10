/** Explicit renewal of an owned original Task's three reading policies.
 * Current Auth, full scope and original business/resource Guards remain required;
 * execution settings and the creation deadline do not authorize historical reads.
 * Only enable writes through original CAS/receipts. Observation never dispatches
 * or retries, and sequential rechecks do not attest an atomic Auth transaction. */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  AI_SCENE_REQUEST_DRAFT_VERSION, AI_TASK_ORIGINAL_READ_POLICY_HTTP, AI_TASK_READ_POLICY_OPERATIONS,
  AI_TASK_READ_POLICY_VERSION, aiTaskReadPolicyEnable, aiTaskReadPolicyQuery,
  aiTaskReadPolicyReference, aiTaskReadPolicyResponse, type AiTaskReadPolicyReference
} from '@rental-os/shared';
import { runWithRequestIdentity } from '../../common/request-identity';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiScopeRepository } from './ai-scope.repository';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from './ai-task.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { PrismaTaskActionPolicyRepository } from './prisma-task-action-policy.repository';
import { AiTaskRunnerError } from './runner/ai-task-runner.service';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './scenes/original-scenes.composition';
import { respondAiScene } from './scenes/original-scenes.controller';
import { withRequestAbort } from './scenes/request-abort';
import { originalIdentityHash } from './task-request/original-request.authority';
import { freezeOriginalInput } from './task-request/original-request.validation';

export const AI_TASK_ORIGINAL_READ_POLICY_REQUESTS = Symbol('AI_TASK_ORIGINAL_READ_POLICY_REQUESTS');
type Dependencies = Omit<AiOriginalSceneDependencies, 'credentials'>;
type Request = { headers: { authorization?: unknown } };
type Action = 'inspect' | 'enable' | 'operation';
type Operation = typeof AI_TASK_READ_POLICY_OPERATIONS[number];
type Receipt = Awaited<ReturnType<PrismaTaskActionPolicyRepository['readMutation']>>;
const ttlMs = 120000;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
// These are the original closed GET bridges' accepted permissions. A held
// permission alone is insufficient: the original locator executes their real
// resource Guards before every read or CAS. Existing stricter lists are retained.
const readPermissions = {
  order_explanation: ['rental-os:order:view'],
  quote_clarification: ['rental-os:rules:manage', 'rental-os:price:manage', 'rental-os:order:view', 'rental-os:order:create'],
  opening_diagnosis: ['rental-os:order:view', 'rental-os:price:manage', 'system:user:manage', 'system:role:manage']
} as const;
const taskSelect = {
  id: true, scopeId: true, scopeKind: true, ownerKind: true, ownerId: true,
  audience: true, sceneCode: true, sceneVersion: true, inputRef: true,
  inputHash: true, inputRevision: true, archivedAt: true
} as const;

export function composeTaskOriginalReadPolicyRequests(d: Dependencies) {
  const call = async (request: Request, value: unknown, action: Action, signal?: AbortSignal) => {
    const schema = action === 'inspect' ? aiTaskReadPolicyQuery : action === 'enable' ? aiTaskReadPolicyEnable : aiTaskReadPolicyReference;
    const parsed = schema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || authorization.length > 8192 || !/^Bearer \S+$/u.test(authorization)) throw denied();
    let active = !signal?.aborted;
    const close = () => { active = false; }, clock = d.clock ?? (() => new Date()), requestId = randomUUID();
    signal?.addEventListener('abort', close, { once: true });
    const credentials = { current: async () => {
      if (!active) throw denied();
      return { authorization, audience: 'operator' as const, requestId };
    } };
    try {
      return await waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
        const identities = new AiTaskCurrentIdentityAuthority(d.auth, credentials, clock);
        const scopes = new AiScopeRepository(d.db, identities, clock), bound = await scopes.resolveCurrent(), context = bound.context;
        if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || context.audience !== 'operator'
          || bound.scope.kind !== 'WORKSPACE' || !('access' in context)) throw denied();
        const ownerId = context.actor.userId, identityHash = originalIdentityHash(context);
        const readTask = async () => {
          const access = aiTaskAccessFromContext(context, command.taskId, clock());
          const task = await d.db.aiTask.findFirst({ where: { AND: [access.where, { scopeId: bound.scope.id }] }, select: taskSelect });
          if (!task || task.id !== command.taskId || task.scopeId !== bound.scope.id || task.scopeKind !== 'WORKSPACE'
            || task.ownerId !== ownerId || task.ownerKind !== 'USER' || task.audience !== 'OPERATOR'
            || task.archivedAt !== null || !Object.hasOwn(readPermissions, task.sceneCode) || !task.inputRef) throw unavailable();
          return task;
        };
        const task = await readTask(), taskHash = requestFingerprint(task);
        const original = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: task.inputRef! };
        const originals = composeAiOriginalScenes({ ...d, credentials }).requests;
        const source = await originals.readTaskLocator(original);
        if (source.material !== 'retained' || source.receipt.state === 'revoked' || source.task.state !== 'observed') throw unavailable();
        const creation = source.task, runId = command.runId ?? creation.runId;
        const checkSource = (current: Awaited<ReturnType<typeof originals.readTaskLocator>>) => {
          if (current.material !== 'retained' || current.receipt.state === 'revoked') throw unavailable();
          if (current.receipt.inputRef !== task.inputRef || current.receipt.revision !== task.inputRevision
            || current.receipt.contentHash !== task.inputHash || current.receipt.sceneCode !== task.sceneCode
            || current.receipt.sceneVersion !== task.sceneVersion || originalIdentityHash(current.context) !== identityHash
            || current.task.state !== 'observed' || current.task.taskId !== task.id || current.task.runId !== creation.runId) throw denied();
        };
        const verify = async () => {
          if (!active) throw denied();
          const current = await scopes.resolveCurrent();
          if (current.scope.id !== bound.scope.id || originalIdentityHash(current.context) !== identityHash) throw denied();
          if (requestFingerprint(await readTask()) !== taskHash) throw denied();
          checkSource(await originals.readTaskLocator(original));
          // The policy is Task-scoped; a supplied later Run must still be a real
          // child of this original Task. A browser runId cannot choose a parent.
          const run = await d.db.aiRun.findFirst({ where: { id: runId, taskId: task.id, scopeId: bound.scope.id },
            select: { id: true, taskId: true, scopeId: true } });
          if (!run || run.id !== runId || run.taskId !== task.id || run.scopeId !== bound.scope.id || !active) throw denied();
        };
        checkSource(source);
        await verify();
        // This read authority stays private. Only the named enable command below
        // obtains a separate writer; no general policy repository escapes.
        const reader = new PrismaTaskActionPolicyRepository(d.db, scopes, { resolve: async (taskId, operation) => {
          if (taskId !== task.id || operation !== 'configure_action_policy') throw denied();
          await verify();
          return context;
        } }, clock);
        const fallback = readPermissions[task.sceneCode as keyof typeof readPermissions].find(permission => context.access.permissions.includes(permission));
        if (!fallback) throw denied();
        const describe = async () => {
          const rows = [];
          for (const operation of AI_TASK_READ_POLICY_OPERATIONS) {
            const found = await reader.read(task.id, operation), current = found.state === 'observed' ? found.policy : null;
            rows.push({ operation, current, requiredPermissions: current?.requiredPermissions ?? [fallback] });
          }
          await verify();
          return rows;
        };
        const digest = (reference: Omit<AiTaskReadPolicyReference, 'reviewHash'>, required: readonly (readonly string[])[]) =>
          requestFingerprint({ kind: 'ordinary-original-task-reading-1', contractVersion: AI_TASK_READ_POLICY_VERSION,
            scopeId: bound.scope.id, scope: context.scope, actorId: ownerId,
            origin: { inputRef: task.inputRef, contentHash: task.inputHash }, reference, required });
        const readReceipts = async (reference: AiTaskReadPolicyReference) => {
          const receipts: Receipt[] = [];
          for (const operation of AI_TASK_READ_POLICY_OPERATIONS) receipts.push(await reader.readMutation(task.id, operation, reference.expected[operation]));
          await verify();
          return receipts;
        };
        const observe = async (reference: AiTaskReadPolicyReference, receipts?: Receipt[]) => {
          const rows = await describe(), recorded = receipts ?? await readReceipts(reference);
          const completeRecorded = recorded.every(row => row.state === 'recorded');
          if (completeRecorded) {
            const { reviewHash, ...locator } = reference;
            if (recorded.some(row => row.policy!.expiresAt !== reference.expiresAt)
              || digest(locator, recorded.map(row => row.policy!.requiredPermissions)) !== reviewHash) throw conflict();
          }
          await verify();
          return aiTaskReadPolicyResponse.parse({ contractVersion: AI_TASK_READ_POLICY_VERSION, phase: 'operation', reference,
            scope: context.scope, observedAt: clock().toISOString(), completeRecorded,
            items: rows.map((row, i) => ({ operation: row.operation, current: row.current,
              active: !!row.current && Date.parse(row.current.expiresAt) > clock().getTime()
                && row.current.requiredPermissions.every(permission => context.access.permissions.includes(permission)),
              desired: { requiredPermissions: recorded[i].policy?.requiredPermissions ?? row.requiredPermissions, expiresAt: reference.expiresAt },
              receipt: { state: recorded[i].state, policy: recorded[i].policy } })),
            execution: 'not_attempted', authority: 'reading_policy_not_model_or_core_authorization' });
        };
        if (action === 'operation') return observe(aiTaskReadPolicyReference.parse(command));
        if (action === 'enable') {
          const { decision: _decision, ...locator } = aiTaskReadPolicyEnable.parse(command);
          const reference = aiTaskReadPolicyReference.parse(locator), receipts = await readReceipts(reference);
          // A partial or complete original save is observed. Another enable call
          // never fills missing siblings after an ambiguous group result.
          if (receipts.some(row => row.state === 'recorded')) return observe(reference, receipts);
        }
        const rows = await describe();
        if (rows.some(row => row.requiredPermissions.some(permission => !context.access.permissions.includes(permission)))) throw denied();
        if (action === 'inspect') {
          const expiresAt = new Date(clock().getTime() + ttlMs).toISOString();
          const locator = { taskId: task.id, runId, expiresAt,
            expected: Object.fromEntries(rows.map(row => [row.operation, row.current?.revision ?? null])) } as Omit<AiTaskReadPolicyReference, 'reviewHash'>;
          const reference = { ...locator, reviewHash: digest(locator, rows.map(row => row.requiredPermissions)) };
          return aiTaskReadPolicyResponse.parse({ contractVersion: AI_TASK_READ_POLICY_VERSION, phase: 'review', reference,
            scope: context.scope, observedAt: clock().toISOString(), completeRecorded: false,
            items: rows.map(row => ({ operation: row.operation, current: row.current,
              active: !!row.current && Date.parse(row.current.expiresAt) > clock().getTime()
                && row.current.requiredPermissions.every(permission => context.access.permissions.includes(permission)),
              desired: { requiredPermissions: row.requiredPermissions, expiresAt }, receipt: { state: 'not_checked', policy: null } })),
            execution: 'not_attempted', authority: 'reading_policy_not_model_or_core_authorization' });
        }
        const { decision: _decision, ...locator } = aiTaskReadPolicyEnable.parse(command);
        const reference = aiTaskReadPolicyReference.parse(locator), { reviewHash, ...binding } = reference;
        if (reference.taskId !== task.id || reference.runId !== runId || Date.parse(reference.expiresAt) <= clock().getTime()
          || Date.parse(reference.expiresAt) > clock().getTime() + ttlMs
          || rows.some(row => (row.current?.revision ?? null) !== reference.expected[row.operation])
          || digest(binding, rows.map(row => row.requiredPermissions)) !== reviewHash) throw conflict();
        await verify();
        let attempted = false;
        try {
          for (const row of rows) {
            let writing = true;
            const writer = new PrismaTaskActionPolicyRepository(d.db, scopes, { resolve: async (taskId, operation) => {
              if (!writing || action !== 'enable' || taskId !== task.id || operation !== 'configure_action_policy'
                || !AI_TASK_READ_POLICY_OPERATIONS.includes(row.operation)
                || row.requiredPermissions.some(permission => !context.access.permissions.includes(permission))) throw denied();
              await verify();
              return context;
            } }, clock);
            try {
              attempted = true;
              await writer.put({ taskId: task.id, operation: row.operation as Operation,
                requiredPermissions: row.requiredPermissions, expiresAt: new Date(reference.expiresAt) }, reference.expected[row.operation], true);
              await verify();
            } finally { writing = false; }
          }
          return await observe(reference);
        } catch (error) {
          if (attempted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
          throw error;
        }
      }), action === 'enable', signal);
    } finally {
      active = false;
      signal?.removeEventListener('abort', close);
    }
  };
  return Object.freeze({ inspect: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'inspect', signal),
    enable: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'enable', signal),
    operation: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'operation', signal) });
}

@Controller(AI_TASK_ORIGINAL_READ_POLICY_HTTP.basePath)
export class AiTaskOriginalReadPolicyController {
  constructor(@Inject(AI_TASK_ORIGINAL_READ_POLICY_REQUESTS) private readonly requests: ReturnType<typeof composeTaskOriginalReadPolicyRequests>) {}
  private respond(request: IncomingMessage, action: Action) {
    return respondAiScene(() => withRequestAbort(request,
      signal => this.requests[action](request, (request as IncomingMessage & { body?: unknown }).body, signal)), 'read_original_task_read_policy');
  }
  @Post(AI_TASK_ORIGINAL_READ_POLICY_HTTP.inspect) @HttpCode(200) @Header('Cache-Control', 'no-store')
  inspect(@Req() request: IncomingMessage, @Body() _body: unknown) { return this.respond(request, 'inspect'); }
  @Post(AI_TASK_ORIGINAL_READ_POLICY_HTTP.enable) @HttpCode(200) @Header('Cache-Control', 'no-store')
  enable(@Req() request: IncomingMessage, @Body() _body: unknown) { return this.respond(request, 'enable'); }
  @Post(AI_TASK_ORIGINAL_READ_POLICY_HTTP.operation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  operation(@Req() request: IncomingMessage, @Body() _body: unknown) { return this.respond(request, 'operation'); }
}
