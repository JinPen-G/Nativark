/** Deprecated system parameters never expose or configure model credentials.
 * Legacy records remain available only to the reviewed, server-only conversion reader. */
import { BadRequestException } from "@nestjs/common";
import type { SystemRulesConfig } from "@rental-os/shared";

export function closedLegacyAiSettings(): SystemRulesConfig["aiModel"] {
  return { enabled: false, provider: "OPENAI_COMPATIBLE", baseUrl: "", modelName: "", apiKeyMasked: "",
    promptSourceText: "", promptConfigVersion: "", promptVersion: "", promptHash: "",
    lastTestStatus: "未验证", lastTestTime: "", guardrails: [], logs: [] };
}

export function assertNoLegacyAiCredentials(config: unknown) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new BadRequestException("系统参数格式无效");
  const ai = (config as Record<string, unknown>).aiModel;
  if (ai == null) return;
  if (typeof ai !== "object" || Array.isArray(ai)) throw new BadRequestException("AI 配置请使用专用设置入口");
  const allowed = new Set(Object.keys(closedLegacyAiSettings()));
  if (Object.keys(ai).some(key => !allowed.has(key))) throw new BadRequestException("旧系统参数不接受 AI 密钥或额外配置字段");
}
