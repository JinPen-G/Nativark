import { toReadinessDiagnostics } from "./readiness-diagnostics";

const labels = {
  required: "必需",
  optional: "可选",
  unavailable: "外部待配置",
  completed: "已完成"
} as const;

export function ReadinessDiagnosticsCard({ data }: { data?: unknown }) {
  const display = toReadinessDiagnostics(data);
  if (!display) return <p role="status">开业诊断不可用，请核对当前租户和经营空间。</p>;
  return <section aria-label="开业诊断" data-ai-readiness="readonly">
    <h3>开业诊断 · {display.status}</h3>
    <p>租户 {display.tenantId} · 经营空间 {display.workspaceId} · {display.ready ? "服务端判定可开业" : "仍有配置缺口"}</p>
    {display.rows.map((row) => <div key={row.key} data-readiness-state={row.state}>
      <strong>{row.title}</strong> <span>{labels[row.state]}</span>
      {row.state !== "completed" && <p>{row.state === "unavailable" ? "事实源不可用，不能据此判定完成。" : row.missing}</p>}
      {row.summary && <p>{row.summary}</p>}
    </div>)}
    {display.quoteBlockers.length > 0 && <p role="status">报价/下单阻塞：{display.quoteBlockers.join("、")}</p>}
    <p role="status">此卡片只展示服务端诊断；不会写入配置、发布版本或改变开业状态。</p>
  </section>;
}

