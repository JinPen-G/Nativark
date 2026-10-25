/** Frameless list grouping. Titles/actions remain; only actual form cards keep a shell. */
import { Children, Fragment, createContext, isValidElement, useContext, useId, type CSSProperties, type ReactNode } from "react";
import styles from "./data-table/DataTable.module.css";

export const ListControlsContext = createContext<ReactNode>(null);
export function useListControls() { return useContext(ListControlsContext); }
export interface ListToolbarHeading { id: string; title: ReactNode; extra?: ReactNode }
export const ListHeadingContext = createContext<ListToolbarHeading | null>(null);
export function useListHeading() { return useContext(ListHeadingContext); }
export function ListSectionTitle({ id, title, className }: ListToolbarHeading & { className?: string }) {
  return <div id={id} className={[styles.sectionTitle, className].filter(Boolean).join(" ")} role="heading" aria-level={2}>{title}</div>;
}

/** Only transparent, ready query wrappers are traversed. An alert, form, summary,
 * empty state or multi-table group keeps its own section heading above the body. */
function countListTables(children: ReactNode): number {
  return Children.toArray(children).reduce<number>((count, child) => {
    if (!isValidElement<{ children?: ReactNode; loading?: boolean; error?: unknown }>(child)) return count;
    const kind = child.type as { listToolbarHost?: boolean; listSectionPassthrough?: boolean };
    if (kind.listToolbarHost) return count + 1;
    if (kind.listSectionPassthrough && (child.props.loading || child.props.error)) return count;
    return count + countListTables(child.props.children);
  }, 0);
}
export function startsWithListTable(children: ReactNode): boolean {
  if (countListTables(children) !== 1) return false;
  const first = Children.toArray(children)[0];
  if (!isValidElement<{ children?: ReactNode; loading?: boolean; error?: unknown }>(first)) return false;
  if (first.type === Fragment) return startsWithListTable(first.props.children);
  const kind = first.type as { listToolbarHost?: boolean; listSectionPassthrough?: boolean };
  if (kind.listToolbarHost) return true;
  return Boolean(kind.listSectionPassthrough && !first.props.loading && !first.props.error && startsWithListTable(first.props.children));
}

export function ListSection({ title, titlePlacement = "auto", extra, controls, children, className, style, id }: {
  title?: ReactNode; extra?: ReactNode; controls?: ReactNode; children?: ReactNode;
  /** Pure lists share the tools row by default; composite sections remain above. */
  titlePlacement?: "auto" | "above" | "toolbar";
  className?: string; style?: CSSProperties; id?: string;
}) {
  const titleId = useId();
  const heading = title ? { id: titleId, title, extra } : null;
  const inlineHeading = titlePlacement === "toolbar" || titlePlacement === "auto" && startsWithListTable(children) ? heading : null;
  return <section id={id} className={[styles.listSection, className].filter(Boolean).join(" ")} style={style}
    aria-labelledby={title ? titleId : undefined} data-list-section="">
    {!inlineHeading && (heading || extra) && <div className={styles.sectionHeader}>
      {heading && !inlineHeading && <ListSectionTitle {...heading} />}
      {extra && <div className={styles.sectionActions}>{extra}</div>}
    </div>}
    <ListHeadingContext.Provider value={inlineHeading}>
      <ListControlsContext.Provider value={controls ?? null}>{children}</ListControlsContext.Provider>
    </ListHeadingContext.Provider>
  </section>;
}
