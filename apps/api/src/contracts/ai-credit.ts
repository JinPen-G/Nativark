import type { ContractOperation, SchemaObject } from './openapi-document';
const string: SchemaObject = { type: 'string' }, currency: SchemaObject = { type: 'string', pattern: '^[A-Z]{3}$' };
const id: SchemaObject = { type: 'string', minLength: 1, maxLength: 191 };
const key: SchemaObject = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' };
const amount: SchemaObject = { type: 'string', pattern: '^(0|[1-9][0-9]{0,17})(\\.[0-9]{1,6})?$' };
const revision: SchemaObject = { type: 'integer', minimum: 1 };
const object = (properties: Record<string, SchemaObject>, required = Object.keys(properties)): SchemaObject =>
  ({ type: 'object', additionalProperties: false, properties, required });
const array = (items: SchemaObject, maxItems: number): SchemaObject => ({ type: 'array', items, maxItems });
const ref = (name: string): SchemaObject => ({ $ref: `#/components/schemas/${name}` });
const allocation = object({ workspaceId: id, amount });
const creditRequest = object({ id, tenantId: id, tenantName: string, currency, requestedAmount: amount,
  state: { type: 'string', enum: ['pending', 'approved', 'rejected'] }, revision,
  grantedAmount: { ...amount, nullable: true }, createdAt: { type: 'string', format: 'date-time' },
  decidedAt: { type: 'string', format: 'date-time', nullable: true } });
const balance = object({ currency, grantedAmount: amount, spentAmount: amount, heldAmount: amount, availableAmount: amount,
  revision, allocations: array(allocation, 64) });
const allocated = object({ state: { type: 'string', enum: ['allocated'] }, revision });
const receipt = (name: string, property: string) => ({ oneOf: [object({ state: { type: 'string', enum: ['unknown'] } }),
  object({ state: { type: 'string', enum: ['recorded'] }, [property]: ref(name) })] });
export const AI_CREDIT_COMPONENT_SCHEMAS: Record<string, SchemaObject> = {
  AiCreditRequest: creditRequest,
  AiCreditBalance: balance,
  AiCreditSummary: object({ currencies: array(currency, 8), balances: array(balance, 8), requests: array(creditRequest, 20),
    workspaces: array(object({ id, name: string }), 64), requestHistoryComplete: { type: 'boolean' } }),
  AiCreditApplication: object({ operationKey: key, currency, amount }),
  AiCreditOperationRead: object({ operationKey: key }),
  AiCreditAllocation: object({ operationKey: key, currency, expectedRevision: revision, allocations: array(allocation, 64) }),
  AiCreditAllocated: allocated,
  AiCreditAllocationRead: object({ operationKey: key, currency }),
  AiCreditAllocationReceipt: receipt('AiCreditAllocated', 'result'),
  AiCreditRequestReceipt: receipt('AiCreditRequest', 'request'),
  AiCreditPlatformQueue: object({ requests: array(creditRequest, 50), nextCursor: { ...id, nullable: true } }),
  AiCreditPlatformRead: object({ cursor: id }, []),
  AiCreditDecision: { oneOf: [object({ requestId: id, operationKey: key, expectedRevision: revision,
    decision: { type: 'string', enum: ['approve'] }, amount }), object({ requestId: id, operationKey: key, expectedRevision: revision,
    decision: { type: 'string', enum: ['reject'] } })] },
  AiCreditRequestRead: object({ requestId: id, operationKey: key }),
  AiCreditDecisionReceipt: { oneOf: [object({ state: { type: 'string', enum: ['unknown'] } }), object({
    state: { type: 'string', enum: ['recorded'] }, request: creditRequest,
    originalDecision: { type: 'string', enum: ['unknown', 'matched', 'superseded'] } })] },
  AiTenantCallQuery: object({ since: { type: 'string', format: 'date-time' }, until: { type: 'string', format: 'date-time' },
    cursor: id, workspaceId: id, mode: { type: 'string', enum: ['platform_managed', 'tenant_managed'] } }, ['since', 'until']),
  AiTenantCallRecord: object({ id, taskId: id, callId: id, createdAt: { type: 'string', format: 'date-time' },
    workspaceId: id, workspaceName: string, actorName: string, sceneCode: string,
    mode: { type: 'string', enum: ['platform_managed', 'tenant_managed', 'unknown'] }, modelLabel: string,
    state: { type: 'string', enum: ['registered', 'reserved', 'dispatched', 'settled', 'cancelled', 'unknown'] },
    inputTokens: { type: 'string', pattern: '^[0-9]+$', nullable: true }, outputTokens: { type: 'string', pattern: '^[0-9]+$', nullable: true },
    cachedInputTokens: { type: 'string', pattern: '^[0-9]+$', nullable: true }, amount: { ...amount, nullable: true }, currency: { ...currency, nullable: true } }),
  AiTenantCallRecords: object({ records: array(ref('AiTenantCallRecord'), 50), nextCursor: { ...id, nullable: true },
    observedAt: { type: 'string', format: 'date-time' } })
};
const definitions = [
  ['read', undefined, 'AiCreditSummary', 'Read current tenant approved credit and original-ledger consumption. Tenant administrator only.'],
  ['request', 'AiCreditApplication', 'AiCreditRequest', 'Request ADDITIONAL money allowance. Does not approve, pay, allocate or dispatch.'],
  ['receipt', 'AiCreditOperationRead', 'AiCreditRequestReceipt', 'Read original own application. Missing is unknown, never retry authority.'],
  ['allocate', 'AiCreditAllocation', 'AiCreditAllocated', 'CAS limits within approved total; same transaction writes original OperationLog receipt.'],
  ['allocation-receipt', 'AiCreditAllocationRead', 'AiCreditAllocationReceipt', 'Observe original allocation receipt; not a current-settings or execution attestation.'],
  ['platform-read', 'AiCreditPlatformRead', 'AiCreditPlatformQueue', 'SaaS-only bounded pending queue with opaque cursor.'],
  ['platform-decide', 'AiCreditDecision', 'AiCreditRequest', 'SaaS-only one original decision; grant and immutable request decision commit together.'],
  ['platform-receipt', 'AiCreditRequestRead', 'AiCreditDecisionReceipt', 'SaaS-only original decision observation. Distinguishes own match from a superseding decision; never grants credit again.'],
  ['calls', 'AiTenantCallQuery', 'AiTenantCallRecords', 'Tenant-admin scoped model invocation metadata; interval <=31 days, cursor max50 rows. No prompts, secrets, dispatch tokens or supplier prices; absent usage stays null.']
] as const;
export const AI_CREDIT_OPERATIONS: ContractOperation[] = definitions.map(([action, requestSchema, responseSchema, summary]) => ({
  method: 'post', path: `/api/ai-native/credits/${action}`, tag: 'AI Native', operationId: `aiCredit_${action.replaceAll('-', '_')}`,
  permissions: [action.startsWith('platform-') ? action === 'platform-decide' ? 'system:ai-provider:manage' : 'system:ai-provider:view' : 'system:params:manage'],
  summary, requestSchema: requestSchema ?? object({}), responseSchema
}));
