export interface AiCursorEvent { cursor: string; taskId: string; version: string; type: string; }
export interface AiCursorState { taskId: string; version: string; cursor: string | null; events: readonly AiCursorEvent[]; sync: "synced" | "unsynced"; reason: "none" | "duplicate" | "out_of_order" | "gap" | "reset" | "unknown_version" | "unknown_event"; }
const integer = (value: string): bigint | null => typeof value === "string" && /^(0|[1-9]\d*)$/.test(value) && value.length <= 128 ? BigInt(value) : null;
export const initialCursorState = (taskId: string, version: string): AiCursorState => ({ taskId, version, cursor: null, events: [], sync: "synced", reason: "none" });
export function applyCursorEvent(state: AiCursorState, event: AiCursorEvent, knownTypes: readonly string[] = []): AiCursorState {
  if (state.sync === "unsynced") return state;
  if (!event || typeof event !== "object") return { ...state, events: [], cursor: null, sync: "unsynced", reason: "unknown_event" };
  if (event.type === "reset_required") return { ...state, events: [], cursor: null, sync: "unsynced", reason: "reset" };
  if (event.version !== state.version || event.taskId !== state.taskId) return { ...state, events: [], cursor: null, sync: "unsynced", reason: "unknown_version" };
  if (!knownTypes.includes(event.type)) return { ...state, events: [], cursor: null, sync: "unsynced", reason: "unknown_event" };
  const next = integer(event.cursor); const current = state.cursor === null ? null : integer(state.cursor);
  if (next === null || (state.cursor !== null && current === null)) return { ...state, events: [], cursor: null, sync: "unsynced", reason: "unknown_version" };
  if (state.cursor === event.cursor) return { ...state, reason: "duplicate" };
  if (current !== null && next <= current) return { ...state, sync: "unsynced", reason: "out_of_order" };
  // Committed cursors increase strictly but can have holes. Page validation
  // checks the original after/last cursor; arithmetic adjacency is not a fact.
  return { ...state, cursor: event.cursor, events: [...state.events.slice(-99), event], sync: "synced", reason: "none" };
}
