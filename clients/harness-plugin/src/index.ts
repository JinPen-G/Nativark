/**
 * Rental's Host-only Bundle entry. Loading is offline; explicit OAuth owns one
 * standard MCP connection and exact Agent/session tools and guidance. Business
 * reads require current original authority/accounting/release providers at the server.
 */
import type { Context } from "@deepseek-ai/cordis";
import Schema from "@deepseek-ai/schemastery";
import type { CommandResult, CommandInvocation } from "@deepseek-ai/dsh-commands";
import type {} from "@deepseek-ai/dsh-system-prompt";
import { ConnectionInspectionError, inspectRentalMcpConnection } from "./connection.js";
import type { ConnectionInspectionConfig } from "./connection.js";
import { copyFor } from "./locales.js";
import { inspectRentalOAuthConfiguration, resolveOAuthClientConfiguration } from "./oauth-discovery.js";
import type { OAuthClientConfiguration } from "./oauth-discovery.js";
import { RentalOAuthSession, OAuthSessionError } from "./oauth-session.js";
import type { LoginConfiguration } from "./oauth-session.js";
import { oauthHostInteraction } from "./oauth-host.js";
import { RentalMcpTools } from "./mcp-tools.js";
import { admitModelMaterial, hasRentalMaterial } from "./model-material.js";
import { RentalMcpPrompts } from "./mcp-prompts.js";
import { RentalOAuthRecovery } from "./oauth-recovery.js";

/** Loader identity; not an OAuth client ID or authorization grant. */
export const name = "rental-os";
/** Use the existing human command service; do not start a separate UI or model. */
export const inject = ["commands"];

export interface Config {
  language: "en" | "zh-CN";
  connection?: ConnectionInspectionConfig;
  oauth?: OAuthClientConfiguration;
  login?: LoginConfiguration;
  readTools?: string[];
  readPrompts?: string[];
  readResources?: string[];
}

function https(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || url.pathname.startsWith("/.well-known/")) throw new Error("invalid address");
    return url.href;
  } catch {
    // Loader diagnostics must not repeat a URL containing a pasted secret.
    throw new Error("Use an HTTPS address without credentials, query, fragment or discovery path");
  }
}

function rejectUnknown(value: object, fields: readonly string[]): void {
  if (Object.keys(value).some(key => !fields.includes(key))) {
    throw new Error("Unsupported Rental plugin configuration field");
  }
}

const ConnectionFields: Schema<ConnectionInspectionConfig> = Schema.object({
  resourceUrl: Schema.transform(Schema.string().required(), https),
  authorizationServerUrl: Schema.transform(Schema.string().required(), https),
  timeoutMs: Schema.number().step(1).min(1).max(60_000).default(5_000),
  maxMetadataBytes: Schema.number().step(1).min(1).max(65_536).default(16_384),
});
const OAuthFields: Schema<OAuthClientConfiguration> = Schema.object({
  clientId: Schema.string().required(),
  redirectUri: Schema.string().required(),
  scopes: Schema.array(Schema.string()).required(),
  authorizationEndpoint: Schema.string().required(),
  tokenEndpoint: Schema.string().required(),
  revocationEndpoint: Schema.string().required(),
});
const LoginFields: Schema<LoginConfiguration> = Schema.object({
  enabled: Schema.boolean().required(),
  attemptTimeoutMs: Schema.number().step(1).min(1).max(600_000).required(),
  sessionLifetimeMs: Schema.number().step(1).min(1).max(28_800_000).required(),
  maxAccessTtlSeconds: Schema.number().step(1).min(1).max(900).required(),
  callbackMode: Schema.union(["host", "loopback"]).required(),
});
const ConfigFields: Schema<Config> = Schema.object({
  language: Schema.union(["en", "zh-CN"]).default("zh-CN"),
  connection: Schema.transform(ConnectionFields, value => {
    rejectUnknown(value, ["resourceUrl", "authorizationServerUrl", "timeoutMs", "maxMetadataBytes"]);
    return Object.freeze({ ...value });
  }),
  oauth: Schema.transform(OAuthFields, resolveOAuthClientConfiguration),
  login: Schema.transform(LoginFields, value => Object.freeze({ ...value })),
  readTools: Schema.array(Schema.string()),
  readPrompts: Schema.array(Schema.string()),
  readResources: Schema.array(Schema.string()),
});

/** Deployment settings are validated by the Loader; no token/header input is accepted. */
export const Config: Schema<Config> = Schema.transform(ConfigFields, value => {
  rejectUnknown(value, ["language", "connection", "oauth", "login", "readTools", "readPrompts", "readResources"]);
  if (value.readTools && (value.readTools.length > 50 || new Set(value.readTools).size !== value.readTools.length
    || value.readTools.some(name => !/^[A-Za-z0-9_-]{1,48}$/.test(name)))) throw new Error("Invalid Rental read-tool allowlist");
  if (value.readTools?.length && !value.login?.enabled) throw new Error("Rental read tools require explicitly enabled OAuth login");
  if (value.readPrompts && (value.readPrompts.length > 50 || new Set(value.readPrompts).size !== value.readPrompts.length
    || value.readPrompts.some(name => !/^[A-Za-z0-9_-]{1,64}$/.test(name)))) throw new Error("Invalid Rental prompt allowlist");
  if (value.readPrompts?.length && !value.login?.enabled) throw new Error("Rental prompts require explicitly enabled OAuth login");
  if (value.readResources && (value.readResources.length > 50 || new Set(value.readResources).size !== value.readResources.length
    || value.readResources.some(name => !/^[A-Za-z0-9_-]{1,64}$/.test(name)))) throw new Error("Invalid Rental resource allowlist");
  if (value.readResources?.length && !value.login?.enabled) throw new Error("Rental resources require explicitly enabled OAuth login");
  if (value.oauth && !value.connection) throw new Error("OAuth inspection requires MCP connection settings");
  if (value.login) {
    rejectUnknown(value.login, ["enabled", "attemptTimeoutMs", "sessionLifetimeMs", "maxAccessTtlSeconds", "callbackMode"]);
    if (!value.oauth || !value.connection) throw new Error("OAuth login requires complete configuration");
  }
  return Object.freeze({ ...value });
});

/**
 * Register direct human feedback and own its request cancellation through unload.
 * @param ctx - Context with the injected original command runtime.
 * @param config - Loader-validated deployment configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const copy = copyFor(config.language);
  const connection = config.connection === undefined ? undefined : Object.freeze({ ...config.connection });
  const lifetime = new AbortController();
  let tools: RentalMcpTools | undefined;
  let prompts: RentalMcpPrompts | undefined;
  const recovery = new RentalOAuthRecovery();
  const session = connection && config.oauth && config.login
    ? new RentalOAuthSession(connection, config.oauth, config.login,
      (input, init) => globalThis.fetch(input, init), oauthHostInteraction(ctx, config.login.callbackMode), result => {
        ctx.logger.warn(result.remote === "not_confirmed" ? copy.revokeUnknown : copy.expired);
      }, () => { tools?.withdraw(); prompts?.withdraw(); }, recovery) : undefined;
  if (session && config.login?.enabled) ctx.inject(["storageDomain"], inner => {
    const opened = recovery.open(inner.storageDomain);
    inner.effect(() => async () => {
      const closed = await session.close();
      if (closed.remote === "not_confirmed") inner.logger.warn(copy.revokeUnknown);
      await opened.catch((_error: unknown) => {}); // The command reports the blocked journal separately.
      await recovery.close();
    });
    return opened.catch((_error: unknown) => { inner.logger.warn(copy.loginUnknown); });
  });
  const connectedCopy = (agent: CommandInvocation["agent"]): string => {
    if (!config.readTools?.length) return copy.connected;
    switch (tools?.publication(agent)) {
      case "published": return copy.toolsConnected;
      case "empty": return copy.toolsEmpty;
      default: return copy.toolsUnavailable;
    }
  };
  // A live owner's coarse compatibility reason supplements, never replaces,
  // the authorization uncertainty or local/remote disconnect distinction.
  const failureCopy = (owner: object, text: string) => session?.unknownReason(owner) === "protocol_incompatible"
    ? `${copy.protocolIncompatible}\n${text}` : text;
  let pending: Promise<CommandResult> | undefined;
  let boundScope: CommandInvocation["agent"] | undefined;
  let boundSession: CommandInvocation["agent"]["session"] | undefined;
  // Disconnect withdraws access, not Host history. Keep the size restriction for
  // this Session's remaining lifetime; this marker grants no business authority.
  const materialSessions = new WeakSet<CommandInvocation["agent"]["session"]>();
  // Connection ownership exists even with no material consumers. Listen from the
  // live Bundle context: the original Agent's scope is already disposed here.
  if (session && config.login?.enabled) ctx.inject(["agents"], inner => {
    inner.on("agent/disposed", ({ agent }) => {
      if (agent !== boundScope || !boundSession) return;
      const owner = boundSession;
      // disconnect withdraws synchronously and owns its async drain; AgentHandle
      // disposal does not await async event listeners in this Host version.
      return session.disconnect(owner).then(result => {
        if (result.remote === "not_confirmed") inner.logger.warn(copy.revokeUnknown);
        else if (boundScope === agent && boundSession === owner) {
          boundScope = undefined;
          boundSession = undefined;
        }
      });
    }, { global: true });
    inner.effect(() => async () => {
      const closed = await session.close();
      if (closed.remote === "not_confirmed") inner.logger.warn(copy.revokeUnknown);
    });
  });
  ctx.inject(["llm", "agents"], inner => {
    inner.on("llm/stream", (options, next) => {
      const agent = inner.agents.currentInitiator();
      // Logged selections and tool records survive login state, but never
      // restore credentials or the right to fetch current business facts.
      if (hasRentalMaterial(options)) {
        if (agent) materialSessions.add(agent.session);
        admitModelMaterial(options, copy.materialUnavailable, ref => inner.llm.fileRequestText(ref));
      } else if (agent && materialSessions.has(agent.session)) admitModelMaterial(options, copy.materialUnavailable, ref => inner.llm.fileRequestText(ref));
      return next();
    });
    if (session && (config.readPrompts?.length || config.readResources?.length)) {
      const consumer = new RentalMcpPrompts(inner, session, [...config.readPrompts ?? []], copy,
        agent => agent === boundScope && agent.session === boundSession,
        selectedSession => materialSessions.add(selectedSession), [...config.readResources ?? []]);
      prompts = consumer;
      inner.effect(() => async () => {
        const drained = consumer.close();
        if (prompts === consumer) prompts = undefined;
        if (!lifetime.signal.aborted) {
          const closed = await session.close();
          if (closed.remote === "not_confirmed") inner.logger.warn(copy.revokeUnknown);
        }
        await drained;
      });
    }
    // Publish reads only while this material-admission owner is active. Losing
    // LlmRuntime must withdraw access, not leave tools without their size check.
    if (session && config.readTools?.length) inner.inject(["tools"], toolContext => {
      const bridge = new RentalMcpTools(toolContext, session, [...config.readTools!], copy.toolsUnavailable);
      tools = bridge;
      toolContext.effect(() => async () => {
        bridge.withdraw();
        if (!lifetime.signal.aborted) {
          const closed = await session.close();
          if (closed.remote === "not_confirmed") toolContext.logger.warn(copy.revokeUnknown);
        }
        await bridge.close();
        if (tools === bridge) tools = undefined;
      });
    });
  });
  ctx.inject(["systemPrompt"], inner => {
    inner.systemPrompt.section({
      name: "mcp:rental-os", order: inner.systemPrompt.getSectionOrder("MCP_SERVERS"), interpolate: false,
      // Ancestor/fork scopes are not accepted merely because they inherit a section.
      text: context => !lifetime.signal.aborted && context.scope === boundScope && boundSession
        && boundScope?.session === boundSession && session ? session.instructions(boundSession) : "",
    });
  });

  // Command outcomes are human/log-only in the original Host. This notice does
  // not become model instructions, a consent record or an input filter.
  const withPrivacyNotice = (handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>) =>
    async (invocation: CommandInvocation): Promise<CommandResult> => {
      const result = await handler(invocation);
      return { ...result, text: [result.text, copy.privacyNotice].filter(Boolean).join("\n\n") };
    };
  const unregister = ctx.commands.register({
    name: "rental",
    description: copy.description,
    input: { hint: copy.hint, attachments: false },
    // Even rejected arguments must not persist a token pasted after the command.
    recordInput: false,
    handler: withPrivacyNotice(invocation => {
      const action = invocation.rawInput.trim();
      const selectedPrompt = /^prompt ([A-Za-z0-9_-]{1,64})$/.exec(action)?.[1];
      const selectedResource = /^resource ([A-Za-z0-9_-]{1,64})$/.exec(action)?.[1];
      if (!["", "status", "check", "oauth-check", "login", "disconnect", "prompts", "resources"].includes(action) && !selectedPrompt && !selectedResource) {
        return { kind: "error", text: copy.usage };
      }
      if (invocation.attachments.length) return { kind: "error", text: copy.usage };
      if (lifetime.signal.aborted) return { kind: "error", text: copy.disposed };
      if (!connection) return { kind: "error", text: copy.unconfigured };
      if (action === "" || action === "status") {
        const status = (): CommandResult => {
          const state = session?.status(invocation.agent.session);
          if (session && config.login?.enabled && !recovery.ready && state !== "unknown") return { kind: "error", text: copy.recoveryUnavailable };
          return { kind: "success", text: state === "connected" ? connectedCopy(invocation.agent)
            : state === "connecting" ? copy.connecting : state === "unknown" ? failureCopy(invocation.agent.session, copy.loginUnknown)
              : state === "other_session" ? copy.otherSession : state === "expired" ? copy.expired : copy.configured };
        };
        if (recovery.available && !recovery.ready) {
          const signal = AbortSignal.any([lifetime.signal, invocation.signal, AbortSignal.timeout(connection.timeoutMs)]);
          return recovery.waitReady(signal).then(status, status);
        }
        return status();
      }
      if (action === "resources" || selectedResource) {
        if (!prompts || !config.readResources?.length) return { kind: "error", text: copy.resourceUnavailable };
        return prompts.executeResource(selectedResource, invocation);
      }
      if (action === "prompts" || selectedPrompt) {
        if (!prompts || !config.readPrompts?.length) return { kind: "error", text: copy.promptUnavailable };
        return prompts.execute(selectedPrompt, invocation);
      }
      if (action === "login" || action === "disconnect"
        || (action === "check" && session && session.status(invocation.agent.session) !== "disconnected")) {
        if (!session) return { kind: "error", text: copy.loginDisabled };
        if (action !== "disconnect" && recovery.blocked) return { kind: "error", text: failureCopy(invocation.agent.session, copy.loginUnknown) };
        if (action !== "disconnect" && !recovery.available) return { kind: "error", text: copy.recoveryUnavailable };
        if (action !== "disconnect" && config.readTools?.length && !tools) return { kind: "error", text: copy.toolsUnavailable };
        if (action !== "disconnect" && config.readPrompts?.length && !prompts) return { kind: "error", text: copy.promptUnavailable };
        if (action !== "disconnect" && config.readResources?.length && !prompts) return { kind: "error", text: copy.resourceUnavailable };
        if (boundScope && (invocation.agent !== boundScope || invocation.agent.session !== boundSession)) return { kind: "error", text: copy.otherSession };
        const owner = invocation.agent;
        const originalSession = owner.session;
        const signal = AbortSignal.any([lifetime.signal, invocation.signal]);
        const currentAgent = () => {
          const registry = ctx.get("agents");
          return !signal.aborted && owner.session === originalSession && (!registry || registry.get(owner.id) === owner);
        };
        if (action !== "disconnect" && !currentAgent()) return { kind: "error", text: copy.otherSession };
        if (action === "login" && !boundScope) {
          // Capture before discovery/consent so disposal also cancels a pending
          // exchange; binding only after success leaves that request ownerless.
          boundScope = owner;
          boundSession = originalSession;
        }
        return (action === "login"
          ? session.login(originalSession, signal).then(async (): Promise<CommandResult> => {
            if (!currentAgent() || session.status(originalSession) !== "connected") throw new OAuthSessionError("other_session");
            materialSessions.add(originalSession);
            await tools?.synchronize(invocation.agent, signal);
            return { kind: "success", text: connectedCopy(invocation.agent) };
          })
          : action === "check"
            ? session.check(originalSession, signal).then(async (): Promise<CommandResult> => {
              if (!currentAgent() || session.status(originalSession) !== "connected") throw new OAuthSessionError("other_session");
              await tools?.synchronize(invocation.agent, signal);
              return { kind: "success", text: connectedCopy(invocation.agent) };
            })
          : session.disconnect(originalSession).then((result): CommandResult => {
            if (session.status(originalSession) === "disconnected") { boundScope = undefined; boundSession = undefined; }
            return {
              kind: result.remote === "not_confirmed" ? "error" : "success",
              text: result.remote === "accepted" ? copy.revoked : result.remote === "not_confirmed"
                ? failureCopy(originalSession, copy.revokeUnknown) : copy.disconnected,
            };
          }))
          .catch((error: unknown): CommandResult => {
            if (invocation.agent === boundScope) {
              tools?.withdraw();
              if (session.status(originalSession) === "disconnected") { boundScope = undefined; boundSession = undefined; }
            }
            return { kind: "error", text: error instanceof OAuthSessionError
              ? error.code === "other_session" ? copy.otherSession : error.code === "busy" ? copy.busy
                : error.code === "unknown" || session.status(invocation.agent.session) === "unknown"
                  ? failureCopy(invocation.agent.session, copy.loginUnknown) : error.code === "disabled" ? copy.loginDisabled
                    : error.code === "denied" ? copy.loginDenied : copy.loginFailed
              : tools ? copy.toolsUnavailable : copy.loginFailed };
          });
      }
      if (action === "oauth-check" && !config.oauth) return { kind: "error", text: copy.oauthUnconfigured };
      if (pending) return { kind: "error", text: copy.busy };
      const signal = AbortSignal.any([lifetime.signal, invocation.signal]);
      const inspection = action === "oauth-check" && config.oauth
        ? inspectRentalOAuthConfiguration(connection, config.oauth, globalThis.fetch.bind(globalThis), signal)
        : inspectRentalMcpConnection(connection, globalThis.fetch.bind(globalThis), signal);
      const operation = inspection
        .then((): CommandResult => signal.aborted
          ? { kind: "error", text: copy.cancelled }
          : { kind: "success", text: action === "oauth-check" ? copy.oauthCompatible : copy.authorizationRequired })
        .catch((error: unknown): CommandResult => {
          if (signal.aborted) return { kind: "error", text: copy.cancelled };
          const code = error instanceof ConnectionInspectionError ? error.code : "unavailable";
          const text = code === "invalid_configuration" ? copy.invalid
            : code === "untrusted_discovery" ? copy.untrusted
              : code === "cancelled" ? copy.cancelled : copy.unavailable;
          return { kind: "error", text };
        });
      pending = operation.finally(() => { pending = undefined; });
      return pending;
    }),
  });

  // Registries also own their disposer. This combined teardown explicitly stops
  // new commands before cancellation, then waits for our bounded operation.
  ctx.effect(() => async () => {
    unregister();
    lifetime.abort();
    const drainedPrompts = prompts?.close();
    const closed = await session?.close();
    await tools?.close();
    await drainedPrompts;
    if (closed?.remote === "not_confirmed") ctx.logger.warn(copy.revokeUnknown);
    await pending;
  });
}
