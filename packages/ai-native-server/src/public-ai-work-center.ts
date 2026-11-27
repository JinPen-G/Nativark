/** Opt-in public Task/Conversation transport on the original platform Guard.
 * This module registers one public diagnostic, with no Rental business tools. */
import { Body, Controller, ForbiddenException, Header, HttpCode, HttpException, Inject, Module, Post, Req, UnauthorizedException,
  type DynamicModule, type FactoryProvider, type ModuleMetadata } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import { PlatformAuthenticationRepository, PlatformAuthService, PlatformPrincipalAuthority, PLATFORM_AUTH_DATA_STORE,
  SecretBox, SubscriptionService, matchableRequestPath, type RegisteredCoreHttpAccess } from '@rental-os/platform-server';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { GatewayCapacityService } from '@rental-os/platform-server/ai-gateway';
import { aiLeafToOpenApi30 } from '@rental-os/platform-contracts/ai-gateway';
import { AI_PUBLIC_WORK_CENTER_OPERATIONS as operations, AI_PUBLIC_WORK_CENTER_PERMISSION as permission,
  AI_PUBLIC_WORK_CENTER_SCHEMAS, publicWorkCenterPath, type AiPublicWorkCenterOperation as Action } from '@rental-os/platform-contracts/ai-work-center';
import { hasEffectivePermission } from '@rental-os/platform-server/permission-match';
import { withRequestAbort, type AiRequestAbortSource } from './runtime/scenes/request-abort';
import { createPublicAiWorkCenterRequests, type WorkCenterRequests, type WorkCenterRequest, type WorkCenterHost } from './work-center/application';

export { createPublicAiWorkCenterRequests };
export type { WorkCenterRequests, WorkCenterHost };
const actions = Object.keys(operations) as Action[];
const paths = new Set(actions.map(action => matchableRequestPath(publicWorkCenterPath(action))));
export function withPublicAiWorkCenterHttpAccess(original?: RegisteredCoreHttpAccess): RegisteredCoreHttpAccess {
  const matches = (method: string, path: string) => method.toUpperCase() === 'POST' && paths.has(matchableRequestPath(path));
  return Object.freeze<RegisteredCoreHttpAccess>({
    registered: (method, path, audience) => audience === 'operator' && matches(method, path) || original?.registered(method, path, audience) === true,
    async authorize(method, path) {
      if (!matches(method, path)) {
        if (original) return original.authorize(method, path);
        throw new ForbiddenException('接口未登记');
      }
      const identity = getRequestIdentity();
      if (!identity?.tenantId || !identity.userId || identity.isSaasAdmin !== false || identity.audience !== 'operator' || identity.staffApi
        || identity.workspaceId !== undefined || !identity.accessSession || identity.accessSession.expiresAt <= Date.now() / 1000
        || identity.dataScope !== 'all' || !hasEffectivePermission(identity.permissions ?? [], permission))
        throw new ForbiddenException('需要租户参数管理权限及完整租户范围');
    }
  });
}

type Request = WorkCenterRequest & AiRequestAbortSource;
const HOST = Symbol('public.ai-work-center.host');
export const PUBLIC_AI_WORK_CENTER_REQUESTS = Symbol('public.ai-work-center.requests');
const mapping = {
  AI_ACCESS_DENIED: ['AI_ACCESS_DENIED', 403], FORBIDDEN: ['AI_ACCESS_DENIED', 403],
  AI_INVALID_INPUT: ['AI_INVALID_INPUT', 400], INVALID_REQUEST: ['AI_INVALID_INPUT', 400],
  AI_REVISION_CONFLICT: ['AI_REVISION_CONFLICT', 409]
} as const;
const recovery: Partial<Record<Action, string>> = { create: 'read_original_operation', archive: 'read_original_operation',
  delete: 'read_original_operation', release: 'read_original_operation', admit: 'read_original_admission', createTask: 'read_original_creation',
  start: 'read_original_task', reconcile: 'read_original_task', savePolicy: 'read_original_policy_operation', allowText: 'read_original_configuration_operation' };

async function respond(requests: WorkCenterRequests, action: Action, request: Request, body: unknown) {
  try { return await withRequestAbort(request, signal => requests.consume(action, request, body, signal),
    { maxWaitMs: action === 'start' || action === 'reconcile' ? 120000 : 15000 }); }
  catch (error) {
    if (error instanceof UnauthorizedException || error instanceof ForbiddenException)
      throw new HttpException({ code: 'AI_ACCESS_DENIED', retryable: false }, error.getStatus());
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (operations[action][4] && (code === 'AI_RESULT_UNKNOWN' || code === 'PENDING_RECONCILIATION'))
      throw new HttpException({ code: 'AI_RESULT_UNKNOWN', retryable: false, nextAction: recovery[action] }, 409);
    const [safe, status] = typeof code === 'string' && Object.hasOwn(mapping, code) ? mapping[code as keyof typeof mapping] : ['AI_RESOURCE_UNAVAILABLE', 503];
    throw new HttpException({ code: safe, retryable: false }, status);
  }
}

@Controller('ai-native/conversations')
export class PublicAiConversationController {
  constructor(@Inject(PUBLIC_AI_WORK_CENTER_REQUESTS) private readonly requests: WorkCenterRequests) {}

  @Post(operations.create[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  create(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'create', req, body); }
  @Post(operations.list[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  list(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'list', req, body); }
  @Post(operations.read[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'read', req, body); }
  @Post(operations.archive[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  archive(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'archive', req, body); }
  @Post(operations.delete[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  delete(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'delete', req, body); }
  @Post(operations.operation[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  operation(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'operation', req, body); }
  @Post(operations.admit[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  admit(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'admit', req, body); }
  @Post(operations.admission[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  admission(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'admission', req, body); }
  @Post(operations.turns[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  turns(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'turns', req, body); }
  @Post(operations.release[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  release(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'release', req, body); }
  @Post(operations.conversationResult[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  modelResult(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'conversationResult', req, body); }
}

@Controller('ai-native/task-center')
export class PublicAiTaskCenterController {
  constructor(@Inject(PUBLIC_AI_WORK_CENTER_REQUESTS) private readonly requests: WorkCenterRequests) {}

  @Post(operations.createTask[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  create(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'createTask', req, body); }
  @Post(operations.taskCreation[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  creation(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'taskCreation', req, body); }
  @Post(operations.snapshot[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  snapshot(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'snapshot', req, body); }
  @Post(operations.start[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  start(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'start', req, body); }
  @Post(operations.reconcile[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcile(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'reconcile', req, body); }
  @Post(operations.result[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  result(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'result', req, body); }
  @Post(operations.policy[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  textPolicy(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'policy', req, body); }
  @Post(operations.savePolicy[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  saveTextPolicy(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'savePolicy', req, body); }
  @Post(operations.policyOperation[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  textPolicyOperation(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'policyOperation', req, body); }
  @Post(operations.allowText[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  allowTextProbe(@Req() req: Request, @Body() body: unknown) { return respond(this.requests, 'allowText', req, body); }
}

export function createPublicAiWorkCenterOpenApi<T extends { paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> } }>(document: T): T {
  const result = structuredClone(document), prefix = '#/components/schemas/';
  const ref = (name: string) => ({ $ref: prefix + name });
  for (const [name, value] of Object.entries(AI_PUBLIC_WORK_CENTER_SCHEMAS)) {
    const schema = aiLeafToOpenApi30(value, name);
    if (Object.hasOwn(result.components.schemas, name) && !isDeepStrictEqual(result.components.schemas[name], schema))
      throw Error(`公共 AI 工作中心 schema 冲突：${name}`);
    result.components.schemas[name] = schema;
  }
  const content = (schema: object) => ({ 'application/json': { schema } });
  for (const action of actions) {
    const [, , input, output, writes] = operations[action];
    const path = `/api${publicWorkCenterPath(action)}`, route = result.paths[path] ??= {};
    if (Object.hasOwn(route, 'post')) throw Error(`公共 AI 工作中心路由冲突：${path}`);
    route.post = { operationId: `publicAiWorkCenter_${action}`, tags: ['AI Native'], security: [{ bearerAuth: [] }],
      'x-requiredPermissions': [permission], 'x-effect': writes ? 'write' : 'read',
      requestBody: { required: true, content: content(ref(input)) },
      responses: { '200': { description: '原操作、任务或结果的公共投影', content: content({ type: 'object',
        required: ['data', 'requestId'], properties: { data: ref(output), requestId: { type: 'string' } } }) },
      '400': { description: '不符合登记合同' }, '401': { description: '原签名会话失效' }, '403': { description: '本租户权限或范围不符' },
      '409': { description: '版本变化或结果未知，按原定位核对' }, '503': { description: '当前依赖或原证据不可用' } } };
  }
  return result;
}

@Module({})
export class PublicAiWorkCenterModule {
  static register<Args extends unknown[]>(host: { imports: NonNullable<ModuleMetadata['imports']>; inject?: FactoryProvider['inject'];
    useFactory(...args: Args): WorkCenterHost | Promise<WorkCenterHost> }): DynamicModule {
    return { module: PublicAiWorkCenterModule, imports: host.imports, controllers: [PublicAiConversationController, PublicAiTaskCenterController],
      providers: [{ provide: HOST, inject: host.inject ?? [], useFactory: host.useFactory }, {
        provide: PUBLIC_AI_WORK_CENTER_REQUESTS,
        inject: [HOST, PLATFORM_AUTH_DATA_STORE, PlatformAuthService, PlatformAuthenticationRepository, SecretBox, SubscriptionService],
        useFactory: (selected: WorkCenterHost, authDatabase: object, auth: PlatformAuthService,
          users: PlatformAuthenticationRepository, secrets: SecretBox, subscriptions: SubscriptionService) => {
          if (!Object.is(selected.db, authDatabase)) throw Error('公共 AI 工作中心与原身份库不一致');
          return createPublicAiWorkCenterRequests({ ...selected, auth, secrets, subscriptions,
            principals: new PlatformPrincipalAuthority<Prisma.TransactionClient>(users),
            capacity: new GatewayCapacityService({ maxConcurrent: 4, maxQueued: 32, maxQueuedPerTenant: 4, maxWaitMs: 15000 }) });
        }
      }] };
  }
}
