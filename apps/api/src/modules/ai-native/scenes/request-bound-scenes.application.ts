import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { PrismaQuoteSelectionRepository, type HumanQuoteSelectionDependencies } from '../task-request/prisma-quote-selection.repository';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './original-scenes.composition';
import { composeHumanQuoteOrder, composeSelectedQuoteTaskApplication, type SelectedQuoteTaskConfiguration, type HumanQuoteOrderDependencies } from './human-quote-order.composition';
import { composeAiOriginalSceneModel, type AiOriginalSceneModelDependencies, type AiOriginalSceneRunDependencies } from './original-scene-model.composition';
import type { AiTaskApplicationHost } from '../runner/prisma-task-application';
import { composeFormalApprovedOrderReprepareServices, type FormalApprovedOrderReprepareConfiguration } from '../approval-execution/formal-approved-order-reprepare.composition';
import { composePersistedTaskCenter } from '../task-center.composition';
import { composeAiTaskCenterScene } from '../task-center-scene.composition';
import { composePersistedTaskAuthorization } from '../task-authorization.composition';
import { AiOriginalSceneRecoveryService } from './original-scene-recovery.service';
import { composeTaskSettingsHost, type AiSettingsTask } from '../runner/settings-task-host.composition';
import { composeAiSettingsBusinessConsumer } from './settings-business-consumer.composition';
import type { ApprovedSettingsApplicationDependencies } from '../approval-execution/approved-settings-task.authority';
import { originalRequestReferenceSchema, freezeOriginalInput } from '../task-request/original-request.validation';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { composePersistedTaskCallGateway, type PersistedTaskCallGatewayDependencies } from '../task-model-gateway.composition';

export type AiSceneHttpRequest = { headers: { authorization?: unknown } };
export type AiSceneRequestOptions = { enabled: boolean; audience: 'operator' | 'staff' };
export type RequestBoundOriginalSceneDependencies = Omit<AiOriginalSceneDependencies, 'credentials'>;
export type RequestBoundOriginalSceneModelDependencies = Omit<AiOriginalSceneModelDependencies, 'credentials'>;
export type AiSceneModelRequestOptions = AiSceneRequestOptions & {
  host: AiTaskApplicationHost;
  runServices: (dependencies: AiOriginalSceneModelDependencies) => AiOriginalSceneRunDependencies;
  /** Server-only business assembly. Never copied from a request body. */
  quoteTask?: { dependencies: RequestBoundQuoteOrderDependencies; configuration: SelectedQuoteTaskConfiguration };
  /** Server-only settings task assembly. It is never derived from a model or request body. */
  settingsTask?: { dependencies: Omit<ApprovedSettingsApplicationDependencies, 'credentials'>;
    configuration: { host: AiTaskApplicationHost; task: AiSettingsTask } };
};
export type RequestBoundQuoteSelectionDependencies = RequestBoundOriginalSceneDependencies & Omit<HumanQuoteSelectionDependencies, 'credentials' | 'originals'>;
export type RequestBoundQuoteOrderDependencies = RequestBoundOriginalSceneDependencies & Omit<HumanQuoteOrderDependencies, 'credentials' | 'originals'>;
const optionsSchema = z.object({ enabled: z.literal(true), audience: z.enum(['operator', 'staff']) }).strict();
const bearerSchema = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);

/** Resolve the existing snapshot only from an authorized original reference.
 * This is not a run claim or business receipt. Keep its persisted cursor intact. */
async function readOriginalTaskSnapshot(scenes: Pick<ReturnType<typeof composeAiOriginalScenes>, 'requests' | 'readTaskReceipt'>,
  events: ReturnType<typeof composePersistedTaskCenter>['events'], value: unknown) {
  const parsed = originalRequestReferenceSchema.safeParse(structuredClone(value));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const reference = freezeOriginalInput(parsed.data);
  const original = await scenes.requests.readHistorical(reference);
  const task = await scenes.readTaskReceipt(reference.inputRef);
  if (task.state !== 'observed' || original.receipt.state === 'revoked') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const snapshot = structuredClone(await events.readSnapshot({ taskId: task.taskId }));
  const after = await scenes.requests.readHistorical(reference);
  const latest = await scenes.readTaskReceipt(reference.inputRef);
  if (after.receipt.state === 'revoked' || originalIdentityHash(original.context) !== originalIdentityHash(after.context)
    || original.receipt.contentHash !== after.receipt.contentHash || latest.state !== 'observed'
    || latest.taskId !== task.taskId || latest.runId !== task.runId || latest.revision !== task.revision
    || snapshot.taskId !== task.taskId || snapshot.revision !== task.revision) {
    throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  }
  return freezeOriginalInput(snapshot);
}

function bindRequests<D extends object, A>(dependencies: D, options: AiSceneRequestOptions,
  compose: (input: D & { credentials: AiTaskCredentialSource }, command: unknown) => A | Promise<A>) {
  const parsed = optionsSchema.safeParse(options);
  if (!parsed.success || 'credentials' in dependencies || 'originals' in dependencies) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const server = { ...dependencies }, { audience } = parsed.data;
  return async <R>(request: AiSceneHttpRequest, value: unknown, consume: (app: A, command: unknown) => Promise<R>): Promise<R> => {
    const header = bearerSchema.safeParse(request?.headers?.authorization);
    if (!header.success) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const command = structuredClone(value), credential = Object.freeze({ authorization: header.data, audience, requestId: randomUUID() });
    let active = true;
    try {
      return await runWithRequestIdentity({}, async () => consume(await compose({ ...server, credentials: {
        current: async () => {
          if (!active) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          return { ...credential };
        }
      } }, command), command));
    } finally { active = false; }
  };
}

export type RequestBoundPersistedOriginalSceneModelDependencies =
  Omit<RequestBoundOriginalSceneModelDependencies, 'runtime' | 'priceVersion' | 'kind'> & {
    /** Server-owned configuration. No request may choose a provider or task. */
    gateway: Pick<PersistedTaskCallGatewayDependencies,
      'secrets' | 'platformProfileId' | 'routeScene' | 'callPriceVersion' | 'adapters' | 'audit'>;
  };

/** Formal original-reference model actions. Resolve the current original task
 * before constructing its real persisted Gateway/financial evidence producer.
 * The existing scene input, continuation, plan, runner and result consumers
 * remain the only execution chain. Construction does not call or claim work.
 * Business-only task-center readers remain in the existing scene entrypoint.
 */
export function composeRequestBoundPersistedOriginalSceneModel(
  dependencies: RequestBoundPersistedOriginalSceneModelDependencies,
  options: AiSceneRequestOptions & { host: AiTaskApplicationHost;
    clock?: AiOriginalSceneRunDependencies['clock']; monotonic?: AiOriginalSceneRunDependencies['monotonic'] }) {
  if (!dependencies.gateway || dependencies.gateway.routeScene !== dependencies.gatewayScene.routeScene
    || 'runtime' in dependencies || 'priceVersion' in dependencies || 'kind' in dependencies
    || 'runServices' in options) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const { host, clock, monotonic, ...requestOptions } = options;
  const serverHost = freezeOriginalInput(structuredClone(host));
  const { gateway, ...sceneDependencies } = dependencies;
  const serverGateway = Object.freeze({ ...gateway, adapters: Object.freeze([...gateway.adapters]) });
  const call = bindRequests(sceneDependencies, requestOptions, async (input, command) => {
    const raw = command && typeof command === 'object' && 'original' in command ? command.original : command;
    const parsed = originalRequestReferenceSchema.safeParse(raw);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const reference = freezeOriginalInput(parsed.data), scenes = composeAiOriginalScenes(input);
    const original = await scenes.requests.readHistorical(reference);
    await scenes.requests.resolve(original.receipt.sceneCode, reference.inputRef);
    const task = await scenes.readTaskReceipt(reference.inputRef);
    if (task.state !== 'observed' || original.receipt.state === 'revoked'
      || original.request.sceneCode !== input.scene.code || original.receipt.sceneVersion !== input.scene.version) {
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
    const persisted = composePersistedTaskCallGateway({ ...serverGateway, db: input.db, auth: input.auth,
      credentials: input.credentials, subscriptions: input.subscriptions, guard: input.guard,
      taskId: task.taskId, clock: input.clock });
    const model = composeAiOriginalSceneModel({ ...input, runtime: persisted.runtime, priceVersion: persisted.priceVersion });
    const application = model.createApplication(serverHost, { inputSource: 'original_scene',
      financialEvidence: persisted.financialEvidence, clock, monotonic });
    const after = await scenes.requests.readHistorical(reference), latest = await scenes.readTaskReceipt(reference.inputRef);
    if (after.receipt.state === 'revoked' || originalIdentityHash(original.context) !== originalIdentityHash(after.context)
      || original.receipt.contentHash !== after.receipt.contentHash || latest.state !== 'observed'
      || latest.taskId !== task.taskId || latest.runId !== task.runId || latest.revision !== task.revision) {
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
    return Object.freeze({ ...application, readModelResult: model.readModelResult, reopenModelSource: model.reopenModelSource });
  });
  return Object.freeze({
    start: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.start(command, signal)),
    readInput: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readInput(command)),
    refreshInput: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.refreshInput(command)),
    resume: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.resume(command, signal)),
    readAnswer: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readAnswer(command)),
    readModelResult: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readModelResult(command)),
    reopenModelSource: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reopenModelSource(command)),
    readQuotePreparation: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readQuotePreparation(command)),
    confirmClarifiedQuote: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.confirmClarifiedQuote(command)),
    readClarifiedQuoteReceipt: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readClarifiedQuoteReceipt(command)),
    continueAnswer: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.continueAnswer(command, signal)),
    reconcile: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.reconcile(command, signal)),
    recover: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.recover(command, signal)),
    requestCancel: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.requestCancel(command))
  });
}

export function composeRequestBoundOriginalSceneModel(dependencies: RequestBoundOriginalSceneModelDependencies,
  options: AiSceneModelRequestOptions) {
  const { host, runServices, quoteTask, settingsTask, ...requestOptions } = options;
  if (typeof runServices !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  if (quoteTask && ('credentials' in quoteTask.dependencies || 'originals' in quoteTask.dependencies
    || quoteTask.dependencies.db !== dependencies.db || quoteTask.dependencies.auth !== dependencies.auth
    || quoteTask.dependencies.guard !== dependencies.guard || quoteTask.dependencies.core !== dependencies.core)) {
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
  if (settingsTask && ('credentials' in settingsTask.dependencies
    || settingsTask.dependencies.db !== dependencies.db || settingsTask.dependencies.auth !== dependencies.auth
    || settingsTask.dependencies.guard !== dependencies.guard || settingsTask.dependencies.core !== dependencies.core)) {
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
  const business = quoteTask ? { dependencies: { ...quoteTask.dependencies }, configuration: {
    ...quoteTask.configuration, host: structuredClone(quoteTask.configuration.host),
    limits: structuredClone(quoteTask.configuration.limits) } } : undefined;
  const settingsBusiness = settingsTask ? { dependencies: { ...settingsTask.dependencies,
    scene: structuredClone(settingsTask.dependencies.scene) }, configuration: {
    host: structuredClone(settingsTask.configuration.host), task: structuredClone(settingsTask.configuration.task) } } : undefined;
  const serverHost = Object.freeze(structuredClone(host));
  const call = bindRequests(dependencies, requestOptions, input => {
    const model = composeAiOriginalSceneModel(input);
    // A business-only read must not construct model execution dependencies.
    // Resolve them only for an actual model action or pending-input read.
    let application: ReturnType<typeof model.createApplication> | undefined;
    const modelApplication = () => application ??= model.createApplication(serverHost, runServices(input));
    const persisted = composePersistedTaskCenter(input);
    const quote = business ? composeQuoteTaskCenterReaders({ ...business.dependencies,
      credentials: input.credentials, originals: model.scenes.requests }, business.configuration) : {};
    const settingsHost = settingsBusiness ? composeTaskSettingsHost({ ...settingsBusiness.dependencies,
      credentials: input.credentials, host: settingsBusiness.configuration.host, task: settingsBusiness.configuration.task }) : undefined;
    const settings = settingsHost && settingsBusiness ? composeAiSettingsBusinessConsumer({ ...settingsBusiness.dependencies,
      credentials: input.credentials, settingsHost }) : undefined;
    const center = composeAiTaskCenterScene({ list: persisted.list, events: persisted.events,
      ...quote, ...(settings ? { settings } : {}),
      scenes: model.scenes, modelResults: { read: model.readModelResult, reopenSource: model.reopenModelSource },
      input: { read: value => modelApplication().readInput(value) } });
    const requireSettings = (value: unknown) => {
      if (!settingsHost || !settingsBusiness) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      if (!value || typeof value !== 'object' || !('taskId' in value) || value.taskId !== settingsBusiness.configuration.task.taskId
        || 'runId' in value && value.runId !== settingsBusiness.configuration.task.runId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return settingsHost;
    };
    return { model, get application() { return modelApplication(); }, center, requireSettings,
      readTaskSnapshot: (value: unknown) => readOriginalTaskSnapshot(model.scenes, persisted.events, value) };
  });
  return Object.freeze({
    startSettingsTask: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.requireSettings(command).application.start(command, signal)),
    readSettingsConfirmation: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.requireSettings(command).application.readConfirmation(command)),
    decideSettingsProposal: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.requireSettings(command).settings.application.decide(command)),
    readSettingsDecision: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.requireSettings(command).settings.application.readDecisionReceipt(command)),
    continueSettingsConfirmation: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.requireSettings(command).application.continueOriginalConfirmation(command, signal)),
    reconcileSettingsTask: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.requireSettings(command).application.reconcileOriginal(command, signal)),
    cancelSettingsTask: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.requireSettings(command).application.requestCancelOriginal(command)),
    readTaskPage: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.center.readPage(command)),
    readTaskSnapshot: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readTaskSnapshot(command)),
    readTaskEvents: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.center.readEvents(command)),
    readTaskScene: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.center.readScene(command)),
    reopenOrderCitation: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.model.scenes.reopenOrderCitation(command)),
    prepareOpeningSections: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.model.scenes.prepareOpeningSections(command)),
    readOpeningSection: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.model.scenes.readOpeningSection(command)),
    readRecovery: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.model.scenes.readRecovery(command)),
    reviewQuote: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.model.scenes.reviewQuote(command)),
    readQuoteReceipt: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.model.scenes.readQuoteReceipt(command)),
    start: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.application.start(command, signal)),
    readInput: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.application.readInput(command)),
    refreshInput: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.application.refreshInput(command)),
    resume: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.application.resume(command, signal)),
    readAnswer: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.application.readAnswer(command)),
    readQuotePreparation: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.application.readQuotePreparation(command)),
    confirmClarifiedQuote: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.application.confirmClarifiedQuote(command)),
    readClarifiedQuoteReceipt: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.application.readClarifiedQuoteReceipt(command)),
    continueAnswer: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.application.continueAnswer(command, signal)),
    reconcile: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.application.reconcile(command, signal)),
    recover: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.application.recover(command, signal)),
    requestCancel: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.application.requestCancel(command)),
    readModelResult: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.model.readModelResult(command)),
    reopenModelSource: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.model.reopenModelSource(command))
  });
}

/** Share the real human-selection/approval/result readers between model and
 * business task centers. No start, continue, lease or write methods escape. */
function composeQuoteTaskCenterReaders(input: HumanQuoteOrderDependencies, configuration: SelectedQuoteTaskConfiguration) {
  const human = composeHumanQuoteOrder(input), tasks = composeSelectedQuoteTaskApplication(input, configuration);
  return Object.freeze({ selections: human, approvals: human, orders: { readResult: tasks.readResult } });
}

export function composeRequestBoundOriginalScenes(dependencies: RequestBoundOriginalSceneDependencies, options: AiSceneRequestOptions) {
  const call = bindRequests(dependencies, options, composeAiOriginalScenes);
  return Object.freeze({
    create: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.create(command)),
    read: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.read(command)),
    reissue: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reissue(command)),
    reconcile: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reconcile(command)),
    reconcileReissue: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reconcile(command, true)),
    createTask: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.createTask(command)),
    prepareTaskMaterial: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.prepareTaskMaterial(command)),
    reopenOrderCitation: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reopenOrderCitation(command)),
    prepareOpeningSections: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.prepareOpeningSections(command)),
    readOpeningSection: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readOpeningSection(command)),
    reviewQuote: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reviewQuote(command)),
    confirmQuote: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.confirmQuote(command)),
    readQuoteReceipt: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readQuoteReceipt(command)),
    readRecovery: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readRecovery(command))
  });
}

export function composeRequestBoundQuoteSelections(dependencies: RequestBoundQuoteSelectionDependencies, options: AiSceneRequestOptions) {
  const call = bindRequests(dependencies, options, input => new PrismaQuoteSelectionRepository({ ...input,
    originals: composeAiOriginalScenes(input).requests }));
  return Object.freeze({
    select: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.select(command)),
    read: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.read(command)),
    reconcile: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reconcile(command))
  });
}

export function composeRequestBoundSelectedQuoteTask(dependencies: RequestBoundQuoteOrderDependencies,
  options: AiSceneRequestOptions, configuration: SelectedQuoteTaskConfiguration) {
  const server = { ...configuration, host: structuredClone(configuration.host), limits: structuredClone(configuration.limits) };
  const call = bindRequests(dependencies, options, input => {
    const originals = composeFormalApprovedOrderReprepareServices(input, { holderId: server.host.holderId,
      creationRules: input.creationRules, memberships: input.memberships }).originals;
    const tasks = composeSelectedQuoteTaskApplication({ ...input, originals }, server);
    const business = composeQuoteTaskCenterReaders({ ...input, originals }, server), persisted = composePersistedTaskCenter(input);
    const recovery = new AiOriginalSceneRecoveryService(input.db, originals, composePersistedTaskAuthorization(input).tasks);
    const center = composeAiTaskCenterScene({ list: persisted.list, events: persisted.events, ...business, scenes: { requests: originals,
        readTaskReceipt: originals.readTaskReceipt.bind(originals), readRecovery: recovery.read.bind(recovery) } });
    return Object.freeze({ ...tasks, readScene: center.readScene,
      readTaskSnapshot: (value: unknown) => readOriginalTaskSnapshot({ requests: originals,
        readTaskReceipt: originals.readTaskReceipt.bind(originals) }, persisted.events, value),
      readTaskPage: center.readPage, readTaskEvents: center.readEvents });
  });
  return Object.freeze({
    readTaskPage: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readTaskPage(command)),
    readTaskSnapshot: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readTaskSnapshot(command)),
    readTaskEvents: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readTaskEvents(command)),
    readScene: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readScene(command)),
    start: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) => call(request, value, (app, command) => app.start(command, signal)),
    readConfirmation: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readConfirmation(command)),
    continueConfirmation: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) => call(request, value, (app, command) => app.continueConfirmation(command, signal)),
    reconcile: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) => call(request, value, (app, command) => app.reconcile(command, signal)),
    readResult: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readResult(command)),
    requestCancel: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.requestCancel(command))
  });
}

export function composeRequestBoundHumanQuoteOrder(dependencies: RequestBoundQuoteOrderDependencies, options: AiSceneRequestOptions,
  reprepare?: FormalApprovedOrderReprepareConfiguration) {
  if (reprepare && 'reprepareServices' in dependencies) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const configuration = reprepare ? { holderId: reprepare.holderId, creationRules: structuredClone(reprepare.creationRules),
    memberships: reprepare.memberships } : undefined;
  const call = bindRequests(dependencies, options, input => {
    if (configuration) {
      const factory = (current: Parameters<typeof composeFormalApprovedOrderReprepareServices>[0]) =>
        composeFormalApprovedOrderReprepareServices(current, configuration);
      return composeHumanQuoteOrder({ ...input, originals: factory(input).originals, reprepareServices: factory });
    }
    return composeHumanQuoteOrder({ ...input, originals: composeAiOriginalScenes(input).requests });
  });
  return Object.freeze({
    readSelectedProposal: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readSelectedProposal(command)),
    decideSelectedProposal: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.decideSelectedProposal(command)),
    readSelectedDecisionReceipt: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readSelectedDecisionReceipt(command)),
    readSelectedOrderResult: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readSelectedOrderResult(command)),
    readSelectedReprepareEligibility: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readSelectedReprepareEligibility(command)),
    reprepareSelectedProposal: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reprepareSelectedProposal(command)),
    readSelectedReprepareReceipt: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readSelectedReprepareReceipt(command))
  });
}
