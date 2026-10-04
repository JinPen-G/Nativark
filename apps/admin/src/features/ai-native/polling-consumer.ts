import { initialEventTimeline, reduceEvent, type DisplayEventInput, type EventTimelineState } from "./event-reducer";

export interface PollBatchResult {
  state: EventTimelineState;
  accepted: number;
  rejected: number;
  resyncRequired: boolean;
}

/** Pure adapter for a future polling host. It performs no I/O and owns no cursor storage. */
export function consumePolledEvents(
  state: EventTimelineState,
  events: readonly DisplayEventInput[],
): PollBatchResult {
  let next = state;
  let accepted = 0;
  let rejected = 0;
  for (const event of events) {
    const result = reduceEvent(next, event);
    next = result.state;
    if (result.accepted) accepted += 1;
    else rejected += 1;
    if (next.resetRequired) break;
  }
  return { state: next, accepted, rejected, resyncRequired: next.resetRequired };
}

export function createPollingTimeline(taskId: string, version: string): EventTimelineState {
  return initialEventTimeline(taskId, version);
}
