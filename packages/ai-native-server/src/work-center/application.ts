/** Request-bound public work-center application. One original principal, one
 * selected database and one model ledger are used throughout each operation. */
import type { PrismaClient } from '@prisma/client';
import type { PlatformAuthService, PlatformPrincipalAuthority, SecretBox, SubscriptionService } from '@rental-os/platform-server';
import { type GatewayCapacityPort } from '@rental-os/platform-server/ai-gateway';
import type { AiPublicWorkCenterOperation } from '@rental-os/platform-contracts/ai-work-center';
import { requestFingerprint as hash } from '@rental-os/platform-contracts/request-fingerprint';
import { createPublicTenantTaskAuthority } from '../public-tenant-task-authority';
import { createPublicAiTaskPersistence } from '../task-persistence';
import { createAiTaskTransactionBoundary } from '../task-transactions';
import { createPublicTenantInvocationConfiguration, createPublicTenantModelConfiguration } from '../model-configuration';
import { createTenantConfigurationTransactions } from '../tenant-configuration-transactions';
import { createAiBodyStorageDatabase } from '../runtime/privacy/prisma-ai-body-storage';
import { createPublicModelAdapters } from '../model-adapters';
import { createNativeModelEgressTransport, modelEgressEvidence, type ModelJsonTransport } from '../runtime/model-egress.transport';
import { AiTaskRepositoryError } from '../task-errors';
import { WorkCenterConversations } from './conversations';
import { WorkCenterDiagnostic } from './diagnostic';
import { WorkCenterPublication } from './publication';
import { WorkCenterTaskAuthority } from './task-authority';
import { createWorkCenterRunner } from './task-runner';
import { createWorkCenterResultReaders } from './task-results';
import { CALL_PRICE_VERSION, SCENE, SCENE_VERSION, WorkCenterUnknownError, conflict, creationKey, denied, entryPermission,
  permission, policy, tenant, type SceneInput, type Tx } from './scene';
import { workCenterInput, workCenterOutput } from './contract';

export type WorkCenterRequest = { headers: { authorization?: unknown } };
export type WorkCenterHost = { db: PrismaClient; assertDataAvailable(db: Pick<Tx, '$queryRaw'>): Promise<void> };
type Dependencies = WorkCenterHost & {
  auth: Pick<PlatformAuthService, 'resolveAccessContext'>;
  principals: Pick<PlatformPrincipalAuthority<Tx>, 'lock'>;
  secrets: SecretBox;
  subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext' | 'lockCategoryCommercialContext'>;
  capacity: GatewayCapacityPort;
  transport?: ModelJsonTransport;
  clock?: () => Date;
};
type Command = { draftVersion?: string; conversationId: string; operationKey: string; admissionKey: string; taskId: string;
  runId: string; resultId: string; expectedRevision: number; limit: number; beforeId?: string; status: 'active' | 'archived' };

export interface WorkCenterRequests {
  consume(action: AiPublicWorkCenterOperation, request: WorkCenterRequest, raw: unknown, signal: AbortSignal): Promise<unknown>;
}

export function createPublicAiWorkCenterRequests(dependencies: Dependencies): WorkCenterRequests {
  const { auth, principals, secrets, subscriptions, assertDataAvailable, capacity } = dependencies;
  const clock = dependencies.clock ?? (() => new Date()), transport = dependencies.transport ?? createNativeModelEgressTransport();
  const mode = modelEgressEvidence(transport), adapters = createPublicModelAdapters(undefined, {}, transport);
  const db = createAiBodyStorageDatabase(dependencies.db, secrets), transactions = createAiTaskTransactionBoundary<Tx>();
  return Object.freeze<WorkCenterRequests>({ async consume(action, request, raw, signal) {
    // The only cast here follows the closed, per-operation shared schema. The
    // individual fields are accessed only in their corresponding handler.
    const command = workCenterInput(action, raw) as Command;
    const taskAuthority = new WorkCenterTaskAuthority(db, subscriptions, signal, clock);
    const authority = await createPublicTenantTaskAuthority({ db, auth, principals, creationPermission: permission, entryPermission,
      assertDataAvailable, clock, assertTaskAction: taskAuthority.assertTaskAction.bind(taskAuthority),
      assertReference: taskAuthority.assertReference.bind(taskAuthority) }).bind(request, signal);
    try {
      const check = async (caller: { tenantId: string; actorId: string }) => {
        const current = tenant(await authority.identities.resolve());
        if (caller.tenantId !== current.tenantId || caller.actorId !== current.ownerId) throw denied();
      };
      const conversations = new WorkCenterConversations(db, authority, clock), initial = await conversations.current();
      const configuration = createPublicTenantInvocationConfiguration({ db, authority: authority.identities, secrets, authorize: check });
      const diagnostic = new WorkCenterDiagnostic(db, authority, configuration, mode === 'live' ? 'node_https' : 'mock', clock);
      const verify = diagnostic.verifyNative.bind(diagnostic);
      const tasks = createPublicAiTaskPersistence({ db, actions: authority.actions, transactions, clock,
        creation: taskAuthority.creation(conversations, authority, verify), creationReceipt: { async resolve(sceneCode, inputRef) {
          if (sceneCode !== SCENE) throw denied();
          const context = await authority.identities.resolve(), { row } = await conversations.readOriginal(inputRef, db, initial);
          return { context, sceneCode, sceneVersion: SCENE_VERSION, inputRef: row.id, inputRevision: row.revision, inputHash: row.contentHash };
        } } });
      const results = createWorkCenterResultReaders({ db, authority, taskAuthority, conversations, diagnostic, tasks });
      const publication = new WorkCenterPublication(db, conversations, clock);

      const createTask = async (write: boolean) => {
        const turn = await conversations.originalForTurn(command);
        const locator = { sceneCode: SCENE, inputRef: turn.row.id, creationKey: creationKey(turn.row.id) };
        const before = await tasks.readCreation(locator);
        const projected = ({ replayed: _internal, ...result }: NonNullable<typeof before.task>) => result;
        if (before.task) await authority.actions.resolve(before.task.taskId, 'read_metadata');
        if (!write || before.state !== 'not_observed') {
          await conversations.same(turn.scope);
          return { ...before, task: before.task && projected(before.task) };
        }
        if (turn.head.status !== 'active' || turn.head.activeTurnId !== turn.turn.turnId || turn.row.creationClosedAt) throw conflict();
        let saved;
        try { saved = await tasks.create(authority.transaction, locator); }
        catch (error) {
          if (!(error instanceof AiTaskRepositoryError) || error.code !== 'AI_STORAGE_UNAVAILABLE') throw error;
          const observed = await tasks.readCreation(locator).catch(() => null);
          if (!observed?.task) throw new WorkCenterUnknownError();
          saved = observed.task;
        }
        try { await authority.actions.resolve(saved.taskId, 'read_metadata'); await conversations.same(initial); }
        catch { throw new WorkCenterUnknownError(); }
        return { state: 'observed', creationKey: locator.creationKey, task: projected(saved), retryable: false, nextAction: 'read_original_task' };
      };
      const start = async (recovery: boolean) => {
        const runner = createWorkCenterRunner({ db, authority, tasks, taskAuthority, conversations, diagnostic, configuration,
          transactions, adapters, transport: mode, capacity, clock, signal });
        const locator = { taskId: command.taskId, runId: command.runId };
        const ref = { ...locator, expectedRevision: command.expectedRevision };
        const observed = await (recovery ? runner.reconcile(ref) : runner.start(ref));
        try {
          const snapshot = await results.snapshot(locator, observed);
          if (observed.status === 'unknown'
            || observed.status === 'unavailable' && observed.nextAction !== 'manual_handoff' && snapshot.status === 'queued') throw new WorkCenterUnknownError();
          return snapshot;
        } catch { throw new WorkCenterUnknownError(); }
      };

      const dispatch: Record<AiPublicWorkCenterOperation, () => Promise<unknown>> = {
        create: () => conversations.change('create', command),
        list: () => conversations.list(command),
        read: () => conversations.read(command),
        archive: () => conversations.change('archive', command),
        delete: () => conversations.change('delete', command),
        operation: () => conversations.operation(command.operationKey),
        admit: () => conversations.admit(command, async scope => {
          const live = await policy(db, scope.scopeId, clock());
          await taskAuthority.entitlement(scope.tenantId);
          const original = await diagnostic.choose(`public-text:${hash({ scopeId: scope.scopeId, ownerId: scope.ownerId,
            conversationId: command.conversationId, admissionKey: command.admissionKey })}`);
          const payload: SceneInput = { command: original.command, configuration: original.configuration,
            policyRevision: live.revision, priceVersion: CALL_PRICE_VERSION };
          return { payload, policy: live };
        }, async (tx, scope, prepared) => {
          await taskAuthority.entitlement(scope.tenantId, tx);
          if ((await policy(tx, scope.scopeId, clock())).hash !== prepared.policy.hash) throw conflict();
          await verify(tx, scope.tenantId, prepared.payload);
        }),
        admission: () => conversations.admission(command),
        turns: () => conversations.turns(command),
        release: () => conversations.change('release_turn', command, async (tx, scope, head) => {
          if (!head || head.status !== 'active') throw conflict();
          await conversations.closeTurn(tx, scope, head, command.operationKey);
        }),
        conversationResult: () => results.conversationResult({ conversationId: command.conversationId, admissionKey: command.admissionKey, resultId: command.resultId }),
        createTask: () => createTask(true),
        taskCreation: () => createTask(false),
        snapshot: () => results.snapshot({ taskId: command.taskId, runId: command.runId }),
        start: () => start(false),
        reconcile: () => start(true),
        result: () => results.result({ taskId: command.taskId, resultId: command.resultId }),
        policy: () => publication.read(),
        savePolicy: () => publication.save(command),
        policyOperation: () => publication.operation(command.operationKey),
        allowText: async () => {
          const transactionParticipant = createTenantConfigurationTransactions<Tx>({ principalAuthority: principals,
            requiredPermission: permission, async assertDataAvailable(tx) { await conversations.same(initial, tx); } });
          const writer = createPublicTenantModelConfiguration({ db, secrets, transactionParticipant, async authorize(caller, operation) {
            if (operation === 'invoke') throw denied();
            await check(caller);
          } });
          return writer.configuration.setTextProbeAllowance({ tenantId: initial.tenantId, actorId: initial.ownerId }, command);
        }
      };
      const result = await dispatch[action]();
      return workCenterOutput(action, result);
    } finally { authority.close(); }
  } });
}
