import { createContext, useContext, type RefObject } from "react";
import type { RestMinutes, RestSession } from "./restSession";

export interface RestContextValue {
  available: boolean;
  session: RestSession | null;
  remaining: number;
  expanded: boolean;
  entryRef: RefObject<HTMLButtonElement | null>;
  start: (minutes: RestMinutes) => void;
  close: () => void;
  minimize: () => void;
  expand: () => void;
}

export const RestContext = createContext<RestContextValue | null>(null);
export function useRest() {
  const value = useContext(RestContext);
  if (!value) throw new Error("Rest controls require RestProvider");
  return value;
}
