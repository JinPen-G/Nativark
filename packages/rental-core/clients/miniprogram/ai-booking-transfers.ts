/** 原客户预约转移请求单源，宿主供给原校验器及当前读取寿命。 */
import type { AiClientBookingTransferIssueRequest, AiClientBookingTransferRequest } from "@rental-os/shared";
import type { RentalMiniProgramClientPorts } from "./ports";
export interface ClientBookingTransferApi {
  readHost(): Promise<unknown>;
  issue(value: AiClientBookingTransferIssueRequest): Promise<unknown>;
  readIssue(value: AiClientBookingTransferIssueRequest): Promise<unknown>;
  consume(value: AiClientBookingTransferRequest): Promise<unknown>;
  readReceipt(value: AiClientBookingTransferRequest): Promise<unknown>;
}
export interface RentalMiniProgramBookingTransferPorts extends RentalMiniProgramClientPorts {
  contracts: Pick<
    typeof import("@rental-os/shared"),
    | "AI_CLIENT_ENTRY_HTTP_DRAFT"
    | "aiClientHostCapabilitiesSchema"
    | "aiClientBookingTransferIssueRequestSchema"
    | "aiClientBookingTransferRequestSchema"
    | "aiClientBookingTransferIssueResponseSchema"
    | "aiClientBookingTransferReceiptSchema"
  >;
}
export function createRentalMiniProgramBookingTransferApi(
  ports: RentalMiniProgramBookingTransferPorts,
  context: {
    current(): boolean;
  },
): ClientBookingTransferApi {
  const { request } = ports;
  const {
    AI_CLIENT_ENTRY_HTTP_DRAFT,
    aiClientHostCapabilitiesSchema,
    aiClientBookingTransferIssueRequestSchema,
    aiClientBookingTransferRequestSchema,
    aiClientBookingTransferIssueResponseSchema,
    aiClientBookingTransferReceiptSchema,
  } = ports.contracts;
  const post = async <T,>(
    action: string,
    value: unknown,
    schema: {
      parse(value: unknown): T;
    },
  ): Promise<T> => {
    if (!context.current()) throw Error("booking_transfer_context_changed");
    const result = await request<unknown>(`/api/${AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedWechatBasePath}/${action}`, {
      method: "POST",
      auth: "required",
      scope: "workspace",
      data: value,
      replayAfterRefresh: false,
      timeoutMs: 15000,
    });
    if (!context.current()) throw Error("booking_transfer_context_changed");
    return schema.parse(result);
  };
  return Object.freeze<ClientBookingTransferApi>({
    readHost: () => post(AI_CLIENT_ENTRY_HTTP_DRAFT.readHostCapabilities, {}, aiClientHostCapabilitiesSchema),
    issue: (value) =>
      post(
        AI_CLIENT_ENTRY_HTTP_DRAFT.issueBookingTransfer,
        aiClientBookingTransferIssueRequestSchema.parse(value),
        aiClientBookingTransferIssueResponseSchema,
      ),
    readIssue: (value) =>
      post(
        AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingTransferIssue,
        aiClientBookingTransferIssueRequestSchema.parse(value),
        aiClientBookingTransferIssueResponseSchema,
      ),
    consume: (value) =>
      post(
        AI_CLIENT_ENTRY_HTTP_DRAFT.consumeBookingTransfer,
        aiClientBookingTransferRequestSchema.parse(value),
        aiClientBookingTransferReceiptSchema,
      ),
    readReceipt: (value) =>
      post(
        AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingTransferReceipt,
        aiClientBookingTransferRequestSchema.parse(value),
        aiClientBookingTransferReceiptSchema,
      ),
  });
}
