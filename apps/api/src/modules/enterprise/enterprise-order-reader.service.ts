/** Curated enterprise order reads use original subjects and disclosure evidence.
 * Current grants and client workspace are checked before and after IO. Rental
 * policies govern new use separately. Money, stock and payment states remain Core facts. */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ENTERPRISE_ORDER_EXPORT_LIMIT, ENTERPRISE_ORDER_GROUPS, type EnterpriseOrderDetail, type EnterpriseOrderDetailResponse,
  type EnterpriseOrderExportQuery, type EnterpriseOrderExportResponse, type EnterpriseOrderGroup,
  type EnterpriseOrderIndex, type EnterpriseOrderReadScope, type EnterpriseOrdersQuery, type EnterpriseOrdersResponse } from "@rental-os/shared";
import { getRequestIdentity } from "../../common/request-identity";
import type { ClientRequestContext } from "../client/client-auth.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { PrismaService } from "../database/prisma.service";
import { rentalOrderDueAt } from "../rental-core/rental-carrier-shipment";
import { enterpriseJson } from "./enterprise-command.service";

type OriginalMembership = {
  bookingIdentity: unknown;
  personalCustomerId: unknown;
  personalCustomerName: unknown;
  corporateCustomerId: unknown;
  corporateCustomerName: unknown;
  corporateMembershipId: unknown;
  noticeVersion: unknown;
  acknowledgedAt: unknown;
};
type OrderRow = {
  id: string; tenantId: string; workspaceId: string; orderNo: string; group: EnterpriseOrderGroup;
  categoryCode: string; status: string; customerType: string; customerName: string; customerId: string | null; contractSubjectCustomerId: string | null;
  payerSubjectCustomerId: string | null; userSubjectCustomerId: string | null; membership: OriginalMembership | string;
  fulfillmentMode: string; startAt: Date; endAt: Date; effectiveEndAt: Date | null;
  actualRentalStartAt: Date | null; carrierRentalDueAt: Date | null; createdAt: Date; updatedAt: Date;
  currency: string | null; payableAmount: Prisma.Decimal | null; finalPayableAmount: Prisma.Decimal | null;
  discountAmount: Prisma.Decimal | null;
};
const reference = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9._:-]{1,191}$/u.test(value);

@Injectable()
export class EnterpriseOrderReaderService {
  constructor(private readonly prisma: PrismaService, private readonly access: EnterpriseAccessService) {}

  private principal(context: ClientRequestContext) {
    const identity = getRequestIdentity();
    if (!identity || context.customerType !== "personal" || !reference(context.workspaceId)
      || identity.tenantId !== context.tenantId || identity.userId !== context.customerId || identity.workspaceId !== context.workspaceId
      || identity.audience !== "client" || identity.isSaasAdmin || identity.staffApi || identity.dataScope !== undefined) {
      throw new ForbiddenException("企业订单仅支持当前客户及可信经营空间");
    }
    return JSON.stringify([context.tenantId, context.tenantCode, context.customerId, context.sessionId, context.workspaceId, context.workspaceCode]);
  }

  private async scope(context: ClientRequestContext, corporateId: string) {
    const principal = this.principal(context);
    if (!reference(corporateId)) throw new BadRequestException("企业引用无效");
    const grant = await this.access.requireAction(context, corporateId, "orders:read");
    // A workspace switch during a slow read must invalidate the old session view,
    // even when the administrator keeps the same corporate action grant.
    const session = await this.prisma.clientAuthSession.findFirst({
      where: { tenantId: context.tenantId, customerId: context.customerId, id: context.sessionId,
        workspaceId: context.workspaceId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { workspace: { select: { id: true, tenantId: true, code: true, name: true } } }
    });
    const workspace = session?.workspace;
    if (!workspace || workspace.tenantId !== context.tenantId || workspace.id !== context.workspaceId || workspace.code !== context.workspaceCode
      || principal !== this.principal(context)) throw new ForbiddenException("当前客户经营空间已变化");
    return { principal, grant, workspace };
  }

  private async recheck(context: ClientRequestContext, corporateId: string, before: Awaited<ReturnType<EnterpriseOrderReaderService["scope"]>>) {
    const after = await this.scope(context, corporateId);
    if (after.principal !== before.principal || after.grant.membershipId !== before.grant.membershipId
      || after.grant.permissionRevision !== before.grant.permissionRevision) throw new ForbiddenException("企业订单权限已变化，请重新读取");
  }

  private readScope(context: ClientRequestContext, corporateId: string, scope: Awaited<ReturnType<EnterpriseOrderReaderService["scope"]>>): EnterpriseOrderReadScope {
    return { apiVersion: "v1", tenantCode: context.tenantCode, corporateCustomerId: corporateId, permissionRevision: scope.grant.permissionRevision,
      workspaceId: scope.workspace.id, workspaceCode: scope.workspace.code, workspaceName: scope.workspace.name,
      coverage: "current_workspace_authorized_enterprise_orders" };
  }

  private paid(corporateId: string) {
    return Prisma.sql`((o.contractSubjectCustomerId=${corporateId} AND o.payerSubjectCustomerId=${corporateId})
      OR (o.contractSubjectCustomerId IS NULL AND o.payerSubjectCustomerId IS NULL AND o.userSubjectCustomerId IS NULL
        AND o.customerType='corporate' AND o.customerId=${corporateId}))`;
  }

  private personalBenefit(corporateId: string) {
    return Prisma.sql`(JSON_UNQUOTE(JSON_EXTRACT(o.membershipSnapshot,'$.bookingIdentity'))='enterprise_employee'
      AND JSON_UNQUOTE(JSON_EXTRACT(o.membershipSnapshot,'$.corporateCustomerId'))=${corporateId}
      AND JSON_TYPE(JSON_EXTRACT(o.membershipSnapshot,'$.enterpriseContractAndPayer'))='BOOLEAN'
      AND JSON_UNQUOTE(JSON_EXTRACT(o.membershipSnapshot,'$.enterpriseContractAndPayer'))='false'
      AND JSON_TYPE(JSON_EXTRACT(o.membershipSnapshot,'$.personalCustomerId'))='STRING'
      AND o.customerId=JSON_UNQUOTE(JSON_EXTRACT(o.membershipSnapshot,'$.personalCustomerId'))
      AND ((o.contractSubjectCustomerId=o.customerId AND o.payerSubjectCustomerId=o.customerId)
        OR (o.contractSubjectCustomerId IS NULL AND o.payerSubjectCustomerId IS NULL AND o.userSubjectCustomerId IS NULL))
      AND JSON_TYPE(JSON_EXTRACT(o.membershipSnapshot,'$.enterpriseBasis.noticeVersion'))='STRING'
      AND CHAR_LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(o.membershipSnapshot,'$.enterpriseBasis.noticeVersion')))) BETWEEN 1 AND 191
      AND JSON_TYPE(JSON_EXTRACT(o.membershipSnapshot,'$.enterpriseBasis.acknowledgedAt'))='STRING'
      AND JSON_UNQUOTE(JSON_EXTRACT(o.membershipSnapshot,'$.enterpriseBasis.acknowledgedAt')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      AND STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(o.membershipSnapshot,'$.enterpriseBasis.acknowledgedAt')),'%Y-%m-%dT%H:%i:%s.%fZ')<=o.createdAt)`;
  }

  private predicate(context: ClientRequestContext, corporateId: string, group?: EnterpriseOrderGroup, keyword?: string) {
    const paid = this.paid(corporateId), benefit = this.personalBenefit(corporateId);
    const responsibility = group === "enterprise_paid" ? paid : group === "personal_benefit" ? benefit : Prisma.sql`(${paid} OR ${benefit})`;
    const search = keyword ? Prisma.sql`AND (LOCATE(${keyword},o.orderNo)>0
      OR LOCATE(${keyword},JSON_UNQUOTE(JSON_EXTRACT(o.membershipSnapshot,'$.personalCustomerName')))>0
      OR (o.customerType='personal' AND o.customerId=o.userSubjectCustomerId AND LOCATE(${keyword},o.customerName)>0)
      OR EXISTS (SELECT 1 FROM rental_order_lines line WHERE line.orderId=o.id AND LOCATE(${keyword},line.itemGroupName)>0))` : Prisma.empty;
    // The same visibility predicate applies before count, search and pagination.
    // Historical employees need no present-day relationship to remain in the index.
    return Prisma.sql`o.tenantId=${context.tenantId} AND o.workspaceId=${context.workspaceId}
      AND EXISTS (SELECT 1 FROM business_workspaces workspace WHERE workspace.tenantId=o.tenantId AND workspace.id=o.workspaceId)
      AND ${responsibility} ${search}`;
  }

  private columns(corporateId: string) {
    return Prisma.sql`o.id,o.tenantId,o.workspaceId,o.orderNo,o.categoryCode,o.status,o.customerType,o.customerName,o.customerId,
      o.contractSubjectCustomerId,o.payerSubjectCustomerId,o.userSubjectCustomerId,
      CASE WHEN ${this.paid(corporateId)} THEN 'enterprise_paid' ELSE 'personal_benefit' END AS \`group\`,
      JSON_OBJECT('bookingIdentity',JSON_EXTRACT(o.membershipSnapshot,'$.bookingIdentity'),
        'personalCustomerId',JSON_EXTRACT(o.membershipSnapshot,'$.personalCustomerId'),
        'personalCustomerName',JSON_EXTRACT(o.membershipSnapshot,'$.personalCustomerName'),
        'corporateCustomerId',JSON_EXTRACT(o.membershipSnapshot,'$.corporateCustomerId'),
        'corporateCustomerName',JSON_EXTRACT(o.membershipSnapshot,'$.corporateCustomerName'),
        'corporateMembershipId',JSON_EXTRACT(o.membershipSnapshot,'$.corporateMembershipId'),
        'noticeVersion',JSON_EXTRACT(o.membershipSnapshot,'$.enterpriseBasis.noticeVersion'),
        'acknowledgedAt',JSON_EXTRACT(o.membershipSnapshot,'$.enterpriseBasis.acknowledgedAt')) AS membership,
      o.fulfillmentMode,o.startAt,o.endAt,o.effectiveEndAt,o.actualRentalStartAt,o.carrierRentalDueAt,
      o.currency,o.payableAmount,o.finalPayableAmount,o.discountAmount,o.createdAt,o.updatedAt`;
  }

  private money(value: Prisma.Decimal | number | string | null | undefined) {
    if (value === null || value === undefined) return null;
    if (typeof value !== "number" && typeof value !== "string" && !(value instanceof Prisma.Decimal)
      || typeof value === "string" && !/^-?\d+(?:\.\d+)?$/u.test(value)) throw new ServiceUnavailableException("原订单金额类型不可核对");
    const amount = Number(value);
    if (!Number.isFinite(amount)) throw new ServiceUnavailableException("原订单金额不可核对");
    return amount;
  }

  private text(value: unknown, maximum = 191): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string" || value.length > maximum) throw new ServiceUnavailableException("原订单展示字段不可核对");
    return value;
  }

  private membership(row: OrderRow): OriginalMembership {
    const snapshot = enterpriseJson(row.membership);
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new ServiceUnavailableException("原企业身份快照不可核对");
    return snapshot;
  }

  private fields(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ServiceUnavailableException("原订单费用字段不可核对");
    return value as Record<string, unknown>;
  }

  private charges(value: unknown, includeGuarantees: boolean): EnterpriseOrderDetail["chargeLines"] {
    const rows = enterpriseJson(value);
    if (!Array.isArray(rows) || rows.length > 1000) throw new ServiceUnavailableException("原订单费用快照不可核对");
    return rows.map(row => {
      const charge = this.fields(row);
      const code = this.text(charge.code), name = this.text(charge.name, 500), type = this.text(charge.type);
      if (!code || !name || !type) throw new ServiceUnavailableException("原订单费用字段缺失");
      if (!["rental", "calendar_adjustment", "fulfillment", "preauthorization", "discount", "coupon", "service", "deposit",
        "cancellation", "overdue", "damage", "extension", "early_return_refund", "order_change"].includes(type)) {
        throw new ServiceUnavailableException("原订单费用类型尚无企业投影");
      }
      return { code, name, type, amount: this.money(charge.amount as number | null) };
    }).filter(charge => includeGuarantees || !["deposit", "preauthorization"].includes(charge.type));
  }

  private benefits(value: unknown, includeGuarantees: boolean): EnterpriseOrderDetail["corporateBenefits"] {
    if (value === null || value === undefined) return null;
    const rows = enterpriseJson(value);
    if (!Array.isArray(rows) || rows.length > 200) throw new ServiceUnavailableException("原企业权益快照不可核对");
    const scopes = includeGuarantees ? ["rental", "service", "deposit", "preauthorization"] : ["rental", "service"];
    return rows.map(row => this.fields(row)).filter(benefit => benefit.source === "corporate" && scopes.includes(String(benefit.appliesTo)))
      .map(benefit => {
        const planName = this.text(benefit.planName), type = this.text(benefit.type), appliesTo = this.text(benefit.appliesTo);
        if (!planName || !type || !appliesTo) throw new ServiceUnavailableException("原企业权益字段缺失");
        return { planName, type, appliesTo, appliedAmount: this.money(benefit.appliedAmount as number | null) };
      });
  }

  private view(context: ClientRequestContext, corporateId: string, row: OrderRow): EnterpriseOrderIndex {
    if (row.tenantId !== context.tenantId || row.workspaceId !== context.workspaceId || !reference(row.id)
      || !ENTERPRISE_ORDER_GROUPS.includes(row.group)) throw new NotFoundException("受权企业订单不存在");
    const snapshot = this.membership(row);
    const originalPersonal = row.customerType === "personal" && row.customerId !== null && row.userSubjectCustomerId === row.customerId;
    const personId = reference(snapshot.personalCustomerId) ? snapshot.personalCustomerId : originalPersonal ? row.customerId : null;
    const legacySubjects = row.contractSubjectCustomerId === null && row.payerSubjectCustomerId === null && row.userSubjectCustomerId === null;
    const originalUser = personId && (row.userSubjectCustomerId === personId || legacySubjects && row.customerId === personId);
    const userName = this.text(snapshot.personalCustomerName) ?? (originalPersonal && row.customerId === personId ? this.text(row.customerName) : null);
    return { orderId: row.id, orderNo: row.orderNo, group: row.group, categoryCode: row.categoryCode, status: row.status.toLowerCase(),
      employeeCustomerId: originalUser ? personId : null, employeeName: originalUser ? userName : null,
      corporateMembershipId: snapshot.corporateCustomerId === corporateId && reference(snapshot.corporateMembershipId) ? snapshot.corporateMembershipId : null,
      startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString(), effectiveEndAt: row.effectiveEndAt?.toISOString() ?? null,
      currentReturnAt: rentalOrderDueAt(row),
      currency: this.text(row.currency, 8), payableAmount: this.money(row.payableAmount), finalPayableAmount: this.money(row.finalPayableAmount),
      discountAmount: this.money(row.discountAmount), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  async list(inputContext: ClientRequestContext, corporateId: string, query: EnterpriseOrdersQuery = {}): Promise<EnterpriseOrdersResponse> {
    const context = structuredClone(inputContext), group = query.group ?? "enterprise_paid";
    if (query.keyword !== undefined && typeof query.keyword !== "string") throw new BadRequestException("订单搜索关键词无效");
    const page = query.page ?? 1, pageSize = query.pageSize ?? 20, keyword = query.keyword?.trim();
    if (!ENTERPRISE_ORDER_GROUPS.includes(group) || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000
      || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50 || keyword && keyword.length > 120) throw new BadRequestException("企业订单查询参数无效");
    const scope = await this.scope(context, corporateId), where = this.predicate(context, corporateId, group, keyword);
    const result = await this.prisma.$transaction(async tx => {
      const count = await tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*) AS total FROM rental_orders o WHERE ${where}`);
      const total = Number(count[0]?.total);
      if (count.length !== 1 || !Number.isSafeInteger(total) || total < 0) throw new ServiceUnavailableException("企业订单计数不可核对");
      const rows = await tx.$queryRaw<OrderRow[]>(Prisma.sql`SELECT ${this.columns(corporateId)} FROM rental_orders o WHERE ${where}
        ORDER BY o.createdAt DESC,o.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
      return { total, items: rows.map(row => this.view(context, corporateId, row)) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    await this.recheck(context, corporateId, scope);
    return { ...this.readScope(context, corporateId, scope), group, page, pageSize, ...result };
  }

  async detail(inputContext: ClientRequestContext, corporateId: string, orderId: string): Promise<EnterpriseOrderDetailResponse> {
    const context = structuredClone(inputContext);
    if (!reference(orderId)) throw new BadRequestException("订单引用无效");
    const scope = await this.scope(context, corporateId), where = this.predicate(context, corporateId);
    const order = await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<OrderRow[]>(Prisma.sql`SELECT ${this.columns(corporateId)} FROM rental_orders o WHERE ${where} AND o.id=${orderId} LIMIT 1`);
      const row = rows[0];
      if (!row) throw new NotFoundException("受权企业订单不存在");
      const index = this.view(context, corporateId, row), snapshot = this.membership(row);
      const original = await tx.rentalOrder.findFirst({ where: { tenantId: context.tenantId, workspaceId: context.workspaceId, id: orderId },
        select: { fulfillmentMode: true, rentalAmount: true, serviceAmount: true, fulfillmentAmount: true, couponAmount: true, adjustmentAmount: true,
          taxAmount: true, depositAmount: true, preAuthAmount: true, legacyDepositUnverified: true, chargeLines: true, membershipBenefitEvaluations: true,
          lines: { take: 201, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, itemGroupName: true, pricingGroupName: true,
            quantity: true, cancelledQuantity: true, amount: true } } } });
      if (!original || original.lines.length > 200) throw new ServiceUnavailableException("原订单明细超出有界读取范围或缺失");
      const noticeVersion = this.text(snapshot.noticeVersion), acknowledgedAt = this.text(snapshot.acknowledgedAt, 24);
      const disclosure = noticeVersion && acknowledgedAt && Number.isFinite(new Date(acknowledgedAt).getTime())
        && new Date(acknowledgedAt).toISOString() === acknowledgedAt && new Date(acknowledgedAt) <= row.createdAt ? { noticeVersion, acknowledgedAt } : null;
      if (row.group === "personal_benefit" && !disclosure) throw new NotFoundException("原企业自费订单告知依据不可核对");
      const paid = row.group === "enterprise_paid";
      if (typeof original.legacyDepositUnverified !== "boolean") throw new ServiceUnavailableException("原保证金依据不可核对");
      const guaranteeRecorded = paid && !original.legacyDepositUnverified;
      const legacyCompany = row.customerType === "corporate" && row.customerId === corporateId && row.contractSubjectCustomerId === null
        && row.payerSubjectCustomerId === null && row.userSubjectCustomerId === null;
      return { ...index, corporateName: snapshot.corporateCustomerId === corporateId ? this.text(snapshot.corporateCustomerName)
          : legacyCompany ? this.text(row.customerName) : null,
        fulfillmentMode: original.fulfillmentMode, rentalAmount: this.money(original.rentalAmount), serviceAmount: this.money(original.serviceAmount),
        fulfillmentAmount: this.money(original.fulfillmentAmount), couponAmount: this.money(original.couponAmount), adjustmentAmount: this.money(original.adjustmentAmount),
        taxAmount: this.money(original.taxAmount), depositAmount: guaranteeRecorded ? this.money(original.depositAmount) : null, preAuthAmount: guaranteeRecorded ? this.money(original.preAuthAmount) : null,
        disclosure, lines: original.lines.map(line => ({ lineId: line.id, itemGroupName: line.itemGroupName, pricingGroupName: line.pricingGroupName,
          quantity: line.quantity, cancelledQuantity: line.cancelledQuantity, amount: this.money(line.amount) })),
        chargeLines: this.charges(original.chargeLines, guaranteeRecorded),
        corporateBenefits: this.benefits(original.membershipBenefitEvaluations, guaranteeRecorded) } satisfies EnterpriseOrderDetail;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    await this.recheck(context, corporateId, scope);
    return { ...this.readScope(context, corporateId, scope), order };
  }

  async exportRows(inputContext: ClientRequestContext, corporateId: string, query: EnterpriseOrderExportQuery = {}): Promise<EnterpriseOrderExportResponse> {
    const context = structuredClone(inputContext), group = query.group ?? "enterprise_paid";
    if (!ENTERPRISE_ORDER_GROUPS.includes(group) || query.keyword !== undefined && (typeof query.keyword !== "string" || query.keyword.length > 120)) {
      throw new BadRequestException("企业订单导出条件无效");
    }
    const scope = await this.scope(context, corporateId);
    const exportGrant = await this.access.requireAction(context, corporateId, "export:create");
    if (exportGrant.membershipId !== scope.grant.membershipId || exportGrant.permissionRevision !== scope.grant.permissionRevision) {
      throw new ForbiddenException("企业导出授权已变化");
    }
    const where = this.predicate(context, corporateId, group, query.keyword?.trim());
    const items = await this.prisma.$transaction(async tx => {
      // A single snapshot supplies the complete applied filter. The probe rejects
      // oversized exports without combining changing pages or sending partial rows.
      const rows = await tx.$queryRaw<OrderRow[]>(Prisma.sql`SELECT ${this.columns(corporateId)} FROM rental_orders o WHERE ${where}
        ORDER BY o.createdAt DESC,o.id DESC LIMIT ${ENTERPRISE_ORDER_EXPORT_LIMIT + 1}`);
      if (rows.length > ENTERPRISE_ORDER_EXPORT_LIMIT) throw new BadRequestException(`每次最多导出 ${ENTERPRISE_ORDER_EXPORT_LIMIT} 条，请缩小筛选范围`);
      return rows.map(row => this.view(context, corporateId, row));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    await this.recheck(context, corporateId, scope);
    const latestExport = await this.access.requireAction(context, corporateId, "export:create");
    if (latestExport.membershipId !== exportGrant.membershipId || latestExport.permissionRevision !== exportGrant.permissionRevision) {
      throw new ForbiddenException("企业导出授权已撤销");
    }
    return { ...this.readScope(context, corporateId, scope), group, items, total: items.length, maxRows: ENTERPRISE_ORDER_EXPORT_LIMIT };
  }
}
