/** Shared policy and OpenAPI for the existing SaaS model settings actions. */
import { AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT, AI_USAGE_DRAFT_SCHEMAS } from '@rental-os/platform-contracts/ai-usage';
import { aiLeafToOpenApi30 } from '@rental-os/platform-contracts/ai-gateway';
import { matchableRequestPath } from '@rental-os/platform-server';
import { platformModelProfileId } from './platform-model-settings-transport';
import { modelConfigurationOperationKey } from '../runtime/model-configuration-operation';

export const PLATFORM_AI_MODEL_VIEW = 'system:ai-provider:view';
export const PLATFORM_AI_MODEL_MANAGE = 'system:ai-provider:manage';
/** Host-controlled permission registration. Selecting routes does not grant roles. */
export const PLATFORM_AI_MODEL_SETTINGS_PERMISSIONS = Object.freeze([
  { code: PLATFORM_AI_MODEL_VIEW, name: '读取平台 AI 配置', module: 'SaaS平台' },
  { code: PLATFORM_AI_MODEL_MANAGE, name: '管理平台 AI 配置', module: 'SaaS平台' }
] as const);
export const PLATFORM_AI_MODEL_SETTINGS_OPERATIONS = [
  { method: 'get' as const, path: `/api/${AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT.basePath}`, tag: 'AI Native',
      operationId: 'listPlatformAiModelConfigurations', permissions: [PLATFORM_AI_MODEL_VIEW],
      summary: 'Current SaaS viewer only. Keyset page of at most 50 platform-owned configuration metadata records; no credentials, base URLs, capability proof or execution grant.',
      parameters: [{ name: 'limit', in: 'query' as const, required: false, schema: { type: 'integer', minimum: 1, maximum: 50 } },
        { name: 'after', in: 'query' as const, required: false, schema: { type: 'string', minLength: 1, maxLength: 36, pattern: '^[A-Za-z0-9][\\w.:-]{0,35}$' } }],
      responseSchema: 'AiPlatformModelDirectoryDraft' },
  { method: 'get' as const, path: `/api/${AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT.basePath}/{profileId}`, tag: 'AI Native',
      operationId: 'readPlatformAiModelConfiguration', permissions: [PLATFORM_AI_MODEL_VIEW],
      summary: 'Current explicitly authorized SaaS platform viewer. Masked current configuration, not an original save receipt, write permission or connection/capability proof.',
      responseSchema: 'AiPlatformModelSettingsSummaryDraft' },
  { method: 'get' as const, path: `/api/${AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT.basePath}/{profileId}/capabilities`, tag: 'AI Native',
      operationId: 'readPlatformAiCapabilityEvidence', permissions: [PLATFORM_AI_MODEL_VIEW],
      summary: 'Current SaaS viewer and platform-owned Profile only. Eight bounded capability observations: configured whitelist, original evidence metadata and current verified readiness are distinct. Uses original receipt verifier, no credentials, connection test, task start, budget mutation or dispatch grant. Missing/mocked/expired evidence never certifies support; inactive configuration retains historical metadata only. Identity, configuration and evidence are revalidated before delivery.',
      responseSchema: 'AiPlatformModelCapabilityObservationDraft' },
  { method: 'put' as const, path: `/api/${AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT.basePath}/{profileId}`, tag: 'AI Native',
      operationId: 'savePlatformAiModelConfiguration', permissions: [PLATFORM_AI_MODEL_MANAGE],
      summary: 'SaaS platform manager CAS + encrypted Vault/Profile transaction. Revision zero provisions only the first DEFAULT profile; no policy, capability evidence or budget is granted. Lost acknowledgement with an operation key requires reading its original receipt. Current configuration is only an observation.',
      requestSchema: 'AiPlatformModelSettingsInputDraft', responseSchema: 'AiPlatformModelSettingsSaveDraft' },
  { method: 'get' as const, path: `/api/${AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT.basePath}/{profileId}/operations/{operationKey}`, tag: 'AI Native',
      operationId: 'readOriginalPlatformModelConfigurationSave', permissions: [PLATFORM_AI_MODEL_VIEW],
      summary: 'Current SaaS viewer and original actor only. Exact immutable save receipt, independent of later config rotations; missing is unknown, not rollback or permission to resend. No credential or execution grant.',
      responseSchema: 'AiModelConfigurationOperationDraft' },
];
const matches = PLATFORM_AI_MODEL_SETTINGS_OPERATIONS.map(route => ({
  method: route.method.toUpperCase(), permission: route.permissions[0], slots: matchableRequestPath(route.path).split('/')
}));

export function platformModelSettingsRoute(method: string, path: string) {
  const parts = matchableRequestPath(path).split('/');
  return matches.find(record => record.method === method.toUpperCase() && record.slots.length === parts.length
    && record.slots.every((slot, at) => {
      if (!slot.startsWith('{')) return slot === parts[at];
      try {
        const value = decodeURIComponent(parts[at]);
        return (slot === '{profileid}' ? platformModelProfileId : modelConfigurationOperationKey).safeParse(value).success;
      } catch { return false; }
    }));
}

export function createPlatformModelSettingsOpenApi<T extends { paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> } }>(document: T): T {
  const result = structuredClone(document);
  const ref = (key: string) => ({ $ref: '#/components/schemas/' + key });
  const content = (schema: object) => ({ 'application/json': { schema } });
  for (const name of ['AiPlatformModelDirectoryDraft', 'AiPlatformModelSettingsSummaryDraft', 'AiPlatformModelCapabilityObservationDraft',
    'AiPlatformModelSettingsInputDraft', 'AiPlatformModelSettingsSaveDraft', 'AiModelConfigurationOperationDraft', 'AiTenantModelSettingsSummaryDraft']) {
    if (Object.hasOwn(result.components.schemas, name)) throw Error('AI schema already registered: ' + name);
    result.components.schemas[name] = aiLeafToOpenApi30(AI_USAGE_DRAFT_SCHEMAS[name], name);
  }
  for (const route of PLATFORM_AI_MODEL_SETTINGS_OPERATIONS) {
    const methods = result.paths[route.path] ??= {};
    if (Object.hasOwn(methods, route.method)) throw Error('AI route already registered: ' + route.path);
    const pathParameters = [...route.path.matchAll(/\{([A-Za-z]+)\}/g)].map(match => ({ name: match[1], in: 'path', required: true,
      schema: { type: 'string', maxLength: match[1] === 'profileId' ? 36 : 128 } }));
    methods[route.method] = { operationId: route.operationId, summary: route.summary, tags: [route.tag], security: [{ bearerAuth: [] }],
      'x-requiredPermissions': [...route.permissions], 'x-effect': route.method === 'get' ? 'read' : 'write',
      parameters: [...pathParameters, ...(route.parameters ?? [])],
      ...(route.requestSchema ? { requestBody: { required: true, content: content(ref(route.requestSchema)) } } : {}),
      responses: { '200': { description: '成功', content: content({ type: 'object', required: ['data', 'requestId'],
        properties: { data: ref(route.responseSchema), requestId: { type: 'string' } } }) },
        '400': { description: '请求不符合原模型配置合同' }, '401': { description: '当前会话无效' },
        '403': { description: '当前 SaaS 权限不足' }, '409': { description: '修订冲突或结果未知，按原操作读取' },
        '503': { description: '所选数据或配置不可用' } } };
  }
  return result;
}
