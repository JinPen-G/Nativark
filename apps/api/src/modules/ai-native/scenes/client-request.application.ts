import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { aiClientOrderExplanationReadRequestSchema, aiClientSourceReadRequestSchema,
  aiClientTaskCancelRequestSchema, aiClientTaskInputSubmissionRequestSchema, AI_TOOL_DRAFT_VERSION,
  aiClientOrderMaterialRequestSchema, aiClientOrderMaterialReceiptSchema, AI_CLIENT_MATERIAL_RECEIPT_VERSION,
  AI_TASK_DRAFT_VERSION, aiClientTaskModelResultReadResponseSchema, AI_BOOKING_ACCEPTANCE_READ_VERSION,
  aiBookingAcceptanceReadRequestSchema } from '@rental-os/shared';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../../common/request-identity';
import { composeAiClientScenes, createAiGuardedClientSession } from '../client-scene.composition';
import type { ClientRequestContext } from '../../client/client-auth.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import { PrismaClientSceneMaterialRepository, AiClientMaterialError, type AiClientMaterialDb,
  type AiClientMaterialScope, type AiClientSceneMaterial } from './prisma-client-scene-material.repository';
import { AiClientPolicyAuthority, AiClientTaskAuthority, clientTaskSceneSchema, type AiClientTaskDependencies } from './client-task.authority';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskResultRepository } from '../runner/ai-task-result.repository';
import { isGatewayResult } from '../gateway-contract-validation';
import { TASK_TEXT_MODEL_TOOL } from '../model-input/task-model-input';
import { PrismaTaskRecoverySnapshotRepository } from '../runner/prisma-task-recovery-snapshot.repository';
import { readTaskModelRunOrigin } from '../task-input/prisma-task-input.repository';
import { AI_CLIENT_HOST_CAPABILITIES_VERSION, aiClientHostCapabilitiesRequestSchema, aiClientHostCapabilitiesSchema,
  type AiClientHostCapabilities } from '@rental-os/shared';
import { AiClientEntryError, assertEntryAction, clientEntrySurface, entryActionSchema, materialEntryAction, parseEntry } from './client-entry-action';
import { composeClientMaterialTasks, clientTaskEventsCommandSchema } from './client-task.composition';
import { composePersistedClientTaskAuthorization } from './client-task-execution.composition';
import { composeClientOriginalTaskModelHost, composeClientOriginalTaskInputReader } from './client-task-model-host.composition';
import { composeClientTaskModelConfiguration, type ClientCallGatewayDependencies, type ClientPersistedCallGatewayDependencies,
  type ClientGatewayDependencies, type ClientPersistedGatewayDependencies } from './client-task-model-configuration.composition';
import type { SecretBox } from '../../../common/secret-box';
import type { PublicGatewayRuntime } from '../public-ai-gateway.service';
import { isAiTaskInputSubmissionDraft, type AiTaskInputSubmissionDraft } from '@rental-os/shared';
type ClientModelServerDependencies = Omit<Parameters<typeof composeClientOriginalTaskModelHost>[0],
  'subscriptions' | 'clientScene' | 'loadMaterial' | 'guard' | 'clock' | 'runtime' | 'priceVersion' | 'financialEvidence'> & (
    { runtime: PublicGatewayRuntime; priceVersion: string;
      financialEvidence: Parameters<typeof composeClientOriginalTaskModelHost>[0]['financialEvidence']; gateway?: never }
    | { gateway: (ClientCallGatewayDependencies | ClientPersistedCallGatewayDependencies | ClientGatewayDependencies | ClientPersistedGatewayDependencies) & { secrets: SecretBox };
      runtime?: never; priceVersion?: never; financialEvidence?: never });
type PersistedClientModelServerDependencies = Omit<Parameters<typeof composeClientOriginalTaskModelHost>[0],
  'subscriptions' | 'clientScene' | 'loadMaterial' | 'guard' | 'clock' | 'runtime' | 'priceVersion' | 'financialEvidence'> & {
    gateway: (ClientPersistedCallGatewayDependencies | ClientPersistedGatewayDependencies) & { secrets: SecretBox };
    runtime?: never; priceVersion?: never; financialEvidence?: never;
  };
import { AiClientTaskUnknownError, clientTaskCommandSchema } from './prisma-client-task-input.repository';
import { prepareClientOrderExplanation } from './client-order-explanation';
import { bookingSelectionSchema, readClientBookingMaterial } from './client-booking-material';
import { PrismaClientBookingRepository } from './prisma-client-booking.repository';
import { composeClientBooking } from './client-booking.composition';
import type { AiBookingMaterial } from '@rental-os/shared';
import type { ClientApiService } from '../../client/client-api.service';
import { composeClientOriginalQuotePreparation } from './client-quote-preparation.composition';

const id = z.string().trim().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const configurationSchema = z.object({ enabled: z.literal(true), tenantCode: id, serviceCode: id,
  channel: z.enum(['wechat_miniprogram', 'app', 'web']), appId: id.optional(),
  entry: z.object({ enabled: z.literal(true), releaseRevision: id }).strict().optional() }).strict();
const commandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('catalog') }).strict(), z.object({ kind: z.literal('help') }).strict(),
  z.object({ kind: z.literal('profile') }).strict(), z.object({ kind: z.literal('order'), orderId: id }).strict(),
  z.object({ kind: z.literal('cancellation_preview'), orderId: id }).strict(),
  z.object({ kind: z.literal('booking_quote'), selection: bookingSelectionSchema }).strict()
]);
const operationSchema = z.object({ operationKey: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  command: commandSchema }).strict();
const sourceSchema = aiClientSourceReadRequestSchema;
const explanationSchema = aiClientOrderExplanationReadRequestSchema;
const taskSceneSchema = clientTaskCommandSchema.extend({ question: z.enum(['status', 'fees']).default('status') }).strict();
const bearerSchema = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
export type AiClientRequestConfiguration = z.infer<typeof configurationSchema>;
export type AiClientApplicationRequest = { headers: { authorization?: unknown }; ip?: string };
export type AiClientRequestDependencies = {
  client: Parameters<typeof composeAiClientScenes>[0]['client'];
  addresses?: Parameters<typeof composeAiClientScenes>[0]['addresses'];
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  db: AiClientMaterialDb;
  tasks?: AiClientTaskDependencies;
  clock?: () => Date;
  /** Explicit same-database server input source for cancellation observation;
   * never accepted as a customer body or used to start a model. */
  taskInputs?: Pick<Parameters<typeof composeClientOriginalTaskInputReader>[0], 'db' | 'inputSource' | 'gatewayScene'>;
  /** Public controls use ONLY this explicit persistent Vault/BYOK/single-ledger
   * server root, never a supplied runtime or customer request configuration. */
  taskModel?: PersistedClientModelServerDependencies;
  /** Result reads require the same repository, not a provider or budget root. */
  taskResults?: { db: ConstructorParameters<typeof PrismaTaskRecoverySnapshotRepository>[0]
    & ConstructorParameters<typeof AiTaskResultRepository>[0] };
  /** Original booking page only, explicit server assembly. Same ClientApiService
   * singleton as the read projection; never an Agent-selected executor. */
  bookingSubmission?: Pick<ClientApiService, 'prepareOrderSubmission' | 'readOrderSubmission' | 'createOrder'>;
  /** Same authorized client service; explicit human parameter confirmation,
   * never an automatically selected model tool or order approval. */
  quotePreparation?: Pick<ClientApiService, 'prepareQuoteForOriginalOperation' | 'createQuoteForOriginalOperation' | 'readQuoteForOriginalOperation'>;
};
type Command = z.infer<typeof commandSchema>;
const fail = (code: 'AI_CLIENT_INVALID_INPUT' | 'AI_CLIENT_CONTEXT_UNAVAILABLE' | 'AI_CLIENT_CAPABILITY_UNAVAILABLE' | 'AI_CLIENT_MATERIAL_STALE'): never => { throw new Error(code); };
const maxBytes = 65536, lifetimeMs = 300000;
const jsonHash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));

export function composeRequestBoundClientApplication(dependencies: AiClientRequestDependencies, configuration: AiClientRequestConfiguration) {
  const parsed = configurationSchema.safeParse(structuredClone(configuration));
  if (!parsed.success || typeof dependencies.guard?.canActivate !== 'function'
    || 'session' in dependencies || 'credentials' in dependencies) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
  const server = freezeOriginalInput(parsed.data), clock = dependencies.clock ?? (() => new Date());
  const assertReadPolicyUnchanged = (before: Awaited<ReturnType<AiClientPolicyAuthority['authorize']>>,
    after: Awaited<ReturnType<AiClientPolicyAuthority['authorize']>>) => {
    const observed = clock(), firstAt = Date.parse(before.context.authorizedAt), lastAt = Date.parse(after.context.authorizedAt);
    if (!(observed instanceof Date) || !Number.isFinite(observed.getTime()) || !Number.isFinite(firstAt)
      || !Number.isFinite(lastAt) || lastAt < firstAt || lastAt > observed.getTime()) {
      throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'clock_unavailable');
    }
    const basis = (grant: typeof before) => {
      // Observation timestamps and request IDs are not authorization revisions.
      const { authorizedAt: _at, requestId: _request, ...identity } = grant.context;
      return jsonHash({ ...grant, context: identity });
    };
    if (before.policy.expiresAt <= observed || after.policy.expiresAt <= observed || basis(before) !== basis(after)) {
      throw new AiClientEntryError('AI_ACCESS_DENIED', 'entry_policy_changed');
    }
    return observed;
  };
  const taskDependencies = dependencies.tasks ? { db: dependencies.tasks.db, subscriptions: dependencies.tasks.subscriptions,
    ...clientTaskSceneSchema.parse({ sceneCode: dependencies.tasks.sceneCode, sceneVersion: dependencies.tasks.sceneVersion }) } : null;
  if (taskDependencies && (taskDependencies.db !== dependencies.db || typeof taskDependencies.db.aiTask?.findFirst !== 'function'
    || typeof taskDependencies.db.aiScope?.findFirst !== 'function' || typeof taskDependencies.db.aiBudgetPolicy?.findUnique !== 'function'
    || typeof taskDependencies.subscriptions?.readCategoryCommercialContext !== 'function')) return fail('AI_CLIENT_CAPABILITY_UNAVAILABLE');
  const repository = new PrismaClientSceneMaterialRepository(dependencies.db);
  const guest = composeAiClientScenes({ client: dependencies.client }).guest;
  const publication = async () => {
    const bootstrap = await guest.bootstrap(server.tenantCode, server.channel, server.appId);
    const services = bootstrap.services.filter(service => service.code === server.serviceCode && service.status === 'open');
    if (bootstrap.tenantCode !== server.tenantCode || bootstrap.client !== server.channel || bootstrap.source !== 'channel'
      || !bootstrap.capabilities.publicCatalog || services.length !== 1) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
    const service = services[0], scope = await repository.resolveScope(server.tenantCode, server.serviceCode);
    return { scope, value: freezeOriginalInput({ tenantCode: bootstrap.tenantCode, channel: bootstrap.client,
      service: { code: service.code, name: service.name, categoryCode: service.categoryCode, status: service.status } }) };
  };
  type Published = Awaited<ReturnType<typeof publication>>;
  type Bound = { published: Published; identity: ClientRequestContext | null; bindingHash: string;
    scenes: ReturnType<typeof composeAiClientScenes>; assertCurrent(): Promise<void> };
  const withBinding = async <T>(request: AiClientApplicationRequest, member: boolean, kind: string, consume: (bound: Bound) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const header = member ? bearerSchema.safeParse(request?.headers?.authorization) : undefined;
    if (member && !header?.success) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
    const credential = Object.freeze({ authorization: header?.success ? header.data : '', ip: request?.ip });
    let active = true;
    const close = () => { active = false; };
    signal?.addEventListener('abort', close, { once: true });
    try {
      if (signal?.aborted) throw new AiClientEntryError('AI_RESULT_UNKNOWN', 'request_interrupted');
      return await runWithRequestIdentity({}, async () => {
        if (!member) {
          const path = `/api/client/v1/${kind === 'catalog' ? 'public/catalog' : 'public/documents/help'}`;
          const publicRequest = { method: 'GET', url: path, originalUrl: path, headers: {}, ip: credential.ip,
            query: { tenantCode: server.tenantCode, ...(kind === 'catalog' ? { service: server.serviceCode } : {}) }, body: {} };
          if (await dependencies.guard.canActivate(new ExecutionContextHost([publicRequest])) !== true) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
        }
        const source = member ? createAiGuardedClientSession(dependencies.guard, { current: async () => {
          if (!active) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
          return { ...credential };
        } }) : undefined;
        const identity = source ? await source.current() : null, before = await publication();
        if (identity && (identity.tenantId !== before.scope.tenantId || identity.workspaceId !== before.scope.workspaceId
          || identity.tenantCode !== server.tenantCode || identity.workspaceCode !== server.serviceCode
          || identity.categoryCode !== before.value.service.categoryCode)) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
        const bindingHash = requestFingerprint({ publication: before, identity, appId: server.appId ?? null });
        const scenes = composeAiClientScenes({ client: dependencies.client, addresses: dependencies.addresses, ...(source ? { session: source } : {}) });
        const assertCurrent = async () => {
          if (!active) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
          const after = await publication(), current = source ? await source.current() : null;
          if (bindingHash !== requestFingerprint({ publication: after, identity: current, appId: server.appId ?? null })) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
        };
        const result = await consume({ published: before, identity, bindingHash, scenes, assertCurrent });
        await assertCurrent();
        return result;
      });
    } finally { signal?.removeEventListener('abort', close); close(); }
  };
  const scopeOf = (bound: Bound): AiClientMaterialScope => {
    const identity = bound.identity;
    if (!identity) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
    return { ...bound.published.scope, channel: server.channel, principalKind: identity.customerType,
      principalHash: requestFingerprint({ ...bound.published.scope, channel: server.channel, appId: server.appId ?? null,
        customerId: identity.customerId, customerType: identity.customerType, sessionId: identity.sessionId }) };
  };
  const materialHash = (command: Command, value: unknown) => {
    if (command.kind === 'cancellation_preview' && value && typeof value === 'object' && 'calculatedAt' in value) {
      // A new observation time alone does not change the estimated cancellation fee.
      const { calculatedAt: _observation, ...facts } = value;
      return requestFingerprint(facts);
    }
    return requestFingerprint(value);
  };
  const readMaterial = async (bound: Bound, command: Command) => {
    let value: unknown;
    switch (command.kind) {
      case 'catalog': value = await bound.scenes.guest.catalog(server.tenantCode, server.serviceCode); break;
      case 'help': value = await bound.scenes.guest.help(server.tenantCode); break;
      case 'profile': value = await bound.scenes.member.profile(); break;
      case 'order': value = await bound.scenes.member.order(command.orderId); break;
      case 'cancellation_preview': value = await bound.scenes.member.cancellationPreview(command.orderId); break;
      case 'booking_quote':
        requireBooking();
        if (!bound.identity) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
        value = await readClientBookingMaterial(bound.scenes, bound.identity, command.selection, clock);
        break;
    }
    const text = JSON.stringify(value);
    if (!text || Buffer.byteLength(text, 'utf8') > maxBytes) return fail('AI_CLIENT_CAPABILITY_UNAVAILABLE');
    return freezeOriginalInput(JSON.parse(text) as unknown);
  };
  const verify = async (bound: Bound, row: AiClientSceneMaterial) => {
    const parsedCommand = commandSchema.safeParse(row.command);
    if (!parsedCommand.success || row.inputHash !== requestFingerprint(parsedCommand.data)
      || row.bindingHash !== bound.bindingHash || row.publicationHash !== requestFingerprint(bound.published.value)
      || row.publicationHash !== requestFingerprint(row.publication) || row.expiresAt <= clock()
      || row.materialHash !== materialHash(parsedCommand.data, row.material)) return fail('AI_CLIENT_MATERIAL_STALE');
    const entryBefore = parsedCommand.data.kind === 'booking_quote' ? await entryGrant(bound, row) : null;
    const current = await readMaterial(bound, parsedCommand.data);
    if (materialHash(parsedCommand.data, current) !== row.materialHash) return fail('AI_CLIENT_MATERIAL_STALE');
    if (entryBefore && (await entryGrant(bound, row)).policyFingerprint !== entryBefore.policyFingerprint) {
      throw new AiClientEntryError('AI_ACCESS_DENIED', 'entry_policy_changed');
    }
    const latest = await repository.findSource(scopeOf(bound), row.id);
    if (!latest || jsonHash(row) !== jsonHash(latest) || row.expiresAt <= clock()) return fail('AI_CLIENT_MATERIAL_STALE');
    return parsedCommand.data;
  };
  const packet = (row: AiClientSceneMaterial, command: Command) => freezeOriginalInput({
    state: 'saved' as const, operationKey: row.operationKey, inputHash: row.inputHash, revision: row.revision,
    materialRef: row.id, kind: command.kind, material: row.material, materialHash: row.materialHash,
    source: { materialRef: row.id, tenantCode: server.tenantCode, serviceCode: server.serviceCode, channel: server.channel },
    publication: row.publication, expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(),
    trust: 'client_api_projection_not_model_instructions' as const, durability: 'persisted_client_material_not_task_history' as const,
    handoff: command.kind === 'cancellation_preview' ? { method: 'POST' as const,
      path: `/api/client/v1/orders/${encodeURIComponent(command.orderId)}/cancel`, requiredBodyFields: ['reason'],
      confirmation: 'explicit_human_action' as const, execution: 'not_attempted' as const } : null,
    model: 'unavailable_client_execution_contract_missing' as const, automaticExecution: false as const
  });
  const parseOperation = (value: unknown) => {
    const input = operationSchema.safeParse(structuredClone(value));
    if (!input.success) return fail('AI_CLIENT_INVALID_INPUT');
    return freezeOriginalInput(input.data);
  };
  const taskOperation = async (request: AiClientApplicationRequest, value: unknown, operation: 'create' | 'readCreation' | 'readSnapshot' | 'readEvents', signal?: AbortSignal) => {
    const parsed = (operation === 'readEvents' ? clientTaskEventsCommandSchema : clientTaskCommandSchema).safeParse(structuredClone(value));
    if (!parsed.success) return fail('AI_CLIENT_INVALID_INPUT');
    if (!taskDependencies) return fail('AI_CLIENT_CAPABILITY_UNAVAILABLE');
    const command = freezeOriginalInput(parsed.data);
    let returned = false;
    try {
      return await withBinding(request, true, 'order', async bound => {
        const identity = bound.identity;
        if (!identity) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
        const load = async (materialRef: string) => {
          await bound.assertCurrent();
          const row = await repository.findSource(scopeOf(bound), materialRef);
          if (!row) return fail('AI_CLIENT_MATERIAL_STALE');
          await verify(bound, row);
          await bound.assertCurrent();
          return { row, identity };
        };
        const tasks = composeClientMaterialTasks(taskDependencies, load, clock);
        const result = await tasks[operation](command);
        returned = true;
        const material = await load(command.materialRef);
        if (operation === 'readSnapshot' || operation === 'readEvents') return freezeOriginalInput(result);
        return freezeOriginalInput({ ...result, source: { materialRef: material.row.id, materialHash: material.row.materialHash,
          tenantCode: server.tenantCode, serviceCode: server.serviceCode, channel: server.channel } });
      }, signal);
    } catch (error) {
      if (returned && operation === 'create') throw new AiClientTaskUnknownError();
      throw error;
    }
  };
  const requireEntry = () => {
    if (!server.entry || !taskDependencies) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'entry_disabled');
    return clientEntrySurface(server.channel);
  };
  const entryGrant = async (bound: Bound, row: AiClientSceneMaterial, operation: 'create' | 'read' = 'create') => {
    requireEntry();
    if (!taskDependencies || !bound.identity) throw new AiClientEntryError('AI_ACCESS_DENIED', 'client_required');
    const identity = bound.identity;
    const authority = new AiClientTaskAuthority(taskDependencies, taskDependencies, async ref => {
      if (ref !== row.id) throw new AiClientEntryError('AI_ACCESS_DENIED', 'material_binding');
      await bound.assertCurrent();
      return { row, identity };
    }, randomUUID(), clock);
    const grant = await authority.authorize(row.id, operation);
    return { policyFingerprint: requestFingerprint({ policyHash: grant.policyHash ?? requestFingerprint(grant.policy),
      release: server.entry }), expiresAt: grant.policy.expiresAt };
  };
  const verifyEntryMaterial = async (bound: Bound, row: AiClientSceneMaterial) => {
    const key = `entry-invalid:${row.id}`, scope = scopeOf(bound);
    if (await repository.findOperation(scope, key)) throw new AiClientEntryError('AI_PROPOSAL_STALE', 'action_invalidated', 'reprepare');
    try {
      const command = await verify(bound, row), grant = await entryGrant(bound, row);
      await verify(bound, row);
      const latest = await entryGrant(bound, row);
      if (latest.policyFingerprint !== grant.policyFingerprint) throw new AiClientEntryError('AI_ACCESS_DENIED', 'entry_policy_changed');
      if (await repository.findOperation(scope, key)) throw new AiClientEntryError('AI_PROPOSAL_STALE', 'action_invalidated', 'reprepare');
      if (row.expiresAt <= clock() || grant.expiresAt <= clock()) throw new AiClientEntryError('AI_PROPOSAL_STALE', 'action_expired', 'reprepare');
      return { command, grant };
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : null;
      const status = error instanceof Error && 'getStatus' in error && typeof error.getStatus === 'function' ? error.getStatus() : null;
      if (code === 'AI_PROPOSAL_STALE' || code === 'AI_ACCESS_DENIED' || code === 'AI_RESOURCE_UNAVAILABLE' || [401, 403, 404].includes(status)
        || (error instanceof Error && ['AI_CLIENT_MATERIAL_STALE', 'AI_CLIENT_CONTEXT_UNAVAILABLE'].includes(error.message))) {
        const command = { kind: 'entry_invalid', materialRef: row.id }, material = { reason: 'current_basis_invalid' }, createdAt = clock();
        await repository.save({ ...row, id: randomUUID(), operationKey: key, command, material,
          inputHash: requestFingerprint(command), materialHash: requestFingerprint(material), createdAt,
          expiresAt: new Date(createdAt.getTime() + lifetimeMs) });
      }
      throw error;
    }
  };
  const orderAction = async (bound: Bound, materialRef: string) => {
    const row = await repository.findSource(scopeOf(bound), materialRef);
    if (!row) throw new AiClientEntryError('AI_ACCESS_DENIED', 'material_unavailable');
    const { command, grant } = await verifyEntryMaterial(bound, row);
    if (command.kind !== 'order') throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'action_not_assembled');
    return materialEntryAction(row, requireEntry(), grant.policyFingerprint, grant.expiresAt, command.orderId, 'OPEN_ORDER');
  };
  const bookingRepository = new PrismaClientBookingRepository(dependencies.db, clock);
  const requireBooking = () => {
    requireEntry();
    if (typeof dependencies.client.getQuote !== 'function' || typeof dependencies.client.bookingOptions !== 'function') {
      throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'booking_reads_not_assembled');
    }
  };
  const loadBookingMaterial = async (bound: Bound, materialRef: string) => {
    requireBooking();
    const row = await repository.findSource(scopeOf(bound), materialRef);
    if (!row) throw new AiClientEntryError('AI_ACCESS_DENIED', 'booking_material_unavailable');
    const { command, grant } = await verifyEntryMaterial(bound, row);
    if (command.kind !== 'booking_quote') throw new AiClientEntryError('AI_INVALID_INPUT', 'booking_material_required');
    return { row, material: row.material as AiBookingMaterial, policyFingerprint: grant.policyFingerprint, policyExpiresAt: grant.expiresAt };
  };
  const booking = (bound: Bound) => composeClientBooking({ repository: bookingRepository, scope: scopeOf(bound),
    bindingHash: bound.bindingHash, surface: requireEntry(), clock, assertCurrent: bound.assertCurrent,
    loadMaterial: ref => loadBookingMaterial(bound, ref) });
  const bookingOperation = async <T>(request: AiClientApplicationRequest, value: unknown, writes: boolean,
    consume: (app: ReturnType<typeof composeClientBooking>, command: unknown) => Promise<T>): Promise<T> => {
    requireBooking();
    const frozen = freezeOriginalInput(structuredClone(value));
    let returned = false;
    try {
      return await withBinding(request, true, 'order', async bound => {
        const result = await consume(booking(bound), frozen);
        returned = true;
        return result;
      });
    } catch (error) {
      if (returned && writes) {
        throw new AiClientEntryError('AI_RESULT_UNKNOWN', 'booking_commit_unacknowledged', 'read_booking_operation');
      }
      throw error;
    }
  };
  const hasSubmissionPort = () => {
    const port = dependencies.bookingSubmission;
    return !!port && (port as unknown) === dependencies.client && ['prepareOrderSubmission', 'readOrderSubmission', 'createOrder']
      .every(key => typeof port[key as keyof typeof port] === 'function');
  };
  const hasReceiptPort = () => !!dependencies.bookingSubmission && (dependencies.bookingSubmission as unknown) === dependencies.client
    && typeof dependencies.bookingSubmission.readOrderSubmission === 'function';
  const receiptPort = () => {
    requireEntry();
    if (!hasReceiptPort()) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'original_booking_receipt_not_assembled');
    return dependencies.bookingSubmission!;
  };
  const submissionPort = () => {
    if (!hasSubmissionPort()) {
      throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'original_booking_submission_not_assembled');
    }
    requireBooking();
    return dependencies.bookingSubmission!;
  };
  const submissionDraft = z.object({ handoffRef: z.string().uuid(), contactPhone: z.string().max(32).optional() }).strict();
  const acceptedRef = z.object({ acceptanceRef: z.string().uuid() }).strict();
  const confirmedAcceptance = acceptedRef.extend({ decision: z.literal('submit_original_booking') }).strict();
  type Acceptance = { version: 'client-booking-acceptance-1'; handoffRef: string; bookingDraftId: string;
    selectionRevision: number; inputFingerprint: string; quoteId: string; operationKey: string;
    accepted: Awaited<ReturnType<ClientApiService['prepareOrderSubmission']>> };
  const acceptedView = (row: AiClientSceneMaterial, material: Acceptance) => freezeOriginalInput({
    acceptanceRef: row.id, handoffRef: material.handoffRef, bookingDraftId: material.bookingDraftId,
    selectionRevision: material.selectionRevision, inputFingerprint: material.inputFingerprint,
    quoteId: material.quoteId, operationKey: material.operationKey, execution: 'not_attested' as const });
  const loadAcceptance = async (bound: Bound, ref: string) => {
    const row = await repository.findSource(scopeOf(bound), ref);
    if (!row || row.bindingHash !== bound.bindingHash || row.materialHash !== jsonHash(row.material)
      || row.inputHash !== jsonHash(row.command) || !row.material || typeof row.material !== 'object') {
      throw new AiClientEntryError('AI_ACCESS_DENIED', 'booking_acceptance_unavailable');
    }
    const material = row.material as Acceptance;
    const original = parseEntry(submissionDraft, row.command);
    if (material.version !== 'client-booking-acceptance-1' || material.operationKey !== row.operationKey
      || material.operationKey !== `booking-order:${jsonHash({ scope: scopeOf(bound), handoffRef: original.handoffRef })}`
      || material.handoffRef !== original.handoffRef || !z.string().uuid().safeParse(material.bookingDraftId).success
      || !Number.isInteger(material.selectionRevision) || material.selectionRevision < 1
      || !z.string().regex(/^[a-f0-9]{64}$/u).safeParse(material.inputFingerprint).success
      || material.accepted?.request?.quoteId !== material.quoteId
      || material.accepted.tenantId !== bound.identity?.tenantId
      || material.accepted.workspaceId !== bound.identity?.workspaceId
      || material.accepted.customerId !== bound.identity?.customerId) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'booking_acceptance_invalid');
    // Reauthorize historical receipt access without re-consuming an already used quote.
    const grant = await entryGrant(bound, row, 'read');
    const latest = await repository.findSource(scopeOf(bound), ref);
    if (!latest || jsonHash(latest) !== jsonHash(row)) {
      throw new AiClientEntryError('AI_REVISION_CONFLICT', 'booking_acceptance_changed');
    }
    await bound.assertCurrent();
    return { row, material, policyFingerprint: grant.policyFingerprint };
  };
  const originalBookingCall = async <T>(request: AiClientApplicationRequest, bound: Bound, body: { quoteId: string; contactPhone?: string },
    write: boolean, consume: (identity: ClientRequestContext) => Promise<T>) => runWithRequestIdentity({}, async () => {
    const guarded: { method: string; url: string; originalUrl: string; headers: { authorization: unknown };
      body: unknown; query: unknown; ip?: string; client?: ClientRequestContext } = { method: write ? 'POST' : 'GET',
      url: write ? '/api/client/v1/orders' : '/api/client/v1/auth/me', originalUrl: write ? '/api/client/v1/orders' : '/api/client/v1/auth/me',
      headers: { authorization: request.headers.authorization }, body: write ? body : {}, query: {}, ip: request.ip };
    if (await dependencies.guard.canActivate(new ExecutionContextHost([guarded])) !== true || !guarded.client
      || jsonHash(guarded.client) !== jsonHash(bound.identity)) throw new AiClientEntryError('AI_ACCESS_DENIED', 'booking_current_identity_changed');
    const current = getRequestIdentity();
    if (!current || current.tenantId !== guarded.client.tenantId || current.workspaceId !== guarded.client.workspaceId
      || current.userId !== guarded.client.customerId || current.isSaasAdmin) throw new AiClientEntryError('AI_ACCESS_DENIED', 'booking_identity_scope_missing');
    return consume(structuredClone(guarded.client));
  });
  const readSubmission = async (request: AiClientApplicationRequest, bound: Bound, acceptance: Awaited<ReturnType<typeof loadAcceptance>>) => {
    const { row, material, policyFingerprint } = freezeOriginalInput(structuredClone(acceptance));
    const result = await originalBookingCall(request, bound, { quoteId: material.quoteId }, false,
      identity => receiptPort().readOrderSubmission(identity, structuredClone(material.accepted), material.operationKey));
    const receipt = structuredClone(result);
    const latest = await loadAcceptance(bound, row.id);
    if (latest.policyFingerprint !== policyFingerprint) {
      throw new AiClientEntryError('AI_ACCESS_DENIED', 'booking_receipt_policy_changed');
    }
    if (jsonHash(latest.row) !== jsonHash(row)) {
      throw new AiClientEntryError('AI_REVISION_CONFLICT', 'booking_acceptance_changed');
    }
    await bound.assertCurrent();
    return freezeOriginalInput({ ...receipt, operationKey: material.operationKey, retryable: false as const,
      payment: 'not_inferred' as const, fulfillment: 'not_inferred' as const });
  };
  const runOriginalTaskModel = async (request: AiClientApplicationRequest, value: unknown,
    model: ClientModelServerDependencies, signal?: AbortSignal, answers?: Omit<AiTaskInputSubmissionDraft, 'taskId'>,
    control?: 'recover' | 'reconcile' | 'continue') => {
      requireEntry();
      if (!taskDependencies || model?.db !== dependencies.db) {
        throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_model_dependencies_missing');
      }
      const gatewayServer = !model.gateway ? null : 'pricing' in model.gateway
        ? { ...model.gateway, adapters: [...model.gateway.adapters], pricing: structuredClone(model.gateway.pricing) }
        : { ...model.gateway, adapters: [...model.gateway.adapters] };
      if (gatewayServer && (gatewayServer.db !== dependencies.db
        || gatewayServer.routeScene !== model.gatewayScene.routeScene)) {
        throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_model_dependencies_mismatch');
      }
      const command = parseEntry(clientTaskCommandSchema, structuredClone(value));
      return withBinding(request, true, 'order', async bound => {
        const loadMaterial = async (materialRef: string) => {
          await bound.assertCurrent();
          const row = await repository.findSource(scopeOf(bound), materialRef);
          if (!row || !bound.identity) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          await verify(bound, row);
          await bound.assertCurrent();
          return { row, identity: structuredClone(bound.identity) };
        };
        const configuration = gatewayServer ? await composeClientTaskModelConfiguration({ ...taskDependencies,
          db: gatewayServer.db, secrets: gatewayServer.secrets, loadMaterial, clock }, command) : null;
        const configured = (() => {
          if (!gatewayServer || !configuration) return null;
          if ('pricing' in gatewayServer) return 'platformConnection' in gatewayServer
            ? configuration.createGateway(gatewayServer) : configuration.createPersistedGateway(gatewayServer);
          return 'platformConnection' in gatewayServer
            ? configuration.createCallGateway(gatewayServer) : configuration.createPersistedCallGateway(gatewayServer);
        })();
        const runtime = configured?.runtime ?? model.runtime, priceVersion = configured?.priceVersion ?? model.priceVersion;
        const financialEvidence = configured?.financialEvidence ?? model.financialEvidence;
        if (!runtime || !priceVersion || !financialEvidence) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_model_dependencies_missing');
        const host = await composeClientOriginalTaskModelHost({ ...model, runtime, priceVersion, financialEvidence,
          subscriptions: taskDependencies.subscriptions, clientScene: {
            sceneCode: taskDependencies.sceneCode, sceneVersion: taskDependencies.sceneVersion },
          loadMaterial, guard: dependencies.guard, clock }, command, control ?? (answers ? 'resume' : 'start'));
        const result = control === 'recover' ? await host.recover(signal)
          : control === 'reconcile' ? await host.reconcile(signal)
          : control === 'continue' && answers ? await host.continueSubmittedInput(answers, signal)
          : answers ? await host.resume(answers, signal) : await host.start(signal);
        await bound.assertCurrent();
        return result;
      });
  };
  const withOriginalTaskInput = async <T>(request: AiClientApplicationRequest, value: unknown,
    source: Pick<Parameters<typeof composeClientOriginalTaskInputReader>[0], 'db' | 'inputSource' | 'gatewayScene'>,
    consume: (reader: Awaited<ReturnType<typeof composeClientOriginalTaskInputReader>>) => Promise<T>) => {
    // Original task observation/convergence does not need a booking navigation
    // surface. The server entry gate, current policy and Guard still apply.
    if (!server.entry || !taskDependencies) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'entry_disabled');
    if (!taskDependencies || source?.db !== dependencies.db) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_input_dependencies_missing');
    const command = parseEntry(clientTaskCommandSchema, structuredClone(value));
    return withBinding(structuredClone(request), true, 'order', async bound => {
      const loadMaterial = async (materialRef: string) => {
        await bound.assertCurrent();
        const row = await repository.findSource(scopeOf(bound), materialRef);
        if (!row || !bound.identity) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        await verify(bound, row);
        await bound.assertCurrent();
        return { row, identity: structuredClone(bound.identity) };
      };
      const reader = await composeClientOriginalTaskInputReader({ ...source,
        clientScene: { sceneCode: taskDependencies.sceneCode, sceneVersion: taskDependencies.sceneVersion },
        subscriptions: taskDependencies.subscriptions, loadMaterial, clock }, command);
      const result = await consume(reader);
      await bound.assertCurrent();
      return result;
    });
  };
  const configuredTaskInputSource = dependencies.taskInputs && {
    ...dependencies.taskInputs, gatewayScene: structuredClone(dependencies.taskInputs.gatewayScene) };
  const configuredModel = (): PersistedClientModelServerDependencies => {
    const model = dependencies.taskModel;
    if (!model || model.db !== dependencies.db || model.gateway?.db !== dependencies.db
      || ('kind' in model && model.kind !== undefined)
      || ['runtime', 'priceVersion', 'financialEvidence'].some(key => Object.prototype.hasOwnProperty.call(model, key))
      || Object.prototype.hasOwnProperty.call(model.gateway, 'platformConnection'))
      throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_persisted_model_dependencies_missing');
    return model;
  };
  const configuredResultSource = dependencies.taskResults
    ?? (dependencies.taskInputs && { db: dependencies.taskInputs.db })
    ?? (dependencies.taskModel && { db: dependencies.taskModel.db });
  const withQuotePreparation = async <T>(request: AiClientApplicationRequest,
    consume: (preparation: ReturnType<typeof composeClientOriginalQuotePreparation>, bound: Bound) => Promise<T>) => {
    if (!server.entry || !taskDependencies || server.channel === 'app' || !dependencies.quotePreparation)
      return fail('AI_CLIENT_CAPABILITY_UNAVAILABLE');
    const credential = bearerSchema.safeParse(request?.headers?.authorization);
    if (!credential.success) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
    const authorization = credential.data, ip = request.ip;
    return withBinding(request, true, 'quotes', async bound => {
      const preparation = composeClientOriginalQuotePreparation({ enabled: true,
        client: dependencies.quotePreparation!, guard: dependencies.guard,
        credentials: { current: async () => ({ authorization, ip }) }, tasks: taskDependencies,
        tenantCode: server.tenantCode, serviceCode: server.serviceCode,
        channel: server.channel as 'web' | 'wechat_miniprogram', clock });
      const result = await consume(preparation, bound);
      await bound.assertCurrent();
      return result;
    });
  };
  return Object.freeze({
    /** Original material INSERT receipt, not refreshed order facts or execution
     * permission. A changed order/expired material must not erase its receipt. */
    async readOrderMaterialReceipt(request: AiClientApplicationRequest, value: unknown, signal?: AbortSignal) {
      requireEntry();
      if (!taskDependencies) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const command = parseEntry(aiClientOrderMaterialRequestSchema, structuredClone(value));
      return withBinding(structuredClone(request), true, 'order', async bound => {
        if (!bound.identity) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const authority = new AiClientPolicyAuthority(taskDependencies, taskDependencies, randomUUID(), clock);
        const subject = { ...scopeOf(bound), identity: structuredClone(bound.identity) };
        const before = await authority.authorize(subject, 'read');
        // Current ownership/visibility is necessary, but today's content/hash is
        // never substituted for the immutable original INSERT.
        await bound.scenes.member.order(command.orderId);
        const row = await repository.findOperation(scopeOf(bound), command.operationKey);
        const original = { kind: 'order' as const, orderId: command.orderId };
        if (row && (row.inputHash !== requestFingerprint(original) || jsonHash(row.command) !== jsonHash(original)
          || row.materialHash !== materialHash(original, row.material))) throw new AiClientMaterialError('AI_CLIENT_REVISION_CONFLICT');
        await bound.assertCurrent();
        assertReadPolicyUnchanged(before, await authority.authorize(subject, 'read'));
        return freezeOriginalInput(aiClientOrderMaterialReceiptSchema.parse({ contractVersion: AI_CLIENT_MATERIAL_RECEIPT_VERSION,
          operationKey: command.operationKey, state: row ? 'observed' : 'unknown', materialRef: row?.id ?? null,
          materialHash: row?.materialHash ?? null, expiresAt: row?.expiresAt.toISOString() ?? null,
          execution: 'not_attested', freshness: 'revalidate_before_execution', retryable: false,
          nextAction: 'read_original_material_receipt' }));
      }, signal);
    },
    /** Server-only request consumers. Public transport must use its formal
     * whitelist contract; these methods are not registered by this composition. */
    async prepareQuoteParameters(request: AiClientApplicationRequest, value: unknown) {
      const command = structuredClone(value);
      return withQuotePreparation(request, preparation => preparation.prepare(command));
    },
    async readQuotePreparationOperation(request: AiClientApplicationRequest, value: unknown) {
      const command = structuredClone(value);
      return withQuotePreparation(request, preparation => preparation.readPreparationOperation(command));
    },
    async confirmQuoteParameters(request: AiClientApplicationRequest, value: unknown) {
      const command = structuredClone(value);
      return withQuotePreparation(request, preparation => preparation.confirm(command));
    },
    async readPreparedQuoteOriginal(request: AiClientApplicationRequest, value: unknown) {
      const command = structuredClone(value);
      return withQuotePreparation(request, preparation => preparation.readOriginal(command));
    },
    /** Human-host consumer of an exact original quote and an explicit booking
     * selection. The full Core snapshot never crosses this read boundary.
     * No quote creation, draft persistence, stock lock or order submission. */
    async readPreparedQuoteBookingMaterial(request: AiClientApplicationRequest, value: unknown, selection: unknown) {
      const command = freezeOriginalInput(structuredClone(value));
      const chosen = freezeOriginalInput(parseEntry(bookingSelectionSchema, structuredClone(selection)));
      return withQuotePreparation(request, async (preparation, bound) => {
        if (!bound.identity) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
        const original = await preparation.readOriginal(command);
        if (original.state !== 'observed' || !original.quote) {
          return freezeOriginalInput({ source: original.source, state: 'unknown' as const,
            material: null, quotePersistence: 'unknown' as const, retryable: false as const,
            nextAction: 'read_original_quote' as const, inventoryReservation: 'not_attempted' as const,
            orderExecution: 'not_attempted' as const });
        }
        if (chosen.quoteId !== original.quote.id) throw new AiClientEntryError('AI_ACCESS_DENIED', 'quote_original_selection_mismatch');
        // Existing material reader checks customer ownership, original quote
        // parameters, membership, publication/catalog, locations and stock.
        const material = await readClientBookingMaterial(bound.scenes, bound.identity, chosen, clock);
        if (material.quote.quoteVersion !== jsonHash(original.quote)) {
          throw new AiClientEntryError('AI_REVISION_CONFLICT', 'quote_material_basis_changed');
        }
        const latest = await preparation.readOriginal(command);
        if (latest.state !== 'observed' || !latest.quote
          || jsonHash(latest.source) !== jsonHash(original.source)
          || jsonHash(latest.quote) !== jsonHash(original.quote)) {
          throw new AiClientEntryError('AI_REVISION_CONFLICT', 'quote_original_changed');
        }
        await bound.assertCurrent();
        return freezeOriginalInput({ source: original.source, state: 'observed' as const, material,
          quotePersistence: 'saved' as const, selection: 'explicit_booking_parameters_revalidated' as const,
          inventoryReservation: 'not_attempted' as const, orderExecution: 'not_attempted' as const,
          draftPersistence: 'not_attempted' as const, retryable: false as const });
      });
    },
    /** Discover only this original task's latest proved model run. No caller
     * result/run ID, earlier-run fallback, arbitrary artifact or raw config. */
    async readOriginalTaskModelResult(request: AiClientApplicationRequest, value: unknown, source = configuredResultSource) {
      if (!server.entry || !taskDependencies || !source || !Object.is(source.db, dependencies.db))
        throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_result_dependencies_missing');
      const command = parseEntry(clientTaskCommandSchema, structuredClone(value)), db = source.db;
      return withBinding(structuredClone(request), true, 'order', async bound => {
        const loadMaterial = async (materialRef: string) => {
          await bound.assertCurrent();
          const row = await repository.findSource(scopeOf(bound), materialRef);
          if (!row || !bound.identity) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          await verify(bound, row); await bound.assertCurrent();
          return { row, identity: structuredClone(bound.identity) };
        };
        const authorized = composePersistedClientTaskAuthorization(taskDependencies, command, loadMaterial, clock);
        const original = await composeClientMaterialTasks(taskDependencies, loadMaterial, clock).readCreation(command);
        if (!original.task) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const before = await authorized.execution.readGrant(original.task.taskId, 'read');
        const access = await authorized.tasks.resolveAccess(before.taskId, 'read_step_terminal');
        const selected = await db.$transaction(async tx => {
          const task = await tx.aiTask.findFirst({ where: access.where });
          if (!task || task.inputRef !== original.inputRef) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          const runs = await tx.aiRun.findMany({ where: { scopeId: task.scopeId, taskId: task.id,
            actorKind: access.actorKind, actorId: access.actorId }, orderBy: { sequence: 'desc' }, take: 2 });
          const run = runs[0];
          if (!run || runs[1]?.sequence === run.sequence) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          await readTaskModelRunOrigin(tx, access, { scopeId: task.scopeId, taskId: task.id, runId: run.id,
            originRunId: original.task!.runId, registrationRef: `client-model:${original.inputRef}` });
          const steps = await tx.aiStep.findMany({ where: { scopeId: task.scopeId, taskId: task.id, runId: run.id },
            orderBy: { sequence: 'desc' }, take: 2 });
          if (steps.length > 1 || steps.some(step => step.toolCode !== TASK_TEXT_MODEL_TOOL || step.toolVersion !== AI_TOOL_DRAFT_VERSION))
            throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          if (steps[0]?.resultRef && run.status === 'QUEUED') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          return { scopeId: task.scopeId, taskId: task.id, taskRevision: task.revision,
            runId: run.id, runRevision: run.revision, step: steps[0] ?? null };
        }, { maxWait: 2500, timeout: 5000 });
        const result = selected.step?.resultRef ? await new AiTaskResultRepository(db, authorized.tasks, clock)
          .read({ taskId: selected.taskId, resultId: selected.step.resultRef }) : null;
        if (result && (result.runId !== selected.runId || result.stepId !== selected.step?.id)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        let text: string | null = null;
        if (result?.status === 'succeeded') {
          if (!isGatewayResult(result.payload) || result.payload.status !== 'completed' || result.payload.toolRequests.length
            || typeof result.payload.text !== 'string') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          text = result.payload.text;
        }
        const current = await authorized.execution.readGrant(before.taskId, 'read');
        if (before.proof !== current.proof) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        const latest = await db.$transaction(async tx => ({
          run: await tx.aiRun.findFirst({ where: { scopeId: selected.scopeId, taskId: selected.taskId, id: selected.runId } }),
          step: selected.step ? await tx.aiStep.findFirst({ where: { scopeId: selected.scopeId, taskId: selected.taskId, id: selected.step.id } }) : null
        }), { maxWait: 2500, timeout: 5000 });
        if (latest.run?.id !== selected.runId || latest.run.scopeId !== selected.scopeId || latest.run.taskId !== selected.taskId
          || latest.run.revision !== selected.runRevision || latest.step?.revision !== selected.step?.revision
          || latest.step?.resultRef !== selected.step?.resultRef) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        const final = await authorized.execution.readGrant(before.taskId, 'read');
        if (before.proof !== final.proof) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        await bound.assertCurrent();
        const response = aiClientTaskModelResultReadResponseSchema.safeParse({ contractVersion: AI_TASK_DRAFT_VERSION,
          taskId: selected.taskId, taskRevision: selected.taskRevision, state: result ? 'observed' : 'not_observed',
          result: result ? { resultId: result.resultId, status: result.status, observedAt: result.observedAt, text } : null,
          authority: 'generated_text_not_business_fact', businessExecution: 'not_inferred_from_model_result',
          retryable: false, nextAction: 'read_original_task' });
        if (!response.success || Buffer.byteLength(JSON.stringify(response.data), 'utf8') > maxBytes)
          throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        return freezeOriginalInput(response.data);
      });
    },
    /** Server-only, original released-input witness; not a generic cancellation
     * finalizer and never a model/provider or budget-dependent operation. */
    reconcileOriginalTaskInputCancellation(request: AiClientApplicationRequest, value: unknown,
      source = configuredTaskInputSource) {
      if (!source) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_input_dependencies_missing');
      return withOriginalTaskInput(request, value, source, reader => reader.settleInputCancellation());
    },
    /** Original customer cancellation request only. No caller task/run/holder,
     * provider, approval, budget release or claim of external rollback. */
    async requestOriginalTaskCancellation(request: AiClientApplicationRequest, value: unknown) {
      if (!server.entry) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'entry_disabled');
      if (!taskDependencies) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_task_dependencies_missing');
      const parsed = parseEntry(aiClientTaskCancelRequestSchema, structuredClone(value));
      const { expectedRevision, ...original } = parsed;
      return withBinding(structuredClone(request), true, 'order', async bound => {
        const loadMaterial = async (materialRef: string) => {
          await bound.assertCurrent();
          const row = await repository.findSource(scopeOf(bound), materialRef);
          if (!row || !bound.identity) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          await verify(bound, row);
          await bound.assertCurrent();
          return { row, identity: structuredClone(bound.identity) };
        };
        const authorized = composePersistedClientTaskAuthorization(taskDependencies, original, loadMaterial, clock);
        const result = await authorized.cancellation.request({ expectedRevision });
        await bound.assertCurrent();
        return result;
      });
    },
    /** Server-only original execution read. No provider, lease, cancellation,
     * retry or financial authority is acquired by observing these facts. */
    async readOriginalTaskExecution(request: AiClientApplicationRequest, value: unknown,
      source: { db: ConstructorParameters<typeof PrismaTaskRecoverySnapshotRepository>[0] }) {
      if (!server.entry) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'entry_disabled');
      const db = source?.db;
      if (!taskDependencies || !Object.is(db, dependencies.db))
        throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_execution_dependencies_missing');
      const command = parseEntry(clientTaskCommandSchema, structuredClone(value));
      return withBinding(structuredClone(request), true, 'order', async bound => {
        const loadMaterial = async (materialRef: string) => {
          await bound.assertCurrent();
          const row = await repository.findSource(scopeOf(bound), materialRef);
          if (!row || !bound.identity) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          await verify(bound, row);
          await bound.assertCurrent();
          return { row, identity: structuredClone(bound.identity) };
        };
        const authorized = composePersistedClientTaskAuthorization(taskDependencies, command, loadMaterial, clock);
        const original = await composeClientMaterialTasks(taskDependencies, loadMaterial, clock).readCreation(command);
        if (!original.task) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const before = await authorized.execution.readGrant(original.task.taskId, 'read');
        const access = await authorized.tasks.resolveAccess(before.taskId, 'read_step_terminal');
        // Choose only the latest persisted run belonging to this original owner.
        // A resumed run needs the existing consumed-input lineage proof, not a
        // caller-selected run or a latest task/quote from another operation.
        const selected = await db.$transaction(async tx => {
          const task = await tx.aiTask.findFirst({ where: access.where });
          if (!task || task.inputRef !== original.inputRef) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          const runs = await tx.aiRun.findMany({ where: { scopeId: task.scopeId, taskId: task.id,
            actorKind: access.actorKind, actorId: access.actorId }, orderBy: { sequence: 'desc' }, take: 2 });
          const run = runs[0];
          if (!run || (runs[1] && run.sequence === runs[1].sequence)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          await readTaskModelRunOrigin(tx, access, { scopeId: task.scopeId, taskId: task.id,
            runId: run.id, originRunId: original.task!.runId, registrationRef: `client-model:${original.inputRef}` });
          return { runId: run.id, runRevision: run.revision, taskRevision: task.revision };
        }, { maxWait: 2500, timeout: 5000 }).catch(error => {
          if (error instanceof AiTaskRepositoryError) throw error;
          throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        });
        const snapshot = await new PrismaTaskRecoverySnapshotRepository(db, authorized.tasks)
          .read({ taskId: before.taskId, runId: selected.runId });
        const current = await authorized.execution.readGrant(before.taskId, 'read');
        if (before.proof !== current.proof || snapshot.task.revision !== selected.taskRevision
          || snapshot.run.revision !== selected.runRevision) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        await bound.assertCurrent();
        if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > maxBytes) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        return freezeOriginalInput(snapshot);
      });
    },
    /** Original-command result consumption, not model execution or a business
     * receipt. The server supplies the same repository; callers cannot choose
     * a task/run or provide a payload. No Gateway/lease/budget is constructed. */
    async readOriginalTaskResult(request: AiClientApplicationRequest, value: unknown,
      source: { db: ConstructorParameters<typeof AiTaskResultRepository>[0] }) {
      // A result read has no navigation Action. Do not require an assembled
      // booking-page surface, but retain explicit server opt-in and read policy.
      if (!server.entry) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'entry_disabled');
      const resultDb = source?.db;
      if (!taskDependencies || !Object.is(resultDb, dependencies.db)) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_result_dependencies_missing');
      const command = parseEntry(clientTaskCommandSchema.extend({ resultId: id }).strict(), structuredClone(value));
      const { resultId, ...original } = command;
      return withBinding(structuredClone(request), true, 'order', async bound => {
        const loadMaterial = async (materialRef: string) => {
          await bound.assertCurrent();
          const row = await repository.findSource(scopeOf(bound), materialRef);
          if (!row || !bound.identity) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          await verify(bound, row);
          await bound.assertCurrent();
          return { row, identity: structuredClone(bound.identity) };
        };
        const authorized = composePersistedClientTaskAuthorization(taskDependencies, original, loadMaterial, clock);
        const receipt = await composeClientMaterialTasks(taskDependencies, loadMaterial, clock).readCreation(original);
        if (!receipt.task) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const before = await authorized.execution.readGrant(receipt.task.taskId, 'read');
        const result = await new AiTaskResultRepository(resultDb, authorized.tasks, clock).read({ taskId: before.taskId, resultId });
        // Recheck material, publication, current identity and original task after
        // the result transaction. Changed input/policy/task cannot return old data.
        const current = await authorized.execution.readGrant(before.taskId, 'read');
        if (before.proof !== current.proof) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        await bound.assertCurrent();
        if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        return freezeOriginalInput(result);
      });
    },
    async readBookingAcceptance(request: AiClientApplicationRequest, value: unknown) {
      requireEntry();
      const command = parseEntry(aiBookingAcceptanceReadRequestSchema, structuredClone(value));
      return withBinding(structuredClone(request), true, 'order', async bound => {
        if (!taskDependencies || !bound.identity) throw new AiClientEntryError('AI_ACCESS_DENIED', 'client_required');
        const scope = scopeOf(bound), operationKey = `booking-order:${jsonHash({ scope, handoffRef: command.handoffRef })}`;
        const policy = new AiClientPolicyAuthority(taskDependencies, taskDependencies, randomUUID(), clock);
        const subject = { ...scope, identity: structuredClone(bound.identity) };
        const before = await policy.authorize(subject, 'read');
        const row = await repository.findOperation(scope, operationKey);
        let acceptance: ReturnType<typeof acceptedView> | null = null;
        if (row) {
          if (row.inputHash !== jsonHash(command)) throw new AiClientEntryError('AI_REVISION_CONFLICT', 'booking_accepted_input_changed');
          const existing = await loadAcceptance(bound, row.id);
          if (jsonHash(existing.row) !== jsonHash(row)) throw new AiClientEntryError('AI_REVISION_CONFLICT', 'booking_acceptance_changed');
          acceptance = acceptedView(existing.row, existing.material);
        }
        await bound.assertCurrent();
        const after = await policy.authorize(subject, 'read');
        assertReadPolicyUnchanged(before, after);
        return freezeOriginalInput({ contractVersion: AI_BOOKING_ACCEPTANCE_READ_VERSION,
          state: acceptance ? 'observed' as const : 'unknown' as const,
          handoffRef: command.handoffRef, operationKey, acceptance,
          currentUse: 'not_authorized_by_receipt' as const, execution: 'not_attested' as const,
          retryable: false as const, nextAction: acceptance ? 'read_original_submission' as const : 'read_original_acceptance' as const });
      });
    },
    /** Explicit human booking-page request, not an AI Tool or approval bypass. */
    async acceptBookingSubmission(request: AiClientApplicationRequest, value: unknown) {
      request = structuredClone(request);
      const port = submissionPort(), command = parseEntry(submissionDraft, structuredClone(value));
      return withBinding(request, true, 'order', async bound => {
        const scope = scopeOf(bound), operationKey = `booking-order:${jsonHash({ scope, handoffRef: command.handoffRef })}`;
        const prior = await repository.findOperation(scope, operationKey);
        if (prior) {
          if (prior.inputHash !== jsonHash(command)) throw new AiClientEntryError('AI_REVISION_CONFLICT', 'booking_accepted_input_changed');
          const existing = await loadAcceptance(bound, prior.id);
          return acceptedView(existing.row, existing.material);
        }
        const handoff = await booking(bound).readHandoff({ handoffRef: command.handoffRef });
        const draft = await booking(bound).read({ bookingDraftId: handoff.bookingDraftId });
        if (!bound.identity || !('selectionRevision' in draft)) throw new AiClientEntryError('AI_ACCESS_DENIED', 'booking_selection_missing');
        const body = { quoteId: handoff.fields.quoteId, ...(command.contactPhone !== undefined ? { contactPhone: command.contactPhone } : {}) };
        const accepted = await originalBookingCall(request, bound, body, true, identity => port.prepareOrderSubmission(identity, body));
        await booking(bound).readHandoff({ handoffRef: command.handoffRef });
        const material: Acceptance = { version: 'client-booking-acceptance-1', handoffRef: command.handoffRef,
          bookingDraftId: handoff.bookingDraftId, selectionRevision: draft.selectionRevision,
          inputFingerprint: draft.inputFingerprint, quoteId: handoff.fields.quoteId, operationKey, accepted };
        const row = await repository.save({ id: randomUUID(), ...scope, bindingHash: bound.bindingHash,
          publicationHash: jsonHash(bound.published.value), publication: bound.published.value, operationKey,
          command, inputHash: jsonHash(command), material, materialHash: jsonHash(material), revision: 1,
          createdAt: clock(), expiresAt: new Date(handoff.expiresAt) });
        await bound.assertCurrent();
        const saved = await loadAcceptance(bound, row.row.id);
        return acceptedView(saved.row, saved.material);
      });
    },
    async readBookingSubmission(request: AiClientApplicationRequest, value: unknown) {
      request = structuredClone(request);
      receiptPort(); const command = parseEntry(acceptedRef, structuredClone(value));
      return withBinding(request, true, 'order', async bound => readSubmission(request, bound,
        await loadAcceptance(bound, command.acceptanceRef)));
    },
    async submitAcceptedBooking(request: AiClientApplicationRequest, value: unknown) {
      request = structuredClone(request);
      const port = submissionPort(), command = parseEntry(confirmedAcceptance, structuredClone(value));
      return withBinding(request, true, 'order', async bound => {
        const acceptance = await loadAcceptance(bound, command.acceptanceRef);
        const { row, material } = acceptance;
        const attemptKey = `booking-attempt:${row.id}`;
        if (await repository.findOperation(scopeOf(bound), attemptKey)) return readSubmission(request, bound, acceptance);
        if (row.expiresAt <= clock()) throw new AiClientEntryError('AI_PROPOSAL_STALE', 'booking_acceptance_expired');
        // Before the ORIGINAL business call, commit a stable local attempt. A
        // crashed/unknown attempt is observed only, never automatically resent.
        await booking(bound).readHandoff({ handoffRef: material.handoffRef });
        const attempt = await repository.save({ ...row, id: randomUUID(), operationKey: attemptKey });
        if (attempt.replayed) return readSubmission(request, bound, acceptance);
        const original = parseEntry(submissionDraft, row.command);
        const body = { quoteId: material.quoteId, ...(original.contactPhone !== undefined ? { contactPhone: original.contactPhone } : {}) };
        let called = false;
        try {
          await originalBookingCall(request, bound, body, true, async identity => {
            const current = await port.prepareOrderSubmission(identity, body);
            if (jsonHash(current) !== jsonHash(material.accepted)) throw new AiClientEntryError('AI_REVISION_CONFLICT', 'booking_accepted_request_changed');
            await bound.assertCurrent();
            called = true;
            return port.createOrder(identity, body, { headers: { 'idempotency-key': material.operationKey } });
          });
        } catch (error) {
          if (!called) throw error;
          // Only the original persisted Core receipt can attest success after a lost reply.
          return readSubmission(request, bound, acceptance);
        }
        return readSubmission(request, bound, acceptance);
      });
    },
    /** Internal server consumer only. Runtime/pricing/plan/host configuration is
     * injected by the application, never accepted in a customer HTTP body. */
    startOriginalTaskModel(request: AiClientApplicationRequest, value: unknown, model: ClientModelServerDependencies = configuredModel(),
      signal?: AbortSignal) { return runOriginalTaskModel(request, value, model, signal); },
    recoverOriginalTaskModel(request: AiClientApplicationRequest, value: unknown, model: ClientModelServerDependencies = configuredModel(),
      signal?: AbortSignal) { return runOriginalTaskModel(request, value, model, signal, undefined, 'recover'); },
    reconcileOriginalTaskModel(request: AiClientApplicationRequest, value: unknown, model: ClientModelServerDependencies = configuredModel(),
      signal?: AbortSignal) { return runOriginalTaskModel(request, value, model, signal, undefined, 'reconcile'); },
    async resumeOriginalTaskModel(request: AiClientApplicationRequest, value: unknown, answerValue: unknown,
      model: ClientModelServerDependencies, signal?: AbortSignal) {
      const parsed = z.record(z.unknown()).safeParse(structuredClone(answerValue));
      if (!parsed.success || Object.prototype.hasOwnProperty.call(parsed.data, 'taskId')) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const submission = { ...parsed.data, taskId: 'validation-only' };
      if (!isAiTaskInputSubmissionDraft(submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const { taskId: _taskId, ...answers } = submission;
      return runOriginalTaskModel(request, value, model, signal, answers);
    },
    /** Server-injected source; read-only, no provider/model capability needed. */
    readOriginalTaskModelInput(request: AiClientApplicationRequest, value: unknown,
      source = configuredTaskInputSource) {
      if (!source) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_input_dependencies_missing');
      return withOriginalTaskInput(request, value, source, reader => reader.readPending());
    },
    /** Original submit/resume-input policies apply atomically. Persisting an
     * answer/successor does not claim its lease, invoke AI or approve business. */
    submitOriginalTaskModelInput(request: AiClientApplicationRequest, value: unknown,
      source = configuredTaskInputSource) {
      if (!source) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_input_dependencies_missing');
      const { submission, ...command } = parseEntry(aiClientTaskInputSubmissionRequestSchema, structuredClone(value));
      return withOriginalTaskInput(request, command, source, reader => reader.submit(submission));
    },
    /** Explicit server execution dependencies, exact original answer receipt;
     * never resubmit, select a caller run or automatically start after submit. */
    continueOriginalTaskModelInput(request: AiClientApplicationRequest, value: unknown,
      model: ClientModelServerDependencies = configuredModel(), signal?: AbortSignal) {
      const { submission, ...command } = parseEntry(aiClientTaskInputSubmissionRequestSchema, structuredClone(value));
      return runOriginalTaskModel(request, command, model, signal, submission, 'continue');
    },
    async readOriginalTaskModelInputReceipt(request: AiClientApplicationRequest, value: unknown, answerValue: unknown,
      source = configuredTaskInputSource) {
      if (!source) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_input_dependencies_missing');
      const parsed = z.record(z.unknown()).safeParse(structuredClone(answerValue));
      if (!parsed.success || Object.prototype.hasOwnProperty.call(parsed.data, 'taskId')) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const submission = { ...parsed.data, taskId: 'validation-only' };
      if (!isAiTaskInputSubmissionDraft(submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const { taskId: _taskId, ...answers } = submission;
      return withOriginalTaskInput(request, value, source, reader => reader.readSubmission(answers));
    },
    async readHostCapabilities(request: AiClientApplicationRequest, value: unknown): Promise<AiClientHostCapabilities> {
      parseEntry(aiClientHostCapabilitiesRequestSchema, structuredClone(value));
      const surface = requireEntry(), observedAt = clock();
      if (!taskDependencies || !server.entry) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'entry_disabled');
      const releaseRevision = server.entry.releaseRevision;
      const authority = new AiClientPolicyAuthority(taskDependencies, taskDependencies, randomUUID(), clock);
      return withBinding(request, true, 'order', async bound => {
        if (!bound.identity) throw new AiClientEntryError('AI_ACCESS_DENIED', 'client_required');
        const identity = bound.identity, subject = { ...scopeOf(bound), identity };
        const readGrant = async () => {
          try { return await authority.authorize(subject, 'read'); }
          catch (error) {
            const code = error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED'
              ? 'AI_ACCESS_DENIED' : 'AI_RESOURCE_UNAVAILABLE';
            throw new AiClientEntryError(code, 'host_policy_unavailable');
          }
        };
        const grant = await readGrant();
        let creationAllowed = false;
        if (grant.policy.allowCreate) {
          try {
            const first = await authority.authorize(subject, 'capabilities');
            const second = await authority.authorize(subject, 'capabilities');
            assertReadPolicyUnchanged(first, second);
            if (jsonHash(second.policy) !== jsonHash(grant.policy)) throw new AiClientEntryError('AI_ACCESS_DENIED', 'host_policy_changed');
            creationAllowed = true;
          } catch (error) {
            if (!(error instanceof AiTaskRepositoryError) || !['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(error.code)) throw error;
          }
        }
        await bound.assertCurrent();
        const latest = await readGrant();
        assertReadPolicyUnchanged(grant, latest);
        const bookingReceiptRead = latest.policy.allowRead && hasReceiptPort();
        const entryActions: AiClientHostCapabilities['capabilities']['entryActions'] = [];
        if (creationAllowed && typeof dependencies.client.getOrder === 'function') entryActions.push('OPEN_ORDER');
        const bookingDrafts = creationAllowed && identity.customerType === 'personal'
          && typeof dependencies.client.getQuote === 'function' && typeof dependencies.client.bookingOptions === 'function';
        if (bookingDrafts) entryActions.push('CREATE_BOOKING_DRAFT', 'OPEN_BOOKING');
        const result = aiClientHostCapabilitiesSchema.parse({
          contractVersion: AI_CLIENT_HOST_CAPABILITIES_VERSION, enabled: entryActions.length > 0 || bookingReceiptRead, audience: 'customer', surface,
          channel: server.channel, customerId: identity.customerId, customerType: identity.customerType,
          tenantCode: server.tenantCode, serviceCode: server.serviceCode,
          scope: { kind: 'workspace', tenantId: subject.tenantId, workspaceId: subject.workspaceId },
          policy: { revision: latest.policy.revision, allowRead: latest.policy.allowRead, allowCreate: latest.policy.allowCreate },
          releaseRevision, observedAt: observedAt.toISOString(),
          expiresAt: new Date(Math.min(observedAt.getTime() + lifetimeMs, latest.policy.expiresAt.getTime())).toISOString(),
          capabilities: { entryActions, bookingDrafts, bookingReceiptRead, savedDeliveryAddresses: bookingDrafts
            && typeof dependencies.addresses?.list === 'function' && typeof dependencies.addresses.requireOwnAddress === 'function' },
          authorization: 'observation_only_recheck_each_action'
        });
        if (Date.parse(result.expiresAt) <= clock().getTime()) throw new AiClientEntryError('AI_ACCESS_DENIED', 'host_observation_expired');
        return freezeOriginalInput(result);
      });
    },
    createBookingDraft: (request: AiClientApplicationRequest, value: unknown) => bookingOperation(request, value, true, (app, command) => app.create(command)),
    readBookingDraft: (request: AiClientApplicationRequest, value: unknown) => bookingOperation(request, value, false, (app, command) => app.read(command)),
    chooseBookingDraft: (request: AiClientApplicationRequest, value: unknown) => bookingOperation(request, value, true, (app, command) => app.choose(command)),
    handoffBookingDraft: (request: AiClientApplicationRequest, value: unknown) => bookingOperation(request, value, true, (app, command) => app.handoff(command)),
    readBookingHandoff: (request: AiClientApplicationRequest, value: unknown) => bookingOperation(request, value, false, (app, command) => app.readHandoff(command)),
    readBookingPreparation: (request: AiClientApplicationRequest, value: unknown) => bookingOperation(request, value, false, async (app, command) => {
      const preparation = await app.readPreparation(command);
      // This is current dependency availability, not an accepted request or a
      // business receipt. Acceptance/submission still use their explicit,
      // independently authorized original-page operations.
      return freezeOriginalInput({ ...preparation, submission: hasSubmissionPort()
        ? 'explicit_original_page_submission_and_receipt_only' as const
        : 'unavailable_original_page_acceptance_receipt_missing' as const });
    }),
    readBookingOperation: (request: AiClientApplicationRequest, value: unknown) => bookingOperation(request, value, false, (app, command) => app.readOperation(command)),
    async issueAction(request: AiClientApplicationRequest, value: unknown) {
      requireEntry();
      const input = parseEntry(z.object({ actionCode: z.enum(['OPEN_ORDER', 'CREATE_BOOKING_DRAFT']), materialRef: z.string().uuid() }).strict(), value);
      return withBinding(request, true, 'order', async bound => {
        if (input.actionCode === 'OPEN_ORDER') return orderAction(bound, input.materialRef);
        const material = await loadBookingMaterial(bound, input.materialRef);
        return materialEntryAction(material.row, requireEntry(), material.policyFingerprint, material.policyExpiresAt,
          material.material.selection.quoteId, 'CREATE_BOOKING_DRAFT');
      });
    },
    async readAction(request: AiClientApplicationRequest, value: unknown) {
      requireEntry();
      const action = parseEntry(entryActionSchema, value);
      return withBinding(request, true, 'order', async bound => {
        if (action.actionCode === 'OPEN_BOOKING') return booking(bound).readAction(action);
        const material = action.actionCode === 'CREATE_BOOKING_DRAFT' ? await loadBookingMaterial(bound, action.associations.materialRef) : null;
        const expected = material ? materialEntryAction(material.row, requireEntry(), material.policyFingerprint, material.policyExpiresAt,
          material.material.selection.quoteId, 'CREATE_BOOKING_DRAFT') : await orderAction(bound, action.associations.materialRef);
        assertEntryAction(action, expected, clock());
        return freezeOriginalInput(expected);
      });
    },
    async consumeOrderAction(request: AiClientApplicationRequest, value: unknown) {
      requireEntry();
      const action = parseEntry(entryActionSchema, value);
      return withBinding(request, true, 'order', async bound => {
        const expected = await orderAction(bound, action.associations.materialRef);
        assertEntryAction(action, expected, clock());
        return { actionCode: 'OPEN_ORDER' as const, orderId: expected.resource.id, surface: expected.surface,
          scope: expected.scope, execution: 'navigation_not_business_submission' as const };
      });
    },
    createTask: (request: AiClientApplicationRequest, value: unknown, signal?: AbortSignal) => taskOperation(request, value, 'create', signal),
    readTaskCreation: (request: AiClientApplicationRequest, value: unknown, signal?: AbortSignal) => taskOperation(request, value, 'readCreation', signal),
    /** Server-only composition callback, deliberately absent from HTTP controller.
     * Reuses the original request's Guard/ALS/publication-aware material loader.
     * Providing authority does not publish a plan, reserve budget or start a run. */
    /** Server-only Gateway composition callback. No HTTP export and no model
     * configuration/credential returned by a public client route. All subsequent
     * resolves remain bound to this live Guard/ALS request and original task. */
    async withTaskModelConfiguration<T>(request: AiClientApplicationRequest, value: unknown,
      configuration: Pick<Parameters<typeof composeClientTaskModelConfiguration>[0], 'db' | 'secrets'>,
      consume: (configuration: Awaited<ReturnType<typeof composeClientTaskModelConfiguration>>) => Promise<T>) {
      requireEntry();
      if (!taskDependencies || configuration.db !== taskDependencies.db || typeof consume !== 'function') {
        return fail('AI_CLIENT_CAPABILITY_UNAVAILABLE');
      }
      const command = freezeOriginalInput(clientTaskCommandSchema.parse(structuredClone(value)));
      return withBinding(request, true, 'order', async bound => {
        if (!bound.identity) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
        const identity = structuredClone(bound.identity);
        const loadMaterial = async (materialRef: string) => {
          await bound.assertCurrent();
          const row = await repository.findSource(scopeOf(bound), materialRef);
          if (!row) return fail('AI_CLIENT_MATERIAL_STALE');
          await verify(bound, row);
          await bound.assertCurrent();
          return { row, identity };
        };
        const current = await composeClientTaskModelConfiguration({ ...taskDependencies,
          ...configuration, loadMaterial, clock }, command);
        const result = await consume(current);
        await bound.assertCurrent();
        return result;
      });
    },
    async withTaskAuthorization<T>(request: AiClientApplicationRequest, value: unknown,
      consume: (authorization: ReturnType<typeof composePersistedClientTaskAuthorization>) => Promise<T>) {
      requireEntry();
      const parsed = clientTaskCommandSchema.safeParse(structuredClone(value));
      if (!parsed.success || typeof consume !== 'function') return fail('AI_CLIENT_INVALID_INPUT');
      if (!taskDependencies) return fail('AI_CLIENT_CAPABILITY_UNAVAILABLE');
      const command = freezeOriginalInput(parsed.data);
      return withBinding(request, true, 'order', async bound => {
        const identity = bound.identity;
        if (!identity) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
        const load = async (materialRef: string) => {
          await bound.assertCurrent();
          const row = await repository.findSource(scopeOf(bound), materialRef);
          if (!row) return fail('AI_CLIENT_MATERIAL_STALE');
          await verify(bound, row);
          await bound.assertCurrent();
          return { row, identity };
        };
        const authorization = composePersistedClientTaskAuthorization(taskDependencies, command, load, clock);
        await authorization.scopes.resolveCurrent();
        const result = await consume(authorization);
        await authorization.scopes.resolveCurrent();
        await bound.assertCurrent();
        return result;
      });
    },
    readTaskSnapshot: (request: AiClientApplicationRequest, value: unknown) => taskOperation(request, value, 'readSnapshot'),
    readTaskEvents: (request: AiClientApplicationRequest, value: unknown) => taskOperation(request, value, 'readEvents'),
    async readOrderExplanation(request: AiClientApplicationRequest, value: unknown) {
      const parsed = explanationSchema.safeParse(structuredClone(value));
      if (!parsed.success) return fail('AI_CLIENT_INVALID_INPUT');
      const command = freezeOriginalInput(parsed.data);
      return withBinding(request, true, 'order', async bound => freezeOriginalInput({
        facts: prepareClientOrderExplanation(await bound.scenes.member.order(command.orderId), command.orderId, command.question,
          command.question === 'fees' && typeof bound.scenes.member.feeItems === 'function'
            ? await bound.scenes.member.feeItems(command.orderId) : undefined),
        scope: bound.published.scope, publication: bound.published.value, observedAt: clock().toISOString(),
        execution: 'read_only_no_task_start' as const
      }));
    },
    async readOrderCancellationPreview(request: AiClientApplicationRequest, value: unknown) {
      const parsed = z.object({ orderId: id }).strict().safeParse(structuredClone(value));
      if (!parsed.success) return fail('AI_CLIENT_INVALID_INPUT');
      return withBinding(request, true, 'order', async bound => {
        if (typeof bound.scenes.member.cancellationPreview !== 'function') return fail('AI_CLIENT_CAPABILITY_UNAVAILABLE');
        const preview = z.object({ orderId: id, cancellationCharge: z.number().finite().nonnegative(),
          currency: z.string().min(1).max(32), calculatedAt: z.string().datetime({ offset: true }), estimated: z.literal(true) })
          .parse(await bound.scenes.member.cancellationPreview(parsed.data.orderId));
        if (preview.orderId !== parsed.data.orderId) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
        return freezeOriginalInput({ preview, handoff: { method: 'POST' as const,
          path: `/api/client/v1/orders/${encodeURIComponent(preview.orderId)}/cancel`,
          requiredBodyFields: ['reason'] as const, confirmation: 'explicit_human_action' as const,
          execution: 'not_attempted' as const }, businessResult: 'not_inferred' as const });
      });
    },
    async readTaskScene(request: AiClientApplicationRequest, value: unknown) {
      const parsed = taskSceneSchema.safeParse(structuredClone(value));
      if (!parsed.success) return fail('AI_CLIENT_INVALID_INPUT');
      if (!taskDependencies) return fail('AI_CLIENT_CAPABILITY_UNAVAILABLE');
      const { question, ...command } = freezeOriginalInput(parsed.data);
      return withBinding(request, true, 'order', async bound => {
        const identity = bound.identity;
        if (!identity) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
        const load = async (materialRef: string) => {
          const row = await repository.findSource(scopeOf(bound), materialRef);
          if (!row) return fail('AI_CLIENT_MATERIAL_STALE');
          await verify(bound, row);
          await bound.assertCurrent();
          return { row, identity };
        };
        const receipt = await composeClientMaterialTasks(taskDependencies, load, clock).readCreation(command);
        const { row } = await load(command.materialRef), original = commandSchema.parse(row.command);
        if (original.kind !== 'order') return fail('AI_CLIENT_CAPABILITY_UNAVAILABLE');
        const facts = prepareClientOrderExplanation(row.material, original.orderId, question);
        // Read the same original creation receipt again after business awaits;
        // never select a latest task or grant operator task access.
        const latest = await composeClientMaterialTasks(taskDependencies, load, clock).readCreation(command);
        if (jsonHash(receipt) !== jsonHash(latest)) return fail('AI_CLIENT_MATERIAL_STALE');
        return freezeOriginalInput({ ...receipt, facts, source: { materialRef: row.id, materialHash: row.materialHash,
          tenantCode: server.tenantCode, serviceCode: server.serviceCode, channel: server.channel },
          taskOutcome: 'not_inferred_from_order_facts' as const, execution: 'read_only_no_task_start' as const });
      });
    },
    async readPublic(request: AiClientApplicationRequest, value: unknown) {
      const input = commandSchema.safeParse(structuredClone(value));
      if (!input.success || !['catalog', 'help'].includes(input.data.kind)) return fail('AI_CLIENT_INVALID_INPUT');
      const command = freezeOriginalInput(input.data);
      return withBinding(request, false, command.kind, async bound => ({ kind: command.kind,
        material: await readMaterial(bound, command), publication: bound.published.value, materialRef: null,
        durability: 'current_public_read_only' as const, persistentOperations: 'unavailable_anonymous_session_missing' as const }));
    },
    async prepare(request: AiClientApplicationRequest, value: unknown, signal?: AbortSignal) {
      const input = parseOperation(value), inputHash = requestFingerprint(input.command);
      if (input.command.kind === 'booking_quote') requireBooking();
      let submitted = false;
      try {
        return await withBinding(request, true, input.command.kind, async bound => {
          const scope = scopeOf(bound), existing = await repository.findOperation(scope, input.operationKey);
          if (existing) {
            if (existing.inputHash !== inputHash) throw new AiClientMaterialError('AI_CLIENT_REVISION_CONFLICT');
            return { ...packet(existing, await verify(bound, existing)), replayed: true };
          }
          const material = await readMaterial(bound, input.command), createdAt = clock();
          const draftRow: AiClientSceneMaterial = { id: randomUUID(), ...scope, bindingHash: bound.bindingHash,
            publicationHash: requestFingerprint(bound.published.value), operationKey: input.operationKey, inputHash,
            materialHash: materialHash(input.command, material), command: input.command, material,
            publication: bound.published.value, revision: 1, createdAt, expiresAt: new Date(createdAt.getTime() + lifetimeMs) };
          if (input.command.kind === 'booking_quote') {
            const facts = material as AiBookingMaterial;
            const grant = await entryGrant(bound, draftRow);
            draftRow.expiresAt = new Date(Math.min(draftRow.expiresAt.getTime(), grant.expiresAt.getTime(),
              Date.parse(facts.quote.expiresAt), Date.parse(facts.selection.startAt)));
            await bound.assertCurrent();
          }
          submitted = true;
          const saved = await repository.save(draftRow);
          if (input.command.kind === 'booking_quote') await entryGrant(bound, saved.row);
          return { ...packet(saved.row, await verify(bound, saved.row)), replayed: saved.replayed };
        }, signal);
      } catch (error) {
        if (error instanceof AiClientMaterialError || !submitted) throw error;
        throw new AiClientMaterialError('AI_CLIENT_RESULT_UNKNOWN');
      }
    },
    /** Server-host receipt observation only, independent of a new quote or
     * stock query. It cannot supply a Booking Draft, Action or execution grant.
     * Public readOperation/readSource keep their current-material semantics. */
    async readBookingMaterialReceipt(request: AiClientApplicationRequest, value: unknown) {
      const input = parseOperation(value);
      if (input.command.kind !== 'booking_quote') return fail('AI_CLIENT_INVALID_INPUT');
      const selected = input.command.selection;
      requireEntry();
      return withBinding(structuredClone(request), true, 'booking_quote', async bound => {
        if (!taskDependencies || !bound.identity) throw new AiClientEntryError('AI_ACCESS_DENIED', 'client_required');
        const scope = scopeOf(bound), policy = new AiClientPolicyAuthority(taskDependencies, taskDependencies, randomUUID(), clock);
        const subject = { ...scope, identity: structuredClone(bound.identity) };
        const before = await policy.authorize(subject, 'read');
        const row = await repository.findOperation(scope, input.operationKey);
        if (!row) {
          await bound.assertCurrent();
          const after = await policy.authorize(subject, 'read');
          assertReadPolicyUnchanged(before, after);
          return freezeOriginalInput({ state: 'unknown' as const, operationKey: input.operationKey,
            retryable: false as const, nextAction: 'read_original_material_receipt' as const,
            absenceSemantics: 'not_proof_of_no_persistence' as const });
        }
        const saved = commandSchema.safeParse(row.command);
        if (!saved.success || saved.data.kind !== 'booking_quote'
          || row.inputHash !== requestFingerprint(saved.data) || row.materialHash !== materialHash(saved.data, row.material)
          || row.bindingHash !== bound.bindingHash || row.publicationHash !== requestFingerprint(bound.published.value)
          || row.publicationHash !== requestFingerprint(row.publication)) return fail('AI_CLIENT_MATERIAL_STALE');
        // The original quote may have supplied its recorded default return
        // location. Only that omitted optional field may be reconstructed from
        // the immutable saved command; no current configuration is consulted.
        const originalCommand = { kind: 'booking_quote' as const, selection: {
          ...selected, ...(selected.returnLocationId === undefined && saved.data.selection.returnLocationId !== undefined
            ? { returnLocationId: saved.data.selection.returnLocationId } : {})
        } };
        if (row.inputHash !== requestFingerprint(originalCommand)) throw new AiClientMaterialError('AI_CLIENT_REVISION_CONFLICT');
        const latest = await repository.findOperation(scope, input.operationKey);
        if (!latest || jsonHash(latest) !== jsonHash(row)) throw new AiClientMaterialError('AI_CLIENT_REVISION_CONFLICT');
        await bound.assertCurrent();
        const after = await policy.authorize(subject, 'read');
        const observed = assertReadPolicyUnchanged(before, after);
        return freezeOriginalInput({ state: 'observed' as const, operationKey: row.operationKey,
          inputHash: row.inputHash, materialRef: row.id, materialHash: row.materialHash, revision: row.revision,
          createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), observedAt: observed.toISOString(),
          materialValidity: row.expiresAt <= observed ? 'expired' as const : 'not_revalidated' as const,
          currentUse: 'not_authorized_by_receipt' as const, execution: 'not_attested' as const,
          retryable: false as const, nextAction: 'read_current_material_or_manual_review' as const });
      });
    },
    async readOperation(request: AiClientApplicationRequest, value: unknown) {
      const input = parseOperation(value), inputHash = requestFingerprint(input.command);
      return withBinding(request, true, input.command.kind, async bound => {
        const row = await repository.findOperation(scopeOf(bound), input.operationKey);
        if (!row) return { state: 'unknown' as const, operationKey: input.operationKey, inputHash,
          retryable: false as const, nextAction: 'readOperation' as const };
        if (row.inputHash !== inputHash) throw new AiClientMaterialError('AI_CLIENT_REVISION_CONFLICT');
        return packet(row, await verify(bound, row));
      });
    },
    async readSource(request: AiClientApplicationRequest, value: unknown) {
      const input = sourceSchema.safeParse(structuredClone(value));
      if (!input.success) return fail('AI_CLIENT_INVALID_INPUT');
      return withBinding(request, true, 'order', async bound => {
        const row = await repository.findSource(scopeOf(bound), input.data.materialRef);
        if (!row) return fail('AI_CLIENT_MATERIAL_STALE');
        return freezeOriginalInput({ ...packet(row, await verify(bound, row)), verifiedAt: clock().toISOString() });
      });
    },
    capabilities: Object.freeze({ quotePreparation: server.entry && taskDependencies && server.channel !== 'app'
      && dependencies.quotePreparation ? 'explicit_human_confirmation_original_quote_only' as const : 'unavailable' as const,
      entryActions: server.entry && taskDependencies && server.channel !== 'app'
      ? (typeof dependencies.client.getQuote === 'function' && typeof dependencies.client.bookingOptions === 'function'
        ? ['OPEN_ORDER', 'CREATE_BOOKING_DRAFT', 'OPEN_BOOKING'] as const : ['OPEN_ORDER'] as const) : [],
      bookingDrafts: server.entry && taskDependencies && server.channel !== 'app' && typeof dependencies.client.getQuote === 'function'
        && typeof dependencies.client.bookingOptions === 'function' ? 'existing_quote_same_surface_only' as const : 'unavailable' as const,
      savedDeliveryAddresses: server.entry && taskDependencies && server.channel !== 'app'
        && typeof dependencies.addresses?.list === 'function' && typeof dependencies.addresses.requireOwnAddress === 'function'
        ? 'current_saved_address_snapshot_only' as const : 'unavailable' as const,
      bookingSubmission: hasSubmissionPort()
        ? 'explicit_original_page_submission_and_receipt_only' as const : 'unavailable_original_page_acceptance_receipt_missing' as const,
      crossSurfaceHandoff: 'unavailable' as const,
      materialKinds: ['catalog', 'help', 'profile', 'order', 'cancellation_preview'] as const,
      orderExplanation: 'current_client_order_projection_only' as const,
      taskScenes: taskDependencies ? 'original_creation_and_order_facts_only' as const : 'unavailable' as const,
      persistentMaterials: 'authenticated_client_session_only' as const, publicReads: ['catalog', 'help'] as const,
      tasks: taskDependencies ? 'create_and_read_only' as const : 'unavailable' as const, models: 'unavailable' as const,
      taskSnapshots: taskDependencies ? 'original_task_snapshot_read_only' as const : 'unavailable' as const,
      events: taskDependencies ? 'original_task_events_read_only' as const : 'unavailable' as const,
      downloads: 'unavailable' as const, historyMigration: 'unavailable' as const,
      excluded: ['operator_tools', 'staff_tools', 'tenant_inventory', 'costs', 'review_notes', 'model_urls'] as const })
  });
}
