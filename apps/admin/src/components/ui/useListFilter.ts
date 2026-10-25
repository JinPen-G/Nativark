/** Filter a complete, already-authorized result before Table performs local pagination.
 * Never pass a remotely paged subset; searchable fields must be explicitly public to this list. */
import { useState } from "react";

type SearchValue = string | number | null | undefined;
type FilterFields<T> = { fields: (row: T) => readonly SearchValue[]; status?: (row: T) => string | undefined };
const normalize = (value: SearchValue) => String(value ?? "").normalize("NFKC").toLocaleLowerCase().trim();

export function filterListRows<T>(rows: readonly T[], keyword: string, status: string, fields: FilterFields<T>): T[] {
  const terms = normalize(keyword).split(/\s+/u).filter(Boolean);
  return rows.filter(row => (!status || fields.status?.(row) === status) &&
    (!terms.length || terms.every(term => fields.fields(row).some(value => normalize(value).includes(term)))));
}

export function useListFilter<T>(rows: readonly T[] | undefined, fields: FilterFields<T>) {
  const [keyword, updateKeyword] = useState("");
  const [status, updateStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  return {
    keyword, status,
    setKeyword: (next: string) => { updateKeyword(next); setPage(1); },
    setStatus: (next: string) => { updateStatus(next); setPage(1); },
    clear: () => { updateKeyword(""); updateStatus(""); setPage(1); },
    rows: filterListRows(rows ?? [], keyword, status, fields),
    pagination: { current: page, pageSize, onChange: (next: number, size: number) => { setPage(size === pageSize ? next : 1); setPageSize(size); } },
  };
}
