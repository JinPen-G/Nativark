/** Dedicated HTTP draft for the AI input-counting request surface.
 * NEW dedicated source file: the central shared index/OpenAPI wiring is done
 * by the mainline single author; nothing here is exported centrally yet.
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
  nextAction?: 'reconcile';
}

export interface AiCountingCountResultDraft {
  state: 'observed' | 'failed' | 'unknown';
  callId: string; countCallId: string; reference: string; receiptId: string;
  inputTokens?: number; failureCode?: 'AUTHENTICATION_FAILED' | 'PROVIDER_REJECTED';
  method: 'provider_count_tokens_receipt'; protocol: string; sceneCode: string;
  admission: { reservationId: string; sceneCode: string; unit: 'calls';
    status: 'settled' | 'reserved' | 'released' | 'pending_reconciliation' };
  observedAt: string; expiresAt: string; executionPermission: false; textDispatch: 'not_started';
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

/** Closed JSON-schema drafts for response validation. Field-level shapes
 * intentionally mirror the server result types above. The four
 * counting-owned responses (count / observe / receipt / pricing bases) are
 * structurally validated in AiInputCountingController via lockstep zod
 * mirrors; wiring THESE JSON schemas centrally (urn:rental:counting:* ids,
 * key = schema name) is the mainline's single-author integration step. */
export const AI_COUNTING_HTTP_SCHEMAS = {
  AiCountingCountResultDraft: {
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
      textDispatch: { type: 'string', const: 'not_started' }
    }
  },
  AiCountingLifecycleObservationDraft: {
    type: 'object', additionalProperties: false, required: ['callId', 'countCallId', 'lifecycle', 'admission'],
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
    allOf: [
      { $ref: 'urn:rental:counting:AiCountingCountResultDraft' },
      { type: 'object', additionalProperties: false,
        required: ['diagnostics', 'lifecycle'],
        properties: {
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
        } }
    ]
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
