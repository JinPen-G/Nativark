/** 公共日志写入与敏感字段脱敏，使用原服务端ALS空间及原成功要求。
 * 日志不授予权限或证明业务提交；敏感读取必须requireSuccess，普通Web日志保留原最佳努力语义。 */
import { InternalServerErrorException } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { getRequestWorkspaceId } from "./request-identity";

export type PlatformAuditJson = string | number | boolean | null | PlatformAuditJson[] | { [key: string]: PlatformAuditJson };
export type PlatformAuditJsonObject = { [key: string]: PlatformAuditJson };

export interface PlatformOperationLogStorage {
  operationLog: {
    create(input: { data: { tenantId: string; workspaceId: string | null; userId?: string; rentalOrderId?: string; action: string; detail: PlatformAuditJsonObject } }): PromiseLike<unknown>;
  };
}

export interface OperationLogInput {
  tenantId?: string;
  user?: SystemUserRow;
  userId?: string;
  /** 兼容原审计行的可选租赁关联；公共写入不要求装配业务Core或读取业务表。 */
  rentalOrderId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  operator?: string;
  detail?: string;
  metadata?: Record<string, unknown>;
  /** Sensitive-data reads must not return data unless their audit record is durable. */
  requireSuccess?: boolean;
}

export class PlatformOperationLogService {
  constructor(protected readonly prisma: PlatformOperationLogStorage) {}

  async record(input: OperationLogInput) {
    const tenantId = input.tenantId ?? input.user?.tenantId;

    if (!tenantId) {
      if (input.requireSuccess) throw new InternalServerErrorException("敏感资料审计失败，未返回完整信息");
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
      if (input.requireSuccess) throw new InternalServerErrorException("敏感资料审计失败，未返回完整信息");
      // 审计不能阻断业务主流程；MySQL 未连接时由业务自身错误处理。
    }
  }

  protected toJsonValue(value: Record<string, unknown>): PlatformAuditJsonObject {
    return JSON.parse(JSON.stringify(value)) as PlatformAuditJsonObject;
  }

  protected maskSensitive(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.maskSensitive(item));
    }
    if (!value || typeof value !== "object") {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
        const shouldMask =
          normalizedKey.includes("password") ||
          normalizedKey.includes("token") ||
          normalizedKey.includes("apikey") ||
          normalizedKey.includes("credential") ||
          normalizedKey.includes("authorization") ||
          normalizedKey.includes("privatekey") ||
          normalizedKey.includes("encryptionkey") ||
          normalizedKey.includes("accesskey") ||
          normalizedKey.includes("baseurl") ||
          normalizedKey.includes("secret") ||
          normalizedKey.includes("phone") ||
          normalizedKey.includes("identity") ||
          normalizedKey.includes("license");

        return [key, shouldMask ? "[masked]" : this.maskSensitive(item)];
      })
    );
  }
}
