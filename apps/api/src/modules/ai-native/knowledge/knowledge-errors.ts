export type KnowledgeErrorCode = 'unavailable' | 'invalid_input' | 'conflict' | 'not_ready' | 'unsupported' | 'invalid_text' | 'empty_text' | 'limit_exceeded';
export class KnowledgeError extends Error {
  constructor(readonly code: KnowledgeErrorCode) { super(code); this.name = 'KnowledgeError'; }
}
export function unavailable(): never { throw new KnowledgeError('unavailable'); }
export function requiredPort(value: unknown, methods: string[]): void {
  if (!value || methods.some(method => typeof (value as { [key: string]: unknown })[method] !== 'function')) unavailable();
}
