/** 已注册业务参加者的工具格式校验，Gateway 在准入前确认此接点。
 * 业务来源、当前权限与原收据由 nativeToolResults 和宿主参加者负责。 */
import type { AiLeafSchemaDraft } from '@rental-os/platform-contracts/ai-gateway';

export interface GatewayToolResultPolicy<TToolRequest = never> {
  readonly toolRequestSchema: AiLeafSchemaDraft;
  readonly schemaDefinitions?: Readonly<Record<string, AiLeafSchemaDraft>>;
  validateToolRequest(value: unknown): value is TToolRequest;
  validateNativeToolCall(value: unknown): boolean;
}
