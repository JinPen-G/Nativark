/** Core-owned historical and financial facts for the current client workspace.
 * Reuses the original enterprise qualifier and rechecks the client session
 * around IO. Does not grant cross-workspace history, mutate money, fabricate
 * statements or borrow an operator identity. */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CustomerCorporateCreditAccountSummary,
  RentalEnterpriseCorporateFinancialProjection, RentalEnterpriseHistoryWorkspaceBasis,
  RentalEnterpriseOrderFinancialProjection, RentalFundingBalance } from "@rental-os/shared";
import { getRequestIdentity } from "../../common/request-identity";
import type { ClientRequestContext } from "../client/client-auth.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import type { PrismaService } from "../database/prisma.service";
import { lockRentalBusinessTenant } from "./rental-business-fence";
import { readCorporateCreditLedger } from "./rental-corporate-ledger-reader";
import { corporateOrderPaid, corporatePaymentReceipts } from "./rental-corporate-payment-receipt";
import { roundMoney } from "./rental-money";

type ReadAction = "orders:read" | "finance:read";
export interface EnterpriseCoreFundingSource {
  listEvents(tenantId: string, workspaceId: string, orderId: string, tx?: Prisma.TransactionClient,
    options?: { realOnly?: boolean }): Promise<RentalFundingBalance>;
}
export interface EnterpriseCoreCreditAccountSource {
  account(tenantId: string, customerId: string, tx?: Prisma.TransactionClient): Promise<CustomerCorporateCreditAccountSummary>;
}
type Scope = { principal: string; membershipId: string; permissionRevision: string };
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
const unavailableStatements = () => ({ state: "unavailable" as const, reason: "formal_statement_provider_not_implemented" as const });

/** Compose with the original EnterpriseAccessService, RentalFundingService and
 * CustomerCorporateSettlementService. No permissive default is provided. */
export class RentalEnterpriseReadPort {
  private readonly authorization: EnterpriseAccessService;
  constructor(private readonly prisma: PrismaService,
    private readonly funding?: EnterpriseCoreFundingSource, private readonly credit?: EnterpriseCoreCreditAccountSource) {
    // Use the original database-backed qualifier, not a caller-provided action
    // callback whose returned grant could authorize itself.
    this.authorization = new EnterpriseAccessService(prisma);
  }

  private principal(context: ClientRequestContext) {
    const identity = getRequestIdentity();
    if (!identity || context.customerType !== "personal" || identity.audience !== "client" || identity.isSaasAdmin
      || identity.staffApi || identity.dataScope !== undefined || identity.tenantId !== context.tenantId
      || identity.userId !== context.customerId || identity.workspaceId !== context.workspaceId
      || ![context.tenantId, context.tenantCode, context.customerId, context.sessionId, context.workspaceId, context.workspaceCode].every(validId)) {
      throw new ForbiddenException("企业Core读取缺少原客户身份与当前空间");
    }
    return JSON.stringify([context.tenantId, context.tenantCode, context.customerId, context.sessionId,
      context.workspaceId, context.workspaceCode]);
  }

  private async scope(context: ClientRequestContext, corporateId: string, actions: readonly ReadAction[]): Promise<Scope> {
    const principal = this.principal(context);
    if (!validId(corporateId)) throw new BadRequestException("企业引用无效");
    let scope: Scope | undefined;
    for (const action of actions) {
      const grant = await this.authorization.requireAction(context, corporateId, action);
      if (!grant || grant.corporateCustomerId !== corporateId || !validId(grant.membershipId)
        || typeof grant.permissionRevision !== "string" || !grant.permissionRevision || !Array.isArray(grant.actions)
        || !grant.actions.includes(action) || !grant.actions.includes("portal:enter")) throw new ForbiddenException("企业读取资格来源不可核对");
      if (scope && (scope.membershipId !== grant.membershipId || scope.permissionRevision !== grant.permissionRevision)) {
        throw new ForbiddenException("企业读取资格在核对期间变化");
      }
      scope = { principal, membershipId: grant.membershipId, permissionRevision: grant.permissionRevision };
    }
    const session = await this.prisma.clientAuthSession.findFirst({ where: { id: context.sessionId, tenantId: context.tenantId,
      customerId: context.customerId, workspaceId: context.workspaceId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { workspace: { select: { id: true, tenantId: true, code: true, status: true } } } });
    if (!scope || !session?.workspace || session.workspace.id !== context.workspaceId
      || session.workspace.tenantId !== context.tenantId || session.workspace.code !== context.workspaceCode
      || session.workspace.status !== "ACTIVE" || this.principal(context) !== principal) throw new ForbiddenException("企业读取期间原客户会话已变化");
    return scope;
  }

  private async recheck(context: ClientRequestContext, corporateId: string, actions: readonly ReadAction[], before: Scope) {
    // This fresh authorization read is outside the business snapshot. A
    // repeatable-read snapshot must not preserve revoked grants for the reply.
    const after = await this.scope(context, corporateId, actions);
    if (after.principal !== before.principal || after.membershipId !== before.membershipId
      || after.permissionRevision !== before.permissionRevision) throw new ForbiddenException("企业Core读取资格已变化");
  }

  private paid(corporateId: string) {
    return Prisma.sql`((CAST(o.contractSubjectCustomerId AS BINARY)=CAST(${corporateId} AS BINARY)
      AND CAST(o.payerSubjectCustomerId AS BINARY)=CAST(${corporateId} AS BINARY))
      OR (o.contractSubjectCustomerId IS NULL AND o.payerSubjectCustomerId IS NULL AND o.userSubjectCustomerId IS NULL
        AND o.customerType='corporate' AND CAST(o.customerId AS BINARY)=CAST(${corporateId} AS BINARY)))`;
  }

  private personalBenefit(corporateId: string) {
    return Prisma.sql`(JSON_UNQUOTE(JSON_EXTRACT(o.membershipSnapshot,'$.bookingIdentity'))='enterprise_employee'
      AND CAST(JSON_UNQUOTE(JSON_EXTRACT(o.membershipSnapshot,'$.corporateCustomerId')) AS BINARY)=CAST(${corporateId} AS BINARY)
      AND JSON_TYPE(JSON_EXTRACT(o.membershipSnapshot,'$.enterpriseContractAndPayer'))='BOOLEAN'
      AND JSON_UNQUOTE(JSON_EXTRACT(o.membershipSnapshot,'$.enterpriseContractAndPayer'))='false'
      AND JSON_TYPE(JSON_EXTRACT(o.membershipSnapshot,'$.personalCustomerId'))='STRING'
      AND CAST(o.customerId AS BINARY)=CAST(JSON_UNQUOTE(JSON_EXTRACT(o.membershipSnapshot,'$.personalCustomerId')) AS BINARY)
      AND ((o.contractSubjectCustomerId=o.customerId AND o.payerSubjectCustomerId=o.customerId)
        OR (o.contractSubjectCustomerId IS NULL AND o.payerSubjectCustomerId IS NULL AND o.userSubjectCustomerId IS NULL))
      AND JSON_TYPE(JSON_EXTRACT(o.membershipSnapshot,'$.enterpriseBasis.noticeVersion'))='STRING'
      AND CHAR_LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(o.membershipSnapshot,'$.enterpriseBasis.noticeVersion')))) BETWEEN 1 AND 191
      AND JSON_TYPE(JSON_EXTRACT(o.membershipSnapshot,'$.enterpriseBasis.acknowledgedAt'))='STRING'
      AND JSON_UNQUOTE(JSON_EXTRACT(o.membershipSnapshot,'$.enterpriseBasis.acknowledgedAt')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      AND STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(o.membershipSnapshot,'$.enterpriseBasis.acknowledgedAt')),'%Y-%m-%dT%H:%i:%s.%fZ')<=o.createdAt)`;
  }

  async historicalWorkspaceBasis(context: ClientRequestContext, corporateId: string): Promise<RentalEnterpriseHistoryWorkspaceBasis> {
    const subject = Object.freeze({ ...context }), actions = ["orders:read"] as const;
    const before = await this.scope(subject, corporateId, actions);
    const workspaces = await this.prisma.$queryRaw<Array<{ workspaceId: string; workspaceCode: string; workspaceName: string }>>(Prisma.sql`
      SELECT DISTINCT w.id AS workspaceId,w.code AS workspaceCode,w.name AS workspaceName
      FROM rental_orders o JOIN business_workspaces w ON w.tenantId=o.tenantId AND w.id=o.workspaceId AND w.status='ACTIVE'
      WHERE o.tenantId=${subject.tenantId} AND CAST(o.workspaceId AS BINARY)=CAST(${subject.workspaceId} AS BINARY)
        AND (${this.paid(corporateId)} OR ${this.personalBenefit(corporateId)})
      ORDER BY w.id LIMIT 251`);
    if (workspaces.length > 1 || new Set(workspaces.map(row => row.workspaceId)).size !== workspaces.length
      || workspaces.some(row => row.workspaceId !== subject.workspaceId || row.workspaceCode !== subject.workspaceCode
        || typeof row.workspaceName !== "string" || row.workspaceName.length > 191)) throw new ConflictException("企业历史空间依据超出完整读取范围或来源不一致");
    await this.recheck(subject, corporateId, actions, before);
    return { apiVersion: "v1", corporateCustomerId: corporateId, permissionRevision: before.permissionRevision,
      observedAt: new Date().toISOString(), source: "original_enterprise_order_subjects", coverage: "current_trusted_workspace_only",
      crossWorkspaceRead: { state: "unavailable", reason: "authoritative_enterprise_history_space_scope_not_connected" }, workspaces };
  }

  private amount(value: unknown, negative = false): number {
    if (typeof value !== "number" && !(value instanceof Prisma.Decimal)) throw new ConflictException("原企业金额缺失");
    const amount = Number(value);
    if (!Number.isFinite(amount) || Math.abs(amount) > 9999999999.99 || !negative && amount < 0 || roundMoney(amount) !== amount) {
      throw new ConflictException("原企业金额精度或范围不可核对");
    }
    return amount;
  }

  async orderFinancialProjection(context: ClientRequestContext, corporateId: string, orderId: string): Promise<RentalEnterpriseOrderFinancialProjection> {
    const subject = Object.freeze({ ...context }), actions = ["orders:read", "finance:read"] as const;
    const before = await this.scope(subject, corporateId, actions);
    if (!validId(orderId)) throw new BadRequestException("原订单引用无效");
    if (!this.funding) throw new ServiceUnavailableException("原Core资金读取供应未接入");
    const result = await this.prisma.$transaction(async tx => {
      await lockRentalBusinessTenant(tx, subject.tenantId);
      const rows = await tx.$queryRaw<Array<{ id: string; tenantId: string; workspaceId: string; currency: string; updatedAt: Date }>>(Prisma.sql`
        SELECT o.id,o.tenantId,o.workspaceId,o.currency,o.updatedAt FROM rental_orders o
        JOIN business_workspaces w ON w.tenantId=o.tenantId AND w.id=o.workspaceId AND w.status='ACTIVE'
        WHERE o.tenantId=${subject.tenantId} AND CAST(o.workspaceId AS BINARY)=CAST(${subject.workspaceId} AS BINARY)
          AND CAST(o.id AS BINARY)=CAST(${orderId} AS BINARY) AND ${this.paid(corporateId)} FOR UPDATE`);
      const order = rows[0];
      if (rows.length !== 1 || !order || order.tenantId !== subject.tenantId || order.id !== orderId
        || order.workspaceId !== subject.workspaceId) {
        throw new NotFoundException("原企业承担订单不可读");
      }
      if (typeof order.currency !== "string" || !/^[A-Z]{3}$/u.test(order.currency)
        || !(order.updatedAt instanceof Date) || !Number.isFinite(order.updatedAt.getTime())) throw new ConflictException("原订单币种或修订缺失");
      const balance = await this.funding!.listEvents(subject.tenantId, order.workspaceId, orderId, tx, { realOnly: true });
      if (balance.orderId !== orderId || balance.balanceBasis !== "real" || balance.simulationAllowed !== false
        || !Array.isArray(balance.events) || balance.events.some(event => event.tenantId !== subject.tenantId
          || event.workspaceId !== order.workspaceId || event.orderId !== orderId)) {
        throw new ConflictException("企业财务只允许原实款读取");
      }
      const ledger = await readCorporateCreditLedger(this.prisma, subject.tenantId, corporateId, tx);
      const allocated = this.amount(corporateOrderPaid(order.workspaceId, orderId, order.currency, ledger));
      const entries = ledger.filter(row => row.orderId === orderId);
      if (entries.some(row => row.workspaceId !== order.workspaceId || row.currency !== order.currency)) {
        throw new ConflictException("原企业债权空间或币种不一致");
      }
      // realOnly excludes simulation from the totals; a historical mock cash
      // event still cannot prove a verified zero receipt for this order.
      const unverified = balance.events.some(event => event.provider === "mock"
        && (event.instrument === "rental" && ["initiate", "append", "refund"].includes(event.action)
          || event.paymentMethod || event.idempotencyKey.startsWith("staff-offline:")));
      const collected = this.amount(balance.rental.collected), refunded = this.amount(balance.rental.refunded);
      const rentalCash: RentalEnterpriseOrderFinancialProjection["rentalCash"] = unverified
        ? { state: "unavailable", reason: "unverified_original_cash_receipt" }
        : { state: "available", collected, refunded, netReceived: roundMoney(collected - refunded) };
      const output = { apiVersion: "v1" as const, corporateCustomerId: corporateId, permissionRevision: before.permissionRevision,
        workspaceId: order.workspaceId, orderId, currency: order.currency, sourceOrderUpdatedAt: order.updatedAt.toISOString(),
        observedAt: new Date().toISOString(), source: "persisted_original_core_finance" as const, rentalCash,
        corporatePaymentAllocated: allocated,
        receivableEntries: entries.map(row => {
          if (!(row.occurredAt instanceof Date) || !Number.isFinite(row.occurredAt.getTime())
            || !["reserve", "release", "settle", "payment_allocation", "allocation_reversal", "adjust"].includes(row.entryType)) {
            throw new ConflictException("原企业应收流水类型或时间不可核对");
          }
          return { id: row.id, entryType: row.entryType as RentalEnterpriseOrderFinancialProjection["receivableEntries"][number]["entryType"],
            amount: this.amount(row.amount), reservedDelta: this.amount(row.reservedDelta, true),
            receivableDelta: this.amount(row.receivableDelta, true), occurredAt: row.occurredAt.toISOString() };
        }), guarantee: { state: "unavailable" as const, reason: "original_payer_or_provider_guarantee_read_port_not_connected" as const },
        statements: unavailableStatements() };
      if (Buffer.byteLength(JSON.stringify(output), "utf8") > 65536) throw new ConflictException("企业订单财务超出完整投影上限");
      return output;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2500, timeout: 5000 });
    await this.recheck(subject, corporateId, actions, before);
    return result;
  }

  async corporateFinancialProjection(context: ClientRequestContext, corporateId: string): Promise<RentalEnterpriseCorporateFinancialProjection> {
    const subject = Object.freeze({ ...context }), actions = ["finance:read"] as const;
    const before = await this.scope(subject, corporateId, actions);
    const credit = !this.credit ? { state: "unavailable" as const, reason: "original_account_source_not_connected" as const }
      : await this.prisma.$transaction(async tx => {
        await lockRentalBusinessTenant(tx, subject.tenantId);
        const ledger = await readCorporateCreditLedger(this.prisma, subject.tenantId, corporateId, tx);
        const configured = await tx.customerCorporateCredit.findFirst({ where: { tenantId: subject.tenantId, customerId: corporateId }, select: { id: true } });
        // Missing account configuration must not hide an existing debt. Read
        // the original ledger under its writer fence before declaring absence.
        if (!configured) return ledger.length
          ? { state: "unavailable" as const, reason: "original_account_configuration_missing_with_ledger" as const }
          : { state: "not_configured" as const };
        const receipts = corporatePaymentReceipts(ledger);
        const scopedAggregateIds = new Set(receipts.filter(receipt => receipt.legs.every(leg => leg.workspaceId === subject.workspaceId))
          .flatMap(receipt => [receipt.payment.id, ...(receipt.reversal ? [receipt.reversal.id] : [])]));
        // The account is tenant-wide. Never present a current-space subtotal as
        // the complete account, or use a rental allowlist as historical authority.
        if (ledger.some(row => row.workspaceId !== subject.workspaceId && !scopedAggregateIds.has(row.id))) {
          return { state: "unavailable" as const, reason: "authoritative_account_history_space_scope_not_connected" as const };
        }
        const original = await this.credit!.account(subject.tenantId, corporateId, tx);
        if (original.tenantId !== subject.tenantId || original.customerId !== corporateId || original.currency !== "CNY"
          || !["active", "suspended", "revoked"].includes(original.status) || !["monthly", "semi_monthly", "per_order"].includes(original.billingCycle)
          || !Number.isSafeInteger(original.settlementTermDays) || original.settlementTermDays < 0) throw new ConflictException("原企业账户范围或配置不可核对");
        return { state: "available" as const, account: { creditLimit: this.amount(original.creditLimit),
          reservedAmount: this.amount(original.reservedAmount), receivableAmount: this.amount(original.receivableAmount),
          availableAmount: this.amount(original.availableAmount, true), currency: original.currency, status: original.status,
          billingCycle: original.billingCycle, settlementTermDays: original.settlementTermDays } };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2500, timeout: 5000 });
    await this.recheck(subject, corporateId, actions, before);
    return { apiVersion: "v1", corporateCustomerId: corporateId, permissionRevision: before.permissionRevision,
      observedAt: new Date().toISOString(), source: "original_tenant_corporate_credit_account", credit,
      maturities: { state: "unavailable", reason: "financially_determined_maturity_read_port_not_connected" },
      statements: unavailableStatements() };
  }
}
