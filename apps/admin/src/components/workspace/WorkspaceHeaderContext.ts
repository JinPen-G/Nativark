/** Retained routes and refreshed header components share these context identities. */
import { createContext } from "react";

interface WorkspaceHeaderSlots {
  actions: HTMLDivElement | null;
  title: HTMLSpanElement | null;
  setActions: (node: HTMLDivElement | null) => void;
  setTitle: (node: HTMLSpanElement | null) => void;
}

export const WorkspaceHeaderContext = createContext<WorkspaceHeaderSlots | null>(null);
export const WorkspaceHeaderActiveContext = createContext(true);
export const WorkspaceActionFormContext = createContext<string | undefined>(undefined);
