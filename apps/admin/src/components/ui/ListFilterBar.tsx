/** One list-query row. Secondary criteria use the original UIArc anchored Popover;
 * page-owned values and transport stay intact; measurement never creates duplicate controls. */
import { Children, Fragment, cloneElement, isValidElement, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/registry/components/popover/popover";
import { ADMIN_LIST_CONTROL_WIDTH as LIST_WIDTH, ADMIN_LIST_METRICS } from "@/app/designTokens";
import { useLocale } from "@/app/locale";
import { Button } from "./Button";
import { SearchField } from "./SearchField";
import { Segmented } from "./Segmented";
import { Tabs } from "./Tabs";
import { ListFilters, listFilterElements, type ListFiltersProps } from "./ListFilters";
import { planListFilters } from "./listFilterLayout";
import styles from "./data-table/DataTable.module.css";

type Kind = "category" | "search" | "filter" | "reset" | "action";
type ItemProps = { children: ReactNode; kind?: Kind; label?: string; active?: boolean; width?: keyof typeof LIST_WIDTH; priority?: boolean };
type Entry = ItemProps & { key: string; kind: Kind };

/** Explicitly describe a wrapped/custom business filter; ordinary shared fields are inferred. */
export function ListFilterItem({ children }: ItemProps) { return <>{children}</>; }

/** A view switch changes the content schema; it must never become a hidden criterion.
 * Fragments are transparent, but custom fields keep their existing component identity. */
export function splitListControls(children: ReactNode): { navigation: ReactNode[]; filters: ReactNode[] } {
  const navigation: ReactNode[] = [], filters: ReactNode[] = [];
  for (const child of Children.toArray(children)) {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
      const nested = splitListControls(child.props.children);
      navigation.push(...nested.navigation); filters.push(...nested.filters);
    } else if (isValidElement(child) && child.type === Tabs) navigation.push(child);
    else filters.push(child);
  }
  return { navigation, filters };
}

function entriesFrom(children: ReactNode, t: (value: string) => string, prefix = ""): Entry[] {
  return Children.toArray(children).flatMap((node, index): Entry[] => {
    if (!isValidElement<Record<string, unknown>>(node)) return [];
    const key = prefix + (node.key ?? index);
    const props = node.props;
    if (node.type === Fragment) return entriesFrom(props.children as ReactNode, t, key + "/");
    if (node.type === ListFilters) return entriesFrom(listFilterElements(props as unknown as ListFiltersProps, t), t, key + "/");
    if (node.type === ListFilterItem) return [{ ...props as ItemProps, key, kind: (props.kind as Kind) ?? "filter" }];
    const kind: Kind = node.type === Segmented ? "category" : node.type === SearchField ? "search"
      : props["data-list-filter-reset"] != null || props.children === t("清除筛选") ? "reset" : node.type === Button ? "action" : "filter";
    const label = props["aria-label"] ?? props.placeholder ?? props.label ?? (kind === "action" ? props.children : undefined);
    const value = props.value ?? props.activeKey ?? props.checked;
    const firstTab = (props.items as { key: string }[] | undefined)?.[0]?.key;
    return [{ key, kind, children: node, label: typeof label === "string" ? label : undefined,
      active: Array.isArray(value) ? value.some(Boolean) : value != null && value !== "" && value !== "all" && value !== false && value !== firstTab }];
  });
}

export function ListFilterBar({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const slots = useRef(new Map<string, HTMLDivElement>());
  const measured = useRef(new Map<string, number>());
  const [available, setAvailable] = useState(0);
  const [layout, setLayout] = useState<ReturnType<typeof planListFilters>>();
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    setAvailable(node.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const entries = entriesFrom(children, t);
  const categories = entries.filter(item => item.kind === "category");
  const searches = entries.filter(item => item.kind === "search");
  const fields = entries.filter(item => item.kind === "filter");
  const resets = entries.filter(item => item.kind === "reset");
  const actions = entries.filter(item => item.kind === "action");
  const compact = available > 0 && available < ADMIN_LIST_METRICS.categoryInlineMinWidth;
  useLayoutEffect(() => {
    const width = root.current?.getBoundingClientRect().width ?? 0;
    if (!width) return;
    for (const entry of entries) {
      const node = slots.current.get(entry.key);
      if (node && !node.closest('[role="dialog"]')) measured.current.set(entry.key,
        entry.kind === "category" ? Math.max(node.scrollWidth, ...[...node.querySelectorAll("*")].map(child => child.scrollWidth))
          : entry.kind === "filter" ? LIST_WIDTH[entry.width ?? "select"] : node.getBoundingClientRect().width);
    }
    const category = compact ? 0 : Math.min(categories.reduce((sum, entry) => sum + (measured.current.get(entry.key) ?? LIST_WIDTH.wide), 0), width * .6);
    const sizeOf = (entry: Entry) => measured.current.get(entry.key) ?? LIST_WIDTH[entry.width ?? "select"];
    const gap = parseFloat(getComputedStyle(root.current!).columnGap) || 0;
    const moreWidth = moreTrigger.current?.getBoundingClientRect().width ??
      (width <= ADMIN_LIST_METRICS.compactTriggerMaxWidth ? ADMIN_LIST_METRICS.moreSearchCompactWidth : ADMIN_LIST_METRICS.moreSearchWidth);
    const categoryMin = Math.min(category, LIST_WIDTH.number);
    const next = planListFilters({ available: width, category,
      categoryMin,
      search: searches.length ? LIST_WIDTH.search : 0,
      searchMin: searches.length ? (width >= categoryMin + LIST_WIDTH.searchMin + moreWidth + gap * 2 ? LIST_WIDTH.searchMin : LIST_WIDTH.compact) : 0,
      fieldWidths: fields.map(sizeOf), preferFirst: Boolean(fields[0]?.priority), actions: actions.map(sizeOf), resets: resets.map(sizeOf),
      gap, moreWidth,
      collapsedCategory: compact && categories.length > 0 });
    setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    if (!next.more && open) setOpen(false);
  });
  const inlineFields = fields.slice(0, layout?.count ?? fields.length);
  const collapsed = [...(compact ? categories : []), ...fields.slice(inlineFields.length)];
  const activeCount = collapsed.filter(item => item.active).length;
  // A child Select/Combobox may portal outside this panel. Only its actual
  // aria-controls target belongs to this popover; unrelated page overlays do not.
  const ownsPopupTarget = (target: EventTarget | null) => target instanceof Node &&
    [...(panel.current?.querySelectorAll("[aria-controls]") ?? [])].some(control =>
      control.getAttribute("aria-controls")?.split(/\s+/u).some(id => document.getElementById(id)?.contains(target)));
  const item = (entry: Entry, inPanel = false) => <div key={entry.key} data-filter-kind={entry.kind}
    ref={node => { if (node) slots.current.set(entry.key, node); else slots.current.delete(entry.key); }}
    style={!inPanel ? { width: entry.kind === "category" && layout ? layout.category / categories.length : entry.kind === "search" && layout ? layout.search : entry.width ? LIST_WIDTH[entry.width] : undefined } : undefined}
    className={inPanel ? styles.filterPanelField : styles.filterSlot} role={inPanel ? "group" : undefined} aria-label={inPanel ? entry.label : undefined}>
    {inPanel && entry.label && <span className={styles.filterLabel} aria-hidden="true">{entry.label}</span>}
    {!inPanel && compact && entry.kind === "action" && isValidElement<{ icon?: ReactNode; children?: ReactNode; "aria-label"?: string; title?: string }>(entry.children) && entry.children.props.icon
      ? cloneElement(entry.children, { children: null, "aria-label": entry.label, title: entry.label }) : entry.children}
  </div>;
  return <div ref={root} className={styles.filterBar} data-list-filter-bar="" data-has-category={categories.length ? "" : undefined}>
    {!compact && categories.map(entry => item(entry))}{searches.map(entry => item(entry))}{inlineFields.map(entry => item(entry))}
    {layout?.more ? <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild><Button ref={moreTrigger} className={styles.moreSearch} aria-label={t("更多搜索")}>
        <SlidersHorizontal size={16} aria-hidden="true" /><span className={styles.moreSearchText}>{t("更多搜索")}</span>
        {activeCount > 0 && <span className={styles.filterCount} aria-label={t("{count} 个已选条件", { count: activeCount })}>{activeCount}</span>}
      </Button></PopoverTrigger>
      <PopoverContent ref={panel} side="bottom" align="start" className={styles.filterPopover} aria-label={t("更多搜索")}
        onInteractOutside={event => { if (ownsPopupTarget(event.target)) event.preventDefault(); }}>
        <div className={styles.filterPanelFields}>{collapsed.map(entry => item(entry, true))}</div>
        {resets.length > 0 && <div className={styles.filterPanelFooter}>{resets.map(entry => item(entry))}</div>}
      </PopoverContent>
    </Popover> : resets.map(entry => item(entry))}
    {actions.map(entry => item(entry))}
  </div>;
}
