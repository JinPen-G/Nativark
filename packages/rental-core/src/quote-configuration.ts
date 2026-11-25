/** 新报价提交时核对实际参与计算的配置组合。不计算金额、不授予权限，
 * 不用于历史报价回放；调用者持有租户父锁及空间锁，并拥有原写入事务。 */
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RentalPricingRate, RentalQuoteSnapshotV1 } from './contracts';
import type { RentalBusinessContext as BusinessContext, CategoryWriteBinding } from './configuration-basis';
import type { WorkspaceCategoryConfigSnapshot } from './mysql-core-configuration';
import type { TenantBusinessConfigSnapshot } from './mysql-business-configuration';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { snapshotInspectionTemplate } from './inspection-template-snapshot';
import { normalizeBusinessSettingsForCategory } from './business-settings';

type BusinessConfiguration = Pick<TenantBusinessConfigSnapshot,
  'pricingPlans' | 'discountPlans' | 'services' | 'calendars' | 'ruleVersions'>;
type QuotePrice = { versionId: string; version: string; effectiveFrom: string; rates: RentalPricingRate[] };
type ContextCollection = 'groups' | 'pricingGroups' | 'locations' | 'operators';
/** 由应用组合提供同一仓储和调用方事务，不在事实仓储中重建数据库或事件适配。 */
export interface RentalQuoteConfigurationReader<TTransaction> {
  loadCore(tenantId: string, workspaceId: string, tx: TTransaction): PromiseLike<WorkspaceCategoryConfigSnapshot>;
  loadBusiness(tenantId: string, workspaceId: string, binding: CategoryWriteBinding, tx: TTransaction): PromiseLike<TenantBusinessConfigSnapshot>;
  readPrice(tenantId: string, workspaceId: string, startAt: string, tx: TTransaction): PromiseLike<QuotePrice | undefined>;
}

/** 两种宿主复用原配置实例和传入事务；价格仍取原不可变版本，不另开读取事务。 */
export function createRentalQuoteConfigurationReader<TTransaction extends {
  rentalPriceVersion: Pick<Prisma.TransactionClient['rentalPriceVersion'], 'findFirst'>;
}>(core: { loadWorkspaceSnapshot: RentalQuoteConfigurationReader<TTransaction>['loadCore'] },
  business: { loadWorkspaceSnapshot: RentalQuoteConfigurationReader<TTransaction>['loadBusiness'] }
): RentalQuoteConfigurationReader<TTransaction> {
  return {
    loadCore: (tenantId, workspaceId, tx) => core.loadWorkspaceSnapshot(tenantId, workspaceId, tx),
    loadBusiness: (tenantId, workspaceId, binding, tx) => business.loadWorkspaceSnapshot(tenantId, workspaceId, binding, tx),
    readPrice: async (tenantId, workspaceId, startAt, tx) => {
      const price = await tx.rentalPriceVersion.findFirst({
        where: { tenantId, workspaceId, effectiveFrom: { lte: new Date(startAt) } },
        orderBy: [{ effectiveFrom: 'desc' }, { sequence: 'desc' }]
      });
      return price ? { versionId: price.id, version: `v${price.sequence}`,
        effectiveFrom: price.effectiveFrom.toISOString(), rates: price.rates as unknown as RentalPricingRate[] } : undefined;
    }
  };
}
/** 只在服务与仓储间传递；不进入请求DTO、Shared或历史报价正文。 */
export interface RentalQuoteConfigurationBasis {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly categoryVersionId: string;
  readonly adoptionRevision: number;
  readonly coreHash: string;
  readonly businessHash: string;
  readonly priceHash: string;
  readonly ids: Record<ContextCollection, string[]>;
}

const sorted = <T extends { id: string }>(rows: readonly T[]): T[] => [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const businessHash = (value: BusinessConfiguration) => requestFingerprint({
  pricingPlans: sorted(value.pricingPlans), discountPlans: sorted(value.discountPlans), services: sorted(value.services),
  calendars: [...value.calendars].sort((a, b) => a.year - b.year || a.version.localeCompare(b.version)),
  ruleVersions: sorted(value.ruleVersions)
});

function coreHash(context: BusinessContext): string {
  const { profile, settings } = context;
  return requestFingerprint({
    category: context.category,
    profile: { tenantId: profile.tenantId, categoryCode: profile.categoryCode, configVersion: profile.configVersion,
      capabilities: [...profile.capabilities].sort() },
    settings: { tenantId: settings.tenantId, categoryCode: settings.categoryCode, configVersion: settings.configVersion,
      pricing: settings.pricing, calendar: settings.calendar,
      fulfillment: { enabledModes: settings.fulfillment.enabledModes,
        deliveryServiceArea: settings.fulfillment.deliveryServiceArea ?? { mode: 'all', areas: [] } } },
    // 媒体/展示说明不参与报价；R0与营运上下文释放的这些字段不同。
    groups: sorted(context.groups).map(({ description: _description, images: _images, attributes, ...row }) => {
      const { __itemGroupMedia: _media, ...businessAttributes } = attributes;
      return { ...row, attributes: businessAttributes,
        bundleComponents: [...row.bundleComponents].sort((a, b) => a.itemGroupId.localeCompare(b.itemGroupId)) };
    }),
    pricingGroups: sorted(context.pricingGroups ?? []).map(({ description: _description, ...row }) => row),
    locations: sorted(context.locations).map(row => ({ id: row.id, tenantId: row.tenantId, code: row.code, name: row.name,
      type: row.type, organizationId: row.organizationId, operatorId: row.operatorId, operatorType: row.operatorType,
      operatorName: row.operatorName, parentLocationId: row.parentLocationId, timezone: row.timezone,
      capabilities: [...row.capabilities].sort(), status: row.status })),
    operators: sorted(context.operators).map(row => ({ id: row.id, tenantId: row.tenantId, code: row.code, name: row.name,
      type: row.type, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt }))
  });
}

export function captureQuoteConfigurationBasis(tenantId: string, workspaceId: string, context: BusinessContext,
  business: BusinessConfiguration, price: QuotePrice): RentalQuoteConfigurationBasis {
  if (!context.categoryVersionId || !Number.isSafeInteger(context.categoryAdoptionRevision) || context.categoryAdoptionRevision! < 0)
    throw new ConflictException('新报价缺少当前品类绑定依据');
  return { tenantId, workspaceId, categoryVersionId: context.categoryVersionId, adoptionRevision: context.categoryAdoptionRevision!,
    coreHash: coreHash(context), businessHash: businessHash(business),
    priceHash: requestFingerprint(price), ids: {
      groups: context.groups.map(row => row.id), pricingGroups: (context.pricingGroups ?? []).map(row => row.id),
      locations: context.locations.map(row => row.id), operators: context.operators.map(row => row.id)
    } };
}

export async function assertQuoteConfigurationBasis<TTransaction>(tx: TTransaction, tenantId: string, workspaceId: string,
  quote: RentalQuoteSnapshotV1, basis: RentalQuoteConfigurationBasis | undefined,
  reader: RentalQuoteConfigurationReader<TTransaction> | undefined) {
  if (!basis || !reader)
    throw new ServiceUnavailableException('新报价缺少完整配置组合依据，不能保存');
  if (basis.tenantId !== tenantId || basis.workspaceId !== workspaceId)
    throw new ConflictException('报价配置依据与当前租户或经营空间不一致');
  const current = await reader.loadCore(tenantId, workspaceId, tx);
  if (current.tenantId !== tenantId || current.workspaceId !== workspaceId || !current.profile || !current.businessSettings
    || current.definition.code !== quote.categoryCode || current.binding.categoryVersionId !== quote.categoryVersionId
    || current.binding.categoryVersionId !== basis.categoryVersionId || current.binding.adoptionRevision !== basis.adoptionRevision)
    throw new ConflictException('报价经营配置或品类来源已变化');
  const select = <T extends { id: string }>(rows: readonly T[], ids: readonly string[]): T[] => {
    const wanted = new Set(ids);
    if (wanted.size !== ids.length) throw new ConflictException('报价配置依据含重复对象');
    const selected = rows.filter(row => wanted.has(row.id));
    if (selected.length !== ids.length) throw new ConflictException('报价配置对象已变化，请重新准备');
    return selected;
  };
  // 只核对调用者已读取的授权集合，不扩大员工地点投影，也不返回内部配置。
  const context: BusinessContext = { category: current.definition, profile: current.profile, settings: current.businessSettings,
    groups: select(current.itemGroups, basis.ids.groups), pricingGroups: select(current.pricingGroups ?? [], basis.ids.pricingGroups),
    locations: select(current.locations, basis.ids.locations), operators: select(current.operators, basis.ids.operators), couponTemplates: [] };
  // 正式R0读口已应用原兼容归一化；原营运上下文仍可能是持久原文。
  if (basis.coreHash !== coreHash(context) && basis.coreHash !== coreHash({ ...context,
    settings: normalizeBusinessSettingsForCategory(context.settings, context.category) }))
    throw new ConflictException('报价期间经营配置已变化，请重新准备');
  const configuration = await reader.loadBusiness(tenantId, workspaceId, current.binding, tx);
  if (configuration.tenantId !== tenantId || configuration.workspaceId !== workspaceId || configuration.categoryCode !== quote.categoryCode
    || basis.businessHash !== businessHash(configuration))
    throw new ConflictException('报价期间价格计划、优惠、服务、日历或规则已变化，请重新准备');
  const price = await reader.readPrice(tenantId, workspaceId, quote.request.startAt, tx);
  if (!price || price.versionId !== quote.priceVersionId || price.version !== quote.priceVersion
    || basis.priceHash !== requestFingerprint(price))
    throw new ConflictException('报价期间生效价格版本已变化，请重新准备');
  const inspections = current.inspectionTemplates.filter(row => row.enabled)
    .map(row => snapshotInspectionTemplate(current.definition, row, quote.capabilityRequirementsSnapshot));
  if (!quote.inspectionTemplateSnapshots || requestFingerprint(sorted(inspections)) !== requestFingerprint(sorted(quote.inspectionTemplateSnapshots)))
    throw new ConflictException('报价期间检查模板已变化，请重新准备');
}
