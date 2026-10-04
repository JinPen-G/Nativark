import { toDisplayOrderFacts, orderFactsRows } from "./order-facts-display";

export function OrderFactsCard({ facts }: { facts?: unknown }) {
  const display = toDisplayOrderFacts(facts);
  if (!display) return <p role="status">权威订单事实不可用，请核对当前读取范围。</p>;
  return <section aria-label="权威订单事实" data-ai-order-facts="readonly">
    <h3>权威订单事实</h3>
    <p>订单 {display.orderNo} · 状态 {display.status}</p>
    <p>查询时点：{display.observedAt} · 来源范围：{display.sourceScope} · 依据：当前订单</p>
    <dl>{orderFactsRows(display).map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}{row.known ? ` ${display.currency}` : ""}</dd></div>)}</dl>
    <p role="status">以上为受控事实投影；支付凭证与历史费用依据未加载，不代表支付已完成。</p>
  </section>;
}
