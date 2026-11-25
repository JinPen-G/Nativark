/** 原客户对具体换货检查和交付的同意应用。复用原ClientAuth/ALS并逐次核范围，
 * 同意与原键同事务提交；不批准费用、预占资源或执行换货，照片只读原冻结证据。 */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE, type ConfirmRentalExchangeInspectionRequest, type RentalExchangeInspectionConsent, type RentalExchangeInspectionConsentOriginal } from "./index";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import { lockRentalBusinessTenant, type RentalBusinessTenantTransaction } from "./mysql-business-fence";
import { readPreparedExchangeInspection, verifyPreparedExchangeInspectionMedia, type ExchangeInspectionPreparationRow } from "./exchange-inspection-preparation.read";
import { exchangeInspectionCustomerMaterial, readExchangeInspectionConsent, validExchangeInspectionHash as validHash, type ExchangeInspectionConsentRow } from "./exchange-inspection-consent-basis";
import type { RentalExchangeInspectionTransaction, RentalExchangeInspectionStorage, RentalExchangeInspectionConsentIdempotent,
  RentalExchangeInspectionCustomerContext, RentalExchangeInspectionCustomerAuthority, RentalExchangeInspectionEvidenceFiles } from "./exchange-inspection-ports";
export { exchangeInspectionCustomerMaterial, readExchangeInspectionConsent, type ExchangeInspectionConsentRow } from "./exchange-inspection-consent-basis";
export type { RentalExchangeInspectionCustomerContext, RentalExchangeInspectionCustomerAuthority, RentalExchangeInspectionEvidenceFiles,
  RentalExchangeInspectionPhoto, RentalExchangeInspectionConsentIdempotent } from "./exchange-inspection-ports";

const validId = (value: unknown): value is string => typeof value === "string" && value.trim() === value && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
const validKey = (value: unknown): value is string => typeof value === "string" && value.trim() === value && /^[A-Za-z0-9_-]{1,128}$/u.test(value);

export async function verifyExchangeInspectionConsentReceipt<TTransaction extends RentalBusinessTenantTransaction>(idempotent: RentalExchangeInspectionConsentIdempotent<TTransaction>, tx: TTransaction,
  tenantId: string, consent: RentalExchangeInspectionConsent) {
  const key = `inspection-consent:${requestFingerprint({ customerId: consent.customerId, operationKey: consent.operationKey })}`;
  const original = await idempotent.readReceipt({ tenantId, action: "order.exchange.inspection.consent", key, orderId: consent.orderId,
    replay: async response => requestFingerprint(response) === requestFingerprint(consent) ? consent : undefined }, tx);
  if (!original) throw new ConflictException("原检查同意缺少同事务登记的原收据，不能重新执行");
}

export class RentalExchangeInspectionConsentService<TTransaction extends RentalExchangeInspectionTransaction = RentalExchangeInspectionTransaction> {
  constructor(private readonly prisma: RentalExchangeInspectionStorage<TTransaction>, private readonly idempotent: RentalExchangeInspectionConsentIdempotent<TTransaction>,
    private readonly auth: RentalExchangeInspectionCustomerAuthority, private readonly files?: RentalExchangeInspectionEvidenceFiles) {}

  private principal(context: RentalExchangeInspectionCustomerContext) {
    const identity = getRequestIdentity();
    if (!identity || identity.audience !== "client" || identity.staffApi || identity.isSaasAdmin || identity.dataScope !== undefined
      || context.customerType !== "personal" || identity.tenantId !== context.tenantId || identity.workspaceId !== context.workspaceId
      || identity.userId !== context.customerId || ![context.tenantId, context.workspaceId, context.customerId, context.sessionId].every(validId)) {
      throw new ForbiddenException("具体检查同意只允许原客户会话本人操作");
    }
    return JSON.stringify([context.tenantId, context.workspaceId, context.workspaceCode, context.customerId, context.sessionId]);
  }
  private async customer(authorization: string | undefined, context: RentalExchangeInspectionCustomerContext, newBusiness = true) {
    const principal = this.principal(context);
    const token = typeof authorization === "string" ? /^Bearer\s+(\S+)$/iu.exec(authorization)?.[1] : undefined;
    if (!token) throw new ForbiddenException("检查同意缺少原客户认证");
    const current = await this.auth.authenticate(token);
    if (this.principal(current) !== principal || this.principal(context) !== principal || newBusiness && current.membershipStatus !== "active") {
      throw new ForbiddenException("原客户会话或当前会员资格已变化");
    }
  }
  private async ownOrder(tx: TTransaction, context: RentalExchangeInspectionCustomerContext, orderId: string, newBusiness = true) {
    await lockRentalBusinessTenant(tx, context.tenantId);
    // Same authoritative account/session facts used by ClientAuth, held before
    // the order. A successful Guard earlier is not permanent write permission.
    const customers = await tx.$queryRaw<Array<{ id: string }>>`SELECT p.id FROM customer_profiles p
      JOIN customer_accounts a ON a.tenantId=p.tenantId AND a.customerId=p.id AND a.status='active' AND a.mustChangePassword=false
      JOIN customer_memberships m ON m.tenantId=p.tenantId AND m.customerId=p.id AND m.status NOT IN ('exited','closed') AND (${!newBusiness} OR m.status='active')
      JOIN client_auth_sessions s ON s.tenantId=p.tenantId AND s.customerId=p.id AND s.id=${context.sessionId}
        AND s.workspaceId=${context.workspaceId} AND s.revokedAt IS NULL AND s.expiresAt>NOW(3)
        AND (a.passwordUpdatedAt IS NULL OR s.createdAt>=a.passwordUpdatedAt)
      JOIN business_workspaces w ON w.tenantId=s.tenantId AND w.id=s.workspaceId AND w.code=${context.workspaceCode} AND w.status='ACTIVE'
      WHERE p.tenantId=${context.tenantId} AND p.id=${context.customerId} AND p.customerType='personal' AND p.status='active'
        AND p.mergedIntoCustomerId IS NULL LOCK IN SHARE MODE`;
    if (customers.length !== 1 || customers[0].id !== context.customerId) throw new ForbiddenException("原客户身份或空间访问已失效");
    const orders = await tx.$queryRaw<Array<{ id: string; tenantId: string; workspaceId: string; status: string; updatedAt: Date }>>`SELECT id,tenantId,workspaceId,status,updatedAt FROM rental_orders
      WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND id=${orderId}
        AND (CAST(customerId AS BINARY)=CAST(${context.customerId} AS BINARY)
          OR (JSON_TYPE(JSON_EXTRACT(membershipSnapshot,'$.personalCustomerId'))='STRING'
            AND CAST(JSON_UNQUOTE(JSON_EXTRACT(membershipSnapshot,'$.personalCustomerId')) AS BINARY)=CAST(${context.customerId} AS BINARY))) FOR UPDATE`;
    if (orders.length !== 1 || orders[0].id !== orderId || orders[0].tenantId !== context.tenantId || orders[0].workspaceId !== context.workspaceId) {
      throw new NotFoundException("本人当前空间原订单不存在");
    }
    return orders[0];
  }
  private rows(tx: TTransaction, context: RentalExchangeInspectionCustomerContext, key: string) {
    return tx.$queryRaw<ExchangeInspectionConsentRow[]>`SELECT * FROM rental_exchange_inspection_consents
      WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND customerId=${context.customerId} AND operationKey=${key}`;
  }
  private async preparation(tx: TTransaction, context: RentalExchangeInspectionCustomerContext, orderId: string, id: string) {
    const rows = await tx.$queryRaw<ExchangeInspectionPreparationRow[]>`SELECT * FROM rental_exchange_inspection_preparations
      WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND orderId=${orderId} AND id=${id} LOCK IN SHARE MODE`;
    if (rows.length !== 1 || rows[0].id !== id) throw new NotFoundException("当前订单原检查准备不存在");
    return { row: rows[0], value: readPreparedExchangeInspection(rows[0], { ...context, orderId }) };
  }

  async material(authorization: string | undefined, context: RentalExchangeInspectionCustomerContext, orderId: string, preparationId: string) {
    const customer = Object.freeze({ ...context });
    if (!validId(orderId) || !validId(preparationId)) throw new BadRequestException("订单或准备引用无效");
    await this.customer(authorization, customer);
    const result = await this.prisma.$transaction(async tx => {
      const order = await this.ownOrder(tx, customer, orderId), { row, value } = await this.preparation(tx, customer, orderId, preparationId);
      if (order.status !== "RENTING" || order.updatedAt.toISOString() !== value.expectedOrderUpdatedAt) throw new ConflictException("订单已变化，不能对旧准备新增同意");
      await verifyPreparedExchangeInspectionMedia(tx, customer.tenantId, value);
      await this.customer(authorization, customer);
      return exchangeInspectionCustomerMaterial(value, customer.customerId, row.payloadHash);
    }, { isolationLevel: "ReadCommitted" });
    await this.customer(authorization, customer); return result;
  }

  /** Same original using-customer authority and material hash as consent. File
   * IO occurs between two scoped reads; revoked/changed material is never sent. */
  async photo(authorization: string | undefined, context: RentalExchangeInspectionCustomerContext, orderId: string, preparationId: string,
    fileAssetId: string, preparationHash: string) {
    if (!this.files) throw new ServiceUnavailableException("原检查照片读取服务未装配");
    if (![orderId, preparationId, fileAssetId].every(validId) || !validHash(preparationHash)) throw new BadRequestException("原检查照片或材料引用无效");
    const customer = Object.freeze({ ...context }); await this.customer(authorization, customer);
    const source = async () => this.prisma.$transaction(async tx => {
      const order = await this.ownOrder(tx, customer, orderId), { row, value } = await this.preparation(tx, customer, orderId, preparationId);
      if (order.status !== "RENTING" || order.updatedAt.toISOString() !== value.expectedOrderUpdatedAt
        || row.payloadHash !== preparationHash) throw new ConflictException("原检查材料或订单已变化");
      await verifyPreparedExchangeInspectionMedia(tx, customer.tenantId, value);
      const media = (value.acceptedMedia ?? []).filter(media => media.fileAssetId === fileAssetId);
      if (media.length !== 1) throw new NotFoundException("照片不属于本人当前具体检查材料");
      await this.customer(authorization, customer);
      return { media: media[0], actorUserId: value.actorUserId, preparationHash: row.payloadHash };
    }, { isolationLevel: "ReadCommitted" });
    const before = await source();
    const result = await this.files.readFrozenExchangeInspectionEvidence(customer.tenantId, fileAssetId,
      { businessType: "rental_order", businessId: orderId, uploadScene: RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE,
        workspaceId: customer.workspaceId, actorUserId: before.actorUserId, exchangeInspectionSourceId: before.media.sourceId }, before.media.contentHash);
    await this.customer(authorization, customer);
    const after = await source();
    if (requestFingerprint(before) !== requestFingerprint(after)) throw new ConflictException("原照片材料在读取期间发生变化");
    await this.customer(authorization, customer); return result;
  }

  async confirm(authorization: string | undefined, context: RentalExchangeInspectionCustomerContext, orderId: string,
    input: ConfirmRentalExchangeInspectionRequest): Promise<RentalExchangeInspectionConsent> {
    if (!validId(orderId) || !input || Object.keys(input).some(key => !["operationKey", "expectedRevision", "preparationId", "preparationHash", "materialHash", "expectedOrderUpdatedAt", "confirm"].includes(key))
      || !validKey(input.operationKey) || input.expectedRevision !== 0 || !validId(input.preparationId) || !validHash(input.preparationHash)
      || !validHash(input.materialHash) || !Number.isFinite(Date.parse(input.expectedOrderUpdatedAt)) || input.confirm !== true) {
      throw new BadRequestException("须本人明确确认原检查材料、修订和独立操作键");
    }
    const customer = Object.freeze({ ...context }), body = structuredClone(input);
    const requestHash = requestFingerprint({ orderId, customerId: customer.customerId, input: body });
    await this.customer(authorization, customer, false);
    const result = await this.prisma.$transaction(async tx => {
      const order = await this.ownOrder(tx, customer, orderId, false), original = (await this.rows(tx, customer, body.operationKey))[0];
      if (original) {
        if (original.requestHash !== requestHash) throw new ConflictException("原检查同意键已用于其他材料，不能重发");
        const consent = readExchangeInspectionConsent(original, { ...customer, orderId });
        await verifyExchangeInspectionConsentReceipt(this.idempotent, tx, customer.tenantId, consent);
        await this.customer(authorization, customer, false); return consent;
      }
      await this.customer(authorization, customer);
      const { row, value } = await this.preparation(tx, customer, orderId, body.preparationId);
      if (order.status !== "RENTING" || order.updatedAt.toISOString() !== body.expectedOrderUpdatedAt || value.expectedOrderUpdatedAt !== body.expectedOrderUpdatedAt
        || row.payloadHash !== body.preparationHash) throw new ConflictException("原订单或具体检查准备已变化");
      await verifyPreparedExchangeInspectionMedia(tx, customer.tenantId, value);
      const material = exchangeInspectionCustomerMaterial(value, customer.customerId, row.payloadHash);
      if (material.materialHash !== body.materialHash) throw new ConflictException("具体检查材料已变化，请重新审阅");
      const consent: RentalExchangeInspectionConsent = { id: randomUUID(), orderId, workspaceId: customer.workspaceId, customerId: customer.customerId,
        preparationId: value.id, preparationHash: row.payloadHash, materialHash: material.materialHash, expectedOrderUpdatedAt: body.expectedOrderUpdatedAt,
        operationKey: body.operationKey, requestHash, confirmedAt: new Date().toISOString(), revision: 1, state: "confirmed",
        scope: "specific_exchange_inspection_and_handover", retryable: false };
      const key = `inspection-consent:${requestFingerprint({ customerId: customer.customerId, operationKey: body.operationKey })}`;
      const recorded = await this.idempotent.executeInTransaction({ tenantId: customer.tenantId, orderId, action: "order.exchange.inspection.consent", key, fallbackKey: key,
        request: { orderId, customerId: customer.customerId, input: body }, run: async () => {
          await tx.$executeRaw`INSERT INTO rental_exchange_inspection_consents (tenantId,workspaceId,id,orderId,customerId,preparationId,operationKey,requestHash,payloadHash,payload)
            VALUES (${customer.tenantId},${customer.workspaceId},${consent.id},${orderId},${customer.customerId},${value.id},${body.operationKey},${requestHash},${requestFingerprint(consent)},${JSON.stringify(consent)})`;
          return consent;
        }, replay: async () => {
          const row = (await this.rows(tx, customer, body.operationKey))[0];
          return row && row.requestHash === requestHash ? readExchangeInspectionConsent(row, { ...customer, orderId }) : undefined;
        } }, tx);
      await this.customer(authorization, customer); return recorded.result;
    }, { isolationLevel: "ReadCommitted" });
    await this.customer(authorization, customer, false); return result;
  }

  async original(authorization: string | undefined, context: RentalExchangeInspectionCustomerContext, orderId: string, key: string): Promise<RentalExchangeInspectionConsentOriginal> {
    if (!validId(orderId) || !validKey(key)) throw new BadRequestException("原检查同意引用无效");
    const customer = Object.freeze({ ...context }); await this.customer(authorization, customer, false);
    const result = await this.prisma.$transaction(async tx => {
      await this.ownOrder(tx, customer, orderId, false);
      const row = (await this.rows(tx, customer, key))[0];
      const original: RentalExchangeInspectionConsentOriginal = row
        ? { state: "observed", consent: readExchangeInspectionConsent(row, { ...customer, orderId }), retryable: false }
        : { state: "not_recorded", retryable: false };
      if (original.state === "observed") await verifyExchangeInspectionConsentReceipt(this.idempotent, tx, customer.tenantId, original.consent);
      await this.customer(authorization, customer, false); return original;
    }, { isolationLevel: "ReadCommitted" });
    await this.customer(authorization, customer, false); return result;
  }
}
