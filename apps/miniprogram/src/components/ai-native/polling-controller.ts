import type { AiReadContext } from "./types";

export interface AiPollPage { cursor: string | null; events: readonly unknown[]; version: string; }
export interface AiCancelSignal { readonly aborted: boolean; onAbort(listener: () => void): void; }
class AiCancelController { readonly signal: AiCancelSignal; private done = false; private listeners: (() => void)[] = []; constructor() { const controller = this; this.signal = { get aborted() { return controller.done; }, onAbort(listener) { if (controller.done) listener(); else controller.listeners.push(listener); } }; } abort() { if (!this.done) { this.done = true; for (const listener of this.listeners.splice(0)) listener(); } } }
export type AiReadPage = (context: AiReadContext, signal: AiCancelSignal) => Promise<AiPollPage>;
export type AiPollListener = (page: AiPollPage) => void;
export class AiPollingController {
  private active = true; private paused = false; private inFlight = false; private generation = 0; private abort: AiCancelController | null = null;
  constructor(private readonly readPage: AiReadPage, private readonly onPage: AiPollListener) {}
  async poll(context: AiReadContext): Promise<"started" | "skipped" | "stale"> {
    if (!this.active || this.paused || this.inFlight) return "skipped";
    this.inFlight = true; const generation = this.generation; const abort = new AiCancelController(); this.abort = abort;
    try { const page = await this.readPage(context, abort.signal); if (!this.active || this.paused || generation !== this.generation || abort.signal.aborted) return "stale"; this.onPage(page); return "started"; }
    finally { if (this.abort === abort) this.abort = null; this.inFlight = false; }
  }
  pause() { this.paused = true; this.generation += 1; this.abort?.abort(); }
  resume() { if (this.active) { this.paused = false; this.generation += 1; } }
  changeContext() { this.generation += 1; this.abort?.abort(); }
  destroy() { this.active = false; this.generation += 1; this.abort?.abort(); }
}
