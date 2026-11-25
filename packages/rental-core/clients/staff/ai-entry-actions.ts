/** 原员工 Action 读取与身份复验。原会话、权限和服务器时钟由宿主供给，业务对象及结果沿原合同校验。 */
import type {
  AiRegisteredEntryAction,
  AiRegisteredEntryActionOrderResponse,
  AiRegisteredEntryActionOrderSource,
  AiRegisteredEntryActionRead,
  AiRegisteredEntryActionRevalidation,
} from "@rental-os/shared";
import type { RentalStaffClientPorts } from "./ports";
export const STAFF_ORDER_ENTRY_CODES = ["OPEN_ORDER", "OPEN_CUSTOMER", "OPEN_PRODUCT", "OPEN_DISPATCH"] as const;
export type StaffOrderEntryCode = (typeof STAFF_ORDER_ENTRY_CODES)[number];
export interface RentalStaffEntryActionSession {
  accessToken: string;
  tenant: {
    tenantId: string;
  };
  user: {
    id: string;
  };
  currentWorkspaceId: string;
}
export interface RentalStaffEntryActionPorts extends RentalStaffClientPorts {
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
  currentSession(): RentalStaffEntryActionSession | undefined;
  contextVersion(): number;
  serverNow(): number;
  can(...codes: string[]): boolean;
}
export function createRentalStaffEntryActionApi(ports: RentalStaffEntryActionPorts) {
  const { request, currentSession, contextVersion, serverNow, can } = ports;
  const {
    AI_REGISTERED_ENTRY_ACTION_VERSION,
    AI_REGISTERED_ENTRY_ACTION_HTTP,
    aiRegisteredEntryActionOrderSourceSchema,
    aiRegisteredEntryActionOrderResponseSchema,
    aiRegisteredEntryActionReadSchema,
    aiRegisteredEntryActionRevalidationSchema,
  } = ports.contracts;
  const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
  const unavailable = () => Error("当前原入口无法核对，请刷新订单后重新读取。");
  /** A local display fence, never destination authorization. Capture the token
   * and complete current user projection privately so same-account refreshes
   * and in-place permission changes cannot deliver an old observation. */
  function captureStaffEntryActionContext() {
    const session = currentSession(),
      version = contextVersion();
    if (
      !session?.accessToken ||
      !session.user?.id ||
      !session.tenant?.tenantId ||
      !session.currentWorkspaceId ||
      !can("rental-os:order:view")
    )
      throw unavailable();
    const token = session.accessToken,
      user = JSON.stringify(session.user),
      tenantId = session.tenant.tenantId,
      workspaceId = session.currentWorkspaceId,
      ownerId = session.user.id;
    return {
      tenantId,
      workspaceId,
      ownerId,
      current: () => {
        const current = currentSession();
        return (
          current === session &&
          contextVersion() === version &&
          current.accessToken === token &&
          current.tenant.tenantId === tenantId &&
          current.currentWorkspaceId === workspaceId &&
          current.user.id === ownerId &&
          JSON.stringify(current.user) === user &&
          can("rental-os:order:view")
        );
      },
    };
  }
  type Context = ReturnType<typeof captureStaffEntryActionContext>;
  function originalAction(action: AiRegisteredEntryAction, context: Context, orderId?: string): boolean {
    return (
      action.contractVersion === AI_REGISTERED_ENTRY_ACTION_VERSION &&
      action.audience === "staff" &&
      action.surface === "staff_miniprogram" &&
      action.scope.kind === "workspace" &&
      action.scope.tenantId === context.tenantId &&
      action.scope.workspaceId === context.workspaceId &&
      (STAFF_ORDER_ENTRY_CODES as readonly string[]).includes(action.actionCode) &&
      action.riskLevel === "R0" &&
      action.requiresConfirmation === false &&
      action.associations.taskId === null &&
      action.associations.runId === null &&
      action.associations.materialRef === null &&
      action.associations.proposalId === null &&
      action.associations.quoteId === null &&
      action.associations.bookingDraftId === null &&
      action.associations.orderId !== null &&
      (orderId === undefined || action.associations.orderId === orderId) &&
      Date.parse(action.expiresAt) > serverNow()
    );
  }
  function route(operation: "fromOrder" | "revalidate"): string {
    const base = AI_REGISTERED_ENTRY_ACTION_HTTP.staffBasePath;
    if (base !== "staff/v1/ai-native/entry-actions") throw unavailable();
    return `/${base.slice("staff/v1/".length)}/${AI_REGISTERED_ENTRY_ACTION_HTTP[operation]}`;
  }
  function matchesRevalidation(action: AiRegisteredEntryAction, result: AiRegisteredEntryActionRevalidation): boolean {
    return (
      result.contractVersion === action.contractVersion &&
      result.actionId === action.actionId &&
      result.actionCode === action.actionCode &&
      result.audience === action.audience &&
      result.surface === action.surface &&
      equal(result.scope, action.scope) &&
      equal(result.resource, action.resource) &&
      equal(result.associations, action.associations)
    );
  }
  function createStaffEntryActionApi() {
    return Object.freeze({
      async fromOrder(value: AiRegisteredEntryActionOrderSource): Promise<AiRegisteredEntryActionOrderResponse> {
        const parsed = aiRegisteredEntryActionOrderSourceSchema.safeParse(copy(value));
        if (!parsed.success || !("orderId" in parsed.data)) throw unavailable();
        const input = parsed.data,
          context = captureStaffEntryActionContext();
        const response: unknown = await request(route("fromOrder"), {
          method: "POST",
          data: input,
          timeoutMs: 15000,
          replayAfterRefresh: false,
          scope: "workspace",
        });
        if (!context.current()) throw unavailable();
        const result = aiRegisteredEntryActionOrderResponseSchema.safeParse(response);
        if (
          !result.success ||
          result.data.contractVersion !== AI_REGISTERED_ENTRY_ACTION_VERSION ||
          !("orderId" in result.data.source) ||
          result.data.source.orderId !== input.orderId ||
          result.data.orderId !== input.orderId ||
          result.data.scope.tenantId !== context.tenantId ||
          result.data.scope.workspaceId !== context.workspaceId ||
          result.data.actions.length > 23
        )
          throw unavailable();
        const actions = result.data.actions;
        if (
          actions.some((row) => !originalAction(row.action, context, input.orderId)) ||
          actions.filter((row) => row.action.actionCode === "OPEN_ORDER").length !== 1 ||
          actions.filter((row) => row.action.actionCode === "OPEN_CUSTOMER").length > 1 ||
          actions.filter((row) => row.action.actionCode === "OPEN_DISPATCH").length > 1 ||
          actions.filter((row) => row.action.actionCode === "OPEN_PRODUCT").length > 20 ||
          new Set(actions.map((row) => row.action.actionId)).size !== actions.length ||
          new Set(actions.map((row) => `${row.action.actionCode}:${row.action.resource.id}`)).size !== actions.length
        )
          throw unavailable();
        return copy(result.data);
      },
      async revalidate(value: AiRegisteredEntryActionRead): Promise<AiRegisteredEntryActionRevalidation> {
        const parsed = aiRegisteredEntryActionReadSchema.safeParse(copy(value)),
          context = captureStaffEntryActionContext();
        if (!parsed.success || !originalAction(parsed.data.action, context)) throw unavailable();
        const input = parsed.data;
        const response: unknown = await request(route("revalidate"), {
          method: "POST",
          data: input,
          timeoutMs: 15000,
          replayAfterRefresh: false,
          scope: "workspace",
        });
        if (!context.current() || !originalAction(input.action, context)) throw unavailable();
        const result = aiRegisteredEntryActionRevalidationSchema.safeParse(response);
        if (!result.success || !matchesRevalidation(input.action, result.data)) throw unavailable();
        return copy(result.data);
      },
    });
  }
  return { captureStaffEntryActionContext, createStaffEntryActionApi };
}
export type StaffEntryActionApi = ReturnType<
  ReturnType<typeof createRentalStaffEntryActionApi>["createStaffEntryActionApi"]
>;
