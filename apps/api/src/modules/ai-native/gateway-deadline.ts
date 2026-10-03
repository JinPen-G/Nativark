import { ModelGatewayError } from './model-gateway.ports';

/** Bounds the caller's wait, not the remote effect. Abandoned operations remain
 * observed; callers must retain/repair their durable admission and reservation.
 */
export class GatewayDeadline {
  readonly controller = new AbortController();
  readonly expiresAt: Date;
  private readonly end: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private failure: 'TIMEOUT' | 'CANCELLED' | null = null;
  private rejectStop!: (error: ModelGatewayError) => void;
  private readonly stopped: Promise<never>;
  private cleanupEnd: number | undefined;
  private readonly abort = () => this.stop('CANCELLED');

  constructor(ms: number, private readonly external?: AbortSignal, private readonly cleanupMs = 250) {
    if (!Number.isSafeInteger(ms) || ms < 1 || ms > 120000 || !Number.isSafeInteger(cleanupMs) || cleanupMs < 1 || cleanupMs > 5000) throw new ModelGatewayError('CONFIG_INVALID');
    if (external?.aborted) throw new ModelGatewayError('CANCELLED');
    this.end = performance.now() + ms;
    this.expiresAt = new Date(Date.now() + ms);
    this.stopped = new Promise<never>((_, reject) => { this.rejectStop = reject; });
    void this.stopped.catch(() => {});
    this.timer = setTimeout(() => this.stop('TIMEOUT'), ms);
    external?.addEventListener('abort', this.abort, { once: true });
  }
  reason() { return this.failure; }
  private stop(reason: 'TIMEOUT' | 'CANCELLED') {
    if (this.failure) return;
    this.failure = reason;
    this.rejectStop(new ModelGatewayError(reason));
    this.controller.abort();
  }
  private check() {
    if (!this.failure && performance.now() >= this.end) this.stop('TIMEOUT');
    if (this.failure) throw new ModelGatewayError(this.failure);
  }
  async wait<T>(operation: () => PromiseLike<T> | T): Promise<T> {
    this.check();
    const result = await Promise.race([Promise.resolve().then(() => { this.check(); return operation(); }), this.stopped]);
    this.check();
    return result;
  }
  async cleanup<T>(operation: () => PromiseLike<T> | T): Promise<T> {
    this.cleanupEnd ??= performance.now() + this.cleanupMs;
    const remaining = this.cleanupEnd - performance.now();
    if (remaining <= 0) throw new ModelGatewayError('ACCOUNTING_PENDING');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([Promise.resolve().then(operation), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ModelGatewayError('ACCOUNTING_PENDING')), remaining);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  close() {
    clearTimeout(this.timer);
    this.external?.removeEventListener('abort', this.abort);
    this.controller.abort();
  }
}
