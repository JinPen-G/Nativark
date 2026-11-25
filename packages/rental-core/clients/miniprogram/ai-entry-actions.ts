/** 原客户 Action 读取与身份复验。原会话、权限和服务器时钟由宿主供给，业务对象及结果沿原合同校验。 */
import type {
  AiRegisteredEntryAction,
  AiRegisteredEntryActionOrderResponse,
  AiRegisteredEntryActionRevalidation,
  ClientPaymentIntentResponse,
} from "@rental-os/shared";
import type { RentalMiniProgramClientPorts, RentalMiniProgramPublicConfig } from "./ports";
export type ClientOriginalPaymentRecord = Pick<
  ClientPaymentIntentResponse,
  "intentId" | "instrument" | "amount" | "currency" | "status" | "expiresAt" | "paidAt"
>;
export interface RentalMiniProgramEntryActionSession {
  accessToken: string;
  customer: {
    customerId: string;
    customerType: "personal" | "corporate";
  };
  services: readonly unknown[];
  serviceCode: string;
}
export interface RentalMiniProgramEntryActionPorts extends RentalMiniProgramClientPorts {
  contracts: Pick<
    typeof import("@rental-os/shared"),
    | "AI_REGISTERED_ENTRY_ACTION_VERSION"
    | "AI_REGISTERED_ENTRY_ACTION_HTTP"
    | "aiRegisteredEntryActionOrderSourceSchema"
    | "aiRegisteredEntryActionOrderResponseSchema"
    | "aiRegisteredEntryActionReadSchema"
    | "aiRegisteredEntryActionRevalidationSchema"
  >;
  /** 返回原会话对象，身份复验会读取其完整投影并核对对象引用。 */
  currentSession(): RentalMiniProgramEntryActionSession | undefined;
  contextVersion(): number;
  serverNow(): number;
  publicConfig: Pick<RentalMiniProgramPublicConfig, "tenantCode">;
}
export function createRentalMiniProgramEntryActionApi(ports: RentalMiniProgramEntryActionPorts) {
  const { request, currentSession, contextVersion, serverNow, publicConfig: PUBLIC_CONFIG } = ports;
  const {
    AI_REGISTERED_ENTRY_ACTION_VERSION,
    AI_REGISTERED_ENTRY_ACTION_HTTP,
    aiRegisteredEntryActionOrderSourceSchema,
    aiRegisteredEntryActionOrderResponseSchema,
    aiRegisteredEntryActionReadSchema,
    aiRegisteredEntryActionRevalidationSchema,
  } = ports.contracts;
  const id = (value: unknown): value is string =>
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const unavailable = () => Error("当前原入口无法核对，请重新读取订单。");
  const codes = ["OPEN_ORDER", "OPEN_PROFILE", "OPEN_PRODUCT", "OPEN_PAYMENT"];
  function captureClientEntryActionContext() {
    const session = currentSession(),
      generation = contextVersion(),
      tenantCode = PUBLIC_CONFIG.tenantCode;
    if (
      !session?.accessToken ||
      session.customer.customerType !== "personal" ||
      !id(session.customer.customerId) ||
      !session.serviceCode ||
      !tenantCode
    )
      throw unavailable();
    const token = session.accessToken,
      customerId = session.customer.customerId,
      serviceCode = session.serviceCode,
      identity = JSON.stringify({ customer: session.customer, services: session.services });
    return {
      customerId,
      serviceCode,
      current: () => {
        const current = currentSession();
        return (
          current === session &&
          contextVersion() === generation &&
          PUBLIC_CONFIG.tenantCode === tenantCode &&
          current.accessToken === token &&
          current.serviceCode === serviceCode &&
          JSON.stringify({ customer: current.customer, services: current.services }) === identity
        );
      },
    };
  }
  type Context = ReturnType<typeof captureClientEntryActionContext>;
  function originalAction(action: AiRegisteredEntryAction, context: Context, orderId: string): boolean {
    return (
      action.contractVersion === AI_REGISTERED_ENTRY_ACTION_VERSION &&
      action.audience === "customer" &&
      action.surface === "client_miniprogram" &&
      codes.includes(action.actionCode) &&
      action.riskLevel === "R0" &&
      action.requiresConfirmation === false &&
      action.associations.orderId === orderId &&
      action.associations.taskId === null &&
      action.associations.runId === null &&
      action.associations.materialRef === null &&
      action.associations.proposalId === null &&
      action.associations.quoteId === null &&
      action.associations.bookingDraftId === null &&
      (action.actionCode !== "OPEN_PROFILE" || action.resource.id === context.customerId) &&
      (action.actionCode !== "OPEN_ORDER" || action.resource.id === orderId) &&
      Date.parse(action.expiresAt) > serverNow()
    );
  }
  function route(operation: "fromOrder" | "revalidate") {
    if (AI_REGISTERED_ENTRY_ACTION_HTTP.wechatBasePath !== "client/v1/ai-native/wechat/entry-actions")
      throw unavailable();
    return `/api/${AI_REGISTERED_ENTRY_ACTION_HTTP.wechatBasePath}/${AI_REGISTERED_ENTRY_ACTION_HTTP[operation]}`;
  }
  function createClientEntryActionApi(options: { orderId: string; current(): boolean }) {
    const live = (context: Context) => {
      if (!options.current() || !context.current()) throw unavailable();
    };
    return Object.freeze({
      async fromOrder(): Promise<AiRegisteredEntryActionOrderResponse> {
        const context = captureClientEntryActionContext(),
          command = aiRegisteredEntryActionOrderSourceSchema.parse({ orderId: options.orderId });
        live(context);
        const response: unknown = await request(route("fromOrder"), {
          method: "POST",
          data: command,
          timeoutMs: 15000,
          replayAfterRefresh: false,
          scope: "workspace",
        });
        live(context);
        const result = aiRegisteredEntryActionOrderResponseSchema.parse(response);
        if (
          !("orderId" in result.source) ||
          result.source.orderId !== options.orderId ||
          result.orderId !== options.orderId ||
          result.actions.length > 42 ||
          result.actions.some(
            (row) => !originalAction(row.action, context, options.orderId) || !equal(row.action.scope, result.scope),
          ) ||
          result.actions.filter((row) => row.action.actionCode === "OPEN_ORDER").length !== 1 ||
          result.actions.filter((row) => row.action.actionCode === "OPEN_PROFILE").length > 1 ||
          result.actions.filter((row) => row.action.actionCode === "OPEN_PRODUCT").length > 20 ||
          result.actions.filter((row) => row.action.actionCode === "OPEN_PAYMENT").length > 20 ||
          new Set(result.actions.map((row) => row.action.actionId)).size !== result.actions.length ||
          new Set(result.actions.map((row) => `${row.action.actionCode}:${row.action.resource.id}`)).size !==
            result.actions.length
        )
          throw unavailable();
        return result;
      },
      async revalidate(action: AiRegisteredEntryAction): Promise<AiRegisteredEntryActionRevalidation> {
        const context = captureClientEntryActionContext(),
          command = aiRegisteredEntryActionReadSchema.parse({ action });
        if (!originalAction(command.action, context, options.orderId)) throw unavailable();
        live(context);
        const response: unknown = await request(route("revalidate"), {
          method: "POST",
          data: command,
          timeoutMs: 15000,
          replayAfterRefresh: false,
          scope: "workspace",
        });
        live(context);
        const result = aiRegisteredEntryActionRevalidationSchema.parse(response);
        if (
          !originalAction(command.action, context, options.orderId) ||
          result.actionId !== action.actionId ||
          result.actionCode !== action.actionCode ||
          result.audience !== action.audience ||
          result.surface !== action.surface ||
          !equal(result.scope, action.scope) ||
          !equal(result.resource, action.resource) ||
          !equal(result.associations, action.associations)
        )
          throw unavailable();
        return result;
      },
      async readOriginalPayment(intentId: string): Promise<ClientOriginalPaymentRecord> {
        const context = captureClientEntryActionContext();
        if (!id(options.orderId) || !id(intentId)) throw unavailable();
        live(context);
        const response: unknown = await request(
          `/orders/${encodeURIComponent(options.orderId)}/payment-intents/${encodeURIComponent(intentId)}`,
          { replayAfterRefresh: false, scope: "workspace", timeoutMs: 15000 },
        );
        live(context);
        if (!response || typeof response !== "object" || Array.isArray(response)) throw unavailable();
        const value = response as Record<string, unknown>;
        if (
          value.intentId !== intentId ||
          !["rental", "deposit", "preauthorization"].includes(String(value.instrument)) ||
          !["pending", "paid", "failed", "funding_failed", "closed"].includes(String(value.status)) ||
          typeof value.amount !== "number" ||
          !Number.isFinite(value.amount) ||
          (Number.isInteger(value.amount) && !Number.isSafeInteger(value.amount)) ||
          typeof value.currency !== "string" ||
          !/^[A-Z]{3}$/u.test(value.currency) ||
          typeof value.expiresAt !== "string" ||
          !Number.isFinite(Date.parse(value.expiresAt)) ||
          (value.paidAt !== undefined &&
            (typeof value.paidAt !== "string" || !Number.isFinite(Date.parse(value.paidAt))))
        )
          throw unavailable();
        return {
          intentId,
          instrument: value.instrument as ClientOriginalPaymentRecord["instrument"],
          amount: value.amount,
          currency: value.currency,
          status: value.status as ClientOriginalPaymentRecord["status"],
          expiresAt: value.expiresAt,
          ...(typeof value.paidAt === "string" ? { paidAt: value.paidAt } : {}),
        };
      },
    });
  }
  return { captureClientEntryActionContext, createClientEntryActionApi };
}
