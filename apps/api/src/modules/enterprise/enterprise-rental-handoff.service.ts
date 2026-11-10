/** Original own-order coordination source, requests, merchant opinions and exact receipts.
 * Records an administrative request only; never changes Core, subjects, funds or grants. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ENTERPRISE_RENTAL_HANDOFF_REQUEST_STATES, enterpriseRentalHandoffMaterialSnapshot, type EnterpriseRentalHandoffOrder, type EnterpriseRentalHandoffOrderSource, type EnterpriseRentalHandoffMerchantQueue, type CreateEnterpriseRentalHandoffRequest, type EnterpriseRentalHandoffCreated, type EnterpriseRentalHandoffMaterial, type EnterpriseRentalHandoffView, type EnterpriseOperationResult, type EnterpriseRentalHandoffList, type WithdrawEnterpriseRentalHandoffRequest, type EnterpriseRentalHandoffWithdrawn, type EnterpriseRentalHandoffMerchantView, type ReviewEnterpriseRentalHandoffRequest, type EnterpriseRentalHandoffReviewed, type SystemUserRow } from "@rental-os/shared";
import { getRequestIdentity } from "../../common/request-identity";
import type { ClientRequestContext } from "../client/client-auth.service";
import { ClientApiService } from "../client/client-api.service";
import { RentalCoreFactRepository } from "../rental-core/rental-core-fact.repository";
import { PrismaService } from "../database/prisma.service";
import { EnterpriseCommandService, enterpriseHash, enterpriseJson } from "./enterprise-command.service";
const reference = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(value);
type Row = { id: string; orderId: string; applicantCustomerId: string; corporateCustomerId: string; corporateMembershipId: string; state: EnterpriseRentalHandoffView["state"]; revision: number; material: string | EnterpriseRentalHandoffMaterial; reason: string; merchantReviewReason?: string | null; reviewedBy?: string | null; reviewedAt?: Date | null; createdAt: Date; updatedAt: Date };
@Injectable()
export class EnterpriseRentalHandoffService {
  constructor(private readonly prisma: PrismaService, private readonly commands: EnterpriseCommandService, private readonly api: ClientApiService,
    private readonly facts: RentalCoreFactRepository) {}
  private scope(context: ClientRequestContext) {
    const current = getRequestIdentity();
    if (context.customerType !== "personal" || !reference(context.tenantId) || !reference(context.workspaceId) || !reference(context.customerId)
      || !current || current.tenantId !== context.tenantId || current.workspaceId !== context.workspaceId || current.userId !== context.customerId
      || current.isSaasAdmin !== false || current.staffApi === true || current.dataScope !== undefined) throw new ForbiddenException("交接申请须使用当前客户及服务");
  }
  private view(row: Row, workspaceCode: string): EnterpriseRentalHandoffView {
    let original: unknown;
    try { original = enterpriseJson(row.material); } catch { throw new ConflictException("原交接申请材料损坏，保留原引用"); }
    const material = enterpriseRentalHandoffMaterialSnapshot(original, row.orderId, workspaceCode);
    if (!reference(row.id) || !reference(row.orderId) || !["pending", "reviewed", "withdrawn"].includes(row.state) || !Number.isSafeInteger(row.revision) || row.revision < 1
      || !material || material.subjects.user !== "self" || material.corporateCustomerId !== row.corporateCustomerId || material.corporateMembershipId !== row.corporateMembershipId
      || typeof row.reason !== "string" || !row.reason.trim() || row.reason.length > 500 || !Number.isFinite(row.createdAt?.getTime()) || !Number.isFinite(row.updatedAt?.getTime())) throw new ConflictException("原交接申请依据不可核对");
    const hasReview = row.reviewedBy != null || row.merchantReviewReason != null || row.reviewedAt != null;
    if (hasReview !== (row.state === "reviewed") || hasReview && (!reference(row.reviewedBy) || typeof row.merchantReviewReason !== "string" || !row.merchantReviewReason.trim() || row.merchantReviewReason.length > 500 || !Number.isFinite(row.reviewedAt?.getTime()) || row.revision !== 2)) throw new ConflictException("原商户处理意见不可核对");
    return { id: row.id, orderId: row.orderId, state: row.state, revision: row.revision, material, reason: row.reason,
      ...(hasReview ? { merchantReview: { operatorId: row.reviewedBy!, reason: row.merchantReviewReason!, reviewedAt: row.reviewedAt!.toISOString() } } : {}),
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), effect: "request_only_no_business_change" };
  }
  private merchantScope(user: SystemUserRow) {
    const { tenantId, actor } = this.commands.operator(user, "rental-os:corporate:manage");
    this.commands.operator(user, "rental-os:order:view");
    const current = getRequestIdentity();
    if (!current || !reference(current.workspaceId) || current.isSaasAdmin !== false || current.staffApi === true) throw new ForbiddenException("交接核对须当前商户及订单服务");
    return { tenantId, actor, workspaceId: current.workspaceId, authorityKey: JSON.stringify([current.dataScope, current.locationScope]) };
  }
  private async merchantRow(user: SystemUserRow, id: string, tx: Prisma.TransactionClient): Promise<Row> {
    const owner = this.merchantScope(user);
    const rows = await tx.$queryRaw<Row[]>`SELECT * FROM enterprise_rental_handoff_requests WHERE tenantId=${owner.tenantId} AND workspaceId=${owner.workspaceId} AND id=${id}`;
    if (rows.length !== 1 || !reference(rows[0].orderId) || !reference(rows[0].applicantCustomerId)) throw new NotFoundException("当前服务交接申请不存在");
    if (!this.facts) throw new ServiceUnavailableException("原订单范围读取未装配");
    // Reuse the original order visibility and workspace resolver. A corporate
    // permission cannot read a request outside today's operator order range.
    const order = await this.facts.findOrder(owner.tenantId, rows[0].orderId, tx);
    if (!order || order.id !== rows[0].orderId || order.tenantId !== owner.tenantId) throw new NotFoundException("当前受权订单不存在");
    if (JSON.stringify(this.merchantScope(user)) !== JSON.stringify(owner)) throw new ForbiddenException("商户或订单范围已变化");
    return rows[0];
  }
  private merchantView(row: Row): EnterpriseRentalHandoffMerchantView {
    let original: EnterpriseRentalHandoffMaterial;
    try { original = enterpriseJson(row.material); } catch { throw new ConflictException("原交接材料损坏"); }
    const view = this.view(row, original?.workspaceCode);
    return { ...view, applicantCustomerId: row.applicantCustomerId };
  }
  async merchantDetail(user: SystemUserRow, id: string): Promise<EnterpriseRentalHandoffMerchantView> {
    this.merchantScope(user); if (!reference(id)) throw new BadRequestException("交接申请引用无效");
    return this.merchantView(await this.merchantRow(user, id, this.prisma as unknown as Prisma.TransactionClient));
  }
  /** First page the original order reader's authorized universe. Never let a
   * hidden order's request affect the queue or its pagination/count boundary. */
  async merchantQueue(user: SystemUserRow, page = 1): Promise<EnterpriseRentalHandoffMerchantQueue> {
    const owner = this.merchantScope(user);
    if (!Number.isSafeInteger(page) || page < 1 || page > 999999) throw new BadRequestException("原订单页码无效");
    if (!this.facts) throw new ServiceUnavailableException("原订单范围读取未装配");
    const assertOwner = () => { if (JSON.stringify(this.merchantScope(user)) !== JSON.stringify(owner)) throw new ForbiddenException("商户或订单范围已变化"); };
    const orders = await this.facts.queryOrders(owner.tenantId, { skip: (page - 1) * 50, take: 50 }); assertOwner();
    const ids = orders.items.map(row => row.id);
    if (orders.items.length > 50 || !Number.isSafeInteger(orders.total) || orders.total < orders.items.length || ids.some(id => !reference(id))
      || new Set(ids).size !== ids.length || orders.items.some(row => row.tenantId !== owner.tenantId)) throw new ConflictException("受权原订单页不可核对");
    const rows = ids.length ? await this.prisma.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM enterprise_rental_handoff_requests WHERE tenantId=${owner.tenantId} AND workspaceId=${owner.workspaceId} AND orderId IN (${Prisma.join(ids)}) AND state='pending' ORDER BY createdAt DESC,id DESC LIMIT 201`) : [];
    assertOwner();
    if (rows.length > 200 || new Set(rows.map(row => row.id)).size !== rows.length) throw new ConflictException("本页交接请求超出有界范围，请按原申请核对");
    const items: EnterpriseRentalHandoffMerchantView[] = [];
    for (const row of rows) {
      if (!ids.includes(row.orderId) || row.state !== "pending" || row.revision !== 1) throw new ConflictException("原订单与交接申请关联不可核对");
      const current = await this.merchantRow(user, row.id, this.prisma as unknown as Prisma.TransactionClient); assertOwner();
      if (JSON.stringify(this.merchantView(current)) !== JSON.stringify(this.merchantView(row))) throw new ConflictException("交接队列读取期间已变化，请重新核对");
      items.push(this.merchantView(current));
    }
    return { items, orderPage: { page, pageSize: 50, total: orders.total }, coverage: "current_workspace_authorized_original_order_page" };
  }
  /** Stored original employee identity only. A terminated relationship is not
   * rewritten from today's membership and never becomes renewed consumption. */
  async orderSource(context: ClientRequestContext): Promise<EnterpriseRentalHandoffOrderSource> {
    this.scope(context);
    const key = JSON.stringify([context.tenantId, context.workspaceId, context.workspaceCode, context.customerId]);
    const assertOwner = () => { this.scope(context); if (JSON.stringify([context.tenantId, context.workspaceId, context.workspaceCode, context.customerId]) !== key) throw new ForbiddenException("原客户或服务已变化"); };
    const result = await this.prisma.$transaction<EnterpriseRentalHandoffOrderSource>(async tx => {
      await this.commands.customer(context, tx, false); assertOwner();
      const rows = await tx.$queryRaw<Array<{ id: string; status: string; updatedAt: Date }>>(Prisma.sql`SELECT id,status,updatedAt FROM rental_orders WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND (customerId=${context.customerId} OR JSON_UNQUOTE(JSON_EXTRACT(membershipSnapshot,'$.personalCustomerId'))=${context.customerId}) AND JSON_UNQUOTE(JSON_EXTRACT(membershipSnapshot,'$.bookingIdentity'))='enterprise_employee' AND status IN (${Prisma.join([...ENTERPRISE_RENTAL_HANDOFF_REQUEST_STATES])}) ORDER BY createdAt DESC,id DESC LIMIT 201`);
      assertOwner();
      if (rows.length > 200 || new Set(rows.map(row => row.id)).size !== rows.length) throw new ConflictException("原企业身份租赁超出有界范围，请按已知原单核对");
      const items: EnterpriseRentalHandoffOrder[] = [];
      for (const row of rows) {
        if (!reference(row.id) || !ENTERPRISE_RENTAL_HANDOFF_REQUEST_STATES.includes(row.status as EnterpriseRentalHandoffOrder["status"]) || !Number.isFinite(row.updatedAt?.getTime())) throw new ConflictException("原订单状态或修订不可核对");
        const original = await this.api.rentalHandoffMaterial(context, row.id, tx); assertOwner();
        const material = enterpriseRentalHandoffMaterialSnapshot(original, row.id, context.workspaceCode);
        if (!material || material.subjects.user !== "self" || material.orderUpdatedAt !== row.updatedAt.toISOString()) throw new ConflictException("原订单历史依据不可核对");
        items.push({ status: row.status as EnterpriseRentalHandoffOrder["status"], material });
      }
      await this.commands.customer(context, tx, false); assertOwner();
      return { state: "available", coverage: "current_workspace_original_own_enterprise_employee_orders", items };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
    // RepeatableRead keeps historical order rows coherent, but cannot attest to a
    // session revoked after its snapshot. Recheck fresh credentials after release,
    // outside the transaction (also safe with a one-connection pool).
    assertOwner(); await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false); assertOwner();
    return result;
  }
  async review(user: SystemUserRow, id: string, input: ReviewEnterpriseRentalHandoffRequest): Promise<EnterpriseRentalHandoffReviewed> {
    const owner = this.merchantScope(user);
    this.commands.operator(user, "rental-os:order:operate");
    if (!reference(id) || input.confirm !== true || input.expectedRevision !== 1 || typeof input.materialKey !== "string" || !input.materialKey || input.materialKey.length > 8000) throw new BadRequestException("须确认原交接申请材料");
    const assertOwner = () => { this.commands.operator(user, "rental-os:order:operate"); if (JSON.stringify(this.merchantScope(user)) !== JSON.stringify(owner)) throw new ForbiddenException("原商户范围已变化"); };
    return this.commands.execute(owner.tenantId, owner.actor, "rental-handoff.review", id, input, async tx => {
      assertOwner();
      const rows = await tx.$queryRaw<Row[]>`SELECT * FROM enterprise_rental_handoff_requests WHERE tenantId=${owner.tenantId} AND workspaceId=${owner.workspaceId} AND id=${id} FOR UPDATE`;
      if (rows.length !== 1) throw new NotFoundException("原交接申请不存在");
      const row = rows[0], material = this.merchantView(row);
      if (row.state !== "pending" || row.revision !== input.expectedRevision || JSON.stringify(material) !== input.materialKey) throw this.commands.conflict();
      // Coordination opinion only. Never feed this into a Core approval, change
      // an order or replace the applicant's original request/reason/material.
      const changed = await tx.$executeRaw`UPDATE enterprise_rental_handoff_requests SET state='reviewed',revision=2,pendingMarker=NULL,merchantReviewReason=${input.reason.trim()},reviewedBy=${user.id},reviewedAt=NOW(3),updatedAt=NOW(3) WHERE tenantId=${owner.tenantId} AND workspaceId=${owner.workspaceId} AND id=${id} AND state='pending' AND revision=${input.expectedRevision}`;
      if (changed !== 1) throw this.commands.conflict();
      await this.merchantRow(user, id, tx); assertOwner();
      return { id, orderId: row.orderId, state: "reviewed", revision: 2, effect: "request_only_no_business_change" };
    }, async tx => { assertOwner(); await this.merchantRow(user, id, tx); assertOwner(); });
  }
  async readReview(user: SystemUserRow, id: string, key: string): Promise<EnterpriseOperationResult> {
    const owner = this.merchantScope(user);
    if (!reference(id) || !/^[a-zA-Z0-9_-]{1,128}$/u.test(key)) throw new BadRequestException("原处理意见引用无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    const receipts = await tx.$queryRaw<Array<{ operationKey: string; result: string | Record<string, unknown> }>>`SELECT operationKey,result FROM enterprise_portal_operations WHERE tenantId=${owner.tenantId} AND operationKey=${key} AND actorUserId=${owner.actor} AND target=${`rental-handoff.review:${id}`}`;
    if (JSON.stringify(this.merchantScope(user)) !== JSON.stringify(owner)) throw new ForbiddenException("原商户范围已变化");
    if (!receipts.length) return { state: "not_recorded" };
    let result: Record<string, unknown>;
    try { result = enterpriseJson(receipts[0].result); } catch { throw new ConflictException("原处理意见收据损坏，保留原键"); }
    if (receipts.length !== 1 || receipts[0].operationKey !== key || !result || result.id !== id || !reference(result.orderId) || result.state !== "reviewed" || result.revision !== 2 || result.effect !== "request_only_no_business_change") throw new ConflictException("原处理意见收据不可核对，保留原键");
    const row = await this.merchantRow(user, id, tx);
    if (row.orderId !== result.orderId || JSON.stringify(this.merchantScope(user)) !== JSON.stringify(owner)) throw new ConflictException("原处理意见关联不可核对，保留原键");
    // Current request state/opinion is not the original K's result. Current order
    // range is rechecked only as authorization, not used to manufacture history.
    return { state: "committed", result: { id, orderId: result.orderId, state: "reviewed", revision: 2, effect: "request_only_no_business_change" } };
  }
  async create(context: ClientRequestContext, orderId: string, input: CreateEnterpriseRentalHandoffRequest): Promise<EnterpriseRentalHandoffCreated> {
    this.scope(context);
    if (!reference(orderId) || input.confirm !== true || input.expectedRevision !== 0 || typeof input.materialKey !== "string" || !input.materialKey || input.materialKey.length > 4000) throw new BadRequestException("须确认有效原订单材料");
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "rental-handoff.create", orderId, input, async tx => {
      this.scope(context);
      // Parent Tenant fence precedes the original order lock. Only the request is
      // mutated; the lock prevents a newer order being accepted under older material.
      const orders = await tx.$queryRaw<Array<{ id: string; status: string }>>`SELECT id,status FROM rental_orders WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND id=${orderId} FOR UPDATE`;
      if (orders.length !== 1) throw new NotFoundException("本人原订单不存在");
      const material = await this.api.rentalHandoffMaterial(context, orderId, tx); this.scope(context);
      // Ownership precedes state feedback; foreign orders must not expose status.
      if (!ENTERPRISE_RENTAL_HANDOFF_REQUEST_STATES.includes(String(orders[0].status).toLowerCase() as EnterpriseRentalHandoffOrder["status"])) throw this.commands.conflict();
      if (material.subjects.user !== "self" || JSON.stringify(material) !== input.materialKey) throw this.commands.conflict();
      const pendingMarker = enterpriseHash({ purpose: "rental-handoff.pending", orderId, customerId: context.customerId });
      const pending = await tx.$queryRaw<Row[]>`SELECT * FROM enterprise_rental_handoff_requests WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND orderId=${orderId} AND applicantCustomerId=${context.customerId} AND pendingMarker=${pendingMarker} AND state='pending'`;
      if (pending.length > 1) throw new ConflictException("原交接申请关联无法核对");
      if (pending[0]) {
        const original = this.view(pending[0], context.workspaceCode);
        if (original.revision !== 1 || JSON.stringify(original.material) !== input.materialKey || original.reason !== input.reason.trim()) throw this.commands.conflict();
        return { id: pending[0].id, orderId, state: "pending", revision: 1, effect: "request_only_no_business_change" };
      }
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO enterprise_rental_handoff_requests (tenantId,workspaceId,id,orderId,applicantCustomerId,corporateCustomerId,corporateMembershipId,material,reason,pendingMarker,updatedAt) VALUES (${context.tenantId},${context.workspaceId},${id},${orderId},${context.customerId},${material.corporateCustomerId},${material.corporateMembershipId},${JSON.stringify(material)},${input.reason.trim()},${pendingMarker},NOW(3))`;
      return { id, orderId, state: "pending", revision: 1, effect: "request_only_no_business_change" };
    }, async tx => { this.scope(context); await this.commands.customer(context, tx, false); });
  }
  async mine(context: ClientRequestContext): Promise<EnterpriseRentalHandoffList> {
    this.scope(context); const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const rows = await tx.$queryRaw<Row[]>`SELECT * FROM enterprise_rental_handoff_requests WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND applicantCustomerId=${context.customerId} ORDER BY createdAt DESC,id DESC LIMIT 201`;
    await this.commands.customer(context, tx, false); this.scope(context);
    if (rows.length > 200) throw new ConflictException("本人交接申请超过有界读取范围，请按原引用核对");
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new ConflictException("本人交接申请关联不可核对");
    return rows.map(row => this.view(row, context.workspaceCode));
  }
  async withdraw(context: ClientRequestContext, id: string, input: WithdrawEnterpriseRentalHandoffRequest): Promise<EnterpriseRentalHandoffWithdrawn> {
    this.scope(context);
    if (!reference(id) || input.confirm !== true || input.expectedRevision !== 1 || typeof input.materialKey !== "string" || !input.materialKey || input.materialKey.length > 8000) throw new BadRequestException("须确认本人的原待核对交接申请");
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "rental-handoff.withdraw", id, input, async tx => {
      this.scope(context);
      const rows = await tx.$queryRaw<Row[]>`SELECT * FROM enterprise_rental_handoff_requests WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND id=${id} AND applicantCustomerId=${context.customerId} FOR UPDATE`;
      if (rows.length !== 1) throw new NotFoundException("本人原交接申请不存在");
      const row = rows[0], original = this.view(row, context.workspaceCode);
      if (row.state !== "pending" || row.revision !== input.expectedRevision || JSON.stringify(original) !== input.materialKey) throw this.commands.conflict();
      // Same Tenant/request boundary as merchant review. Withdrawal changes only
      // the pending administrative request, never its material or rental order.
      const changed = await tx.$executeRaw`UPDATE enterprise_rental_handoff_requests SET state='withdrawn',revision=2,pendingMarker=NULL,updatedAt=NOW(3) WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND id=${id} AND applicantCustomerId=${context.customerId} AND state='pending' AND revision=${input.expectedRevision}`;
      if (changed !== 1) throw this.commands.conflict();
      this.scope(context); await this.commands.customer(context, tx, false);
      return { id, orderId: row.orderId, state: "withdrawn", revision: 2, effect: "request_only_no_business_change" };
    }, async tx => { this.scope(context); await this.commands.customer(context, tx, false); });
  }
  async readWithdrawal(context: ClientRequestContext, id: string, key: string): Promise<EnterpriseOperationResult> {
    this.scope(context); if (!reference(id) || !/^[a-zA-Z0-9_-]{1,128}$/u.test(key)) throw new BadRequestException("原交接撤回引用无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const receipts = await tx.$queryRaw<Array<{ operationKey: string; result: string | Record<string, unknown> }>>`SELECT operationKey,result FROM enterprise_portal_operations WHERE tenantId=${context.tenantId} AND operationKey=${key} AND actorUserId=${`customer:${context.customerId}`} AND target=${`rental-handoff.withdraw:${id}`}`;
    await this.commands.customer(context, tx, false); this.scope(context);
    if (!receipts.length) return { state: "not_recorded" };
    let result: Record<string, unknown>;
    try { result = enterpriseJson(receipts[0].result); } catch { throw new ConflictException("原撤回收据损坏，保留原键"); }
    if (receipts.length !== 1 || receipts[0].operationKey !== key || !result || result.id !== id || !reference(result.orderId) || result.state !== "withdrawn" || result.revision !== 2 || result.effect !== "request_only_no_business_change") throw new ConflictException("原交接撤回收据不可核对，保留原键");
    const rows = await tx.$queryRaw<Array<{ id: string; orderId: string }>>`SELECT id,orderId FROM enterprise_rental_handoff_requests WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND id=${id} AND applicantCustomerId=${context.customerId}`;
    await this.commands.customer(context, tx, false); this.scope(context);
    if (rows.length !== 1 || rows[0].id !== id || rows[0].orderId !== result.orderId) throw new ConflictException("原交接撤回关联不可核对，保留原键");
    return { state: "committed", result: { id, orderId: result.orderId, state: "withdrawn", revision: 2, effect: "request_only_no_business_change" } };
  }
  async detail(context: ClientRequestContext, id: string): Promise<EnterpriseRentalHandoffView> {
    this.scope(context); if (!reference(id)) throw new BadRequestException("原交接申请引用无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const rows = await tx.$queryRaw<Row[]>`SELECT * FROM enterprise_rental_handoff_requests WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND id=${id} AND applicantCustomerId=${context.customerId}`;
    await this.commands.customer(context, tx, false); this.scope(context);
    if (rows.length !== 1) throw new NotFoundException("本人原交接申请不存在");
    return this.view(rows[0], context.workspaceCode);
  }
  /** Receipt first. Today's order, membership or request state never proves this K. */
  async readCreate(context: ClientRequestContext, orderId: string, key: string): Promise<EnterpriseOperationResult> {
    this.scope(context); if (!reference(orderId) || typeof key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(key)) throw new BadRequestException("原交接订单及操作键无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const receipts = await tx.$queryRaw<Array<{ operationKey: string; result: string | Record<string, unknown> }>>`SELECT operationKey,result FROM enterprise_portal_operations WHERE tenantId=${context.tenantId} AND operationKey=${key} AND actorUserId=${`customer:${context.customerId}`} AND target=${`rental-handoff.create:${orderId}`}`;
    await this.commands.customer(context, tx, false); this.scope(context);
    if (!receipts.length) return { state: "not_recorded" };
    let result: Record<string, unknown>;
    try { result = enterpriseJson(receipts[0].result); } catch { throw new ConflictException("原交接创建收据损坏，保留原键"); }
    if (receipts.length !== 1 || receipts[0].operationKey !== key || !result || !reference(result.id) || result.orderId !== orderId || result.state !== "pending" || result.revision !== 1 || result.effect !== "request_only_no_business_change") throw new ConflictException("原交接创建收据不可核对，保留原键");
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM enterprise_rental_handoff_requests WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND id=${result.id} AND orderId=${orderId} AND applicantCustomerId=${context.customerId}`;
    await this.commands.customer(context, tx, false); this.scope(context);
    if (rows.length !== 1 || rows[0].id !== result.id) throw new ConflictException("原交接创建关联不可核对，保留原键");
    return { state: "committed", result: { id: result.id, orderId, state: "pending", revision: 1, effect: "request_only_no_business_change" } };
  }
}
