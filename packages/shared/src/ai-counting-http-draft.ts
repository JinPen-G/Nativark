/** Dedicated HTTP draft for the AI input-counting request surface.
 * Exported through the central shared entry. Route mounting remains explicit
 * and separate from this runtime response contract.
 * Explicit server registration only — these paths are not production
 * switches, and every action still runs the original Auth/Guard/ALS chain
 * and the single budget ledger. */

export const AI_COUNTING_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/counting',
  method: 'POST' as const,
  count: 'count',
  observeCountKey: 'observe',
  readCountReceipt: 'receipt',
  publishInputBound: 'input-bound',
  readInputBound: 'input-bound/read',
  readPublication: 'publication/read',
  usagePage: 'usage/page',
  usageSummary: 'usage/summary',
  usagePricingBases: 'usage/pricing-bases',
  taskCosts: 'task-costs'
});

export interface AiCountingHttpFailureDraft {
  code: 'AI_INVALID_INPUT' | 'AI_ACCESS_DENIED' | 'AI_RESOURCE_UNAVAILABLE' | 'AI_REVISION_CONFLICT' | 'AI_RESULT_UNKNOWN';
  retryable: false;
  nextAction?: Exclude<keyof typeof AI_COUNTING_HTTP_DRAFT, 'basePath' | 'method' | 'count' | 'publishInputBound'> | 'reconcile';
}

export interface AiCountingCountResultDraft {
  state: 'observed' | 'failed' | 'unknown';
  callId: string; countCallId: string; reference: string; receiptId: string;
  inputTokens?: number; failureCode?: 'AUTHENTICATION_FAILED' | 'PROVIDER_REJECTED';
  method: 'provider_count_tokens_receipt'; protocol: string; sceneCode: string;
  admission: { reservationId: string; sceneCode: string; unit: 'calls';
    status: 'settled' | 'reserved' | 'released' | 'pending_reconciliation' };
  /** New producers do not attest the original generation state. The older
   * not_started value remains parseable for draft compatibility, not retry permission. */
  observedAt: string; expiresAt: string; executionPermission: false; textDispatch: 'not_attested' | 'not_started';
}

export interface AiCountingLifecycleObservationDraft {
  callId: string; countCallId: string;
  lifecycle: 'not_started' | 'reserved' | 'claimed_dispatched'
    | { receiptRecorded: 'observed' | 'failed' | 'unknown' };
  admission: AiCountingCountResultDraft['admission'] | null;
  receipt: AiCountingCountResultDraft | null;
}

export interface AiCountingReceiptReadDraft extends AiCountingCountResultDraft {
  diagnostics: { applicable: boolean; bound: { published: boolean; id?: string; maxInputTokens?: number } };
  lifecycle: AiCountingLifecycleObservationDraft['lifecycle'];
}

export interface AiCountingUsagePricingBasesDraft {
  taskId: string;
  bases: Array<{ invocationId: string; callId: string; kind: 'generation' | 'count_request';
    reservationId: string; priceVersion: string | null; configRevision: number | null;
    unit: 'money' | 'tokens' | 'calls' | null }>;
  meaning: 'original_admission_basis_not_provider_invoice';
}

/** Closed response contracts consumed directly by AiInputCountingController;
 * urn:rental:counting:* identifies the local schema registry. */
const countResultSchema = {
    type: 'object', additionalProperties: false,
    required: ['state', 'callId', 'countCallId', 'reference', 'receiptId', 'method', 'protocol',
      'sceneCode', 'admission', 'observedAt', 'expiresAt', 'executionPermission', 'textDispatch'],
    properties: {
      state: { type: 'string', enum: ['observed', 'failed', 'unknown'] },
      callId: { type: 'string', minLength: 1, maxLength: 128 },
      countCallId: { type: 'string', minLength: 1, maxLength: 128 },
      reference: { type: 'string', minLength: 1, maxLength: 128 },
      receiptId: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      inputTokens: { type: 'integer', minimum: 0 },
      failureCode: { type: 'string', enum: ['AUTHENTICATION_FAILED', 'PROVIDER_REJECTED'] },
      method: { type: 'string', const: 'provider_count_tokens_receipt' },
      protocol: { type: 'string', minLength: 1, maxLength: 64 },
      sceneCode: { type: 'string', minLength: 1, maxLength: 128 },
      admission: {
        type: 'object', additionalProperties: false,
        required: ['reservationId', 'sceneCode', 'unit', 'status'],
        properties: {
          reservationId: { type: 'string', minLength: 1, maxLength: 36 },
          sceneCode: { type: 'string', minLength: 1, maxLength: 128 },
          unit: { type: 'string', const: 'calls' },
          status: { type: 'string', enum: ['settled', 'reserved', 'released', 'pending_reconciliation'] }
        }
      },
      observedAt: { type: 'string', format: 'date-time' },
      expiresAt: { type: 'string', format: 'date-time' },
      executionPermission: { type: 'boolean', const: false },
      textDispatch: { type: 'string', enum: ['not_attested', 'not_started'] }
    }
  } as const;

const originalId = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' } as const);
const callRequest = { type: 'object', additionalProperties: false, required: ['callId'], properties: { callId: originalId(128) } } as const;
const taskRequest = { type: 'object', additionalProperties: false, required: ['taskId'], properties: { taskId: originalId(36) } } as const;
const pageRequest = { ...taskRequest, required: ['taskId', 'limit'], properties: { ...taskRequest.properties,
  limit: { type: 'integer', minimum: 1, maximum: 20 }, after: originalId(36) } } as const;

export const AI_COUNTING_HTTP_SCHEMAS = {
  AiCountingCallRequestDraft: callRequest,
  AiCountingReceiptQueryDraft: { oneOf: [callRequest, { type: 'object', additionalProperties: false,
    required: ['invocationId'], properties: { invocationId: originalId(36) } }] },
  AiCountingTaskRequestDraft: taskRequest,
  AiCountingTaskPageRequestDraft: pageRequest,
  AiCountingInputBoundPublishRequestDraft: { ...callRequest, required: ['callId', 'reference'],
    properties: { ...callRequest.properties, reference: originalId(191) } },
  AiCountingInputBoundReceiptDraft: { type: 'object', additionalProperties: false,
    required: ['state', 'id', 'payloadHash', 'callId', 'executionPermission'], properties: {
      state: { type: 'string', const: 'recorded' }, id: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      payloadHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, callId: originalId(128),
      executionPermission: { type: 'boolean', const: false } } },
  AiCountingTaskCostsDraft: { type: 'object', additionalProperties: false, required: ['page', 'summary', 'counting', 'semantics'], properties: {
    page: { $ref: '#/components/schemas/AiTaskBudgetUsagePageDraft' },
    summary: { $ref: '#/components/schemas/AiTaskBudgetUsageSummaryDraft' },
    counting: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false,
      required: ['invocationId', 'receipt'], properties: { invocationId: originalId(36),
        receipt: { $ref: 'urn:rental:counting:AiCountingReceiptReadDraft' } } } },
    semantics: { type: 'object', additionalProperties: false, required: ['execution', 'basis', 'countingBasis', 'absence'], properties: {
      execution: { type: 'string', const: 'read_only_no_dispatch_or_release' },
      basis: { type: 'string', const: 'persisted_budget_records_not_provider_invoice' },
      countingBasis: { type: 'string', const: 'provider_count_tokens_receipt_not_generation_usage' },
      absence: { type: 'string', const: 'no_record_is_not_proof_of_no_consumption' } } } } },
  AiCountingCountResultDraft: countResultSchema,
  AiCountingLifecycleObservationDraft: {
    type: 'object', additionalProperties: false, required: ['callId', 'countCallId', 'lifecycle', 'admission', 'receipt'],
    properties: {
      callId: { type: 'string', minLength: 1, maxLength: 128 },
      countCallId: { type: 'string', minLength: 1, maxLength: 128 },
      lifecycle: { oneOf: [
        { type: 'string', enum: ['not_started', 'reserved', 'claimed_dispatched'] },
        { type: 'object', additionalProperties: false, required: ['receiptRecorded'],
          properties: { receiptRecorded: { type: 'string', enum: ['observed', 'failed', 'unknown'] } } }
      ] },
      admission: { oneOf: [
        { type: 'null' },
        { type: 'object', additionalProperties: false,
          required: ['reservationId', 'sceneCode', 'unit', 'status'],
          properties: {
            reservationId: { type: 'string', minLength: 1, maxLength: 36 },
            sceneCode: { type: 'string', minLength: 1, maxLength: 128 },
            unit: { type: 'string', const: 'calls' },
            status: { type: 'string', enum: ['settled', 'reserved', 'released', 'pending_reconciliation'] }
          } }
      ] },
      receipt: { oneOf: [
        { type: 'null' },
        { $ref: 'urn:rental:counting:AiCountingCountResultDraft' }
      ] }
    }
  },
  AiCountingReceiptReadDraft: {
    type: 'object', additionalProperties: false,
    required: [...countResultSchema.required, 'diagnostics', 'lifecycle'],
    properties: {
          ...countResultSchema.properties,
          diagnostics: { type: 'object', additionalProperties: false, required: ['applicable', 'bound'],
            properties: {
              applicable: { type: 'boolean' },
              bound: { type: 'object', additionalProperties: false, required: ['published'],
                properties: {
                  published: { type: 'boolean' },
                  id: { type: 'string', minLength: 1, maxLength: 128 },
                  maxInputTokens: { type: 'integer', minimum: 0 }
                } }
            } },
          lifecycle: { oneOf: [
            { type: 'string', enum: ['not_started', 'reserved', 'claimed_dispatched'] },
            { type: 'object', additionalProperties: false, required: ['receiptRecorded'],
              properties: { receiptRecorded: { type: 'string', enum: ['observed', 'failed', 'unknown'] } } }
          ] }
    }
  },
  AiCountingUsagePricingBasesDraft: {
    type: 'object', additionalProperties: false, required: ['taskId', 'bases', 'meaning'],
    properties: {
      taskId: { type: 'string', minLength: 1, maxLength: 36 },
      meaning: { type: 'string', const: 'original_admission_basis_not_provider_invoice' },
      bases: { type: 'array', maxItems: 40, items: {
        type: 'object', additionalProperties: false,
        required: ['invocationId', 'callId', 'kind', 'reservationId', 'priceVersion', 'configRevision', 'unit'],
        properties: {
          invocationId: { type: 'string', minLength: 1, maxLength: 36 },
          callId: { type: 'string', minLength: 1, maxLength: 128 },
          kind: { type: 'string', enum: ['generation', 'count_request'] },
          reservationId: { type: 'string', minLength: 1, maxLength: 36 },
          priceVersion: { type: ['string', 'null'], minLength: 1, maxLength: 64 },
          configRevision: { type: ['integer', 'null'], minimum: 1 },
          unit: { type: ['string', 'null'], enum: ['money', 'tokens', 'calls', null] }
        }
      } }
    }
  }
} as const;

/** Exact public routes; task-read alternatives are only an entry superset.
 * The current owner/action policy remains authoritative inside the original reader. */
export const AI_COUNTING_HTTP_OPERATIONS = [
  ['count', 'AiCountingCallRequestDraft', 'AiCountingCountResultDraft', 'management'],
  ['observeCountKey', 'AiCountingCallRequestDraft', 'AiCountingLifecycleObservationDraft', 'task_read'],
  ['readCountReceipt', 'AiCountingReceiptQueryDraft', 'AiCountingReceiptReadDraft', 'task_read'],
  ['publishInputBound', 'AiCountingInputBoundPublishRequestDraft', 'AiCountingInputBoundReceiptDraft', 'management'],
  ['readInputBound', 'AiGatewayInputBoundReadDraft', 'AiGatewayInputBoundSummaryDraft', 'management'],
  ['readPublication', 'AiGatewayPricePublicationReadDraft', 'AiGatewayPriceSummaryDraft', 'management'],
  ['usagePage', 'AiCountingTaskPageRequestDraft', 'AiTaskBudgetUsagePageDraft', 'task_read'],
  ['usageSummary', 'AiCountingTaskRequestDraft', 'AiTaskBudgetUsageSummaryDraft', 'task_read'],
  ['usagePricingBases', 'AiCountingTaskPageRequestDraft', 'AiCountingUsagePricingBasesDraft', 'task_read'],
  ['taskCosts', 'AiCountingTaskPageRequestDraft', 'AiCountingTaskCostsDraft', 'task_read']
] as const;
