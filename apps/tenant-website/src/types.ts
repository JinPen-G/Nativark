export type CategoryMode = 'single' | 'double' | 'multiple';
export type DemoTenantKey = 'single' | 'double' | 'multiple';

export interface SubCategory {
  id: string;
  name: string;
  nameEn?: string;
  description: string;
  descriptionEn?: string;
  image: string;
}

export interface Category {
  id: string;
  name: string;
  nameEn?: string;
  shortName: string;
  shortNameEn?: string;
  description: string;
  descriptionEn?: string;
  icon: string;
  image: string;
  heroImage: string;
  heroTitle: string;
  heroTitleEn?: string;
  heroDescription: string;
  heroDescriptionEn?: string;
  sceneTitle: string;
  sceneTitleEn?: string;
  sceneImage: string;
  children: SubCategory[];
}

export interface Testimonial {
  name: string;
  nameEn?: string;
  context: string;
  contextEn?: string;
  text: string;
  textEn?: string;
}

export interface Tenant {
  id: string;
  name: string;
  nameEn?: string;
  logo: string;
  logoCompact: string;
  slogan: string;
  sloganEn?: string;
  primaryColor: string;
  secondaryColor: string;
  phone: string;
  customerService: string;
  customerServiceEn?: string;
  address: string;
  addressEn?: string;
  footerText: string;
  footerTextEn?: string;
  heroImage: string;
  heroTitle: string;
  heroTitleEn?: string;
  heroDescription: string;
  heroDescriptionEn?: string;
  categories: Category[];
  testimonials: Testimonial[];
  showPoweredBy?: boolean;
  // 官网特有内容（真实租户模式下由 web 渠道配置提供；演示模式可省略）。
  ctaTitle?: string;
  ctaDescription?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
}

export interface Product {
  id: string;
  name: string;
  nameEn?: string;
  subtitle: string;
  subtitleEn?: string;
  cover: string;
  categoryId: string;
  subCategoryId: string;
  tags: string[];
  tagsEn?: string[];
  price: number;
  priceUnit: string;
  deposit: number;
  rating: number;
  reviewCount: number;
  stockStatus: 'available' | 'low' | 'unavailable';
  availableQuantity: number;
  badges: string[];
  badgesEn?: string[];
  description: string;
  descriptionEn?: string;
  specs: Record<string, string>;
  specsEn?: Record<string, string>;
}

export interface DemoOrder {
  id: string;
  tenantId: string;
  productId: string;
  startDate: string;
  endDate: string;
  quantity: number;
  fulfillment: 'pickup' | 'delivery';
  contactName: string;
  contactPhone: string;
  note: string;
  rentalAmount: number;
  depositAmount: number;
  createdAt: string;
}
