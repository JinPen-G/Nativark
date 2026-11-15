/** Core分页列表复用原Table/工具栏/分页及QueryState；列和受权数据来自Core，不以一页数量充当总数。 */
import { useEffect, type ReactNode } from "react";
import { ListSection, Table } from "../components/ui";
import type { BusinessTableProps } from "../components/ui/Table";
import { QueryState } from "../components/QueryState";

export interface CoreListQuery<Row> {
  data?: { rows: Row[]; total: number };
  isPending: boolean;
  isFetching: boolean;
  error?: unknown;
  refetch(): Promise<unknown>;
}

/** 提供查询键、真实分页结果和业务列即可；排序/导出只在Core具有对应服务端合同后另行接入。 */
export function CoreList<Row extends object>({ query, queryKey, pagination, columns, rowKey, controls }: {
  query: CoreListQuery<Row>;
  queryKey: readonly unknown[];
  pagination: { offset: number; limit: number; onChange: (offset: number, limit: number) => void };
  columns: BusinessTableProps<Row>["columns"];
  rowKey: NonNullable<BusinessTableProps<Row>["rowKey"]>;
  controls?: ReactNode;
}) {
  const { offset, limit, onChange } = pagination;
  const last = query.data?.total ? Math.floor((query.data.total - 1) / limit) * limit : 0;
  const outside = Boolean(query.data && offset > last);
  useEffect(() => {
    if (!query.data || query.isFetching || query.isPending || query.error) return;
    if (outside) onChange(last, limit);
  }, [query.data, query.isFetching, query.isPending, query.error, outside, last, limit, onChange]);
  const busy = query.isPending || query.isFetching || Boolean(query.error) || outside;
  return <ListSection controls={controls}>
    {/* 首次列表加载由Table数据区骨架承担，保留列头/筛选；QueryState只负责读取失败与重试。 */}
    <QueryState loading={false} error={query.error} onRetry={() => query.refetch()}
      transitionKey={JSON.stringify([queryKey, Boolean(query.error && !query.data)])}>
      <Table<Row> columns={columns} rowKey={rowKey} dataSource={query.data?.rows} sorting={false}
        loading={busy} refreshing={query.isFetching} onRefresh={() => query.refetch()}
        pagination={{ current: Math.floor(offset / limit) + 1, pageSize: limit, total: query.data?.total,
          showSizeChanger: true, disabled: busy, onChange: (page, size) => onChange((page - 1) * size, size) }} />
    </QueryState>
  </ListSection>;
}
