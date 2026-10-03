import type { AiReadContext } from "./types";

export interface AiPollPage { cursor: string | null; events: readonly unknown[]; version: string; }
export interface AiCancelSignal { readonly aborted: boolean; onAbort(listener: () => void): void; }
class AiCancelController {
  readonly signal: AiCancelSignal;
  private done = false;
  private listeners: (() => void)[] = [];
  constructor() {
    const controller = this;
    this.signal = {
      get aborted() { return controller.done; },
      onAbort(listener) { if (controller.done) listener(); else controller.listeners.push(listener); },
    };
  }
  abort(): void {
    if (this.done) return;
    this.done = true;
    let failed = false;
    for (const listener of this.listeners.splice(0)) {
      try { listener(); } catch { failed = true; }
    }
    // Report failure only after attempting every cleanup; never expose host error text.
    if (failed) throw new Error("AI轮询取消清理失败");
  }
}
export type AiReadPage = (context: AiReadContext, signal: AiCancelSignal) => Promise<AiPollPage>;
/** Local consumption acknowledgement, not a server DTO or authorization result. */
export interface AiPollAcceptance { sync: "synced" | "unsynced"; }
export type AiPollListener = (page: AiPollPage) => AiPollAcceptance | void;

/** Lifecycle-only controller. The host owns authorization, storage and scheduling. */
export class AiPollingController {
  private active = true;
  private paused = false;
  private inFlight = false;
  private generation = 0;
  private abort: AiCancelController | null = null;
  constructor(private readonly readPage: AiReadPage, private readonly onPage: AiPollListener) {}
  async poll(context: AiReadContext): Promise<"started" | "synced" | "unsynced" | "skipped" | "stale"> {
    if (!this.active || this.paused || this.inFlight) return "skipped";
    this.inFlight = true;
    const generation = this.generation;
    const abort = new AiCancelController(); this.abort = abort;
    try {
      const page = await this.readPage(context, abort.signal);
      if (!this.active || this.paused || generation !== this.generation || abort.signal.aborted) return "stale";
      const acceptance = this.onPage(page);
      if (!this.active || this.paused || generation !== this.generation || abort.signal.aborted) return "stale";
      if (!acceptance || typeof acceptance !== "object") return "started";
      return acceptance?.sync === "synced" ? "synced" : "unsynced";
    } finally { if (this.abort === abort) this.abort = null; this.inFlight = false; }
  }
  pause() { this.paused = true; this.generation += 1; this.abort?.abort(); }
  resume() { if (this.active) { this.paused = false; this.generation += 1; } }
  changeContext() { this.generation += 1; this.abort?.abort(); }
  destroy() { this.active = false; this.generation += 1; this.abort?.abort(); }
}

/** Host-owned clock; no timer, request or credential is acquired on construction. */
export interface AiPollClock { schedule(action: () => void, delay: number): unknown; clear(handle: unknown): void; }
export type AiPollFailure = "transient" | "permission" | "version" | "reset" | "unknown";
export interface AiPollRecovery {
  classify(error: unknown): AiPollFailure;
  notify(state: "synced" | "unsynced" | AiPollFailure): void;
}
export class AiPollingLoop {
  private timer: unknown = null;
  private live = false;
  private disposed = false;
  private busy = false;
  private epoch = 0;
  private context: AiReadContext | null = null;
  private failures = 0;
  private blocked = false;
  constructor(private readonly controller: AiPollingController, private readonly clock: AiPollClock, private readonly interval = 2000, private readonly recovery?: AiPollRecovery) {}
  start(context: AiReadContext): void {
    if (this.disposed || this.blocked) return;
    const changed = JSON.stringify(this.context) !== JSON.stringify(context);
    if (changed) { this.controller.changeContext(); this.epoch += 1; this.context = { ...context }; }
    if (this.live && !changed) return;
    this.live = true; this.controller.resume(); this.clearTimer();
    if (!this.busy) void this.tick();
  }
  private clearTimer(): void {
    if (this.timer === null) return;
    const timer = this.timer;
    this.timer = null;
    try { this.clock.clear(timer); } catch { throw new Error("AI轮询时钟清理失败"); }
  }
  private async tick(): Promise<void> {
    if (!this.live || this.disposed || !this.context || this.busy) return;
    this.busy = true;
    const requestEpoch = this.epoch;
    let delay = Math.max(100, Math.min(30000, this.interval));
    try {
      const result = await this.controller.poll(this.context);
      if (requestEpoch === this.epoch) {
        if (result === "synced") { this.failures = 0; this.recovery?.notify("synced"); }
        else if (result === "started" || result === "unsynced") {
          this.blocked = true;
          this.pause();
          this.recovery?.notify("unsynced");
        }
      }
    }
    catch (error) {
      if (requestEpoch === this.epoch) {
        const kind = this.recovery?.classify(error) ?? "unknown";
        this.recovery?.notify(kind); this.failures += 1;
        if (kind !== "transient" || this.failures > 3) { this.blocked = true; this.pause(); }
        else delay = Math.min(30000, delay * Math.pow(2, this.failures));
      }
    }
    finally {
      this.busy = false;
      if (this.live && !this.disposed) {
        const epoch = this.epoch;
        this.timer = this.clock.schedule(() => { this.timer = null; if (epoch === this.epoch) void this.tick(); }, delay);
      }
    }
  }
  pause(): void {
    this.live = false; this.epoch += 1;
    try { this.clearTimer(); } finally { this.controller.pause(); }
  }
  /** Host must reauthorize/resync before invoking this explicit manual action. */
  retry(context: AiReadContext): void { if (this.disposed) return; this.blocked = false; this.failures = 0; this.pause(); this.start(context); }
  destroy(): void {
    this.disposed = true; this.context = null;
    try { this.pause(); } finally { this.controller.destroy(); }
  }
}
