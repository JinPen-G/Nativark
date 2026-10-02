/** Internal implementation ports, NOT the centrally maintained AIN-C03 wire contract. */
export type ModelFeature = "tools" | "structuredOutput";
export interface GatewayContext { tenantId: string; workspaceId: string; actorId: string; }
export interface ModelRequest {
  callId: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxOutputTokens: number;
  features?: ModelFeature[];
}
export interface ModelUsage { inputTokens: number; outputTokens: number; }
export interface AdapterResult { text: string; usage?: ModelUsage; }
export interface ModelAdapter {
  readonly provider: string;
  readonly features: readonly ModelFeature[];
  generate(input: Readonly<ModelRequest> & { signal: AbortSignal }, credential: string,
    connection?: Readonly<{ baseUrl: string }>): Promise<AdapterResult>;
}
export interface GatewayProfile {
  enabled: boolean;
  provider: string;
  /** Registry key identifies protocol, not a fixed supplier. Resolved by the server. */
  baseUrl?: string;
  allowedModels: string[];
  credentialRef: string;
  timeoutMs: number;
  maxConcurrent: number;
  maxOutputTokens: number;
}
export interface GatewayPorts {
  /** Required AIN-04 adapter: must resolve fresh server identity/scope, never model claims. */
  authorize(context: GatewayContext): Promise<void>;
  profile(context: GatewayContext): Promise<GatewayProfile>;
  /** Required server vault adapter. Never provided by request payload. */
  credential(reference: string, context: GatewayContext): Promise<string>;
  /** Required AIN-11 adapter; no free/unmetered fallback is supplied. */
  budget: {
    reserve(context: GatewayContext, request: { callId: string; model: string; maxOutputTokens: number }): Promise<string>;
    settle(reservationId: string, usage: ModelUsage): Promise<void>;
    release(reservationId: string): Promise<void>;
    reconcile(reservationId: string, reason: string): Promise<void>;
  };
}
export type GatewayErrorCode = "INVALID_REQUEST" | "FORBIDDEN" | "DISABLED" | "MODEL_NOT_ALLOWED" |
  "CAPABILITY_UNSUPPORTED" | "PROVIDER_UNAVAILABLE" | "CONFIG_INVALID" | "RATE_LIMITED" |
  "CREDENTIAL_UNAVAILABLE" | "BUDGET_UNAVAILABLE" | "AUTHENTICATION_FAILED" |
  "TIMEOUT" | "CANCELLED" | "PROVIDER_FAILED" | "INVALID_RESPONSE" | "ACCOUNTING_PENDING";
export class ModelGatewayError extends Error {
  constructor(readonly code: GatewayErrorCode) { super(code); this.name = "ModelGatewayError"; }
}
/** Adapters map vendor errors to this type; never pass vendor payload/messages to callers. */
export class ModelAdapterError extends Error {
  constructor(readonly code: "AUTHENTICATION_FAILED" | "RATE_LIMITED" | "PROVIDER_FAILED") {
    super(code); this.name = "ModelAdapterError";
  }
}
