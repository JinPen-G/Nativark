import { toInspectionDraftRows } from "./inspection-draft-display";

export function InspectionDraftCard({ items }: { items?: unknown }) {
  const rows = toInspectionDraftRows(items);
  if (!items) return <p role="status">检查草稿不可用</p>;
  if (!rows.length) return <p role="status">没有可展示的检查草稿字段</p>;
  return <section aria-label="履约检查草稿" data-ai-inspection-draft="readonly">
    <h3>检查草稿（待核实）</h3>
    <dl>{rows.map(row => <div key={row.key}><dt>{row.label}</dt><dd>{row.humanValue ?? row.candidate ?? "未提供"}</dd><small>{row.sourceLabel ?? "来源不可用"} · {row.humanValue ? "人工值" : row.candidate ? "候选值，待核实" : "缺失"}</small></div>)}</dl>
    <p role="status">候选或人工输入不会自动改变订单、库存、费用或责任。</p>
  </section>;
}
