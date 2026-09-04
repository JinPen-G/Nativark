import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { SystemUserRow } from "@store-rental/shared";
import { PrismaService } from "../modules/database/prisma.service";
import { getRequestWorkspaceId } from "./request-identity";

export interface OperationLogInput {
  tenantId?: string;
  user?: SystemUserRow;
  userId?: string;
  /** 租赁订单（rental_orders）。 */
  rentalOrderId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  operator?: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}

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

@Injectable()
export class OperationLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: OperationLogInput) {
    const tenantId = input.tenantId ?? input.user?.tenantId;

    if (!tenantId) {
      return;
    }

    try {
      await this.prisma.operationLog.create({
        data: {
          tenantId,
          // SPACE-03：经营空间归属取自**会话**，不接受调用方传入，也不回退默认空间。
          // 平台域动作（租户创建/冻结、平台配置）本就没有空间，留 NULL 表示"不属于
          // 任何经营空间"——比塞一个看似精确的假归属诚实。
          workspaceId: getRequestWorkspaceId() ?? null,
          userId: input.userId ?? input.user?.id,
          rentalOrderId: input.rentalOrderId,
          action: input.action,
          detail: this.toJsonValue({
            operator:
              input.operator ??
              input.user?.displayName ??
              input.user?.account ??
              "系统",
            targetType: input.targetType,
            targetId: input.targetId,
            detail: input.detail,
            metadata: this.maskSensitive(input.metadata ?? {})
          })
        }
      });
    } catch {
      // 审计不能阻断业务主流程；MySQL 未连接时由业务自身错误处理。
    }
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
    if (parts[0] === "store-rental") {
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
        targetType: typeMap[parts[1] ?? ""] ?? parts[1] ?? "store-rental",
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

  private toJsonValue(value: Record<string, unknown>): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private maskSensitive(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.maskSensitive(item));
    }
    if (!value || typeof value !== "object") {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        const normalizedKey = key.toLowerCase();
        const shouldMask =
          normalizedKey.includes("password") ||
          normalizedKey.includes("token") ||
          normalizedKey.includes("apikey") ||
          normalizedKey.includes("api_key") ||
          normalizedKey.includes("secret") ||
          normalizedKey.includes("phone") ||
          normalizedKey.includes("identity") ||
          normalizedKey.includes("license");

        return [key, shouldMask ? "[masked]" : this.maskSensitive(item)];
      })
    );
  }
}
