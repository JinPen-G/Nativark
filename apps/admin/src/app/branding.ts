import type { AuthUser, TenantContext } from "@rental-os/shared";

export const ADMIN_BRAND_NAME = "Rental OS";
// Login wordmark is the original monochrome brand asset. Sidebar mark/favicon
// remain independent; tenant-uploaded artwork is not filtered as platform art.
export const ADMIN_DEFAULT_LOGO = "/brand/rentalos-logo-mono.svg";
export const ADMIN_DEFAULT_MARK = "/brand/rentalos-icon.svg";
export const ADMIN_DEFAULT_FAVICON = ADMIN_DEFAULT_MARK;
export const ADMIN_LOGIN_DEFAULTS = {
  title: "你的租赁业务，\n有了 Rental Agent。",
  description: "资源调配、任务分派、跨店协作，\n交给 Rental Agent 统筹安排。\n\n日常管理，也有 Copilot 随时协助。",
  highlights: [
    { title: "Rental Agent", description: "统筹资源与任务" },
    { title: "Copilot", description: "辅助日常管理" },
    { title: "多工作空间", description: "一次登录，自如切换" }
  ],
  footerText: "rentalOS · 租赁操作系统"
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
