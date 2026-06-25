import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { SystemUserRow } from "@store-rental/shared";
import { PrismaService } from "../modules/database/prisma.service";

export interface OperationLogInput {
  tenantId?: string;
  user?: SystemUserRow;
  userId?: string;
  orderId?: string;
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
          userId: input.userId ?? input.user?.id,
          orderId: input.orderId,
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
