/** 原受控检测任务的运输，不直接连接供应商。批准、派发和核账仍由服务端决定；
 * 所有命令只发送一次，失应答继续读取原请求、任务、操作和计量收据。 */
import { AI_TEXT_CAPABILITY_HTTP_DRAFT as routes, AI_TASK_CENTER_HTTP_DRAFT,
  type AiTextCapabilityHttpResponsesDraft, type AiTextCapabilityPrepareRequestDraft,
  type AiTextCapabilityCancelRequestDraft, type AiTextCapabilityConfigureActionDraft,
  type AiTextCapabilityActionRequestDraft, type AiTextCapabilityAccountingOperationRequestDraft,
  type AiTaskStopQueryDraft, type AiTaskStopObservationDraft } from "@rental-os/shared/ai-admin";
import type { AiAdminHost } from "../host";
import { AI_EXECUTION_RESPONSE_TIMEOUT_MS } from "../api/aiRequestTiming";
import { createAiSettingsRequest } from "../platform-model-settings/request";

export type CapabilityProbeAction = 'prepare' | 'publish' | 'readOriginal' | 'createTask' | 'readTask' | 'start' | 'inspect'
  | 'cancel' | 'reconcile' | 'readCapabilityReceipt' | 'readHistory' | 'preflight' | 'readTaskAction' | 'configureTaskAction' | 'readTaskActionReceipt'
  | 'readAccounting' | 'releaseUnsent' | 'reconcileAccounting' | 'readAccountingOperation';

export function createAiCapabilityProbeApi(host: AiAdminHost) {
  const request = createAiSettingsRequest(host);
  const access = { audience: "tenant", permission: "system:params:manage", workspace: true, write: false } as const;
  return Object.freeze({
    readCancellationReceipt: (input: AiTaskStopQueryDraft, signal: AbortSignal) =>
      request<AiTaskStopObservationDraft>(`/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.stopReceipt}`,
        access, { method: "post", data: input, signal }),
    call<K extends CapabilityProbeAction>(action: K, value: AiTextCapabilityPrepareRequestDraft | AiTextCapabilityCancelRequestDraft
      | AiTextCapabilityConfigureActionDraft | AiTextCapabilityActionRequestDraft | AiTextCapabilityAccountingOperationRequestDraft,
      signal: AbortSignal): Promise<AiTextCapabilityHttpResponsesDraft[K]> {
      // receipt/read 核对后会记录能力证据，仍是原写操作，不能按名称猜成只读。
      const write = ["publish", "createTask", "start", "cancel", "reconcile", "readCapabilityReceipt",
        "configureTaskAction", "releaseUnsent", "reconcileAccounting"].includes(action);
      return request<AiTextCapabilityHttpResponsesDraft[K]>(`/${routes.basePath}/${routes[action]}`, { ...access, write },
        { method: "post", data: value, signal, headers: { "Cache-Control": "no-store" },
          ...(action === "start" ? { timeout: AI_EXECUTION_RESPONSE_TIMEOUT_MS } : {}) });
    },
  });
}

export type AiCapabilityProbeApi = ReturnType<typeof createAiCapabilityProbeApi>;
