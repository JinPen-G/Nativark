/** Explicit human Prompt/resource selection through the original Agent inbox.
 * One maintenance owner captures the Agent's Session; selections never grant authority. */
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
    "rental-resource": { kind: "rental-resource"; name: string; version: string; uri: string } & ContextFormed;
  }
}

/** One bounded human operation at a time, disposed with the model-admission services. */
export class RentalMcpPrompts {
  readonly #lifetime = new AbortController();
  #pending: { abort: AbortController; result: Promise<CommandResult> } | undefined;

  constructor(readonly ctx: Context, readonly connection: RentalOAuthSession, readonly names: readonly string[],
    readonly copy: ReturnType<typeof copyFor>, readonly bound: (agent: CommandInvocation["agent"]) => boolean,
    readonly markMaterial: (session: CommandInvocation["agent"]["session"]) => void, readonly resourceNames: readonly string[] = []) {}

  /** Return a current catalog or submit exactly one selected template; never retry or queue a busy selection. */
  execute(name: string | undefined, invocation: CommandInvocation): Promise<CommandResult> {
    return this.#execute(name, invocation, false);
  }

  /** Resource names come from explicit configuration; one selection reads no arbitrary URI. */
  executeResource(name: string | undefined, invocation: CommandInvocation): Promise<CommandResult> {
    return this.#execute(name, invocation, true);
  }

  #execute(name: string | undefined, invocation: CommandInvocation, resource: boolean): Promise<CommandResult> {
    const copy = resource ? { ...this.copy, promptUnavailable: this.copy.resourceUnavailable, promptPending: this.copy.resourcePending,
      promptBusy: this.copy.resourceBusy, promptList: this.copy.resourceList, noPrompts: this.copy.noResources,
      promptSubmitted: this.copy.resourceSubmitted } : this.copy;
    if (this.#lifetime.signal.aborted) return Promise.resolve({ kind: "error", text: copy.promptUnavailable });
    if (this.#pending) return Promise.resolve({ kind: "error", text: copy.promptPending });
    if (name !== undefined && !(resource ? this.resourceNames : this.names).includes(name)) return Promise.resolve({ kind: "error", text: copy.promptUnavailable });
    const agent = invocation.agent;
    const originalSession = agent.session;
    const abort = new AbortController();
    const signal = AbortSignal.any([invocation.signal, this.#lifetime.signal, abort.signal]);
    const current = () => !signal.aborted && agent.session === originalSession && this.bound(agent)
      && this.ctx.agents.get(agent.id) === agent && this.connection.status(originalSession) === "connected";
    if (!current()) return Promise.resolve({ kind: "error", text: copy.promptUnavailable });
    const operation = (async (): Promise<CommandResult> => {
      if (name === undefined) {
        const prompts = (await (resource ? this.connection.listResources(originalSession, signal)
          : this.connection.listPrompts(originalSession, signal))).filter(prompt => (resource ? this.resourceNames : this.names).includes(prompt.name));
        if (!current()) throw new Error(copy.promptUnavailable);
        const text = prompts.length ? `${copy.promptList}\n${prompts.map(prompt => `${prompt.name} (${prompt.version})\n${prompt.description}`).join("\n\n")}` : copy.noPrompts;
        if (Buffer.byteLength(text, "utf8") > 65_536) throw new Error(copy.promptUnavailable);
        return { kind: "success", text };
      }
      if (agent.status !== "idle") return { kind: "error", text: copy.promptBusy };
      // The original idle maintenance claim holds incoming work behind selection.
      // Submit inside it only after cancellation and exact-session checks, so no
      // async gap can turn a late response into a different Session's input.
      let selection: Promise<void>;
      try { selection = agent.runMaintenance(async maintenanceSignal => {
        const abort = AbortSignal.any([signal, maintenanceSignal]);
        const selected = resource ? { kind: "resource" as const, value: await this.connection.getResource(originalSession, name, abort) }
          : { kind: "prompt" as const, value: await this.connection.getPrompt(originalSession, name, abort) };
        if (abort.aborted || !current()) throw new Error(copy.promptUnavailable);
        const message = createUserMessage({
          source: selected.kind === "resource" ? { kind: "rental-resource", name: selected.value.name,
            version: selected.value.version, uri: selected.value.uri, form: "relay" }
            : { kind: "rental-prompt", name: selected.value.name, version: selected.value.version, form: "instructions" },
          content: [{ type: "text", text: selected.value.text }],
        });
        this.markMaterial(originalSession);
        agent.followup(message);
      }); } catch { return { kind: "error", text: copy.promptBusy }; }
      await selection;
      return { kind: "success", text: copy.promptSubmitted };
    })().catch((): CommandResult => ({ kind: "error", text: copy.promptUnavailable }));
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
