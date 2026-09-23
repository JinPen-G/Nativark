// 把租户客户端公开接口（bootstrap + public/catalog）映射成官网 UI 使用的 Tenant / Category / Product。
//
// 这是「真实接入」的映射层：通用品牌/发布服务来自 bootstrap，官网特有内容来自 bootstrap.website，
// 商品来自各已发布服务的 public/catalog。后端目前不提供的字段（二级分类、评分、评价数、押金、
// 精确库存、场景图、证言）按诚实占位处理——不编造数字，由页面既有「以报价为准 / 预约时确认」文案兜底。

import { clientApi, type BootstrapResponse, type CatalogItem, type PublicCatalogResponse } from './apiClient';
import type { Category, Product, SubCategory, Tenant } from '../types';

/** 后端一级品类编码 → 官网图标键（HomeSections 的 icons 映射）。 */
const CATEGORY_ICON: Record<string, string> = {
  CAMERA: 'camera', CAMPING: 'camping', VEHICLE: 'car', DIGITAL: 'laptop',
  CONSTRUCTION: 'tool', HOME: 'home', BABY: 'baby', SPORTS: 'sports',
};

/** 后端一级品类编码 → 中文短名（服务名已是完整中文名，短名用于导航/筛选）。 */
const CATEGORY_SHORT: Record<string, string> = {
  CAMERA: '摄影', CAMPING: '露营', VEHICLE: '用车', DIGITAL: '数码',
  CONSTRUCTION: '工具', HOME: '家居', BABY: '母婴', SPORTS: '运动',
};

/** 计价单位编码 → 展示单位。 */
const PRICE_UNIT: Record<string, string> = { day_24h: '天', day: '天', hour: '小时', week: '周', month: '月' };

const FALLBACK_HERO = '/assets/multi-lifestyle-hero.webp';
const FALLBACK_SCENE = '/assets/scene-camera.webp';
const PLACEHOLDER_IMAGE = '/assets/product-camera.webp';

function firstImage(item: CatalogItem): string {
  return item.images?.[0]?.url || PLACEHOLDER_IMAGE;
}

function subtitleOf(item: CatalogItem): string {
  if (item.description?.trim()) return item.description.trim();
  const attrs = item.attributes ? Object.values(item.attributes).filter(Boolean) : [];
  return attrs.slice(0, 3).join(' · ');
}

/** 一个 catalog item → 官网商品卡。后端未提供的字段用诚实占位（0/available），由页面文案兜底。 */
function toProduct(item: CatalogItem, categoryId: string, groupId: string): Product {
  const price = item.startingPrice?.amount ?? 0;
  const priceUnit = PRICE_UNIT[item.startingPrice?.unit ?? ''] ?? '天';
  return {
    id: item.id,
    name: item.name,
    subtitle: subtitleOf(item),
    cover: firstImage(item),
    categoryId,
    subCategoryId: groupId,
    tags: item.attributes?.brand ? [item.attributes.brand] : [],
    price,
    priceUnit,
    deposit: 0,
    rating: 0,
    reviewCount: 0,
    stockStatus: 'available',
    availableQuantity: 1,
    badges: [],
    description: item.description?.trim() || item.name,
    specs: item.attributes ?? {},
  };
}

/** 一个已发布服务（+它的 catalog）→ 官网一级品类。二级分类由定价分组近似（后端暂无二级结构）。 */
function toCategory(service: BootstrapResponse['services'][number], catalog: PublicCatalogResponse | null, configuredImage?: string): Category {
  const code = service.categoryCode;
  const items = catalog?.items ?? [];
  // 品类入口图优先用租户在后台配置的图，缺省再回落到该品类首个商品图。
  const coverImage = configuredImage || (items[0] ? firstImage(items[0]) : PLACEHOLDER_IMAGE);
  const children: SubCategory[] = (catalog?.pricingGroups ?? [])
    .filter(group => group.enabled !== false)
    .map(group => {
      const memberId = group.memberItemGroupIds?.[0];
      const memberItem = items.find(item => item.id === memberId) ?? items.find(item => item.id === group.id);
      return { id: group.id, name: group.name, description: '', image: memberItem ? firstImage(memberItem) : coverImage };
    });
  return {
    id: service.code,
    name: service.name,
    shortName: CATEGORY_SHORT[code] ?? service.name,
    description: children.slice(0, 3).map(child => child.name).join(' / ') || service.name,
    icon: CATEGORY_ICON[code] ?? 'gift',
    image: coverImage,
    heroImage: coverImage,
    heroTitle: service.name,
    heroDescription: '',
    sceneTitle: service.name,
    sceneImage: coverImage,
    children,
  };
}

export interface RemoteSite {
  tenant: Tenant;
  products: Product[];
}

/** 加载一个真实租户的官网数据：bootstrap 定品牌与发布服务，各服务的 public/catalog 定商品。 */
export async function loadRemoteSite(tenantCode: string): Promise<RemoteSite> {
  const bootstrap = await clientApi.bootstrap(tenantCode);
  const openServices = bootstrap.services.filter(service => service.status === 'open');

  // 各已发布服务的公开目录并行拉取；单个服务失败不影响整体（缺目录的品类仍在导航里，只是没商品）。
  const catalogs = await Promise.all(openServices.map(async service => {
    try {
      return await clientApi.publicCatalog(tenantCode, service.code);
    } catch {
      return null;
    }
  }));

  const categoryImageByCode = new Map((bootstrap.website?.categoryImages ?? []).map(item => [item.code, item.imageUrl]));
  const categories = openServices.map((service, index) => toCategory(service, catalogs[index], categoryImageByCode.get(service.code)));
  const products: Product[] = [];
  openServices.forEach((service, index) => {
    const catalog = catalogs[index];
    catalog?.items.forEach(item => {
      const group = catalog.pricingGroups?.find(g => g.memberItemGroupIds?.includes(item.id));
      products.push(toProduct(item, service.code, group?.id ?? item.id));
    });
  });

  const website = bootstrap.website;
  const merchantName = bootstrap.merchant.name;
  const tenant: Tenant = {
    id: `tenant-${bootstrap.tenantCode}`,
    name: merchantName,
    logo: bootstrap.merchant.logoUrl || '/brand/logo-horizontal.png',
    logoCompact: bootstrap.merchant.logoUrl || '/brand/logo-mark.png',
    slogan: website?.slogan || merchantName,
    primaryColor: bootstrap.themeColor || '#007aff',
    secondaryColor: website?.secondaryColor || '#eaf1f9',
    phone: bootstrap.merchant.servicePhone || '',
    customerService: bootstrap.merchant.serviceHours || '在线客服',
    address: website?.contactAddress || '',
    footerText: website?.footerText || website?.slogan || merchantName,
    heroImage: website?.heroImageUrl || (categories[0]?.heroImage ?? FALLBACK_HERO),
    heroTitle: website?.heroTitle || merchantName,
    heroDescription: website?.heroDescription || '',
    categories,
    testimonials: (website?.testimonials ?? []).map(item => ({ name: item.name, context: item.context ?? '', text: item.text })),
    advantages: website?.advantages,
    steps: website?.steps,
    showPoweredBy: website?.showPoweredBy ?? false,
    ctaTitle: website?.ctaTitle,
    ctaDescription: website?.ctaDescription,
    seoTitle: website?.seoTitle,
    seoDescription: website?.seoDescription,
    seoKeywords: website?.seoKeywords,
  };

  // 缺场景图的品类回落到通用场景图，避免空图。
  tenant.categories.forEach(category => {
    if (!category.sceneImage) category.sceneImage = FALLBACK_SCENE;
  });

  return { tenant, products };
}
