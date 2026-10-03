import { useEffect, useRef, useState } from "react";

/** Feature-local UI concurrency guard. Never authorizes a resource or approval. */
class ResourceActionGate<T> {
  private signature = "";
  private callback: ((input: T) => void | Promise<void>) | undefined;
  private epoch = 0;
  private lifecycle = 0;
  private alive = true;
  private flight: Promise<void> | null = null;
  private pendingKey: string | null = null;
  private errorKey: string | null = null;
  constructor(private readonly notify: () => void) {}
  configure(signature: string, callback: ((input: T) => void | Promise<void>) | undefined): number {
    if (signature !== this.signature || callback !== this.callback) {
      this.signature = signature; this.callback = callback; this.epoch++; this.errorKey = null;
    }
    return this.epoch;
  }
  activate(): void { this.alive = true; }
  dispose(): void { this.alive = false; this.lifecycle++; this.errorKey = null; }
  snapshot(): { pendingKey: string | null; errorKey: string | null } {
    return { pendingKey: this.pendingKey, errorKey: this.errorKey };
  }
  run(epoch: number, key: string, input: T): Promise<void> {
    if (!this.alive || epoch !== this.epoch || !this.callback) return Promise.reject(new Error("资源操作不可用或已变化"));
    if (this.flight) return this.flight;
    const callback = this.callback, lifecycle = this.lifecycle;
    const current = () => this.alive && epoch === this.epoch && lifecycle === this.lifecycle;
    this.pendingKey = key; this.errorKey = null;
    const request = Promise.resolve().then(() => {
      if (!current()) throw new Error("资源操作已变化");
      return callback(input);
    }).then(() => {
      if (!current()) throw new Error("资源操作已变化");
    }).catch(() => {
      if (current()) this.errorKey = key;
      throw new Error("资源操作不可用或已变化");
    }).finally(() => {
      if (this.flight === request) { this.flight = null; this.pendingKey = null; }
      if (this.alive) this.notify();
    });
    this.flight = request; this.notify();
    return request;
  }
}

export function useResourceAction<T>(signature: string, callback: ((input: T) => void | Promise<void>) | undefined) {
  const [, refresh] = useState(0);
  const ref = useRef<ResourceActionGate<T> | null>(null);
  if (!ref.current) ref.current = new ResourceActionGate<T>(() => refresh(value => value + 1));
  const gate = ref.current;
  const epoch = gate.configure(signature, callback);
  useEffect(() => { gate.activate(); return () => gate.dispose(); }, [gate]);
  return { ...gate.snapshot(), run: (key: string, input: T) => gate.run(epoch, key, input) };
}
