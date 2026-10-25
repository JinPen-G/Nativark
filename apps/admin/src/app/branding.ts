import type { AuthUser, TenantContext } from "@rental-os/shared";

export const ADMIN_BRAND_NAME = "Rental OS";
export const ADMIN_DEFAULT_LOGO = "/brand/rentalos-logo-color.svg";
export const ADMIN_DEFAULT_MARK = "/brand/rentalos-icon.svg";
export const ADMIN_DEFAULT_FAVICON = ADMIN_DEFAULT_MARK;
export const ADMIN_LOGIN_DEFAULTS = {
  title: "租赁生意，\n有序运转。",
  description: "从预订、交付到归还与结算，把资产、订单和客户放在同一个工作台。",
  highlights: [
    { title: "管好资产", description: "在库、在租与维护" },
    { title: "跟进订单", description: "预订、交付与归还" },
    { title: "连接客户", description: "会员、权益与往来" }
  ],
  footerText: "多品类经营，一个工作台。"
} as const;

function isTenantUser(user?: Pick<AuthUser, "isSaasAdmin">) {
  return Boolean(user && !user.isSaasAdmin);
}

export function resolveAdminBrandName(
  tenant?: Pick<TenantContext, "tenantName" | "brandName">,
  user?: Pick<AuthUser, "isSaasAdmin">,
) {
  if (!isTenantUser(user)) return ADMIN_BRAND_NAME;
  return (
    tenant?.brandName?.trim() || tenant?.tenantName?.trim() || ADMIN_BRAND_NAME
  );
}

export function resolveAdminLogo(
  tenant?: Pick<TenantContext, "brandLogoUrl">,
  user?: Pick<AuthUser, "isSaasAdmin">,
) {
  return isTenantUser(user)
    ? tenant?.brandLogoUrl?.trim() || ADMIN_DEFAULT_LOGO
    : ADMIN_DEFAULT_LOGO;
}

export function resolveAdminFavicon(
  tenant?: Pick<TenantContext, "brandLogoUrl">,
  user?: Pick<AuthUser, "isSaasAdmin">,
) {
  return resolveAdminMark(tenant, user);
}

export function resolveAdminMark(
  tenant?: Pick<TenantContext, "brandLogoUrl">,
  user?: Pick<AuthUser, "isSaasAdmin">,
) {
  return isTenantUser(user)
    ? tenant?.brandLogoUrl?.trim() || ADMIN_DEFAULT_MARK
    : ADMIN_DEFAULT_MARK;
}

/** 登录前无法读取会话时也可安全替换 favicon；失败时保留 HTML 中的平台默认图标。 */
export function applyAdminFavicon(url?: string, onError?: () => void) {
  if (typeof document === "undefined") return;
  const href = url?.trim() || ADMIN_DEFAULT_FAVICON;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
  link.type = /^data:image\/svg\+xml[;,]|\.svg(?:[?#]|$)/iu.test(href) ? "image/svg+xml" : "";
  const failed = () => { if (link?.getAttribute("href") === href) onError?.(); };
  link.addEventListener("error", failed);
  return () => link?.removeEventListener("error", failed);
}
