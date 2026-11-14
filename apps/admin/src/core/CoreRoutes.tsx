/** 已登记Core路由消费原会话、真实范围与就绪；沿原Router和页头运行，不重建后台外壳。 */
import type { ComponentType, ReactNode } from "react";
import { Route, useNavigate, useParams } from "react-router-dom";
import { corePageText, resolveCorePageLocation, type CoreRegisteredPage, type CoreScopeReference } from "@rental-os/core-contracts";
import { useLocale } from "@/app/locale";
import { currentSessionEpoch } from "@/app/queryClient";
import { PageHeading } from "@/components/PageHeading";
import { QueryState } from "@/components/QueryState";
import { Alert, Result } from "@/components/ui";
import { CorePageHostProvider } from "./CorePage";
import { useCoreSession } from "./useCoreSession";
import { useCoreScope } from "./useCoreScope";

export interface CoreRouteOptions {
  brandName: string;
  /** 原宿主按当前Core业务上下文提供；租户范围Core可以省略，不补Rental空间默认值。 */
  containers?: Readonly<Record<string, CoreScopeReference["container"]>>;
}
export type CoreRouteComponent = ComponentType<{ routeParams?: Readonly<Record<string, string>> }>;
type Pages = ReadonlyMap<string, CoreRegisteredPage<CoreRouteComponent>>;

/** 在原Routes内部直接展开返回的Route元素；注册表由受控组合创建，身份/容器变化时重新取当前参数。 */
export function createCoreRouteElements(pages: Pages, options: CoreRouteOptions) {
  return [...pages.values()].map(page => <Route key={page.key} path={page.path}
    element={<RegisteredCoreRoute page={page} pages={pages} options={options} />} />);
}

function RegisteredCoreRoute({ page, pages, options }: { page: CoreRegisteredPage<CoreRouteComponent>; pages: Pages; options: CoreRouteOptions }) {
  const session = useCoreSession(), { locale } = useLocale();
  const permitted = session.canAccess(page.coreId, page.definition.permissions);
  return <QueryState loading={session.isPending} error={session.error} onRetry={session.refetch}>
    {permitted && session.data
      ? <ScopedCoreRoute key={JSON.stringify([currentSessionEpoch(), page.key, options.containers?.[page.coreId]])}
        page={page} pages={pages} options={options} context={session.data} canAccess={session.canAccess} />
      : <><PageHeading title={corePageText(page.definition.title, locale)} brandName={options.brandName} />
        <Result status="403" title={locale === "en-US" ? "This Core page is unavailable" : "当前Core页面不可用"}
          subTitle={locale === "en-US" ? "Ask your tenant administrator to check Core assignment and page access." : "请联系租户管理员核对Core分配及页面权限。"} /></>}
  </QueryState>;
}

function ScopedCoreRoute({ page, pages, options, context, canAccess }: {
  page: CoreRegisteredPage<CoreRouteComponent>; pages: Pages; options: CoreRouteOptions;
  context: NonNullable<ReturnType<typeof useCoreSession>["data"]>; canAccess: ReturnType<typeof useCoreSession>["canAccess"];
}) {
  const scope = useCoreScope(page.coreId, options.containers?.[page.coreId]);
  const navigate = useNavigate(), matched = useParams(), { locale } = useLocale();
  const params = Object.fromEntries([...page.path.matchAll(/:([a-z][a-zA-Z0-9]*)/g)]
    .map(match => [match[1], matched[match[1]]])) as Record<string, string>;
  // 只把原Router当前已匹配的登记参数交给Core；缺参数在渲染业务前明确拒绝。
  resolveCorePageLocation(pages, { coreId: page.coreId, pageId: page.definition.id, params });
  const granted = context.cores.find(entry => entry.core.id === page.coreId)!;
  const binding = scope.data?.status === "bound" ? scope.data.binding : undefined;
  const lifetimeKey = JSON.stringify([currentSessionEpoch(), context.tenantId, context.subjectId, page.coreId,
    granted.grant.revision, granted.assignment.revision, granted.permissions, params, binding?.bindingId, binding?.revision]);
  const Page = page.definition.component;
  const configuration = page.definition.purpose === "configuration";
  let content: ReactNode;
  if (scope.data && (scope.ready || configuration)) content = <CorePageHostProvider host={{ page, pages, brandName: options.brandName,
    lifetimeKey, params, binding, canAccess: (coreId, permissions) => canAccess(coreId, permissions)
      && (coreId !== page.coreId || scope.ready || configuration), navigate }}><Page routeParams={params} /></CorePageHostProvider>;
  else content = <><PageHeading title={corePageText(page.definition.title, locale)} brandName={options.brandName} />
    {scope.data?.status === "bound" && scope.data.readiness.status === "configuration_required"
      ? <Alert type="warning" title={locale === "en-US" ? "Core configuration is incomplete" : "Core配置尚未完成"}
        description={<ul>{scope.data.readiness.missing.map(item => <li key={item.code}>{item.message}</li>)}</ul>} />
      : <Result status="warning" title={locale === "en-US" ? "This Core is not ready" : "Core尚未就绪"}
        subTitle={scope.data?.status === "bound" && scope.data.readiness.status === "unavailable" ? scope.data.readiness.message
          : locale === "en-US" ? "Ask your tenant administrator to complete Core setup." : "请联系租户管理员完成Core配置。"} />}</>;
  return <QueryState loading={scope.isPending} error={scope.error} onRetry={scope.refetch}>{content}</QueryState>;
}
