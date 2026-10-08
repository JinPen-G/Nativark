import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { composeAiClientScenes, createAiGuardedClientSession } from '../client-scene.composition';
import type { ClientRequestContext } from '../../client/client-auth.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import { PrismaClientSceneMaterialRepository, AiClientMaterialError, type AiClientMaterialDb,
  type AiClientMaterialScope, type AiClientSceneMaterial } from './prisma-client-scene-material.repository';
import { clientTaskSceneSchema, type AiClientTaskDependencies } from './client-task.authority';
import { composeClientMaterialTasks } from './client-task.composition';
import { AiClientTaskUnknownError, clientTaskCommandSchema } from './prisma-client-task-input.repository';
import { prepareClientOrderExplanation } from './client-order-explanation';

const id = z.string().trim().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const configurationSchema = z.object({ enabled: z.literal(true), tenantCode: id, serviceCode: id,
  channel: z.enum(['wechat_miniprogram', 'app', 'web']), appId: id.optional() }).strict();
const commandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('catalog') }).strict(), z.object({ kind: z.literal('help') }).strict(),
  z.object({ kind: z.literal('profile') }).strict(), z.object({ kind: z.literal('order'), orderId: id }).strict(),
  z.object({ kind: z.literal('cancellation_preview'), orderId: id }).strict()
]);
const operationSchema = z.object({ operationKey: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  command: commandSchema }).strict();
const sourceSchema = z.object({ materialRef: z.string().uuid() }).strict();
const explanationSchema = z.object({ orderId: id, question: z.enum(['status', 'fees']).default('status') }).strict();
const taskSceneSchema = clientTaskCommandSchema.extend({ question: z.enum(['status', 'fees']).default('status') }).strict();
const bearerSchema = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
export type AiClientRequestConfiguration = z.infer<typeof configurationSchema>;
export type AiClientApplicationRequest = { headers: { authorization?: unknown }; ip?: string };
export type AiClientRequestDependencies = {
  client: Parameters<typeof composeAiClientScenes>[0]['client'];
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  db: AiClientMaterialDb;
  tasks?: AiClientTaskDependencies;
  clock?: () => Date;
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
  const withBinding = async <T>(request: AiClientApplicationRequest, member: boolean, kind: string, consume: (bound: Bound) => Promise<T>): Promise<T> => {
    const header = member ? bearerSchema.safeParse(request?.headers?.authorization) : undefined;
    if (member && !header?.success) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
    const credential = Object.freeze({ authorization: header?.success ? header.data : '', ip: request?.ip });
    let active = true;
    try {
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
        const scenes = composeAiClientScenes({ client: dependencies.client, ...(source ? { session: source } : {}) });
        const assertCurrent = async () => {
          if (!active) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
          const after = await publication(), current = source ? await source.current() : null;
          if (bindingHash !== requestFingerprint({ publication: after, identity: current, appId: server.appId ?? null })) return fail('AI_CLIENT_CONTEXT_UNAVAILABLE');
        };
        const result = await consume({ published: before, identity, bindingHash, scenes, assertCurrent });
        await assertCurrent();
        return result;
      });
    } finally { active = false; }
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
    const current = await readMaterial(bound, parsedCommand.data);
    if (materialHash(parsedCommand.data, current) !== row.materialHash) return fail('AI_CLIENT_MATERIAL_STALE');
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
  const taskOperation = async (request: AiClientApplicationRequest, value: unknown, operation: 'create' | 'readCreation') => {
    const parsed = clientTaskCommandSchema.safeParse(structuredClone(value));
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
        return freezeOriginalInput({ ...result, source: { materialRef: material.row.id, materialHash: material.row.materialHash,
          tenantCode: server.tenantCode, serviceCode: server.serviceCode, channel: server.channel } });
      });
    } catch (error) {
      if (returned && operation === 'create') throw new AiClientTaskUnknownError();
      throw error;
    }
  };
  return Object.freeze({
    createTask: (request: AiClientApplicationRequest, value: unknown) => taskOperation(request, value, 'create'),
    readTaskCreation: (request: AiClientApplicationRequest, value: unknown) => taskOperation(request, value, 'readCreation'),
    async readOrderExplanation(request: AiClientApplicationRequest, value: unknown) {
      const parsed = explanationSchema.safeParse(structuredClone(value));
      if (!parsed.success) return fail('AI_CLIENT_INVALID_INPUT');
      const command = freezeOriginalInput(parsed.data);
      return withBinding(request, true, 'order', async bound => freezeOriginalInput({
        facts: prepareClientOrderExplanation(await bound.scenes.member.order(command.orderId), command.orderId, command.question),
        scope: bound.published.scope, publication: bound.published.value, observedAt: clock().toISOString(),
        execution: 'read_only_no_task_start' as const
      }));
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
    async prepare(request: AiClientApplicationRequest, value: unknown) {
      const input = parseOperation(value), inputHash = requestFingerprint(input.command);
      let submitted = false;
      try {
        return await withBinding(request, true, input.command.kind, async bound => {
          const scope = scopeOf(bound), existing = await repository.findOperation(scope, input.operationKey);
          if (existing) {
            if (existing.inputHash !== inputHash) throw new AiClientMaterialError('AI_CLIENT_REVISION_CONFLICT');
            return { ...packet(existing, await verify(bound, existing)), replayed: true };
          }
          const material = await readMaterial(bound, input.command), createdAt = clock();
          submitted = true;
          const saved = await repository.save({ id: randomUUID(), ...scope, bindingHash: bound.bindingHash,
            publicationHash: requestFingerprint(bound.published.value), operationKey: input.operationKey, inputHash,
            materialHash: materialHash(input.command, material), command: input.command, material,
            publication: bound.published.value, revision: 1, createdAt, expiresAt: new Date(createdAt.getTime() + lifetimeMs) });
          return { ...packet(saved.row, await verify(bound, saved.row)), replayed: saved.replayed };
        });
      } catch (error) {
        if (error instanceof AiClientMaterialError || !submitted) throw error;
        throw new AiClientMaterialError('AI_CLIENT_RESULT_UNKNOWN');
      }
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
    capabilities: Object.freeze({ materialKinds: ['catalog', 'help', 'profile', 'order', 'cancellation_preview'] as const,
      orderExplanation: 'current_client_order_projection_only' as const,
      taskScenes: taskDependencies ? 'original_creation_and_order_facts_only' as const : 'unavailable' as const,
      persistentMaterials: 'authenticated_client_session_only' as const, publicReads: ['catalog', 'help'] as const,
      tasks: taskDependencies ? 'create_and_read_only' as const : 'unavailable' as const, models: 'unavailable' as const, events: 'unavailable' as const,
      downloads: 'unavailable' as const, historyMigration: 'unavailable' as const,
      excluded: ['operator_tools', 'staff_tools', 'tenant_inventory', 'costs', 'review_notes', 'model_urls'] as const })
  });
}
