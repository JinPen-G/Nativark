/** Local UI lifetime fence; not authorization, CAS or server idempotency. */
export class SettingsSaveSession {
  private generation = 0;
  private identity = "";
  private callback: unknown;
  private blocked = true;
  private disposed = false;
  private inFlight = false;

  bind(identity: string, callback: unknown, blocked: boolean) {
    if (identity !== this.identity || callback !== this.callback || blocked !== this.blocked) {
      this.generation += 1;
      this.inFlight = false;
    }
    this.identity = identity;
    this.callback = callback;
    this.blocked = blocked;
  }
  dispose() { this.disposed = true; this.generation += 1; this.inFlight = false; }
  activate() { this.disposed = false; }

  async run(action: () => Promise<unknown>, notify: (state: "pending" | "request_finished" | "failed") => void): Promise<void> {
    if (this.disposed || this.blocked || this.inFlight) throw new Error("AI 设置操作不可用");
    const generation = this.generation;
    this.inFlight = true;
    notify("pending");
    try {
      await action();
      if (!this.disposed && generation === this.generation) notify("request_finished");
    } catch {
      if (!this.disposed && generation === this.generation) notify("failed");
      // Never forward provider/host errors which might contain credentials.
      throw new Error("AI 设置请求失败，请重新核对修订与权限");
    } finally {
      if (generation === this.generation) this.inFlight = false;
    }
  }
}
