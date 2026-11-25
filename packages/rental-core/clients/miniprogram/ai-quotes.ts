/** 原客户报价与预约草稿请求单源。宿主供给原运输和正式 Native 校验器，原操作及重放选项保持。 */
import type {
  AiClientQuoteSelectionRef,
  AiClientBookingReadRef,
  AiClientQuotePreparationRequest,
  AiClientQuoteConfirmationRequest,
  AiClientQuoteBookingRequest,
  AiEntryActionDraft,
} from "@rental-os/shared";
import type { RentalMiniProgramClientPorts } from "./ports";
export interface RentalMiniProgramQuotePorts extends RentalMiniProgramClientPorts {
  contracts: Pick<
    typeof import("@rental-os/shared"),
    | "AI_CLIENT_ENTRY_HTTP_DRAFT"
    | "aiClientBookingReadRequestSchema"
    | "aiClientQuoteReadRequestSchema"
    | "aiClientQuotePreparationRequestSchema"
    | "aiClientQuotePreparationResponseSchema"
    | "aiClientQuotePreparationReadResponseSchema"
    | "aiClientQuoteConfirmationRequestSchema"
    | "aiClientQuoteResultReadResponseSchema"
    | "aiClientQuoteBookingRequestSchema"
    | "aiClientQuoteBookingPreparationResponseSchema"
    | "aiClientQuoteBookingOperationResponseSchema"
    | "aiEntryActionSchema"
    | "aiBookingDraftSchema"
    | "aiBookingCreateResponseSchema"
    | "aiBookingChoiceResponseSchema"
    | "aiBookingHandoffResponseSchema"
    | "aiBookingOperationReadResponseSchema"
  >;
}
export function createRentalMiniProgramQuoteApi(ports: RentalMiniProgramQuotePorts) {
  const { request } = ports;
  const {
    AI_CLIENT_ENTRY_HTTP_DRAFT,
    aiClientBookingReadRequestSchema,
    aiClientQuoteReadRequestSchema,
    aiClientQuotePreparationRequestSchema,
    aiClientQuotePreparationResponseSchema,
    aiClientQuotePreparationReadResponseSchema,
    aiClientQuoteConfirmationRequestSchema,
    aiClientQuoteResultReadResponseSchema,
    aiClientQuoteBookingRequestSchema,
    aiClientQuoteBookingPreparationResponseSchema,
    aiClientQuoteBookingOperationResponseSchema,
    aiEntryActionSchema,
    aiBookingDraftSchema,
    aiBookingCreateResponseSchema,
    aiBookingChoiceResponseSchema,
    aiBookingHandoffResponseSchema,
    aiBookingOperationReadResponseSchema,
  } = ports.contracts;
  const post = (action: string, value: unknown) =>
    request<unknown>(`/api/${AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedWechatBasePath}/${action}`, {
      method: "POST",
      data: value,
      replayAfterRefresh: false,
      timeoutMs: 15000,
    });
  return Object.freeze({
    async prepare(input: AiClientQuotePreparationRequest) {
      return aiClientQuotePreparationResponseSchema.parse(
        await post(
          AI_CLIENT_ENTRY_HTTP_DRAFT.prepareQuoteParameters,
          aiClientQuotePreparationRequestSchema.parse(input),
        ),
      );
    },
    async readPreparation(input: AiClientQuoteSelectionRef | AiClientQuotePreparationRequest) {
      return aiClientQuotePreparationReadResponseSchema.parse(
        await post(
          AI_CLIENT_ENTRY_HTTP_DRAFT.readQuotePreparationOperation,
          aiClientQuoteReadRequestSchema.parse(input),
        ),
      );
    },
    async confirm(input: AiClientQuoteConfirmationRequest) {
      return aiClientQuoteResultReadResponseSchema.parse(
        await post(
          AI_CLIENT_ENTRY_HTTP_DRAFT.confirmQuoteParameters,
          aiClientQuoteConfirmationRequestSchema.parse(input),
        ),
      );
    },
    async readOriginal(input: AiClientQuoteConfirmationRequest) {
      return aiClientQuoteResultReadResponseSchema.parse(
        await post(
          AI_CLIENT_ENTRY_HTTP_DRAFT.readPreparedQuoteOriginal,
          aiClientQuoteConfirmationRequestSchema.parse(input),
        ),
      );
    },
    async prepareBooking(input: AiClientQuoteBookingRequest) {
      return aiClientQuoteBookingPreparationResponseSchema.parse(
        await post(
          AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOriginalQuoteBooking,
          aiClientQuoteBookingRequestSchema.parse(input),
        ),
      );
    },
    async readBookingPreparation(input: AiClientBookingReadRef | AiClientQuoteBookingRequest) {
      return aiClientQuoteBookingOperationResponseSchema.parse(
        await post(
          AI_CLIENT_ENTRY_HTTP_DRAFT.readOriginalQuoteBookingOperation,
          aiClientBookingReadRequestSchema.parse(input),
        ),
      );
    },
    async issueBookingAction(input: { materialRef: string; actionCode: "CREATE_BOOKING_DRAFT" }) {
      return aiEntryActionSchema.parse(await post(AI_CLIENT_ENTRY_HTTP_DRAFT.issueAction, input));
    },
    async createBookingDraft(input: { action: AiEntryActionDraft; operationKey: string }) {
      return aiBookingCreateResponseSchema.parse(await post(AI_CLIENT_ENTRY_HTTP_DRAFT.createBookingDraft, input));
    },
    async readBookingDraft(input: { bookingDraftId: string }) {
      return aiBookingDraftSchema.parse(await post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingDraft, input));
    },
    async chooseBookingDraft(input: {
      bookingDraftId: string;
      expectedRevision: number;
      inputFingerprint: string;
      operationKey: string;
      decision: "continue_booking";
    }) {
      const value = aiBookingChoiceResponseSchema.parse(
        await post(AI_CLIENT_ENTRY_HTTP_DRAFT.chooseBookingDraft, input),
      );
      if (!("draft" in value)) throw Error("booking_choice_changed");
      return value;
    },
    async handoffBookingDraft(input: { action: AiEntryActionDraft; operationKey: string }) {
      return aiBookingHandoffResponseSchema.parse(await post(AI_CLIENT_ENTRY_HTTP_DRAFT.handoffBookingDraft, input));
    },
    async readBookingOperation(input: { operationKey: string }) {
      return aiBookingOperationReadResponseSchema.parse(
        await post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingOperation, input),
      );
    },
  });
}
