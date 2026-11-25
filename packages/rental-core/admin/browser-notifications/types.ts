/** 通知宿主供给同一会话、已注册导航及可选的原 Operator 展示与回调。 */
import type { RentalBrowserAdminSession } from "../browser";
import type { RentalOperationsApi } from "../operations/client";
import type { RentalWorkOrderApi } from "../work-orders/client";
import type { Notice } from "./model";

export type RentalNotificationAuth = ReturnType<RentalBrowserAdminSession["useAuthStore"]["getState"]>;
export type RentalNotificationApi = Pick<RentalOperationsApi, "workbenchTodos">
  & Pick<RentalWorkOrderApi, "workOrders" | "workOrderAssignees" | "assignWorkOrder">;

export interface RentalNotificationArtifact {
  kind: "brief" | "quote" | "tasks" | "schedule" | "inventory" | "customer"
    | "comparison" | "ledger" | "document" | "trend";
  title: string;
  summary: string;
  columns: string[];
  rows: string[][];
  metrics?: { label: string; value: string; note?: string }[];
  note: string;
}

export interface RentalNotificationOperator {
  threads: readonly {
    id: string;
    capabilityId: string;
    artifact?: RentalNotificationArtifact;
    running: boolean;
    receipt?: string;
    runId?: string;
    revisionRequest?: string;
  }[];
  available: readonly { id: string; action?: string }[];
  openConversation: (id: string) => void;
  confirmConversation: (id: string, runId?: string) => boolean;
  requestConversationChanges: (id: string, runId: string | undefined, note: string) => boolean;
}

export interface RentalBrowserNotificationsOptions {
  session: RentalBrowserAdminSession;
  /** 按当前权限解析已登记目标，缺目标或缺权时返回 null。 */
  resolveHref: (notice: Notice, auth: RentalNotificationAuth) => string | null;
  /** 标准 Core 宿主从当前使用目录核对登记页面，原组合宿主沿自身授权入口。 */
  hasPageAccess?: (pageId: "workbench" | "work-orders", auth: RentalNotificationAuth) => boolean;
  useOperator?: () => RentalNotificationOperator;
  aiHref?: string;
  confirmationDetails?: (artifact: RentalNotificationArtifact) => {
    description: string;
    facts: readonly { label: string; value: string }[];
  };
  /** 与宿主唯一 AdminUiProvider 的声音范围一致。 */
  soundScopeKey?: (auth: RentalNotificationAuth) => string;
}

export type RentalNotificationBindings = RentalBrowserNotificationsOptions & { api: RentalNotificationApi };
