/** Provider setup metadata only. A directory entry or HTTP route hint is never
 * model capability evidence, dispatch permission or a billing observation. */
export const AI_PROVIDER_DISCOVERY_PROTOCOLS = ['openai_chat_completions', 'openai_responses', 'anthropic_messages'] as const;
export type AiProviderDiscoveryProtocol = typeof AI_PROVIDER_DISCOVERY_PROTOCOLS[number];
export interface AiProviderDiscoveryInputDraft {
  baseUrl: string; protocol: AiProviderDiscoveryProtocol; expectedRevision: number;
  secretChange: { operation: 'retain' } | { operation: 'replace'; apiKey: string };
}
export interface AiProviderDiscoveryResultDraft {
  observation: 'metadata_only'; observedAt: string;
  models: string[]; truncated: boolean;
  state: 'listed' | 'empty' | 'authentication_failed' | 'unavailable';
  protocols: { protocol: AiProviderDiscoveryProtocol; state: 'candidate' | 'undetermined' }[];
}
export const AI_PROVIDER_DISCOVERY_INPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['baseUrl', 'protocol', 'expectedRevision', 'secretChange'], properties: {
    baseUrl: { type: 'string', minLength: 1, maxLength: 2048 },
    protocol: { type: 'string', enum: [...AI_PROVIDER_DISCOVERY_PROTOCOLS] },
    expectedRevision: { type: 'integer', minimum: 0, maximum: 4294967294 },
    secretChange: { oneOf: [
      { type: 'object', additionalProperties: false, required: ['operation'], properties: { operation: { type: 'string', enum: ['retain'] } } },
      { type: 'object', additionalProperties: false, required: ['operation', 'apiKey'], properties: {
        operation: { type: 'string', enum: ['replace'] }, apiKey: { type: 'string', minLength: 1, maxLength: 8192, pattern: '^[\\x21-\\x7e]+$', writeOnly: true }
      } }
    ] }
  }
};
export const AI_PROVIDER_DISCOVERY_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['observation', 'observedAt', 'models', 'truncated', 'state', 'protocols'], properties: {
    observation: { type: 'string', enum: ['metadata_only'] }, observedAt: { type: 'string', format: 'date-time' },
    models: { type: 'array', maxItems: 200, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 256, pattern: '^[\\w./:-]+$' } },
    truncated: { type: 'boolean' }, state: { enum: ['listed', 'empty', 'authentication_failed', 'unavailable'] },
    protocols: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', additionalProperties: false,
      required: ['protocol', 'state'], properties: { protocol: { enum: [...AI_PROVIDER_DISCOVERY_PROTOCOLS] }, state: { enum: ['candidate', 'undetermined'] } } } }
  }
};
