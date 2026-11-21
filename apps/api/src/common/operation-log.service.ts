/** Original OperationLog writes. Legacy Web audit keeps its ALS/best-effort path;
 * OAuth and MCP metadata Native methods use exact scope and fail closed.
 * Logging grants no permission or business/commit outcome; callers own the transaction. */
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CoreAccessReceipt, CoreBindingReceipt } from "@rental-os/core-host";
import type { SystemUserRow } from "@rental-os/shared";
import { PrismaService } from "../modules/database/prisma.service";
import { OperationLogService as OriginalMcpOperationLogService } from "@rental-os/rental-mcp-host/operation-log";

export type { OperationLogInput } from "@rental-os/platform-server/operation-log";
export type { OriginalOAuthAuditRecord, OriginalMcpCatalogGoalAdoptionAuditRecord, OriginalMcpRequestSaveAuditRecord, OriginalMcpReadGoalAuditRecord } from "@rental-os/rental-mcp-host/operation-log";

export interface HttpMutationAuditInput {
  method: string;
  path: string;
  /** 由调用方或路径解析得出的通用租赁订单 id。 */
  rentalOrderId?: string;
  requestId?: string;
  user?: SystemUserRow;
  body?: unknown;
  status: "success" | "failed";
  durationMs: number;
  errorMessage?: string;
}

/** 已受权Core执行者提供的原操作关联，业务正文留在所属Core。 */
export interface CoreBusinessAuditInput {
  tenantId: string;
  userId: string;
  coreId: string;
  targetType: string;
  targetId: string;
  operationId: string;
  revision: number;
  fingerprint: string;
  state: string;
}

@Injectable()
export class OperationLogService extends OriginalMcpOperationLogService {
  declare protected readonly prisma: PrismaService;
  constructor(prisma: PrismaService) { super(prisma); }

  /** 当前受权Core管理事实的同事务审计。输入来自Core管理原收据，写失败沿原事务抛出。 */
  async recordCoreAccessReceipt(transaction: Prisma.TransactionClient, receipt: CoreAccessReceipt): Promise<void> {
    await transaction.operationLog.create({ data: {
      tenantId: receipt.result.tenantId,
      userId: receipt.actor.subjectId,
      workspaceId: null,
      rentalOrderId: null,
      action: `core.${receipt.kind}.changed`,
      detail: {
        operator: receipt.actor.subjectId,
        targetType: receipt.kind === "tenant_grant" ? "tenant-core-grant" : "member-core-assignment",
        targetId: receipt.result.coreId,
        metadata: { operationId: receipt.result.operationId, revision: receipt.result.revision,
          fingerprint: receipt.fingerprint, actorTenantId: receipt.actor.tenantId, state: receipt.result.state,
          ...(receipt.kind === "member_assignment" ? { memberId: receipt.result.userId } : {}) }
      }
    } });
  }

  /** 原初始化回执与绑定同事务，审计仅记录关联与修订，配置正文留所属Core。 */
  async recordCoreBindingReceipt(transaction: Prisma.TransactionClient, receipt: CoreBindingReceipt): Promise<void> {
    await transaction.operationLog.create({ data: {
      tenantId: receipt.binding.tenantId, userId: receipt.actor.subjectId, workspaceId: null, rentalOrderId: null,
      action: "core.binding.initialized",
      detail: { operator: receipt.actor.subjectId, targetType: "core-binding", targetId: receipt.binding.bindingId,
        metadata: { coreId: receipt.binding.coreId, operationId: receipt.operation.operationId, revision: receipt.binding.revision,
          dataVersion: receipt.binding.dataVersion, fingerprint: receipt.fingerprint } }
    } });
  }

  /** 原Core执行者的同事务审计，公共服务只消费关联与修订。 */
  async recordCoreBusinessReceipt(transaction: Prisma.TransactionClient, receipt: CoreBusinessAuditInput): Promise<void> {
    await transaction.operationLog.create({ data: {
      tenantId: receipt.tenantId, userId: receipt.userId, workspaceId: null, rentalOrderId: null,
      action: `core.${receipt.coreId}.changed`,
      detail: { operator: receipt.userId, targetType: receipt.targetType, targetId: receipt.targetId,
        metadata: { coreId: receipt.coreId, operationId: receipt.operationId, revision: receipt.revision,
          fingerprint: receipt.fingerprint, state: receipt.state } }
    } });
  }

  async recordHttpMutation(input: HttpMutationAuditInput) {
    const normalizedPath = this.normalizePath(input.path);
    const { targetType, targetId } = this.resolveTarget(normalizedPath);

    await this.record({
      user: input.user,
      action: this.resolveAction(input.method, normalizedPath),
      targetType,
      targetId,
      rentalOrderId: input.rentalOrderId ?? this.resolveRentalOrderId(normalizedPath),
      detail:
        input.status === "success"
          ? "接口动作执行成功"
          : `接口动作执行失败：${input.errorMessage ?? "未知错误"}`,
      metadata: {
        requestId: input.requestId,
        method: input.method,
        path: normalizedPath,
        status: input.status,
        durationMs: input.durationMs,
        body: input.body
      }
    });
  }

  private normalizePath(path: string) {
    return path.split("?")[0]?.replace(/^\/api/, "") || "/";
  }

  private resolveAction(method: string, path: string) {
    return `http.${method.toLowerCase()}.${path
      .replace(/^\/+/, "")
      .replace(/\/+/g, ".")
      .replace(/[^a-zA-Z0-9_.:-]/g, "-")}`;
  }

  private resolveTarget(path: string) {
    const parts = path.split("/").filter(Boolean);

    if (parts[0] === "platform") {
      return {
        targetType: parts[1] ?? "platform",
        targetId: parts[2]
      };
    }
    // /rental/v1/<resource>/<id>/... —— 版本段不是资源，必须跳过，
    // 否则 targetType 会变成 "rental"、targetId 变成 "v1"，审计无法按对象检索。
    if (parts[0] === "rental") {
      const resourceIndex = parts[1] && /^v\d+$/u.test(parts[1]) ? 2 : 1;
      const typeMap: Record<string, string> = {
        orders: "rental-order",
        quotes: "rental-quote",
        assets: "rental-asset",
        "item-groups": "rental-item-group",
        locations: "rental-location",
        "coupon-templates": "rental-coupon-template",
        "customer-coupons": "rental-customer-coupon",
        rewards: "rental-reward",
        "rule-versions": "rental-rule-version",
        "pricing-plans": "rental-pricing-plan",
        "notification-templates": "rental-notification-template"
      };
      const resource = parts[resourceIndex] ?? "rental";
      return {
        targetType: typeMap[resource] ?? resource,
        targetId: parts[resourceIndex + 1]
      };
    }
    if (parts[0] === "rental-os") {
      const typeMap: Record<string, string> = {
        orders: "order",
        vehicles: "vehicle",
        stations: "station",
        members: "member",
        corporates: "corporate",
        pricing: "pricing",
        dispatch: "dispatch",
        rules: "rental-rule"
      };
      return {
        targetType: typeMap[parts[1] ?? ""] ?? parts[1] ?? "rental-os",
        targetId: parts[2]
      };
    }

    return {
      targetType: parts[0] ?? "system",
      targetId: parts[1]
    };
  }

  /**
   * 从 /rental/v1/orders/<id>/... 抽出通用租赁订单 id。
   * 只认 orders 资源，避免把其他资源的 id 误填进订单外键而触发约束失败。
   */
  private resolveRentalOrderId(path: string) {
    const match = path.match(/^\/rental\/v\d+\/orders\/([^/]+)/u);
    return match ? match[1] : undefined;
  }




}
