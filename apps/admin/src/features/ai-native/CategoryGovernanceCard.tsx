import { toCategoryDifferenceRows, toCategoryGovernanceDisplay } from "./category-governance-display";

const differenceLabels: Record<string, string> = {
  added: "新增", removed: "移除", changed: "修改", required_added: "新增必填要求",
  unique_enabled: "启用唯一要求", type_changed: "字段类型变化", scope_narrowed: "支持范围收窄"
};

export function CategoryGovernanceCard({ summary, differences }: { summary?: unknown; differences?: unknown }) {
  const governance = toCategoryGovernanceDisplay(summary);
  const rows = differences === undefined ? [] : toCategoryDifferenceRows(differences);
  if (!governance && rows === null) return <p role="status">品类治理结果不可用，无法安全展示版本差异。</p>;
  return <section aria-label="品类治理结果" data-ai-category-governance="readonly">
    {governance && <>
      <h3>{governance.name} · 品类治理</h3>
      <p>状态范围：{governance.openingScope} · 开业策略修订 {governance.openingRevision}</p>
      <dl>
        <div><dt>推荐版本</dt><dd>{governance.recommendedVersion}</dd></div>
        <div><dt>最近发布</dt><dd>{governance.latestPublished}</dd></div>
        <div><dt>草稿数量</dt><dd>{governance.draftCount}</dd></div>
        <div><dt>已采用空间/租户</dt><dd>{governance.adoptedSpaces} / {governance.adoptedTenants}</dd></div>
      </dl>
    </>}
    {rows && rows.length > 0 && <>
      <h4>配置差异</h4>
      {rows.map((row) => <div key={`${row.section}:${row.path}`} data-difference-kind={row.kind}>
        <strong>{row.label}</strong> <span>{differenceLabels[row.kind] ?? "未知变更"}</span>
        <p>变更前：{row.before} · 变更后：{row.after}</p>
      </div>)}
    </>}
    {rows && rows.length === 0 && <p role="status">没有可展示的配置差异。</p>}
    <p role="status">此卡片只读展示，不发布版本、不改变租户采用资格，也不代表治理能力已在当前空间可执行。</p>
  </section>;
}

