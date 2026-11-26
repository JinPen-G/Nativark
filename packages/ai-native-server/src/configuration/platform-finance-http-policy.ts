/** Match exactly the published SaaS actions, using the same policy for the
 * original Guard, request dispatch and OpenAPI. No tenant or execution routes. */
import { AI_PLATFORM_FINANCE_ROUTES, AI_CREDIT_COMPONENT_SCHEMAS, AI_BUDGET_MANAGEMENT_HTTP_SCHEMAS,
  type AiPlatformFinanceAction } from '@rental-os/platform-contracts/ai-finance';
import { AI_USAGE_DRAFT_SCHEMAS } from '@rental-os/platform-contracts/ai-usage';
import { aiLeafToOpenApi30, type AiLeafSchemaDraft, type AiOpenApiSchema } from '@rental-os/platform-contracts/ai-gateway';
import { matchableRequestPath, type RegisteredCoreHttpAccess } from '@rental-os/platform-server';
import { PLATFORM_AI_MODEL_MANAGE, PLATFORM_AI_MODEL_VIEW } from './platform-model-settings-policy';
import { withPlatformAiHttpAccess } from './platform-ai-request';

export const platformFinancePermission = (action: AiPlatformFinanceAction) =>
  AI_PLATFORM_FINANCE_ROUTES[action][2] ? PLATFORM_AI_MODEL_MANAGE : PLATFORM_AI_MODEL_VIEW;

const actions = Object.keys(AI_PLATFORM_FINANCE_ROUTES) as AiPlatformFinanceAction[];
const paths = new Map<string, AiPlatformFinanceAction>(actions.map(action => {
  const [base, route] = AI_PLATFORM_FINANCE_ROUTES[action];
  return [`/${base}/${route}`, action] as const;
}));

export function withPublicPlatformFinanceHttpAccess(original?: RegisteredCoreHttpAccess): RegisteredCoreHttpAccess {
  return withPlatformAiHttpAccess((method, path) => {
    const action = method.toUpperCase() === 'POST' ? paths.get(matchableRequestPath(path)) : undefined;
    return action ? platformFinancePermission(action) : undefined;
  }, original);
}

export const platformFinanceHttpSchemas: Record<string, AiLeafSchemaDraft | AiOpenApiSchema> = {
  ...AI_USAGE_DRAFT_SCHEMAS, ...AI_BUDGET_MANAGEMENT_HTTP_SCHEMAS, ...AI_CREDIT_COMPONENT_SCHEMAS,
  // The keyed public writer has no legacy revision-only mode.
  AiPlatformBudgetSettingsSaveDraft: { ...AI_BUDGET_MANAGEMENT_HTTP_SCHEMAS.AiPlatformBudgetSettingsSaveDraft,
    required: [...AI_BUDGET_MANAGEMENT_HTTP_SCHEMAS.AiPlatformBudgetSettingsSaveDraft.required!, 'operationKey'] }
};

export function createPlatformFinanceOpenApi<T extends { paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> } }>(document: T): T {
  const result = structuredClone(document), published = new Set<string>();
  const prefix = '#/components/schemas/';
  const ref = (name: string) => ({ $ref: prefix + name });
  const content = (schema: object) => ({ 'application/json': { schema } });
  const addSchema = (name: string) => {
    if (published.has(name)) return;
    if (Object.hasOwn(result.components.schemas, name)) throw new Error(`平台财务 schema 已登记：${name}`);
    const original = platformFinanceHttpSchemas[name];
    if (!original) throw new Error(`缺少平台财务原 schema：${name}`);
    published.add(name);
    result.components.schemas[name] = Object.hasOwn(AI_CREDIT_COMPONENT_SCHEMAS, name)
      ? structuredClone(original) : aiLeafToOpenApi30(original, name);
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === '$ref' && typeof child === 'string' && child.startsWith(prefix)) addSchema(child.slice(prefix.length));
        else visit(child);
      }
    };
    visit(original);
  };
  for (const [path, action] of paths) {
    const [, , write, command, response, operationId] = AI_PLATFORM_FINANCE_ROUTES[action];
    addSchema(command); addSchema(response);
    const item = result.paths[`/api${path}`] ??= {};
    if (Object.hasOwn(item, 'post')) throw new Error(`平台财务路由已登记：${path}`);
    item.post = { operationId, tags: ['AI Native'], security: [{ bearerAuth: [] }],
      'x-requiredPermissions': [platformFinancePermission(action)], 'x-effect': write ? 'write' : 'read',
      requestBody: { required: true, content: content(ref(command)) },
      responses: { '200': { description: '原配置或原操作收据', content: content({ type: 'object', required: ['data', 'requestId'],
        properties: { data: ref(response), requestId: { type: 'string' } } }) },
        '400': { description: '输入不符合原合同' }, '401': { description: '原会话失效' },
        '403': { description: '当前 SaaS 权限不足' }, '404': { description: '原额度申请不存在' },
        '409': { description: '修订冲突或结果未知；按原键核对' }, '503': { description: '所选数据或原收据不可用' } } };
  }
  return result;
}
