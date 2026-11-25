/** 首页与默认面板共用当前 Core 导航状态；登记和可见性沿原合同，不授予业务权限。 */
import { coreNavigationEntries, type CoreRegisteredPage } from "@rental-os/core-contracts";
import type { useCoreSession } from "./core/useCoreSession";

const noPages: ReadonlyMap<string, CoreRegisteredPage<unknown>> = new Map();

export function coreNavigationMessage(
  pages: ReadonlyMap<string, CoreRegisteredPage<unknown>> = noPages,
  cores: Pick<ReturnType<typeof useCoreSession>, "data" | "error" | "canAccess">,
  locale: string,
  isSaasAdmin: boolean,
): string {
  const en = locale === "en-US";
  if (cores.error) return en ? "Business Core could not be loaded. Try again." : "暂时无法读取业务 Core，请重试。";
  if (isSaasAdmin) return en ? "Use platform administration to manage tenant Core access." : "从平台管理入口维护租户的 Core 使用权。";
  if (cores.data && coreNavigationEntries(pages, cores.data, locale).length) {
    return en ? "Choose an authorized business Core from the sidebar." : "从左侧选择已获授权的业务 Core。";
  }
  const accessible = cores.data?.cores.filter(entry => cores.canAccess(entry.core.id, [])) ?? [];
  if (accessible.length) {
    const registered = [...pages.values()].some(page => accessible.some(entry => entry.core.id === page.coreId));
    return registered
      ? en ? "No business page is available in navigation. Ask your tenant administrator to check page access and entry points."
        : "当前没有可导航的业务页面，请联系租户管理员核对页面入口及权限。"
      : en ? "This host has not assembled pages for your authorized Core. Contact your deployment administrator."
        : "本宿主尚未装配已授权 Core 的业务页面，请联系部署管理员。";
  }
  if (cores.data?.cores.length) return en ? "Business Core deployment admission is unavailable. Contact your SaaS administrator."
    : "业务 Core 部署准入当前不可用，请联系 SaaS 管理员。";
  if (cores.data?.tenantHasRegisteredGrant) return en ? "Ask your tenant administrator to assign a business Core." : "请联系租户管理员分配业务 Core。";
  return en ? "Contact your SaaS administrator to enable a business Core." : "请联系 SaaS 管理员授权业务 Core。";
}
