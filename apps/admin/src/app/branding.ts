import type { AuthUser, TenantContext } from "@rental-os/shared";

export const ADMIN_BRAND_NAME = "Rental OS";
export const ADMIN_DEFAULT_LOGO = "/brand/rentalos-logo-color.svg";
export const ADMIN_DEFAULT_MARK = "/brand/rentalos-icon-1.svg";
export const ADMIN_DEFAULT_FAVICON = "/brand/rentalos-icon-1.svg";

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
  tenant?: Pick<TenantContext, "faviconUrl">,
  user?: Pick<AuthUser, "isSaasAdmin">,
) {
  return isTenantUser(user)
    ? tenant?.faviconUrl?.trim() || ADMIN_DEFAULT_FAVICON
    : ADMIN_DEFAULT_FAVICON;
}

export function resolveAdminMark(
  tenant?: Pick<TenantContext, "faviconUrl">,
  user?: Pick<AuthUser, "isSaasAdmin">,
) {
  return isTenantUser(user)
    ? tenant?.faviconUrl?.trim() || ADMIN_DEFAULT_MARK
    : ADMIN_DEFAULT_MARK;
}

/** 登录前无法读取会话时也可安全替换 favicon；失败时保留 HTML 中的平台默认图标。 */
export function applyAdminFavicon(url?: string) {
  if (typeof document === "undefined") return;
  const href = url?.trim() || ADMIN_DEFAULT_FAVICON;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}
