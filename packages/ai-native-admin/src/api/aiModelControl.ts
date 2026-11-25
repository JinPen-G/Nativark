/** The original model-control transport consumes the selected host's one
 * session and request boundary. Unknown results retain their original key. */
import { AI_CONVERSATION_HTTP_DRAFT, type AiWorkbenchModelControlPreparation,
  type AiWorkbenchModelControlCommand, type AiWorkbenchModelControlReference,
  type AiWorkbenchModelControlObservation } from "@rental-os/shared/ai-admin";
import type { AiAdminHost } from "../host";
import { parseWorkbenchModelControl } from "../ai-native/workbench-model-control-session";

export function createAiModelControlApi(host: AiAdminHost) {
  const { runtime, getSession } = host;
  async function control(action: "model-control-prepare", input: { taskId: string }, signal: AbortSignal): Promise<AiWorkbenchModelControlPreparation>;
  async function control(action: "model-control" | "model-control-read", input: AiWorkbenchModelControlCommand | AiWorkbenchModelControlReference,
    signal: AbortSignal): Promise<AiWorkbenchModelControlObservation>;
  async function control(action: "model-control-prepare" | "model-control" | "model-control-read", input: unknown, signal: AbortSignal) {
    const command = action === "model-control-prepare" ? parseWorkbenchModelControl("AiWorkbenchDisplayReadDraft", input)
      : action === "model-control" ? parseWorkbenchModelControl("AiWorkbenchModelControlCommand", input)
        : parseWorkbenchModelControl("AiWorkbenchModelControlReference", input);
    const auth = getSession(), epoch = runtime.currentSessionEpoch();
    const active = AbortSignal.any([signal, runtime.currentSessionSignal()]);
    const owner = JSON.stringify([auth.user, auth.tenant?.tenantId, auth.currentWorkspaceId]);
    const check = () => {
      const next = getSession();
      if (active.aborted || epoch !== runtime.currentSessionEpoch() || !next.authenticated || !next.sessionVerified
        || !next.user || next.user.isSaasAdmin || !next.tenant?.tenantId || !next.currentWorkspaceId
        || JSON.stringify([next.user, next.tenant.tenantId, next.currentWorkspaceId]) !== owner) throw Error("AI_SCOPE_CHANGED");
    };
    check();
    // Keep the original single-dispatch rule across credential refresh.
    const response = await runtime.request<unknown>(`/${AI_CONVERSATION_HTTP_DRAFT.basePath}/${action}`, {
      method: "post", data: command, signal: active,
      timeout: action === "model-control" ? 125000 : 15000, retryAuthentication: false,
    });
    check();
    const value = action === "model-control-prepare" ? parseWorkbenchModelControl("AiWorkbenchModelControlPreparation", response)
      : parseWorkbenchModelControl("AiWorkbenchModelControlObservation", response);
    if (value.taskId !== command.taskId || "operationId" in command
      && (!("operationId" in value) || value.operationId !== command.operationId)) throw Error("AI_SCOPE_CHANGED");
    return value;
  }
  return Object.freeze({
    prepare: (input: { taskId: string }, signal: AbortSignal) => control("model-control-prepare", input, signal),
    execute: (input: AiWorkbenchModelControlCommand, signal: AbortSignal) => control("model-control", input, signal),
    read: (input: AiWorkbenchModelControlReference, signal: AbortSignal) => control("model-control-read", input, signal),
  });
}
