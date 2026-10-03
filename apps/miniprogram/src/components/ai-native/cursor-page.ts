import { applyCursorEvent, type AiCursorEvent, type AiCursorState } from "./cursor-adapter";
/** Internal host projection, not an HTTP DTO. Cursor acknowledgements never skip events. */
export function consumeCursorPage(state: AiCursorState, events: readonly AiCursorEvent[], hasMore: boolean, knownTypes: readonly string[]): { state: AiCursorState; continueReading: boolean } {
  if (!Array.isArray(events) || events.length > 200 || typeof hasMore !== "boolean") {
    return { state: { ...state, events: [], cursor: null, sync: "unsynced", reason: "gap" }, continueReading: false };
  }
  let next = state;
  for (const event of events) {
    next = applyCursorEvent(next, event, knownTypes);
    if (next.sync === "unsynced") break;
  }
  return { state: next, continueReading: next.sync === "synced" && hasMore && events.length > 0 };
}
