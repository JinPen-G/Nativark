/** UI ownership only. Hosts supply current identity and optional list commands;
 * this context never supplies business authorization or credentials. */
import { createContext, useContext, type ReactNode } from "react";
export interface BusinessUiScope {
  identity: string;
  currentIdentity: () => string;
  selectionCommand?: { label: string; run: (host: HTMLElement, count: number) => void };
}
const Context = createContext<BusinessUiScope>({ identity: "unavailable", currentIdentity: () => crypto.randomUUID() });
export function BusinessUiScopeProvider({ value, children }: { value: BusinessUiScope; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useBusinessUiScope() { return useContext(Context); }
