import { BadRequestException, ConflictException } from "@nestjs/common";
import type {
  RentalFulfillmentMode,
  RentalQuoteServiceSnapshot,
  RentalOrderServiceOccurrence,
  RentalServiceMandatoryRule,
  RentalValueAddedService
} from "@rental-os/shared";
import { createHash } from "node:crypto";
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

/** Revalidate retained promises against replacement goods, without repricing or
 * manufacturing a new service. A newly triggered requirement needs a separately
 * confirmed service occurrence; historical optional terms cannot become mandatory. */
export function assertExchangeServices(services: RentalValueAddedService[], ctx: Omit<RentalServiceContext, "selections">,
  occurrences: RentalOrderServiceOccurrence[], cancelledIds: readonly string[]): RentalOrderServiceOccurrence[] {
  const retained = occurrences.filter(row => !row.occurrenceId || !cancelledIds.includes(row.occurrenceId))
    .filter(row => !["cancelled", "failed", "no_show"].includes(row.executionStatus ?? "not_started"));
  if (retained.some(row => !row.occurrenceId || row.workspaceId !== ctx.workspaceId
    || !Number.isInteger(row.quantity) || row.quantity < 1)) {
    throw new ConflictException("原服务发生项缺少稳定来源或数量，不能猜测换货履约依据");
  }
  for (const row of retained.filter(row => row.executionStatus !== "completed")) {
    const service = services.find(value => value.id === row.serviceId);
    // 停用禁止新报价，不抹去原订单已锁定的服务承诺。
    if (!service || !eligibilityOf({ ...service, status: "enabled" }, { ...ctx, selections: [] }, [row.serviceLocationId]).eligible
      || !Number.isFinite(Date.parse(row.scheduledStartAt)) || !Number.isFinite(Date.parse(row.scheduledEndAt))
      || Date.parse(row.scheduledEndAt) <= Date.parse(row.scheduledStartAt)
      || !Array.isArray(row.applicableItemGroupIds)
      || row.applicableItemGroupIds.length && !row.applicableItemGroupIds.some(id => ctx.itemGroupIds.includes(id))) {
      throw new ConflictException(`服务「${row.serviceName}」不适用于替换商品，须先确认服务变更`);
    }
  }
  for (const service of services.filter(row => row.status === "enabled" && row.selectionMode === "mandatory")) {
    if (!eligibilityOf(service, { ...ctx, selections: [] }).eligible) continue;
    const hit = mandatoryRuleHit(service.mandatoryRule, ctx);
    if (!hit) continue;
    const requiredGroups = ctx.itemGroupIds.filter(id => !service.applicableItemGroupIds.length || service.applicableItemGroupIds.includes(id));
    const covered = retained.some(row => row.serviceId === service.id && row.requiredByRule && row.executionStatus !== "completed"
      && Boolean(row.serviceVersion) && Boolean(row.termsVersion)
      && Array.isArray(row.applicableItemGroupIds)
      && (!row.applicableItemGroupIds.length || requiredGroups.every(id => row.applicableItemGroupIds!.includes(id)))
      && Number.isFinite(Date.parse(row.scheduledStartAt)) && Number.isFinite(Date.parse(row.scheduledEndAt))
      && Date.parse(row.scheduledStartAt) < Date.parse(ctx.endAt) && Date.parse(row.scheduledEndAt) > Date.parse(ctx.startAt));
    if (!covered) throw new ConflictException(`替换商品按业务规则要求服务「${service.name}」（${hit}），须先选择并确认服务，不能直接换货`);
  }
  return retained.filter(row => row.executionStatus !== "completed");
}

/** 换货服务只给显式新增项取当前价；原发生项仍按原金额、条款及容量收据保留。 */
export function resolveExchangeServices(services: RentalValueAddedService[], ctx: Omit<RentalServiceContext, "selections">,
  occurrences: RentalOrderServiceOccurrence[], cancelledIds: readonly string[], selections: RentalServiceContext["selections"]) {
  if (new Set(cancelledIds).size !== cancelledIds.length) throw new ConflictException("换货服务取消不可重复");
  for (const occurrenceId of cancelledIds) {
    const row = occurrences.find(value => value.occurrenceId === occurrenceId);
    if (!row || (row.executionStatus ?? "not_started") !== "not_started" || row.refundStatus && row.refundStatus !== "none") {
      throw new ConflictException("换货服务缺少可取消的原发生项");
    }
    if (row.requiresCapacity && !row.reservationKey) throw new ConflictException("原服务缺少容量预留依据，不能安全取消");
  }
  for (const selection of selections) {
    // 明确新时段才能确认同一承诺；默认取两次试算墙钟会让确认指纹变成另一项服务。
    if (!selection.scheduledStartAt || !selection.scheduledEndAt || !selection.serviceLocationId
      || !ctx.locationIds.includes(selection.serviceLocationId)
      || Date.parse(selection.scheduledStartAt) < Date.parse(ctx.startAt) || Date.parse(selection.scheduledEndAt) > Date.parse(ctx.endAt)) {
      throw new ConflictException("换货新增服务必须明确剩余租期内的地点和时段，不能追溯保障原事件");
    }
    if (occurrences.some(row => row.serviceId === selection.serviceId && !cancelledIds.includes(row.occurrenceId ?? "")
      && !["cancelled", "failed", "no_show"].includes(row.executionStatus ?? "not_started")
      // 已完成安装/作业不是待履约承诺；保障即使完成购买仍按原有效期防重复。
      && (row.executionStatus !== "completed" || ["damage_waiver", "insurance"].includes(row.serviceType))
      && (!row.applicableItemGroupIds?.length || row.applicableItemGroupIds.some(id => ctx.itemGroupIds.includes(id)))
      && Date.parse(row.scheduledStartAt) < Date.parse(selection.scheduledEndAt!)
      && Date.parse(row.scheduledEndAt) > Date.parse(selection.scheduledStartAt!))) {
      throw new ConflictException("同一服务的原承诺仍覆盖所选时段，不能重复收费或占容量");
    }
  }
  // 未新增的强制项由原发生项承接；最终统一判据不能只看新报价漏选。
  const selectedIds = new Set(selections.map(row => row.serviceId));
  const resolved = resolveQuoteServices(services.map(row => selectedIds.has(row.id) ? row : { ...row, selectionMode: "optional" }),
    { ...ctx, selections });
  const incoming = resolved.snapshots.map((row, index) => ({ ...row, occurrenceId: `exchange-preview:${index}`, executionStatus: "not_started" as const }));
  assertExchangeServices(services, ctx, [...occurrences, ...incoming], cancelledIds);
  return resolved;
}

/** 确认指纹绑定本订单版本、替换对象、取消项和全部新服务正文，不授予操作权限。 */
export function exchangeServiceConfirmationHash(binding: { orderId: string; expectedUpdatedAt: string; orderLineId: string;
  replacementItemGroupId: string; cancelledIds: readonly string[] }, snapshots: RentalQuoteServiceSnapshot[]): string {
  return createHash("sha256").update(JSON.stringify({ ...binding, cancelledIds: [...binding.cancelledIds].sort(),
    services: [...snapshots].sort((a, b) => a.serviceId.localeCompare(b.serviceId)) })).digest("hex");
}

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
      applicableItemGroupIds: [...(service.applicableItemGroupIds ?? [])],
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
