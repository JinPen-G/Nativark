import type { AiTenantModelSettingsSummaryDraft } from "@rental-os/shared";

export interface AiServiceSummaryProps {
  summary?: AiTenantModelSettingsSummaryDraft | null;
}
export type SafeAiServiceSummary =
  | { mode: "platform_managed"; enabled: boolean; availability: "ready" | "unavailable" | "not_verified"; connectionState: string }
  | { mode: "tenant_managed"; enabled: boolean; credentialState: "configured" | "missing" | "rotation_required"; protocol: string; model: string; connectionState: string };
export function toSafeAiServiceSummary(input: unknown): SafeAiServiceSummary | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  if (row.mode === "platform_managed" && (row.availability === "ready" || row.availability === "unavailable" || row.availability === "not_verified")) {
    return { mode: "platform_managed", enabled: row.enabled === true, availability: row.availability, connectionState: typeof row.connectionState === "string" ? row.connectionState : "unknown" };
  }
  if (row.mode === "tenant_managed" && (row.credentialState === "configured" || row.credentialState === "missing" || row.credentialState === "rotation_required")) {
    return { mode: "tenant_managed", enabled: row.enabled === true, credentialState: row.credentialState, protocol: typeof row.protocol === "string" ? row.protocol.slice(0, 128) : "不可用", model: typeof row.model === "string" ? row.model.slice(0, 256) : "不可用", connectionState: typeof row.connectionState === "string" ? row.connectionState : "unknown" };
  }
  return null;
}
const connection = {
  not_tested: "未验证",
  mock_only: "仅模拟验证",
  verified_live: "真实连接已验证",
  failed: "连接不可用",
} as const;
export function AiServiceSummary({ summary }: AiServiceSummaryProps) {
  if (!summary || summary.draftVersion !== "ain-c07-draft-2")
    return <p role="status">AI 配置不可用：缺少摘要或契约版本不匹配</p>;
  const safe = toSafeAiServiceSummary(summary);
  if (!safe) return <p role="status">AI 配置不可用：摘要字段不完整</p>;
  const state = connection[safe.connectionState as keyof typeof connection] ?? "未知验证状态";
  if (safe.mode === "platform_managed")
    return (
      <section aria-label="AI 服务摘要">
        <h3>Rental OS AI</h3>
        <p>
          {!safe.enabled
            ? "未启用"
            : safe.availability === "ready"
              ? "服务可用"
              : safe.availability === "not_verified"
                ? "服务未验证"
                : "服务不可用"}
        </p>
        <p>{state}</p>
      </section>
    );
  return (
    <section aria-label="AI 服务摘要">
      <h3>自定义 AI 服务 / BYOK</h3>
      <p>
        {!safe.enabled
          ? "未启用"
          : safe.credentialState === "missing"
            ? "未配置凭据"
            : safe.credentialState === "rotation_required"
              ? "凭据需要更新"
              : state}
      </p>
      <dl>
        <dt>协议</dt>
        <dd>{safe.protocol}</dd>
        <dt>模型标识</dt>
        <dd>{safe.model}</dd>
      </dl>
      <p>{state}</p>
    </section>
  );
}
