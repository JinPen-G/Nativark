export interface AiCursorEvent { cursor: string; taskId: string; version: string; type: string; }
export interface AiCursorState { taskId: string; version: string; cursor: string | null; events: readonly AiCursorEvent[]; sync: "synced" | "unsynced"; reason: "none" | "duplicate" | "out_of_order" | "gap" | "reset" | "unknown_version"; }
const integer = (value: string): bigint | null => typeof value === "string" && /^(0|[1-9]\d*)$/.test(value) && value.length <= 128 ? BigInt(value) : null;
export const initialCursorState = (taskId: string, version: string): AiCursorState => ({ taskId, version, cursor: null, events: [], sync: "synced", reason: "none" });
export function applyCursorEvent(state: AiCursorState, event: AiCursorEvent): AiCursorState {
  if (event.type === "reset_required") return { ...state, events: [], cursor: null, sync: "unsynced", reason: "reset" };
  if (event.version !== state.version || event.taskId !== state.taskId) return { ...state, events: [], cursor: null, sync: "unsynced", reason: "unknown_version" };
  const next = integer(event.cursor); const current = state.cursor === null ? null : integer(state.cursor);
  if (next === null || (state.cursor !== null && current === null)) return { ...state, events: [], cursor: null, sync: "unsynced", reason: "unknown_version" };
  if (state.cursor === event.cursor) return { ...state, reason: "duplicate" };
  if (current !== null && next <= current) return { ...state, sync: "unsynced", reason: "out_of_order" };
  if (current !== null && next !== current + BigInt(1)) return { ...state, events: [], cursor: null, sync: "unsynced", reason: "gap" };
  return { ...state, cursor: event.cursor, events: [...state.events.slice(-99), event], sync: "synced", reason: "none" };
}
