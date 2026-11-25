/** 原客户取消与原结果请求单源。宿主供给原运输和正式 Native 校验器，原操作及重放选项保持。 */
import type { RentalMiniProgramClientPorts } from "./ports";
import type { ClientTaskApi } from "./ai-tasks";
export interface RentalMiniProgramTaskCancellationPorts extends RentalMiniProgramClientPorts {
  contracts: Pick<
    typeof import("@rental-os/shared"),
    | "AI_CLIENT_ENTRY_HTTP_DRAFT"
    | "aiClientTaskCancelRequestSchema"
    | "aiClientTaskCancelReceiptSchema"
    | "aiClientTaskCancellationObservationSchema"
    | "aiClientTaskInputCancellationReceiptSchema"
    | "aiClientTaskUnstartedCancellationReceiptSchema"
    | "aiClientTaskReadRequestSchema"
  >;
  clientTaskApi: Pick<ClientTaskApi, "readCreation">;
}
export function createRentalMiniProgramTaskCancellationApi(ports: RentalMiniProgramTaskCancellationPorts) {
  const { request, clientTaskApi } = ports;
  const {
    AI_CLIENT_ENTRY_HTTP_DRAFT,
    aiClientTaskCancelRequestSchema,
    aiClientTaskCancelReceiptSchema,
    aiClientTaskCancellationObservationSchema,
    aiClientTaskInputCancellationReceiptSchema,
    aiClientTaskUnstartedCancellationReceiptSchema,
    aiClientTaskReadRequestSchema,
  } = ports.contracts;
  const call = async <T,>(
    action: string,
    value: unknown,
    schema: {
      parse(value: unknown): T;
    },
  ): Promise<T> =>
    schema.parse(
      await request<unknown>(`/api/${AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedWechatBasePath}/${action}`, {
        method: "POST",
        data: value,
        replayAfterRefresh: false,
        timeoutMs: 15000,
      }),
    );
  return Object.freeze({
    readCreation: clientTaskApi.readCreation,
    requestCancellation(input: ReturnType<typeof aiClientTaskCancelRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.requestTaskCancellation,
        aiClientTaskCancelRequestSchema.parse(input),
        aiClientTaskCancelReceiptSchema,
      );
    },
    readRequestReceipt(input: ReturnType<typeof aiClientTaskCancelRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCancellationReceipt,
        aiClientTaskCancelRequestSchema.parse(input),
        aiClientTaskCancellationObservationSchema,
      );
    },
    readSettlementReceipt(input: ReturnType<typeof aiClientTaskCancelRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCancellationSettlementReceipt,
        aiClientTaskCancelRequestSchema.parse(input),
        aiClientTaskCancellationObservationSchema,
      );
    },
    settleUnstarted(input: ReturnType<typeof aiClientTaskCancelRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.settleTaskUnstartedCancellation,
        aiClientTaskCancelRequestSchema.parse(input),
        aiClientTaskUnstartedCancellationReceiptSchema,
      );
    },
    settleReleasedInputWait(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.reconcileTaskInputCancellation,
        aiClientTaskReadRequestSchema.parse(input),
        aiClientTaskInputCancellationReceiptSchema,
      );
    },
  });
}
export type ClientTaskCancellationApi = ReturnType<typeof createRentalMiniProgramTaskCancellationApi>;
