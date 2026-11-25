/** 原客户公开连续性请求单源，宿主供给原校验器及当前读取寿命。 */
import type {
  AiClientPublicContinuityApi,
  AiClientPublicReadRequest,
  AiClientPublicReadResponse,
  AiClientPublicSessionRequest,
  AiClientPublicPreparationRequest,
  AiClientPublicOperationRequest,
  AiClientPublicContinuationRequest,
  AiClientPublicContinuationReadRequest,
} from "@rental-os/shared";
import type { RentalMiniProgramClientPorts, RentalMiniProgramPublicConfig } from "./ports";
export interface RentalMiniProgramPublicPorts extends RentalMiniProgramClientPorts {
  contracts: Pick<
    typeof import("@rental-os/shared"),
    | "AI_CLIENT_PUBLIC_HTTP"
    | "aiClientPublicSessionRequestSchema"
    | "aiClientPublicReadRequestSchema"
    | "aiClientPublicPreparationRequestSchema"
    | "aiClientPublicOperationRequestSchema"
    | "aiClientPublicContinuationRequestSchema"
    | "aiClientPublicContinuationReadRequestSchema"
    | "aiClientPublicSessionResponseSchema"
    | "aiClientPublicReadResponseSchema"
    | "aiClientPublicPreparationResponseSchema"
    | "aiClientPublicOperationResponseSchema"
    | "aiClientPublicContinuationResponseSchema"
  >;
  publicConfig: Pick<RentalMiniProgramPublicConfig, "tenantCode">;
}
export function createRentalMiniProgramPublicApi(ports: RentalMiniProgramPublicPorts): AiClientPublicContinuityApi & {
  read(input: AiClientPublicReadRequest): Promise<AiClientPublicReadResponse>;
} {
  const { request, publicConfig: PUBLIC_CONFIG } = ports;
  const {
    AI_CLIENT_PUBLIC_HTTP,
    aiClientPublicSessionRequestSchema,
    aiClientPublicReadRequestSchema,
    aiClientPublicPreparationRequestSchema,
    aiClientPublicOperationRequestSchema,
    aiClientPublicContinuationRequestSchema,
    aiClientPublicContinuationReadRequestSchema,
    aiClientPublicSessionResponseSchema,
    aiClientPublicReadResponseSchema,
    aiClientPublicPreparationResponseSchema,
    aiClientPublicOperationResponseSchema,
    aiClientPublicContinuationResponseSchema,
  } = ports.contracts;
  const post = (action: string, data: unknown, credential?: string, client = false) => {
    if (!data || typeof data !== "object" || !("tenantCode" in data) || data.tenantCode !== PUBLIC_CONFIG.tenantCode)
      throw Error("public_context_changed");
    return request<unknown>(`/api/${AI_CLIENT_PUBLIC_HTTP.basePaths[1]}/${action}`, {
      method: "POST",
      data,
      auth: client ? "required" : "none",
      scope: "workspace",
      replayAfterRefresh: false,
      timeoutMs: 15000,
      ...(credential ? { publicSessionCredential: credential } : {}),
    });
  };
  return Object.freeze({
    async read(input: AiClientPublicReadRequest) {
      return aiClientPublicReadResponseSchema.parse(
        await post(AI_CLIENT_PUBLIC_HTTP.read, aiClientPublicReadRequestSchema.parse(input)),
      );
    },
    async issueSession(input: AiClientPublicSessionRequest) {
      return aiClientPublicSessionResponseSchema.parse(
        await post(AI_CLIENT_PUBLIC_HTTP.issueSession, aiClientPublicSessionRequestSchema.parse(input)),
      );
    },
    async prepare(input: AiClientPublicPreparationRequest, credential: string) {
      return aiClientPublicPreparationResponseSchema.parse(
        await post(AI_CLIENT_PUBLIC_HTTP.prepare, aiClientPublicPreparationRequestSchema.parse(input), credential),
      );
    },
    async readOriginal(input: AiClientPublicOperationRequest, credential: string) {
      return aiClientPublicOperationResponseSchema.parse(
        await post(AI_CLIENT_PUBLIC_HTTP.readOriginal, aiClientPublicOperationRequestSchema.parse(input), credential),
      );
    },
    async continueOriginal(input: AiClientPublicContinuationRequest, credential: string) {
      return aiClientPublicContinuationResponseSchema.parse(
        await post(
          AI_CLIENT_PUBLIC_HTTP.continueOriginal,
          aiClientPublicContinuationRequestSchema.parse(input),
          credential,
          true,
        ),
      );
    },
    async readContinuation(input: AiClientPublicContinuationReadRequest) {
      return aiClientPublicContinuationResponseSchema.parse(
        await post(
          AI_CLIENT_PUBLIC_HTTP.readContinuation,
          aiClientPublicContinuationReadRequestSchema.parse(input),
          undefined,
          true,
        ),
      );
    },
  });
}
