/** Durable non-secret OAuth uncertainty marker. It cannot recover or authorize a grant. */
import { defineDomain } from "@deepseek-ai/dsh-storage-domain";
import type { Domain, DomainFacility } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
import { OAuthSessionError } from "./oauth-session.js";

const recoverySpec = defineDomain({
  name: "rental_oauth_recovery", version: 1,
  global: { schema: z.object({ state: z.enum(["clear", "unresolved"]) }).strict(), initial: { state: "clear" as const } },
  tables: {},
});

/** One profile-owned journal; only its live reservation can clear a marker. */
export class RentalOAuthRecovery {
  #domain: Domain<typeof recoverySpec> | undefined;
  #opening: Promise<void> | undefined;
  #writing: Promise<void> | undefined;
  #closing: Promise<void> | undefined;
  #drainFailed = false;
  #blocked = false;
  #owned = false;
  #closed = false;

  /** An unreadable or previously unresolved journal never permits a new attempt. */
  get blocked(): boolean { return this.#blocked; }

  /** Login cannot start until the Host's existing durable domain has opened. */
  get ready(): boolean { return this.#domain !== undefined && !this.#closed; }

  /** Whether the existing Host storage has begun opening; no service means unavailable. */
  get available(): boolean { return this.#opening !== undefined && !this.#closed; }

  /** Open the existing Host domain once; malformed data rejects, never becomes an empty record. */
  open(facility: DomainFacility): Promise<void> {
    if (this.#closed) return Promise.reject(new OAuthSessionError("unavailable"));
    return this.#opening ??= this.#open(facility);
  }

  /** Wait for the already-started read within the login deadline; never acquire a second domain. */
  async waitReady(signal: AbortSignal): Promise<void> {
    if (!this.#opening || this.#closed) throw new OAuthSessionError("unavailable");
    let onAbort = () => {};
    try {
      await Promise.race([this.#opening, new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new OAuthSessionError("cancelled"));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      })]);
      if (signal.aborted || !this.ready) throw new OAuthSessionError("unavailable");
      if (this.#blocked) throw new OAuthSessionError("unknown");
    } finally { signal.removeEventListener("abort", onAbort); }
  }

  async #open(facility: DomainFacility): Promise<void> {
    try {
      const domain = await facility.open(recoverySpec);
      // A close already in progress still owns this late handle and awaits it.
      this.#domain = domain;
      this.#blocked ||= domain.global.get().state === "unresolved";
    } catch {
      this.#blocked = true;
      throw new OAuthSessionError("unknown");
    }
  }

  /** Persist before any browser consent; an interrupted write blocks further attempts. */
  async begin(signal: AbortSignal): Promise<void> {
    if (this.#blocked) throw new OAuthSessionError("unknown");
    if (!this.#domain || this.#closed) throw new OAuthSessionError("unavailable");
    if (this.#owned) throw new OAuthSessionError("busy");
    if (signal.aborted) throw new OAuthSessionError("cancelled");
    this.#owned = true;
    await this.#write("unresolved", signal);
  }

  /** Clear only after this live owner established a normal local settlement. */
  async settle(signal: AbortSignal): Promise<void> {
    if (!this.#owned || this.#blocked) return;
    if (!this.#domain || this.#closed) throw new OAuthSessionError("unknown");
    if (this.#writing) throw new OAuthSessionError("busy");
    await this.#write("clear", signal);
    this.#owned = false;
  }

  async #write(state: "clear" | "unresolved", signal: AbortSignal): Promise<void> {
    const domain = this.#domain;
    if (signal.aborted || !domain) {
      this.#blocked = true;
      throw new OAuthSessionError("unknown");
    }
    let decide = (_accepted: boolean) => {};
    const decision = new Promise<boolean>(resolve => { decide = resolve; });
    const write = Promise.resolve().then(() => domain.global.set({ state }));
    // Cancellation bounds the caller, not durability. Keep the original domain
    // until both the write and the caller's commit decision have settled. A
    // rejected/late clear gets one unresolved compensation, never an OAuth retry.
    const draining = (async () => {
      await write.catch(() => {});
      if (state === "clear" && !await decision) {
        await domain.global.set({ state: "unresolved" });
      }
    })().catch(() => {
      this.#blocked = true;
      this.#drainFailed = true;
    }).finally(() => { this.#writing = undefined; });
    this.#writing = draining;
    let onAbort = () => {};
    let accepted = false;
    try {
      await Promise.race([write, new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new OAuthSessionError("unknown"));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      })]);
      if (signal.aborted || this.#closed || this.#blocked) throw new OAuthSessionError("unknown");
      accepted = true;
    } catch { this.#blocked = true; throw new OAuthSessionError("unknown"); }
    finally {
      decide(accepted);
      signal.removeEventListener("abort", onAbort);
    }
    await draining;
  }

  /** Share one disposal; await opening and late compensation before releasing the domain.
   * A failed compensation rejects disposal after resource cleanup, never reports a safe marker.
   */
  close(): Promise<void> {
    this.#closed = true;
    return this.#closing ??= this.#close();
  }

  async #close(): Promise<void> {
    // An opening failure has already blocked login; the Host owns failed-open cleanup.
    await this.#opening?.catch(() => {});
    await this.#writing;
    try { await this.#domain?.close(); }
    finally { this.#domain = undefined; }
    if (this.#drainFailed) throw new OAuthSessionError("unknown");
  }
}
