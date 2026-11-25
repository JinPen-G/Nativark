/** Implemented wire protocols only. This list grants neither capability nor
 * permission; current profiles, evidence, dispatch and budget still gate use. */
export const NATIVE_MODEL_PROTOCOLS = Object.freeze(['openai_chat_completions', 'openai_responses', 'anthropic_messages'] as const);
export type NativeModelProtocol = typeof NATIVE_MODEL_PROTOCOLS[number];
export function isNativeModelProtocol(value: unknown): value is NativeModelProtocol {
  return typeof value === 'string' && (NATIVE_MODEL_PROTOCOLS as readonly string[]).includes(value);
}
