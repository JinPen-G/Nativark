import { Table, type BusinessTableProps } from "./Table";

/** Legacy import kept source-compatible; lists share the order renderer. */
export function AnimatedTable<T extends object>(props: BusinessTableProps<T>) {
  return <Table {...props} />;
}
AnimatedTable.listToolbarHost = true;
