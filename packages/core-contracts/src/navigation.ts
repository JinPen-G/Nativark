/** Core菜单和面包屑由原页面登记生成；只按当前目录过滤可访问链接，不产生权限或对象事实。 */
import { canUseCorePage, type CoreSessionContext } from "./session-http";
import { corePageKey, corePageText, resolveCorePageLocation, type CoreRegisteredPage } from "./admin";

export function coreNavigationEntries<T>(pages: ReadonlyMap<string, CoreRegisteredPage<T>>, context: CoreSessionContext, locale: string) {
  return [...pages.values()].filter(page => page.definition.menu && !page.path.includes(":")
    && canUseCorePage(context, page.coreId, page.definition.permissions)).map(page => ({
      key: page.key, coreId: page.coreId, label: corePageText(page.definition.title, locale), path: page.path,
      coreName: context.cores.find(entry => entry.core.id === page.coreId)!.core.name,
      group: page.definition.menu?.group ? corePageText(page.definition.menu.group, locale) : undefined,
      order: page.definition.menu?.order ?? 0
    })).sort((left, right) => left.coreId.localeCompare(right.coreId) || left.order - right.order || left.key.localeCompare(right.key));
}

/** 未获权页面可以显示登记名称，但不带链接；父页只使用当前登记参数的对应子集。 */
export function coreBreadcrumbEntries<T>(pages: ReadonlyMap<string, CoreRegisteredPage<T>>, page: CoreRegisteredPage<T>,
  params: Readonly<Record<string, string>>, context: CoreSessionContext, locale: string) {
  const chain = [page];
  while (chain[0].definition.parent) {
    const parent = pages.get(corePageKey(page.coreId, chain[0].definition.parent));
    if (!parent || chain.some(entry => entry.key === parent.key)) throw new Error("Core面包屑登记不完整或有循环");
    chain.unshift(parent);
  }
  return chain.map(entry => {
    const names = [...entry.path.matchAll(/:([a-z][a-zA-Z0-9]*)/g)].map(match => match[1]);
    const targetParams = Object.fromEntries(names.map(name => [name, params[name]]));
    const linked = entry !== page && names.every(name => typeof params[name] === "string")
      && canUseCorePage(context, entry.coreId, entry.definition.permissions);
    return { key: entry.key, label: corePageText(entry.definition.title, locale),
      path: linked ? resolveCorePageLocation(pages, { coreId: entry.coreId, pageId: entry.definition.id, params: targetParams }) : undefined };
  });
}
