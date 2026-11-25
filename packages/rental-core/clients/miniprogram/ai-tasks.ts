/** 原客户任务与材料请求单源。宿主供给原运输和正式 Native 校验器，原操作及重放选项保持。 */
import type { AiClientHostCapabilities, AiClientOrderActionSource, AiClientOrderAction } from "@rental-os/shared";
import type { RentalMiniProgramClientPorts } from "./ports";
export interface RentalMiniProgramTaskPorts extends RentalMiniProgramClientPorts {
  contracts: Pick<
    typeof import("@rental-os/shared"),
    | "AI_CLIENT_ENTRY_HTTP_DRAFT"
    | "aiClientOrderMaterialRequestSchema"
    | "aiClientOrderMaterialReceiptSchema"
    | "aiClientTaskReadRequestSchema"
    | "aiClientTaskCreationReceiptSchema"
    | "aiClientTaskModelControlResponseSchema"
    | "aiClientTaskModelResultReadResponseSchema"
    | "aiClientTaskInputReadResponseSchema"
    | "aiClientTaskInputSubmissionRequestSchema"
    | "aiClientTaskInputReferenceRequestSchema"
    | "aiClientTaskInputSubmissionReceiptSchema"
    | "aiClientTaskInputReceiptReadResponseSchema"
    | "aiClientTaskEventsReadRequestSchema"
    | "aiClientTaskSnapshotReadResponseSchema"
    | "aiClientTaskEventsReadResponseSchema"
    | "aiClientOrderActionSourceSchema"
    | "aiClientOrderActionSchema"
    | "aiClientOrderActionRevalidationSchema"
    | "aiClientHostCapabilitiesSchema"
  >;
}
export interface ClientOrderNavigationPort {
  readHost(source: AiClientOrderActionSource): Promise<AiClientHostCapabilities>;
  readAction(source: AiClientOrderActionSource): Promise<AiClientOrderAction>;
  revalidateAction(action: AiClientOrderAction, source: AiClientOrderActionSource): Promise<AiClientOrderAction>;
}
export function createRentalMiniProgramTaskApi(ports: RentalMiniProgramTaskPorts) {
  const { request } = ports;
  const {
    AI_CLIENT_ENTRY_HTTP_DRAFT,
    aiClientOrderMaterialRequestSchema,
    aiClientOrderMaterialReceiptSchema,
    aiClientTaskReadRequestSchema,
    aiClientTaskCreationReceiptSchema,
    aiClientTaskModelControlResponseSchema,
    aiClientTaskModelResultReadResponseSchema,
    aiClientTaskInputReadResponseSchema,
    aiClientTaskInputSubmissionRequestSchema,
    aiClientTaskInputReferenceRequestSchema,
    aiClientTaskInputSubmissionReceiptSchema,
    aiClientTaskInputReceiptReadResponseSchema,
    aiClientTaskEventsReadRequestSchema,
    aiClientTaskSnapshotReadResponseSchema,
    aiClientTaskEventsReadResponseSchema,
    aiClientOrderActionSourceSchema,
    aiClientOrderActionSchema,
    aiClientOrderActionRevalidationSchema,
    aiClientHostCapabilitiesSchema,
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
    orderNavigation: Object.freeze({
      readHost(source: AiClientOrderActionSource) {
        return call(
          AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderTaskHostCapabilities,
          aiClientOrderActionSourceSchema.parse(source),
          aiClientHostCapabilitiesSchema,
        );
      },
      readAction(source: AiClientOrderActionSource) {
        return call(
          AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderAction,
          aiClientOrderActionSourceSchema.parse(source),
          aiClientOrderActionSchema,
        );
      },
      revalidateAction(action: AiClientOrderAction, source: AiClientOrderActionSource) {
        return call(
          AI_CLIENT_ENTRY_HTTP_DRAFT.revalidateOrderAction,
          aiClientOrderActionRevalidationSchema.parse({ ...source, action }),
          aiClientOrderActionSchema,
        );
      },
    }),
    prepareMaterial(input: ReturnType<typeof aiClientOrderMaterialRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOrderMaterial,
        aiClientOrderMaterialRequestSchema.parse(input),
        aiClientOrderMaterialReceiptSchema,
      );
    },
    readMaterial(input: ReturnType<typeof aiClientOrderMaterialRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderMaterialReceipt,
        aiClientOrderMaterialRequestSchema.parse(input),
        aiClientOrderMaterialReceiptSchema,
      );
    },
    createTask(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.createTask,
        aiClientTaskReadRequestSchema.parse(input),
        aiClientTaskCreationReceiptSchema,
      );
    },
    readCreation(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCreation,
        aiClientTaskReadRequestSchema.parse(input),
        aiClientTaskCreationReceiptSchema,
      );
    },
    readSnapshot(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskSnapshot,
        aiClientTaskReadRequestSchema.parse(input),
        aiClientTaskSnapshotReadResponseSchema,
      );
    },
    readEvents(input: ReturnType<typeof aiClientTaskEventsReadRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskEvents,
        aiClientTaskEventsReadRequestSchema.parse(input),
        aiClientTaskEventsReadResponseSchema,
      );
    },
    startModel(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.startTaskModel,
        aiClientTaskReadRequestSchema.parse(input),
        aiClientTaskModelControlResponseSchema,
      );
    },
    readModelResult(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskModelResult,
        aiClientTaskReadRequestSchema.parse(input),
        aiClientTaskModelResultReadResponseSchema,
      );
    },
    readInput(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInput,
        aiClientTaskReadRequestSchema.parse(input),
        aiClientTaskInputReadResponseSchema,
      );
    },
    submitInput(input: ReturnType<typeof aiClientTaskInputSubmissionRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.submitTaskInput,
        aiClientTaskInputSubmissionRequestSchema.parse(input),
        aiClientTaskInputSubmissionReceiptSchema,
      );
    },
    readInputReceipt(input: ReturnType<typeof aiClientTaskInputReferenceRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInputReceipt,
        aiClientTaskInputReferenceRequestSchema.parse(input),
        aiClientTaskInputReceiptReadResponseSchema,
      );
    },
    continueInput(input: ReturnType<typeof aiClientTaskInputReferenceRequestSchema.parse>) {
      return call(
        AI_CLIENT_ENTRY_HTTP_DRAFT.continueTaskInput,
        aiClientTaskInputReferenceRequestSchema.parse(input),
        aiClientTaskModelControlResponseSchema,
      );
    },
  });
}
export type ClientTaskApi = Omit<ReturnType<typeof createRentalMiniProgramTaskApi>, "orderNavigation"> & {
  readonly orderNavigation?: ClientOrderNavigationPort;
};
