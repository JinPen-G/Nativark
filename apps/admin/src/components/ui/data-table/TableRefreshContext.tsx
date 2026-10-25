import { createContext, useContext, type ReactNode } from "react";

type Reader = { onRefresh?: () => unknown; busy?: boolean };
const TableRefreshContext = createContext<Reader>({});

/** Snapshot tables in tabs/drawers refresh their owning reader, not arbitrary caches. */
export function TableRefreshProvider({ children, ...reader }: Reader & { children: ReactNode }) {
  return <TableRefreshContext.Provider value={reader}>{children}</TableRefreshContext.Provider>;
}
export function useTableRefresh() { return useContext(TableRefreshContext); }
