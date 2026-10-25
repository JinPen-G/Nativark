import { Blocks, ChartNoAxesCombined, House, MessagesSquare } from "lucide-react";
import { useState } from "react";
import { SearchField, SidebarMenu } from "@/components/ui";
import { useLocale } from "@/app/locale";

/** Fixed shell entries, independent of permission-filtered business navigation.
 * All four temporarily open the existing overview; no search, AI call or new route.
 */
export function SidebarQuickEntries({ collapsed, selectedKey, onNavigate }: { collapsed: boolean; selectedKey?: string; onNavigate: (key: string) => void }) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const entries = [
    { key: "home", label: "首页", icon: House },
    { key: "ask-ai", label: "询问 AI", icon: MessagesSquare },
    { key: "integrations", label: "集成", icon: Blocks, count: 3 },
    { key: "insights", label: "洞察", icon: ChartNoAxesCombined },
  ];
  return <div className={`sider-quick${collapsed ? " is-compact" : ""}`}>
    {!collapsed && <div className="sider-search-preview">
      <SearchField value={query} onValueChange={setQuery} placeholder={t("搜索")} label={t("搜索（预览，暂未接入）")} />
      {!query && <kbd className="sider-search-hint" aria-hidden="true" title={t("搜索（预览，暂未接入）")}>⌘K</kbd>}
    </div>}
    <nav className="sider-quick-nav" aria-label={t("固定入口")}>
      <SidebarMenu mode="inline" inlineCollapsed={collapsed} selectedKeys={selectedKey ? [selectedKey] : []}
        onClick={({ key }) => onNavigate(String(key))}
        items={entries.map(({ key, label, icon: Icon, count }) => ({
          key, icon: <Icon size={14} strokeWidth={1.75} aria-hidden="true" />,
          title: t(label),
          label: <span className="sider-quick-label">{t(label)}
            {!collapsed && count !== undefined && <span className="sider-quick-count" title={t("示意计数")}>{count}</span>}
          </span>,
        }))} />
    </nav>
    <div className="sider-quick-divider" role="separator" />
  </div>;
}
