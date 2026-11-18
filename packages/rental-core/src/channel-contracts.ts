/** Rental客户端渠道、发布空间与官网配置的单源合同；公共品牌/身份由平台合同提供。 */
import type { AdminLoginBranding } from "@rental-os/platform-contracts";

/* ---------- MP-01 / CLIENT-CHANNEL-01：客户端渠道配置（运营端） ---------- */

/**
 * 租户级客户端渠道配置（小程序与 APP 共用一份）：品牌、客服、协议、帮助、首页横幅、
 * 登录方式开关与发布到客户端的服务空间。渠道凭证（微信 AppID/密钥）单独保存在 MiniProgramChannelSummary。
 */
export interface ClientChannelAgreementConfig {
  /** 展示名称，如“用户服务协议”。 */
  name: string;
  /** 版本号，登录/注册留痕使用；变更须显式保存。 */
  version: string;
  /** 可选外部链接（HTTPS）。 */
  url?: string;
  /** 纯文本或 CLIENT_RICH_TEXT_PREFIX + 安全文档节点 JSON；用 parseClientRichText 识别。不可直接作为 HTML 执行；总长度含格式标记不超过 20000 字符。 */
  body?: string;
}

export interface ClientChannelFaqItem {
  question: string;
  answer: string;
}

export interface ClientChannelReadiness {
  ready: boolean;
  /** 未完成项的可读说明，供开业配置与本页顶部提示。 */
  missing: string[];
}

/** 可发布的经营空间（当前租户全部启用空间），供后台勾选。 */
export interface ClientChannelWorkspaceOption {
  id: string;
  code: string;
  name: string;
  categoryCode: string;
  status: string;
}

export interface ClientChannelProfileSummary {
  configured: boolean;
  revision: number;
  brandName?: string;
  brandLogoUrl?: string;
  faviconUrl?: string;
  customerServicePhone?: string;
  customerServiceHours?: string;
  userAgreement?: ClientChannelAgreementConfig;
  privacyPolicy?: ClientChannelAgreementConfig;
  helpIntro?: string;
  helpFaq: ClientChannelFaqItem[];
  bannerTitle?: string;
  bannerSubtitle?: string;
  adminLogin?: AdminLoginBranding;
  /** 客户端与管理后台主题色（#RRGGBB）；未设置时各端用系统默认色。 */
  themeColor?: string;
  /** 管理后台基础控件圆角（px，旧字段/回退基准）；胶囊页签与圆形图标按钮不受此值强行变形。 */
  adminCornerRadius: number;
  /** 容器（卡片/弹窗/抽屉/表格）圆角（px）；未设置时回退 adminCornerRadius。 */
  adminContainerRadius?: number;
  /** 按钮/分段/选中菜单圆角（px）；未设置时回退 adminCornerRadius。 */
  adminButtonRadius?: number;
  /** 输入/选择/日期等录入控件圆角（px）；未设置时回退 adminCornerRadius。 */
  adminInputRadius?: number;
  smsLoginEnabled: boolean;
  passwordLoginEnabled: boolean;
  publishedWorkspaceIds: string[];
  defaultWorkspaceId?: string;
  workspaces: ClientChannelWorkspaceOption[];
  readiness: ClientChannelReadiness;
  updatedAt?: string;
}

export interface SaveClientChannelProfileRequest {
  /** 携带上次读到的修订号；不一致时拒绝保存，防止两人互相覆盖。首次保存可省略。 */
  expectedRevision?: number;
  brandName?: string;
  brandLogoUrl?: string;
  /** 浏览器标签页图标；留空回退平台默认图标。 */
  faviconUrl?: string;
  customerServicePhone?: string;
  customerServiceHours?: string;
  userAgreement?: ClientChannelAgreementConfig;
  privacyPolicy?: ClientChannelAgreementConfig;
  helpIntro?: string;
  helpFaq?: ClientChannelFaqItem[];
  bannerTitle?: string;
  bannerSubtitle?: string;
  adminLogin?: AdminLoginBranding;
  /** 客户端与管理后台主题色（#RRGGBB）；留空表示回退系统默认色。 */
  themeColor?: string;
  /** 旧统一圆角（4–20px）；省略保留存量，显式 null 清除覆盖；新请求不接受历史极值。 */
  adminCornerRadius?: number | null;
  /** 容器圆角（4–20px）；省略保留，显式 null 回退旧统一值或角色默认值。 */
  adminContainerRadius?: number | null;
  /** 按钮/分段/选中菜单圆角（4–16px）；省略保留，显式 null 回退。 */
  adminButtonRadius?: number | null;
  /** 输入/选择/日期等录入圆角（4–16px）；省略保留，显式 null 回退。 */
  adminInputRadius?: number | null;
  smsLoginEnabled: boolean;
  passwordLoginEnabled: boolean;
  publishedWorkspaceIds: string[];
  defaultWorkspaceId?: string;
}

/**
 * web 官网渠道配置（WEBSITE-CHANNEL-01，运营端读）。只含官网特有设定项；
 * 商户名/Logo/协议/客服/帮助/发布服务仍在 ClientChannelProfileSummary。一租户一条。
 */
export interface WebsiteCategoryImage {
  /** 经营空间/服务编码（= 官网一级品类）。 */
  code: string;
  /** 品类入口图地址（HTTPS）。 */
  imageUrl: string;
}

/** 官网「为什么选择我们」卖点。icon 为可选图标键（authentic/delivery/flexible/service/quality/support…）。 */
export interface WebsiteAdvantage {
  icon?: string;
  title: string;
  description?: string;
}

/** 官网「租赁流程」步骤。 */
export interface WebsiteStep {
  title: string;
  description?: string;
}

/** 官网「用户评价 / 客户案例」。 */
export interface WebsiteTestimonial {
  name: string;
  context?: string;
  text: string;
}

export interface WebsiteChannelProfileSummary {
  configured: boolean;
  revision: number;
  /** 官网渠道是否对外启用；关闭时公开启动接口不返回官网配置。 */
  enabled: boolean;
  slogan?: string;
  heroTitle?: string;
  heroDescription?: string;
  heroImageUrl?: string;
  /** 辅助/强调色（#RRGGBB）；主色仍在通用配置的 themeColor。 */
  secondaryColor?: string;
  footerText?: string;
  contactAddress?: string;
  ctaTitle?: string;
  ctaDescription?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  showPoweredBy: boolean;
  /** 租户自定义官网域名（小写 host，不含协议/路径）；用于按 Host 反查租户。 */
  customDomain?: string;
  /** 品类入口图（按服务编码）。 */
  categoryImages: WebsiteCategoryImage[];
  /** 官网首页内容块（可编辑）；缺省时前端用通用文案 / 隐藏评价。 */
  advantages: WebsiteAdvantage[];
  steps: WebsiteStep[];
  testimonials: WebsiteTestimonial[];
  /** 可配置入口图的一级品类（当前租户已启用的经营空间）；供后台按品类填图。 */
  categories: Array<{ code: string; name: string }>;
  readiness: ClientChannelReadiness;
  updatedAt?: string;
}

export interface SaveWebsiteChannelProfileRequest {
  /** 携带上次读到的修订号；不一致时拒绝保存，防止两人互相覆盖。首次保存可省略。 */
  expectedRevision?: number;
  enabled: boolean;
  slogan?: string;
  heroTitle?: string;
  heroDescription?: string;
  /** Hero 大图地址（HTTPS，服务端做出站地址校验）。 */
  heroImageUrl?: string;
  /** 辅助/强调色（#RGB 或 #RRGGBB，留空回退默认）。 */
  secondaryColor?: string;
  footerText?: string;
  contactAddress?: string;
  ctaTitle?: string;
  ctaDescription?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  showPoweredBy: boolean;
  /** 自定义官网域名（如 www.brand.com）；留空表示不绑定。服务端归一化为小写 host。 */
  customDomain?: string;
  /** 品类入口图（按服务编码）；空 imageUrl 视为清除该品类配置。 */
  categoryImages?: WebsiteCategoryImage[];
  /** 官网首页内容块（可编辑）；空数组表示清空、回落前端通用文案。 */
  advantages?: WebsiteAdvantage[];
  steps?: WebsiteStep[];
  testimonials?: WebsiteTestimonial[];
}

/**
 * 微信小程序渠道凭证：AppID 是公开信息，AppSecret 只写不读（服务端加密保存，只返回是否已配置）。
 * 品牌/协议/发布服务已移到租户级 ClientChannelProfileSummary。
 */
export interface MiniProgramChannelSummary {
  configured: boolean;
  appId?: string;
  secretConfigured: boolean;
  enabled: boolean;
  revision: number;
  lastTestStatus: "not_tested" | "passed" | "failed";
  lastTestAt?: string;
  lastTestError?: string;
  /** 已绑定微信身份的客户数；AppID 一旦有绑定就不能再改。 */
  identityCount: number;
  updatedAt?: string;
}

export interface SaveMiniProgramChannelRequest {
  appId: string;
  /** 只在需要更换时提交；留空保留原密钥。 */
  appSecret?: string;
  enabled: boolean;
}

export interface MiniProgramChannelTestResult {
  ok: boolean;
  message: string;
  testedAt: string;
}
