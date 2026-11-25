/** Internal host display input, not a second public transport contract. */
export interface DisplayEventInput {
  cursor: string;
  taskId: string;
  version: string;
  revision: string;
  type: string;
}
export interface EventTimelineState {
  taskId: string;
  version: string;
  cursor: string | null;
  revision: string | null;
  events: DisplayEventInput[];
  resetRequired: boolean;
  notice:
    | "none"
    | "duplicate"
    | "out_of_order"
    | "cursor_gap"
    | "revision_rollback"
    | "scope_reset";
}
export type EventReduceResult = {
  state: EventTimelineState;
  accepted: boolean;
  reason: EventTimelineState["notice"];
};

const integer = (value: string): bigint | null =>
  typeof value === "string" &&
  value.length <= 128 &&
  /^(0|[1-9]\d*)$/.test(value)
    ? BigInt(value)
    : null;
const empty = (
  state: EventTimelineState,
  notice: EventTimelineState["notice"],
): EventTimelineState => ({
  ...state,
  events: [],
  cursor: null,
  revision: null,
  resetRequired: true,
  notice,
});

export function initialEventTimeline(
  taskId: string,
  version: string,
): EventTimelineState {
  return {
    taskId,
    version,
    cursor: null,
    revision: null,
    events: [],
    resetRequired: false,
    notice: "none",
  };
}

export function reduceEvent(
  state: EventTimelineState,
  event: DisplayEventInput,
): EventReduceResult {
  if (state.resetRequired)
    return { state, accepted: false, reason: "scope_reset" };
  if (event.type === "reset_required")
    return {
      state: empty(state, "scope_reset"),
      accepted: false,
      reason: "scope_reset",
    };
  if (event.taskId !== state.taskId || event.version !== state.version)
    return {
      state: empty(state, "scope_reset"),
      accepted: false,
      reason: "scope_reset",
    };
  const cursor = integer(event.cursor),
    currentCursor = state.cursor === null ? null : integer(state.cursor),
    revision = integer(event.revision),
    currentRevision = state.revision === null ? null : integer(state.revision);
  if (
    cursor === null ||
    revision === null ||
    (state.cursor !== null && currentCursor === null) ||
    (state.revision !== null && currentRevision === null)
  )
    return {
      state: empty(state, "scope_reset"),
      accepted: false,
      reason: "scope_reset",
    };
  if (state.cursor === event.cursor)
    return {
      state: { ...state, notice: "duplicate" },
      accepted: false,
      reason: "duplicate",
    };
  if (currentCursor !== null && cursor <= currentCursor)
    return {
      state: { ...state, notice: "out_of_order" },
      accepted: false,
      reason: "out_of_order",
    };
  if (currentCursor !== null && cursor !== currentCursor + 1n)
    return {
      state: empty(state, "cursor_gap"),
      accepted: false,
      reason: "cursor_gap",
    };
  if (currentRevision !== null && revision < currentRevision)
    return {
      state: { ...state, notice: "revision_rollback" },
      accepted: false,
      reason: "revision_rollback",
    };
  if (!event.type || event.type.length > 128)
    return {
      state: empty(state, "scope_reset"),
      accepted: false,
      reason: "scope_reset",
    };
  const safeEvent = {
    cursor: event.cursor,
    revision: event.revision,
    taskId: state.taskId,
    version: state.version,
    type: event.type,
  };
  return {
    state: {
      ...state,
      cursor: event.cursor,
      revision: event.revision,
      events: [...state.events.slice(-199), safeEvent],
      notice: "none",
    },
    accepted: true,
    reason: "none",
  };
}
