import { BadRequestException, ConflictException } from "@nestjs/common";
import type {
  RentalFulfillmentMode,
  RentalQuoteServiceSnapshot,
  RentalServiceMandatoryRule,
  RentalValueAddedService
} from "@rental-os/shared";
import { businessDayIndex } from "./rental-business-day";

/**
 * MKT-02A：增值服务的适用性判定、计费单位换算与条款快照（需求 4.4.11）。
 *
 * 独立成纯函数模块的理由与优惠取舍相同：「这个服务凭什么可用、为什么算这么多钱」
 * 必须逐条回放。四个品类共用同一套判定，因此这里不出现任何品类编码分支。
 *
 * 本模块**不**处理容量、人员排班、物流任务与真实保险 Provider：
 * 前三者属 MKT-02B 与 SHARED-PEOPLE-01/LOG-01，最后一项属 EXT-02。
 */

export interface RentalServiceContext {
  /** 报价选择的服务与数量。 */
  selections: Array<{
    serviceId: string;
    quantity: number;
    scheduledStartAt?: string;
    scheduledEndAt?: string;
    serviceLocationId?: string;
  }>;
  itemGroupIds: string[];
  fulfillmentMode: RentalFulfillmentMode;
  /** 领取地点；异地归还时归还地点也参与判定。 */
  locationIds: string[];
  customerType: "personal" | "corporate";
  startAt: string;
  endAt: string;
  timeZone: string;
  /** 优惠前租金，用于「高价值商品强制基础保障」这类触发规则。 */
  rentalAmount: number;
  workspaceId: string;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * 计费单位数。自然日与夜用与商品取价**同一个日界口径**（营业时区日序号），
 * 否则同一张报价里服务按 24 小时块、租金按自然日，两者的天数会对不上。
 */
export function serviceBillingUnits(
  billingUnit: RentalValueAddedService["billingUnit"],
  startAt: string,
  endAt: string,
  timeZone: string
): number {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (end <= start) return billingUnit === "per_order" || billingUnit === "per_unit" || billingUnit === "per_rental_period" ? 1 : 0;
  switch (billingUnit) {
    case "per_order":
    case "per_unit":
    case "per_rental_period":
      return 1;
    case "per_hour":
      return Math.ceil((end - start) / 3_600_000);
    case "per_night":
      return Math.max(0, businessDayIndex(new Date(end - 1).toISOString(), timeZone) - businessDayIndex(startAt, timeZone));
    case "per_day":
    default:
      // 自然日：占用的日期个数。周一 22:00 到周二 08:00 占用两个工作日，
      // 按 24 小时折算只会算成一天——那是 per_rental_period 的语义，不是每自然日。
      return businessDayIndex(new Date(end - 1).toISOString(), timeZone) - businessDayIndex(startAt, timeZone) + 1;
  }
}

/** 触发规则是否命中。返回命中说明，供快照记录「按哪条规则强制」。 */
export function mandatoryRuleHit(
  rule: RentalServiceMandatoryRule | undefined,
  ctx: Pick<RentalServiceContext, "itemGroupIds" | "fulfillmentMode" | "rentalAmount">
): string | undefined {
  if (!rule) return undefined;
  const hits: string[] = [];
  if (rule.itemGroupIds?.length && ctx.itemGroupIds.some((id) => rule.itemGroupIds?.includes(id))) {
    hits.push("命中指定商品");
  }
  if (rule.fulfillmentModes?.length && rule.fulfillmentModes.includes(ctx.fulfillmentMode)) {
    hits.push(`命中履约方式 ${ctx.fulfillmentMode}`);
  }
  if (rule.minRentalAmount !== undefined && ctx.rentalAmount >= rule.minRentalAmount) {
    hits.push(`优惠前租金 ${ctx.rentalAmount} 达到 ${rule.minRentalAmount}`);
  }
  return hits.length ? hits.join("；") : undefined;
}

/** 逐条资格判据。留空的适用范围表示不限制，不是「都不适用」。 */
function eligibilityOf(service: RentalValueAddedService, ctx: RentalServiceContext, locationIds = ctx.locationIds) {
  const rows: RentalQuoteServiceSnapshot["eligibility"] = [];
  const record = (rule: string, passed: boolean, detail?: string) => {
    rows.push({ rule, passed, detail });
    return passed;
  };
  const statusOk = record("status", service.status === "enabled", `状态 ${service.status}`);
  const groupOk = record(
    "item_group",
    !service.applicableItemGroupIds.length || ctx.itemGroupIds.some((id) => service.applicableItemGroupIds.includes(id))
  );
  const modeOk = record(
    "fulfillment_mode",
    !service.applicableFulfillmentModes.length || service.applicableFulfillmentModes.includes(ctx.fulfillmentMode),
    `本次履约方式 ${ctx.fulfillmentMode}`
  );
  const locationOk = record(
    "location",
    !service.applicableLocationIds.length || locationIds.some((id) => service.applicableLocationIds.includes(id))
  );
  const scopeOk = record(
    "customer_scope",
    service.customerScope === "all" || service.customerScope === ctx.customerType,
    `服务范围 ${service.customerScope}`
  );
  return { rows, eligible: statusOk && groupOk && modeOk && locationOk && scopeOk };
}

/**
 * 解析本次报价的服务明细与快照。
 *
 * 顺序（需求 4.4.11）：
 *   1. 逐个校验被选服务的适用性、数量范围；不适用即**明确拒绝**，不静默丢弃；
 *   2. 按计费单位算单位数与金额；
 *   3. 检查条件强制服务是否被漏选——强制服务必须在单里，且标记「业务规则要求」；
 *   4. 固化服务、价格、资格与条款快照。
 */
export function resolveQuoteServices(
  services: RentalValueAddedService[],
  ctx: RentalServiceContext
): { snapshots: RentalQuoteServiceSnapshot[]; totalAmount: number } {
  const byId = new Map(services.map((service) => [service.id, service]));
  const selected = new Map<string, RentalServiceContext["selections"][number]>();
  for (const selection of ctx.selections) {
    if (selected.has(selection.serviceId)) {
      throw new BadRequestException("同一增值服务在一次报价中只能出现一行，请用数量表达多份");
    }
    selected.set(selection.serviceId, selection);
  }

  const snapshots: RentalQuoteServiceSnapshot[] = [];
  let totalAmount = 0;
  for (const [serviceId, selection] of selected) {
    const service = byId.get(serviceId);
    if (!service) throw new BadRequestException("增值服务不存在");
    const quantity = selection.quantity;
    if (service.billingUnit === "per_hour" && (!selection.scheduledStartAt || !selection.scheduledEndAt)) {
      throw new BadRequestException(`${service.name} 按实际服务时段计费，必须填写服务开始和结束时间`);
    }
    if (service.requiresCapacity && (!selection.scheduledStartAt || !selection.scheduledEndAt || !selection.serviceLocationId)) {
      throw new BadRequestException(`${service.name} 需要预留容量，必须填写服务地点、开始时间和结束时间`);
    }
    const scheduledStartAt = selection.scheduledStartAt ?? ctx.startAt;
    const scheduledEndAt = selection.scheduledEndAt ?? ctx.endAt;
    const serviceLocationId = selection.serviceLocationId ?? ctx.locationIds[0];
    const startMs = new Date(scheduledStartAt).getTime();
    const endMs = new Date(scheduledEndAt).getTime();
    if (!serviceLocationId || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      throw new BadRequestException(`${service.name} 的服务地点或计划时段无效`);
    }
    const { rows, eligible } = eligibilityOf(service, ctx, [serviceLocationId]);
    if (!eligible) {
      const failed = rows.find((row) => !row.passed);
      throw new ConflictException(
        `${service.name} 不适用于本次报价（未通过：${failed?.rule}${failed?.detail ? `，${failed.detail}` : ""}）`
      );
    }
    if (!Number.isInteger(quantity) || quantity < service.minimumQuantity || quantity > service.maximumQuantity) {
      throw new BadRequestException(
        `${service.name} 的数量必须是 ${service.minimumQuantity} 到 ${service.maximumQuantity} 之间的整数`
      );
    }
    const billingUnits = serviceBillingUnits(service.billingUnit, scheduledStartAt, scheduledEndAt, ctx.timeZone);
    // 按件计价乘商品数量没有意义（服务数量本身就是份数），因此单位数与数量分开相乘。
    const amount = money(service.price * quantity * billingUnits);
    totalAmount = money(totalAmount + amount);
    const ruleHit = service.selectionMode === "mandatory" ? mandatoryRuleHit(service.mandatoryRule, ctx) : undefined;
    snapshots.push({
      serviceId: service.id,
      serviceCode: service.code,
      serviceName: service.name,
      serviceType: service.serviceType,
      serviceVersion: service.version,
      workspaceId: ctx.workspaceId,
      billingUnit: service.billingUnit,
      selectionMode: service.selectionMode,
      requiredByRule: Boolean(ruleHit),
      mandatoryRuleHit: ruleHit,
      unitPrice: service.price,
      quantity,
      billingUnits,
      amount,
      formula: `${service.price} × ${quantity} 份 × ${billingUnits} ${service.billingUnit} = ${amount}`,
      coverageLimit: service.coverageLimit,
      deductible: service.deductible,
      termsVersion: service.termsVersion,
      terms: service.terms,
      eligibility: rows,
      // 未接入真实保险 Provider 前恒为 false：损坏免赔是商户责任减免，
      // 保险占位也只是预留能力，两者都不得向客户显示「已投保」。
      insuredDisplayable: false,
      insuranceProviderStatus: service.serviceType === "insurance" ? service.insuranceProviderStatus : undefined,
      insuranceProviderName: service.serviceType === "insurance" ? service.insuranceProviderName : undefined,
      requiresCapacity: service.requiresCapacity,
      scheduledStartAt,
      scheduledEndAt,
      serviceLocationId,
      capacityQuantity: quantity
    });
  }

  // 条件强制服务漏选必须拒绝，而不是悄悄替客户加上——需求要求客户重新确认金额与条款。
  for (const service of services) {
    if (service.status !== "enabled" || service.selectionMode !== "mandatory") continue;
    if (selected.has(service.id)) continue;
    const { eligible } = eligibilityOf(service, ctx);
    if (!eligible) continue;
    const hit = mandatoryRuleHit(service.mandatoryRule, ctx);
    if (!hit) continue;
    throw new ConflictException(
      `本次报价按业务规则要求必须包含服务「${service.name}」（触发原因：${hit}），请选择后重新报价`
    );
  }

  return { snapshots, totalAmount };
}
