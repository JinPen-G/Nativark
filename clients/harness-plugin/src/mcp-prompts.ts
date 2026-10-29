/** Explicit human Prompt selection through the original Agent inbox, not automatic instructions or business authority. */
import type { Context } from "@deepseek-ai/cordis";
import type { CommandInvocation, CommandResult } from "@deepseek-ai/dsh-commands";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { ContextFormed } from "@deepseek-ai/dsh-llm";
import type { RentalOAuthSession } from "./oauth-session.js";
import type { copyFor } from "./locales.js";

// The original user/message and inbox records preserve this source on replay.
// A source label records the selection, never grants access or forces retention.
declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "rental-prompt": { kind: "rental-prompt"; name: string; version: string } & ContextFormed;
  }
}

/** One bounded human operation at a time, disposed with the model-admission services. */
export class RentalMcpPrompts {
  readonly #lifetime = new AbortController();
  #pending: { abort: AbortController; result: Promise<CommandResult> } | undefined;

  constructor(readonly ctx: Context, readonly connection: RentalOAuthSession, readonly names: readonly string[],
    readonly copy: ReturnType<typeof copyFor>, readonly bound: (agent: CommandInvocation["agent"]) => boolean,
    readonly markMaterial: (session: CommandInvocation["agent"]["session"]) => void) {}

  /** Return a current catalog or submit exactly one selected template; never retry or queue a busy selection. */
  execute(name: string | undefined, invocation: CommandInvocation): Promise<CommandResult> {
    if (this.#lifetime.signal.aborted) return Promise.resolve({ kind: "error", text: this.copy.promptUnavailable });
    if (this.#pending) return Promise.resolve({ kind: "error", text: this.copy.promptPending });
    if (name !== undefined && !this.names.includes(name)) return Promise.resolve({ kind: "error", text: this.copy.promptUnavailable });
    const agent = invocation.agent;
    const originalSession = agent.session;
    const abort = new AbortController();
    const signal = AbortSignal.any([invocation.signal, this.#lifetime.signal, abort.signal]);
    const current = () => !signal.aborted && agent.session === originalSession && this.bound(agent)
      && this.ctx.agents.get(agent.id) === agent && this.connection.status(originalSession) === "connected";
    if (!current()) return Promise.resolve({ kind: "error", text: this.copy.promptUnavailable });
    const operation = (async (): Promise<CommandResult> => {
      if (name === undefined) {
        const prompts = (await this.connection.listPrompts(originalSession, signal)).filter(prompt => this.names.includes(prompt.name));
        if (!current()) throw new Error(this.copy.promptUnavailable);
        const text = prompts.length ? `${this.copy.promptList}\n${prompts.map(prompt => `${prompt.name} (${prompt.version})\n${prompt.description}`).join("\n\n")}` : this.copy.noPrompts;
        if (Buffer.byteLength(text, "utf8") > 65_536) throw new Error(this.copy.promptUnavailable);
        return { kind: "success", text };
      }
      if (agent.status !== "idle") return { kind: "error", text: this.copy.promptBusy };
      // The original idle maintenance claim holds incoming work behind selection.
      // Submit inside it only after cancellation and exact-session checks, so no
      // async gap can turn a late response into a different Session's input.
      let selection: Promise<void>;
      try { selection = agent.runMaintenance(async maintenanceSignal => {
        const abort = AbortSignal.any([signal, maintenanceSignal]);
        const prompt = await this.connection.getPrompt(originalSession, name, abort);
        if (abort.aborted || !current()) throw new Error(this.copy.promptUnavailable);
        const message = createUserMessage({
          source: { kind: "rental-prompt", name: prompt.name, version: prompt.version, form: "instructions" },
          content: [{ type: "text", text: prompt.text }],
        });
        this.markMaterial(originalSession);
        agent.followup(message);
      }); } catch { return { kind: "error", text: this.copy.promptBusy }; }
      await selection;
      return { kind: "success", text: this.copy.promptSubmitted };
    })().catch((): CommandResult => ({ kind: "error", text: this.copy.promptUnavailable }));
    const pending = { abort, result: operation };
    this.#pending = pending;
    void operation.finally(() => { if (this.#pending === pending) this.#pending = undefined; });
    return operation;
  }

  /** Revoke an in-flight selection without closing the reusable connection consumer. */
  withdraw(): void {
    this.#pending?.abort.abort();
  }

  /** Stop new selections and drain accepted operations; ordinary Host history remains its owner's responsibility. */
  async close(): Promise<void> {
    this.#lifetime.abort();
    await this.#pending?.result;
  }
}
