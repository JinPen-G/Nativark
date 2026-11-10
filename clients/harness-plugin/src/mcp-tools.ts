/** One exact Agent's published MCP reads, using the original tool bridge and registry. */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createScope, scopeChainOf } from "@deepseek-ai/dsh-scope";
import type { Scope } from "@deepseek-ai/dsh-scope";
import { createMcpToolDefinition } from "@deepseek-ai/dsh-mcp-client";
import { assertSupportedJsonSchema } from "@deepseek-ai/dsh-tools";
import type { Tool } from "@modelcontextprotocol/client";
import type { RentalOAuthSession } from "./oauth-session.js";

/** The allowlist limits local presentation; only the server can grant business access. */
export class RentalMcpTools {
  #scope: Scope | undefined;
  #agent: Agent | undefined;
  #session: Agent["session"] | undefined;
  #generation: AbortController | undefined;
  #disposers: (() => void)[] = [];
  readonly #children = new Map<Agent, { scope: Scope; lift?: () => void }>();
  #names: string[] = [];
  #pending: Promise<void> | undefined;
  readonly #calls = new Set<Promise<unknown>>();
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(readonly ctx: Context, readonly connection: RentalOAuthSession, readonly names: readonly string[], readonly failure: string) {}

  /** Withdraw synchronously, including callbacks retained outside the registry. */
  withdraw(): void {
    this.#generation?.abort();
    this.#generation = undefined;
    for (const dispose of this.#disposers.splice(0)) dispose();
    this.#names = [];
    for (const child of this.#children.values()) { child.lift?.(); child.lift = undefined; }
  }

  /** Discover a single bounded list and publish one complete generation, or none. */
  async synchronize(agent: Agent, signal: AbortSignal): Promise<void> {
    if (this.#closed || this.#pending) throw new Error(this.failure);
    this.withdraw();
    const generation = new AbortController();
    this.#generation = generation;
    const run = this.#synchronize(agent, AbortSignal.any([signal, generation.signal]), generation);
    this.#pending = run;
    try { await run; }
    catch {
      this.withdraw();
      throw new Error(this.failure);
    }
    finally { if (this.#pending === run) this.#pending = undefined; }
  }

  async #synchronize(agent: Agent, signal: AbortSignal, generation: AbortController): Promise<void> {
    const session = agent.session;
    if (this.ctx.get("agents")?.get(agent.id) !== agent) throw new Error(this.failure);
    const tools = await this.connection.listTools(session, signal);
    if (signal.aborted || this.#closed || this.#generation !== generation || agent.session !== session || this.ctx.get("agents")?.get(agent.id) !== agent || this.connection.status(session) !== "connected") throw new Error(this.failure);
    const selected = tools.filter(tool => this.names.includes(tool.name));
    for (const tool of selected) this.#validate(tool);
    if (!this.#scope || this.#agent !== agent || this.#session !== session) {
      await this.#scope?.dispose();
      await Promise.all([...this.#children.values()].map(child => child.scope.dispose()));
      this.#children.clear();
      this.#scope = createScope(this.ctx, agent);
      this.#agent = agent;
      this.#session = session;
      // Scoped tools inherit downward. Mask that inherited surface before a
      // child is announced; the executor still rejects every non-owner Agent.
      this.#scope.ctx.on("agent/created", ({ agent: child }) => {
        if (child !== agent && scopeChainOf(child).includes(agent)) this.#maskChild(child);
      }, { global: true });
      this.#scope.ctx.on("agent/disposed", ({ agent: disposed }) => {
        if (disposed === agent) {
          // The Bundle owns connection disposal, including OAuth-only sessions.
          this.withdraw();
          return;
        }
        const child = this.#children.get(disposed);
        if (child) {
          child.lift?.();
          this.#children.delete(disposed);
          return child.scope.dispose();
        }
      }, { global: true });
    }
    if (signal.aborted || this.#closed || this.#generation !== generation || agent.session !== session || this.ctx.get("agents")?.get(agent.id) !== agent || this.connection.status(session) !== "connected") throw new Error(this.failure);
    const scope = this.#scope;
    try {
      for (const tool of selected) {
        const definition = createMcpToolDefinition(scope.ctx, {
          name: `mcp__rental_os__${tool.name}`, rawName: tool.name, description: tool.description!,
          inputSchema: tool.inputSchema, outputSchema: tool.outputSchema,
          call: async (input, execution) => {
            if (this.#generation !== generation || execution.agent !== agent || agent.session !== session
              || this.ctx.get("agents")?.get(agent.id) !== agent || execution.signal.aborted || this.connection.status(session) !== "connected") throw new Error(this.failure);
            const call = this.connection.callTool(session, tool, input, AbortSignal.any([execution.signal, generation.signal]));
            this.#calls.add(call);
            try {
              const result = await call;
              if (this.#generation !== generation || agent.session !== session || execution.signal.aborted) throw new Error(this.failure);
              return result;
            } catch { throw new Error(this.failure); }
            finally { this.#calls.delete(call); }
          },
        });
        this.#disposers.push(scope.ctx.tools.register(definition));
      }
      this.#names = selected.map(tool => `mcp__rental_os__${tool.name}`);
      for (const child of this.ctx.get("agents")?.list() ?? []) {
        if (child !== agent && scopeChainOf(child).includes(agent)) this.#maskChild(child);
      }
    } catch {
      this.withdraw();
      throw new Error(this.failure);
    }
  }

  #maskChild(child: Agent): void {
    if (this.#names.length === 0) return;
    let owned = this.#children.get(child);
    if (!owned) {
      owned = { scope: createScope(this.ctx, child) };
      this.#children.set(child, owned);
    }
    owned.lift?.();
    owned.lift = owned.scope.ctx.tools.restrict({ deny: this.#names });
  }

  #validate(tool: Tool): void {
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(tool.name) || !tool.description || [...tool.description].length > 2000
      || tool.annotations?.readOnlyHint !== true || tool.annotations.destructiveHint !== false
      || tool.execution?.taskSupport === "required" || tool.inputSchema.additionalProperties !== false
      || !tool.outputSchema || tool.outputSchema.type !== "object" || tool.outputSchema.additionalProperties !== false) throw new Error(this.failure);
    // Unsupported schemas reject; never drop constraints to fit the Host subset.
    assertSupportedJsonSchema(tool.inputSchema);
    assertSupportedJsonSchema(tool.outputSchema);
  }

  /** Read the last complete LOCAL registration, not current server business rights.
   * @param agent - exact live owner and Session; other owners get unavailable.
   * @returns published, a verified empty generation, or unavailable after withdrawal
   * or while synchronization is pending. No discovery, refresh or model runs. */
  publication(agent: Agent): "published" | "empty" | "unavailable" {
    if (this.#closed || this.#pending || !this.#generation || this.#generation.signal.aborted
      || this.#agent !== agent || this.#session !== agent.session
      || this.ctx.get("agents")?.get(agent.id) !== agent || this.connection.status(agent.session) !== "connected") return "unavailable";
    return this.#names.length === 0 ? "empty" : "published";
  }

  /** Owner cancellation precedes this drain, so dependencies survive until calls settle. */
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.withdraw();
    return this.#closing = this.#close();
  }

  async #close(): Promise<void> {
    // synchronize already withdrew failed generations; close only drains it.
    await this.#pending?.catch((_error: unknown) => {});
    await Promise.allSettled([...this.#calls]);
    await this.#scope?.dispose();
    await Promise.all([...this.#children.values()].map(child => child.scope.dispose()));
    this.#children.clear();
    this.#scope = undefined;
    this.#agent = undefined;
    this.#session = undefined;
  }
}
