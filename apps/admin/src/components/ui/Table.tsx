import { useEffect, useState } from "react";
import { Table as AntTable, type TableProps, type TablePaginationConfig } from "antd";
import { Pagination } from "./Pagination";

/** Ant keeps table selection, sorting and row semantics; Arc owns ordinary paging. */
export function Table<RecordType extends object>(props: TableProps<RecordType>) {
  const config: TablePaginationConfig = props.pagination && typeof props.pagination === "object" ? props.pagination : {};
  const [page, setPage] = useState(config.defaultCurrent ?? 1);
  const [size, setSize] = useState(config.defaultPageSize ?? config.pageSize ?? 10);
  const total = config.total ?? props.dataSource?.length ?? 0;
  const pageSize = config.pageSize ?? size;
  const current = Math.min(config.current ?? page, Math.max(1, Math.ceil(total / pageSize)));
  useEffect(() => { if (page !== current) setPage(current); }, [current, page]);
  // Filtering/grouping/tree data needs Ant's post-filter total, not dataSource.length.
  if (props.pagination === false || props.columns?.some(column => "children" in column || column.filters || column.sorter) || props.dataSource?.some(row => "children" in row) || [...(config.position ?? []), ...(config.placement ?? [])].some(position => position.startsWith("top")) || config.simple || config.itemRender) return <AntTable {...props} />;
  return <div className="arc-table"><AntTable {...props} pagination={{ ...config, current, pageSize, position: undefined, placement: ["none"] }} />
    <Pagination {...config} current={current} total={total} pageSize={pageSize} onChange={(next, nextSize) => {
      setPage(next); setSize(nextSize); config.onChange?.(next, nextSize);
      props.onChange?.({ current: next, pageSize: nextSize, total }, {}, {}, { currentDataSource: [...(props.dataSource ?? [])], action: "paginate" });
    }} />
  </div>;
}
