export type SubmissionOutcome<T> = { status: 'applied' | 'stale'; value: T };
export class SubmissionGate {
  private identity = '';
  private inFlight: Promise<unknown> | null = null;
  begin(identity: string) { this.identity = identity; this.inFlight = null; }
  submit<T>(identity: string, operation: () => Promise<T>): Promise<SubmissionOutcome<T>> {
    if (identity !== this.identity) return Promise.reject(new Error('submission identity changed'));
    if (this.inFlight) return this.inFlight as Promise<SubmissionOutcome<T>>;
    const request = Promise.resolve().then(operation).then(value => ({ status: identity === this.identity ? 'applied' : 'stale', value } as SubmissionOutcome<T>));
    const settled = request.finally(() => { if (this.inFlight === settled) this.inFlight = null; });
    this.inFlight = settled;
    return settled as Promise<SubmissionOutcome<T>>;
  }
}
