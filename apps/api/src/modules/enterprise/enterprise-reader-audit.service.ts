/** Durable enterprise read metadata uses the original operation log. Current
 * client grants fence response delivery and the curated workspace audit page. */
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  ENTERPRISE_READER_AUDIT_ACTIONS, enterpriseReaderAuditEntrySnapshot,
  type EnterpriseManagedCorporate, type EnterprisePortalAction, type EnterpriseReaderAuditAction, type EnterpriseReaderAuditEntry, type EnterpriseReaderAuditPage
} from "@rental-os/shared";
import { OperationLogService } from "../../common/operation-log.service";
import { getRequestIdentity } from "../../common/request-identity";
import type { ClientRequestContext } from "../client/client-auth.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { PrismaService } from "../database/prisma.service";
import { enterpriseHash, enterpriseJson } from "./enterprise-command.service";

const permissions: Record<EnterpriseReaderAuditAction, readonly EnterprisePortalAction[]> = {
  "orders.list": ["orders:read"],
  "orders.detail": ["orders:read"],
  "orders.export": ["orders:read", "export:create"],
  "finance.account.read": ["finance:read"],
  "finance.account.export": ["finance:read", "export:create"],
  "finance.order.read": ["finance:read", "orders:read"],
  "finance.order.export": ["finance:read", "orders:read", "export:create"]
};
const reference = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9._:-]{1,191}$/u.test(value);
interface Projection {
  corporateCustomerId: string;
  permissionRevision: string;
}
interface Cursor { at: string; id: string; scope: string }
interface AuditRow {
  id: string; tenantId: string; workspaceId: string | null; userId: string | null;
  rentalOrderId: string | null; action: string; detail: unknown; createdAt: Date;
}

export class EnterpriseReaderAuditService {
  private readonly log: OperationLogService;
  constructor(private readonly prisma: PrismaService, private readonly access: EnterpriseAccessService) {
    this.log = new OperationLogService(prisma);
  }

  private assertIdentity(context: ClientRequestContext) {
    const current = getRequestIdentity();
    if (context.customerType !== "personal" || !reference(context.tenantId) || !reference(context.customerId)
      || !reference(context.workspaceId) || !reference(context.workspaceCode) || !current
      || current.audience !== "client" || current.isSaasAdmin || current.staffApi || current.dataScope !== undefined
      || current.tenantId !== context.tenantId || current.userId !== context.customerId || current.workspaceId !== context.workspaceId) {
      throw new ForbiddenException("企业读取审计须当前客户经营空间身份");
    }
  }

  async record(inputContext: ClientRequestContext, corporateId: string, action: EnterpriseReaderAuditAction,
    objectId: string, group: EnterpriseReaderAuditEntry["group"], itemCount: number, projection: Projection): Promise<void> {
    const context = Object.freeze({ ...inputContext });
    this.assertIdentity(context);
    const required = permissions[action];
    const before = await this.access.requireWorkspaceAction(context, corporateId, required[0]);
    if (required.some(permission => !before.actions.includes(permission)) || projection.corporateCustomerId !== corporateId
      || projection.permissionRevision !== before.permissionRevision) throw new ForbiddenException("企业读取审计授权已变化");
    const event = enterpriseReaderAuditEntrySnapshot({
      receiptId: randomUUID(), actorCustomerId: context.customerId, membershipId: before.membershipId,
      permissionRevision: before.permissionRevision, action, objectId, group, itemCount,
      projectionHash: enterpriseHash(projection), state: "authorized_projection_prepared", createdAt: new Date().toISOString()
    });
    if (!event) throw new ServiceUnavailableException("企业读取审计元数据不可核对");
    this.assertIdentity(context);
    await this.log.record({
      tenantId: context.tenantId, action: `enterprise.reader.${action}`, targetType: "enterprise-reader", targetId: objectId,
      rentalOrderId: ["orders.detail", "finance.order.read", "finance.order.export"].includes(action) ? objectId : undefined,
      operator: `customer:${context.customerId}`, requireSuccess: true,
      metadata: { version: "v1", corporateCustomerId: corporateId, workspaceCode: context.workspaceCode, ...event }
    });
    // The append can succeed even when response delivery later fails. Retain that
    // original preparation event and discard data if grants changed during IO.
    const after = await this.access.requireWorkspaceAction(context, corporateId, required[0]);
    this.assertIdentity(context);
    if (after.membershipId !== before.membershipId || after.permissionRevision !== before.permissionRevision
      || required.some(permission => !after.actions.includes(permission)) || enterpriseHash(projection) !== event.projectionHash) {
      throw new ForbiddenException("企业读取审计后权限或原投影已变化");
    }
  }

  private cursor(value: string | undefined, scope: string): Cursor | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,512}$/u.test(value)) throw new BadRequestException("企业读取审计游标无效");
    let cursor: Cursor;
    try {
      const bytes = Buffer.from(value, "base64url");
      if (bytes.toString("base64url") !== value) throw new Error("cursor encoding");
      cursor = JSON.parse(bytes.toString("utf8")) as Cursor;
    } catch { throw new BadRequestException("企业读取审计游标无效"); }
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || Object.keys(cursor).length !== 3
      || !reference(cursor.id) || cursor.scope !== scope || typeof cursor.at !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(cursor.at)
      || !Number.isFinite(Date.parse(cursor.at)) || new Date(cursor.at).toISOString() !== cursor.at) {
      throw new BadRequestException("企业读取审计游标与当前范围不一致");
    }
    return cursor;
  }

  async read(inputContext: ClientRequestContext, corporateId: string,
    expected: Pick<EnterpriseManagedCorporate, "membershipId" | "permissionRevision">, readerCursor?: string): Promise<EnterpriseReaderAuditPage> {
    const context = Object.freeze({ ...inputContext });
    this.assertIdentity(context);
    const before = await this.access.requireWorkspaceAction(context, corporateId, "audit:read");
    if (before.membershipId !== expected.membershipId || before.permissionRevision !== expected.permissionRevision) {
      throw new ForbiddenException("企业审计与读取记录权限修订不一致");
    }
    const actions = ENTERPRISE_READER_AUDIT_ACTIONS.filter(action => permissions[action]
      .filter(permission => permission !== "export:create").every(permission => before.actions.includes(permission)));
    const scope = enterpriseHash({ tenantId: context.tenantId, corporateId, workspaceId: context.workspaceId });
    const cursor = this.cursor(readerCursor, scope);
    const rows = actions.length ? await this.prisma.$queryRaw<AuditRow[]>(Prisma.sql`
      SELECT id,tenantId,workspaceId,userId,rentalOrderId,action,detail,createdAt FROM OperationLog
      WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND userId IS NULL
        AND action IN (${Prisma.join(actions.map(action => `enterprise.reader.${action}`))})
        AND JSON_UNQUOTE(JSON_EXTRACT(detail,'$.targetType'))='enterprise-reader'
        AND JSON_UNQUOTE(JSON_EXTRACT(detail,'$.metadata.version'))='v1'
        AND JSON_UNQUOTE(JSON_EXTRACT(detail,'$.metadata.corporateCustomerId'))=${corporateId}
        ${cursor ? Prisma.sql`AND (createdAt<${new Date(cursor.at)} OR (createdAt=${new Date(cursor.at)} AND id<${cursor.id}))` : Prisma.empty}
      ORDER BY createdAt DESC,id DESC LIMIT 51`) : [];
    const after = await this.access.requireWorkspaceAction(context, corporateId, "audit:read");
    this.assertIdentity(context);
    if (before.membershipId !== after.membershipId || before.permissionRevision !== after.permissionRevision
      || actions.some(action => permissions[action].some(permission => permission !== "export:create" && !after.actions.includes(permission)))) {
      throw new ForbiddenException("企业读取审计查看授权已变化");
    }
    if (rows.length > 51 || new Set(rows.map(row => row.id)).size !== rows.length) throw new ConflictException("企业读取审计分页不可核对");
    const items = rows.slice(0, 50).map(row => {
      const invalid = () => new ConflictException("原企业读取审计关联不可核对");
      let detail: { operator?: unknown; targetType?: unknown; targetId?: unknown; metadata?: Record<string, unknown> };
      try { detail = enterpriseJson(row.detail) as typeof detail; } catch { throw invalid(); }
      if (row.tenantId !== context.tenantId || row.workspaceId !== context.workspaceId || row.userId !== null
        || !reference(row.id) || !Number.isFinite(row.createdAt?.getTime()) || !detail || typeof detail !== "object"
        || Array.isArray(detail) || !detail.metadata || typeof detail.metadata !== "object" || Array.isArray(detail.metadata)
        || detail.targetType !== "enterprise-reader" || detail.metadata.version !== "v1"
        || detail.metadata.corporateCustomerId !== corporateId || detail.metadata.workspaceCode !== context.workspaceCode) throw invalid();
      const item = enterpriseReaderAuditEntrySnapshot({ ...detail.metadata, createdAt: row.createdAt.toISOString() });
      if (!item || !actions.includes(item.action) || row.action !== `enterprise.reader.${item.action}`
        || detail.operator !== `customer:${item.actorCustomerId}` || detail.targetId !== item.objectId
        || (["orders.detail", "finance.order.read", "finance.order.export"].includes(item.action) ? row.rentalOrderId !== item.objectId : row.rentalOrderId !== null)
        || ["orders.list", "orders.export", "finance.account.read", "finance.account.export"].includes(item.action) && item.objectId !== corporateId) throw invalid();
      return item;
    });
    if (new Set(items.map(item => item.receiptId)).size !== items.length) throw new ConflictException("企业读取审计原收据重复");
    const last = rows[49];
    return {
      coverage: "original_current_workspace_reader_projections", workspaceCode: context.workspaceCode!, items,
      nextCursor: rows.length > 50 ? Buffer.from(JSON.stringify({ at: last.createdAt.toISOString(), id: last.id, scope })).toString("base64url") : null,
      unavailable: ["uncaptured_reader_history"]
    };
  }
}
