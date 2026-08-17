import { Injectable } from "@nestjs/common";
import { Prisma, type $Enums } from "@prisma/client";
import type {
  RentalCalendarDay,
  RentalCalendarYear,
  RentalCategoryCode,
  RentalDayType,
  RentalDiscountPlan,
  RentalNotificationTemplateV1,
  RentalPricingPlanV1,
  RentalPricingRate,
  RentalRuleConfig,
  RentalRuleVersion,
  RentalValueAddedService
} from "@store-rental/shared";
import { PrismaService } from "../database/prisma.service";

/** 单个租户的业务配置，用于启动预热写穿缓存。 */
export interface TenantBusinessConfigSnapshot {
  tenantId: string;
  categoryCode?: RentalCategoryCode;
  pricingPlans: RentalPricingPlanV1[];
  discountPlans: RentalDiscountPlan[];
  services: RentalValueAddedService[];
  calendars: RentalCalendarYear[];
  ruleVersions: RentalRuleVersion[];
  notificationTemplates: RentalNotificationTemplateV1[];
}

/**
 * 业务配置的库侧接口。与核心配置仓储同构：库是事实源，服务层内存副本是写穿缓存，
 * 不连库的单元测试注入吸收式 stub，持久化语义只在 MySQL E2E 验证。
 */
export interface RentalBusinessConfigStore {
  loadAll(): Promise<TenantBusinessConfigSnapshot[]>;
  upsertPricingPlan(plan: RentalPricingPlanV1): Promise<void>;
  upsertDiscountPlan(plan: RentalDiscountPlan): Promise<void>;
  upsertService(service: RentalValueAddedService): Promise<void>;
  upsertCalendar(calendar: RentalCalendarYear): Promise<void>;
  upsertRuleVersion(version: RentalRuleVersion): Promise<void>;
  upsertNotificationTemplate(template: RentalNotificationTemplateV1): Promise<void>;
}

function iso(value: Date): string {
  return value.toISOString();
}

function optionalIso(value: Date | null): string | undefined {
  return value ? value.toISOString() : undefined;
}

function num(value: Prisma.Decimal): number {
  return Number(value);
}

function optionalNum(value: Prisma.Decimal | null): number | undefined {
  return value === null ? undefined : Number(value);
}

function lower<T extends string>(value: string): T {
  return value.toLowerCase() as T;
}

function upper<T extends string>(value: string): T {
  return value.toUpperCase() as T;
}

function money(value: number | undefined) {
  return value === undefined ? null : new Prisma.Decimal(value);
}

/** RC-01 阶段 4：Rental Core 业务配置的库侧实现（定价、优惠、增值服务、日历、规则版本、通知模板）。 */
@Injectable()
export class RentalBusinessConfigRepository implements RentalBusinessConfigStore {
  constructor(private readonly prisma: PrismaService) {}

  async loadAll(): Promise<TenantBusinessConfigSnapshot[]> {
    const [pricing, discounts, services, calendars, rules, templates] = await Promise.all([
      this.prisma.rentalPricingPlan.findMany({ orderBy: { createdAt: "desc" } }),
      this.prisma.rentalDiscountPlan.findMany({ orderBy: { createdAt: "desc" } }),
      this.prisma.rentalValueAddedService.findMany({ orderBy: { createdAt: "desc" } }),
      this.prisma.rentalBusinessCalendar.findMany({ orderBy: { year: "desc" } }),
      this.prisma.rentalRuleVersion.findMany({ orderBy: { createdAt: "desc" } }),
      this.prisma.rentalNotificationTemplate.findMany({ orderBy: { createdAt: "desc" } })
    ]);

    const tenantIds = new Set<string>([
      ...pricing.map((row) => row.tenantId),
      ...discounts.map((row) => row.tenantId),
      ...services.map((row) => row.tenantId),
      ...calendars.map((row) => row.tenantId),
      ...rules.map((row) => row.tenantId),
      ...templates.map((row) => row.tenantId)
    ]);

    return [...tenantIds].map((tenantId) => {
      const tenantRules = rules.filter((row) => row.tenantId === tenantId);
      return {
        tenantId,
        // 品类以该租户任一业务配置行为准；配置为空时由核心档案决定，这里不猜。
        categoryCode: tenantRules.length
          ? lower<RentalCategoryCode>(tenantRules[0].categoryCode)
          : pricing.find((row) => row.tenantId === tenantId)
            ? lower<RentalCategoryCode>(pricing.find((row) => row.tenantId === tenantId)!.categoryCode)
            : undefined,
        pricingPlans: pricing.filter((row) => row.tenantId === tenantId).map((row) => this.toPricingPlan(row)),
        discountPlans: discounts.filter((row) => row.tenantId === tenantId).map((row) => this.toDiscountPlan(row)),
        services: services.filter((row) => row.tenantId === tenantId).map((row) => this.toService(row)),
        calendars: calendars.filter((row) => row.tenantId === tenantId).map((row) => this.toCalendar(row)),
        ruleVersions: tenantRules.map((row) => this.toRuleVersion(row)),
        notificationTemplates: templates
          .filter((row) => row.tenantId === tenantId)
          .map((row) => this.toNotificationTemplate(row))
      };
    });
  }

  async upsertPricingPlan(plan: RentalPricingPlanV1): Promise<void> {
    const data = {
      tenantId: plan.tenantId,
      categoryCode: upper<$Enums.RentalCategoryCode>(plan.categoryCode),
      code: plan.code,
      name: plan.name,
      currency: plan.currency,
      status: plan.status,
      version: plan.version,
      effectiveFrom: new Date(plan.effectiveFrom),
      effectiveTo: plan.effectiveTo ? new Date(plan.effectiveTo) : null,
      rates: plan.rates as unknown as Prisma.InputJsonValue
    };
    await this.prisma.rentalPricingPlan.upsert({
      where: { id: plan.id },
      create: { id: plan.id, ...data, createdAt: new Date(plan.createdAt) },
      update: data
    });
  }

  async upsertDiscountPlan(plan: RentalDiscountPlan): Promise<void> {
    const data = {
      tenantId: plan.tenantId,
      categoryCode: upper<$Enums.RentalCategoryCode>(plan.categoryCode),
      code: plan.code,
      name: plan.name,
      status: plan.status,
      discountType: plan.discountType,
      discountValue: new Prisma.Decimal(plan.discountValue),
      minimumSpend: new Prisma.Decimal(plan.minimumSpend),
      maximumDiscount: money(plan.maximumDiscount),
      customerScope: plan.customerScope,
      applicableItemGroupIds: plan.applicableItemGroupIds as unknown as Prisma.InputJsonValue,
      applicableDayTypes: plan.applicableDayTypes as unknown as Prisma.InputJsonValue,
      priority: plan.priority,
      stackableWithCoupon: plan.stackableWithCoupon,
      effectiveFrom: new Date(plan.effectiveFrom),
      effectiveTo: plan.effectiveTo ? new Date(plan.effectiveTo) : null,
      version: plan.version
    };
    await this.prisma.rentalDiscountPlan.upsert({
      where: { id: plan.id },
      create: { id: plan.id, ...data, createdAt: new Date(plan.createdAt) },
      update: data
    });
  }

  async upsertService(service: RentalValueAddedService): Promise<void> {
    const data = {
      tenantId: service.tenantId,
      categoryCode: upper<$Enums.RentalCategoryCode>(service.categoryCode),
      code: service.code,
      name: service.name,
      serviceType: service.serviceType,
      billingUnit: service.billingUnit,
      price: new Prisma.Decimal(service.price),
      maximumQuantity: service.maximumQuantity,
      coverageLimit: money(service.coverageLimit),
      deductible: money(service.deductible),
      termsVersion: service.termsVersion,
      terms: service.terms,
      applicableItemGroupIds: service.applicableItemGroupIds as unknown as Prisma.InputJsonValue,
      status: service.status,
      version: service.version
    };
    await this.prisma.rentalValueAddedService.upsert({
      where: { id: service.id },
      create: { id: service.id, ...data, createdAt: new Date(service.createdAt) },
      update: data
    });
  }

  /** 日历按 (租户, 年份) 唯一；整年按日明细随该行一起写。 */
  async upsertCalendar(calendar: RentalCalendarYear): Promise<void> {
    const data = {
      region: calendar.region,
      version: calendar.version,
      status: calendar.status,
      sourceName: calendar.sourceName ?? null,
      sourceUrl: calendar.sourceUrl ?? null,
      sourcePublishedAt: calendar.sourcePublishedAt ? new Date(calendar.sourcePublishedAt) : null,
      importedAt: calendar.importedAt ? new Date(calendar.importedAt) : null,
      publishedAt: calendar.publishedAt ? new Date(calendar.publishedAt) : null,
      days: calendar.days as unknown as Prisma.InputJsonValue
    };
    await this.prisma.rentalBusinessCalendar.upsert({
      where: { tenantId_year: { tenantId: calendar.tenantId, year: calendar.year } },
      create: { tenantId: calendar.tenantId, year: calendar.year, ...data },
      update: data
    });
  }

  async upsertRuleVersion(version: RentalRuleVersion): Promise<void> {
    const data = {
      tenantId: version.tenantId,
      categoryCode: upper<$Enums.RentalCategoryCode>(version.categoryCode),
      version: version.version,
      status: version.status,
      config: version.config as unknown as Prisma.InputJsonValue,
      changeReason: version.changeReason,
      createdBy: version.createdBy,
      publishedAt: version.publishedAt ? new Date(version.publishedAt) : null
    };
    await this.prisma.rentalRuleVersion.upsert({
      where: { id: version.id },
      create: { id: version.id, ...data, createdAt: new Date(version.createdAt) },
      update: data
    });
  }

  async upsertNotificationTemplate(template: RentalNotificationTemplateV1): Promise<void> {
    const data = {
      tenantId: template.tenantId,
      eventCode: template.eventCode,
      channel: template.channel,
      name: template.name,
      title: template.title,
      body: template.body,
      variableSchema: template.variableSchema as unknown as Prisma.InputJsonValue,
      status: template.status,
      version: template.version
    };
    await this.prisma.rentalNotificationTemplate.upsert({
      where: { id: template.id },
      create: { id: template.id, ...data },
      update: data
    });
  }

  /* ---------- 行 → 领域对象 ---------- */

  private toPricingPlan(row: Prisma.RentalPricingPlanGetPayload<object>): RentalPricingPlanV1 {
    return {
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      code: row.code,
      name: row.name,
      currency: row.currency as "CNY",
      status: row.status as RentalPricingPlanV1["status"],
      version: row.version,
      effectiveFrom: iso(row.effectiveFrom),
      effectiveTo: optionalIso(row.effectiveTo),
      rates: (row.rates ?? []) as unknown as RentalPricingRate[],
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }

  private toDiscountPlan(row: Prisma.RentalDiscountPlanGetPayload<object>): RentalDiscountPlan {
    return {
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      code: row.code,
      name: row.name,
      status: row.status as RentalDiscountPlan["status"],
      discountType: row.discountType as RentalDiscountPlan["discountType"],
      discountValue: num(row.discountValue),
      minimumSpend: num(row.minimumSpend),
      maximumDiscount: optionalNum(row.maximumDiscount),
      customerScope: row.customerScope as RentalDiscountPlan["customerScope"],
      applicableItemGroupIds: (row.applicableItemGroupIds ?? []) as string[],
      applicableDayTypes: (row.applicableDayTypes ?? []) as RentalDayType[],
      priority: row.priority,
      stackableWithCoupon: row.stackableWithCoupon,
      effectiveFrom: iso(row.effectiveFrom),
      effectiveTo: optionalIso(row.effectiveTo),
      version: row.version,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }

  private toService(row: Prisma.RentalValueAddedServiceGetPayload<object>): RentalValueAddedService {
    return {
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      code: row.code,
      name: row.name,
      serviceType: row.serviceType as RentalValueAddedService["serviceType"],
      billingUnit: row.billingUnit as RentalValueAddedService["billingUnit"],
      price: num(row.price),
      maximumQuantity: row.maximumQuantity,
      coverageLimit: optionalNum(row.coverageLimit),
      deductible: optionalNum(row.deductible),
      termsVersion: row.termsVersion,
      terms: row.terms,
      applicableItemGroupIds: (row.applicableItemGroupIds ?? []) as string[],
      status: row.status as RentalValueAddedService["status"],
      version: row.version,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }

  private toCalendar(row: Prisma.RentalBusinessCalendarGetPayload<object>): RentalCalendarYear {
    return {
      tenantId: row.tenantId,
      year: row.year,
      region: row.region as RentalCalendarYear["region"],
      version: row.version,
      status: row.status as RentalCalendarYear["status"],
      sourceName: row.sourceName ?? undefined,
      sourceUrl: row.sourceUrl ?? undefined,
      sourcePublishedAt: optionalIso(row.sourcePublishedAt),
      importedAt: optionalIso(row.importedAt),
      publishedAt: optionalIso(row.publishedAt),
      days: (row.days ?? []) as unknown as RentalCalendarDay[]
    };
  }

  private toRuleVersion(row: Prisma.RentalRuleVersionGetPayload<object>): RentalRuleVersion {
    return {
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      version: row.version,
      status: row.status as RentalRuleVersion["status"],
      config: row.config as unknown as RentalRuleConfig,
      changeReason: row.changeReason,
      createdBy: row.createdBy,
      createdAt: iso(row.createdAt),
      publishedAt: optionalIso(row.publishedAt)
    };
  }

  private toNotificationTemplate(row: Prisma.RentalNotificationTemplateGetPayload<object>): RentalNotificationTemplateV1 {
    return {
      id: row.id,
      tenantId: row.tenantId,
      eventCode: row.eventCode,
      channel: row.channel as RentalNotificationTemplateV1["channel"],
      name: row.name,
      title: row.title,
      body: row.body,
      variableSchema: (row.variableSchema ?? {}) as RentalNotificationTemplateV1["variableSchema"],
      status: row.status as RentalNotificationTemplateV1["status"],
      version: row.version,
      updatedAt: iso(row.updatedAt)
    };
  }
}
