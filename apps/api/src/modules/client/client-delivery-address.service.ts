import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CLIENT_API_VERSION, type ClientDeliveryAddressListResponse, type ClientDeliveryAddressRequest, type ClientDeliveryAddressSnapshot, type ClientDeliveryAddressView } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreService } from "../rental-core/rental-core.service";
import type { ClientRequestContext } from "./client-auth.service";
import { evaluateDeliveryServiceArea, type DeliveryServiceAreaDecision } from "./client-delivery-service-area";

/**
 * 本人配送地址簿与订单交付快照（MP-06，需求 §11.1）。
 *
 * - 地址是客户在租户内共享的个人资料，不是联系人；服务端按 tenantId + customerId 校验归属，
 *   客户端不能指定其他客户的地址 ID。
 * - 每客户最多一个有效默认地址；设默认与取消默认幂等。
 * - 报价时按 quoteId 固化快照（含明文电话供运营配送），订单创建后回填 orderId；
 *   之后修改/删除地址不影响历史订单，订单页展示的是快照（客户视图脱敏）。
 */
type AddressRow = Prisma.CustomerDeliveryAddressGetPayload<object>;

const MAX_ADDRESSES = 20;
const maskPhone = (value: string) => (value.length <= 4 ? "****" : `${value.slice(0, 3)}****${value.slice(-4)}`);

function text(value: unknown, max: number, label: string, required: boolean): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    if (required) throw new BadRequestException(`${label}不能为空`);
    return undefined;
  }
  if (normalized.length > max) throw new BadRequestException(`${label}最多 ${max} 个字符`);
  return normalized;
}

function coordinate(value: unknown, label: string, limit: number): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > limit) throw new BadRequestException(`${label}无效`);
  return Math.round(number * 1e7) / 1e7;
}

export interface StoredDeliverySnapshot extends Omit<ClientDeliveryAddressSnapshot, "phoneMasked"> {
  phone: string;
  phoneMasked: string;
  deliveryServiceAreaDecision?: DeliveryServiceAreaDecision;
}

@Injectable()
export class ClientDeliveryAddressService {
  constructor(private readonly prisma: PrismaService, private readonly rentalCore: RentalCoreService) {}

  private view(row: AddressRow): ClientDeliveryAddressView {
    return {
      id: row.id,
      revision: row.revision,
      recipient: row.recipient,
      phoneMasked: row.phoneMasked,
      countryCode: row.countryCode,
      province: row.province,
      city: row.city,
      district: row.district ?? undefined,
      detail: row.detail,
      postalCode: row.postalCode ?? undefined,
      latitude: row.latitude === null ? undefined : Number(row.latitude),
      longitude: row.longitude === null ? undefined : Number(row.longitude),
      isDefault: row.isDefault,
      updatedAt: row.updatedAt.toISOString()
    };
  }

  async list(context: ClientRequestContext): Promise<ClientDeliveryAddressListResponse> {
    const rows = await this.prisma.customerDeliveryAddress.findMany({
      where: { tenantId: context.tenantId, customerId: context.customerId, status: "active" },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
    });
    return { apiVersion: CLIENT_API_VERSION, items: rows.map((row) => this.view(row)) };
  }

  private normalize(input: ClientDeliveryAddressRequest) {
    const recipient = text(input.recipient, 120, "收件人", true)!;
    const rawPhone = typeof input.phone === "string" ? input.phone.trim().replace(/[\s-]/gu, "") : "";
    if (!/^\+?[0-9]{6,20}$/u.test(rawPhone)) throw new BadRequestException("联系电话格式无效");
    if (/\*/u.test(rawPhone)) throw new BadRequestException("请填写完整的联系电话，不能提交脱敏号码");
    const countryCode = (text(input.countryCode, 8, "国家/地区", false) ?? "CN").toUpperCase();
    if (!/^[A-Z]{2,8}$/u.test(countryCode)) throw new BadRequestException("国家/地区编码无效");
    return {
      recipient,
      phone: rawPhone,
      phoneMasked: maskPhone(rawPhone),
      countryCode,
      province: text(input.province, 64, "省/直辖市", true)!,
      city: text(input.city, 64, "城市", true)!,
      district: text(input.district, 64, "区/县", false) ?? null,
      detail: text(input.detail, 255, "详细地址", true)!,
      postalCode: text(input.postalCode, 16, "邮编", false) ?? null,
      latitude: coordinate(input.latitude, "纬度", 90),
      longitude: coordinate(input.longitude, "经度", 180)
    };
  }

  async save(context: ClientRequestContext, input: ClientDeliveryAddressRequest): Promise<ClientDeliveryAddressView> {
    if (context.customerType !== "personal") throw new ForbiddenException("企业账号不能维护本人配送地址");
    const data = this.normalize(input);
    const saved = await this.prisma.$transaction(async (tx) => {
      const scope = { tenantId: context.tenantId, customerId: context.customerId };
      let existing: AddressRow | null = null;
      if (input.id) {
        existing = await tx.customerDeliveryAddress.findFirst({ where: { ...scope, id: input.id, status: "active" } });
        if (!existing) throw new NotFoundException("地址不存在");
        if (input.revision !== undefined && input.revision !== existing.revision) throw new ConflictException("地址已被修改，请刷新后重试");
      } else {
        const count = await tx.customerDeliveryAddress.count({ where: { ...scope, status: "active" } });
        if (count >= MAX_ADDRESSES) throw new ConflictException(`最多保存 ${MAX_ADDRESSES} 个配送地址`);
      }
      const makeDefault = input.isDefault === true || (!existing && (await tx.customerDeliveryAddress.count({ where: { ...scope, status: "active", isDefault: true } })) === 0);
      if (makeDefault) {
        await tx.customerDeliveryAddress.updateMany({ where: { ...scope, status: "active", isDefault: true, ...(existing ? { id: { not: existing.id } } : {}) }, data: { isDefault: false } });
      }
      const payload = { ...data, latitude: data.latitude === undefined ? null : new Prisma.Decimal(data.latitude), longitude: data.longitude === undefined ? null : new Prisma.Decimal(data.longitude) };
      if (existing) {
        const updated = await tx.customerDeliveryAddress.updateMany({
          where: { id: existing.id, ...scope, status: "active", revision: existing.revision },
          data: { ...payload, isDefault: input.isDefault === undefined ? existing.isDefault : input.isDefault, revision: existing.revision + 1 }
        });
        if (updated.count !== 1) throw new ConflictException("地址已被修改，请刷新后重试");
        return tx.customerDeliveryAddress.findUniqueOrThrow({ where: { id: existing.id } });
      }
      return tx.customerDeliveryAddress.create({ data: { ...scope, ...payload, isDefault: makeDefault, status: "active" } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.view(saved);
  }

  async remove(context: ClientRequestContext, addressId: string): Promise<{ success: true }> {
    const result = await this.prisma.customerDeliveryAddress.updateMany({
      where: { tenantId: context.tenantId, customerId: context.customerId, id: addressId, status: "active" },
      data: { status: "deleted", isDefault: false }
    });
    if (result.count !== 1) throw new NotFoundException("地址不存在");
    return { success: true };
  }

  /** 报价前校验地址归属；返回用于快照的完整信息。 */
  async requireOwnAddress(
    context: ClientRequestContext,
    addressId: string
  ): Promise<AddressRow & { deliveryServiceAreaDecision: DeliveryServiceAreaDecision }> {
    const row = await this.prisma.customerDeliveryAddress.findFirst({ where: { tenantId: context.tenantId, customerId: context.customerId, id: addressId, status: "active" } });
    if (!row) throw new NotFoundException("配送地址不存在，请重新选择");
    const policy = this.rentalCore.getBusinessSettings(context.tenantId).fulfillment.deliveryServiceArea;
    const decision = evaluateDeliveryServiceArea(policy, row);
    if (!decision.allowed) {
      throw new BadRequestException("该地址不在当前经营空间的配送范围内，请更换地址或选择自取");
    }
    return Object.assign(row, { deliveryServiceAreaDecision: decision });
  }

  private snapshotOf(row: AddressRow): StoredDeliverySnapshot {
    return {
      addressId: row.id,
      recipient: row.recipient,
      phone: row.phone,
      phoneMasked: row.phoneMasked,
      countryCode: row.countryCode,
      province: row.province,
      city: row.city,
      district: row.district ?? undefined,
      detail: row.detail,
      postalCode: row.postalCode ?? undefined,
      latitude: row.latitude === null ? undefined : Number(row.latitude),
      longitude: row.longitude === null ? undefined : Number(row.longitude),
      capturedAt: new Date().toISOString()
    };
  }

  /** 按报价固化快照；同一报价重复调用返回已有快照（不改写）。 */
  async snapshotForQuote(context: ClientRequestContext, quoteId: string, address: AddressRow): Promise<StoredDeliverySnapshot> {
    const snapshot = {
      ...this.snapshotOf(address),
      ...("deliveryServiceAreaDecision" in address
        ? { deliveryServiceAreaDecision: address.deliveryServiceAreaDecision }
        : {})
    };
    try {
      const created = await this.prisma.clientOrderDeliverySnapshot.create({
        data: { tenantId: context.tenantId, workspaceId: context.workspaceId, customerId: context.customerId, quoteId, addressId: address.id, snapshot: snapshot as unknown as Prisma.InputJsonValue }
      });
      return created.snapshot as unknown as StoredDeliverySnapshot;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.prisma.clientOrderDeliverySnapshot.findFirst({ where: { tenantId: context.tenantId, quoteId } });
        if (existing) return existing.snapshot as unknown as StoredDeliverySnapshot;
      }
      throw error;
    }
  }

  async hasSnapshotForQuote(tenantId: string, quoteId: string): Promise<boolean> {
    return Boolean(await this.prisma.clientOrderDeliverySnapshot.findFirst({ where: { tenantId, quoteId }, select: { id: true } }));
  }

  /** 订单创建后把快照挂到订单上（幂等；订单已挂其他快照时不覆盖）。 */
  async attachOrder(tenantId: string, quoteId: string, orderId: string): Promise<void> {
    await this.prisma.clientOrderDeliverySnapshot.updateMany({ where: { tenantId, quoteId, orderId: null }, data: { orderId } });
  }

  /** 客户视图：脱敏后的快照。 */
  async snapshotForOrder(context: ClientRequestContext, order: { id: string; quoteId?: string | null }): Promise<ClientDeliveryAddressSnapshot | undefined> {
    const row = await this.prisma.clientOrderDeliverySnapshot.findFirst({
      where: { tenantId: context.tenantId, customerId: context.customerId, OR: [{ orderId: order.id }, ...(order.quoteId ? [{ quoteId: order.quoteId }] : [])] }
    });
    if (!row) return undefined;
    const stored = row.snapshot as unknown as StoredDeliverySnapshot;
    const { phone: _phone, deliveryServiceAreaDecision: _deliveryArea, ...rest } = stored;
    return { ...rest, phoneMasked: stored.phoneMasked || maskPhone(stored.phone ?? "") };
  }

  /** 运营端读取（含明文电话），按租户 + 订单归属校验。 */
  async snapshotForOperations(tenantId: string, workspaceId: string, order: { id: string; quoteId?: string | null }): Promise<StoredDeliverySnapshot | undefined> {
    const row = await this.prisma.clientOrderDeliverySnapshot.findFirst({
      where: { tenantId, workspaceId, OR: [{ orderId: order.id }, ...(order.quoteId ? [{ quoteId: order.quoteId }] : [])] }
    });
    return row ? (row.snapshot as unknown as StoredDeliverySnapshot) : undefined;
  }
}
