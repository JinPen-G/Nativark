/**
 * 将Core页面/操作声明接到原页头、按钮和Form；不复制外壳、样式或业务请求。
 * 宿主供给当前受权注册表与身份代次，服务端仍独立复核权限及业务结果。
 */
import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import type { FormInstance } from "antd";
import {
  corePageKey, corePageText, resolveCorePageLocation,
  type CorePageAction, type CorePageDescriptor, type CoreRegisteredPage
} from "@rental-os/core-contracts";
import { useLocale } from "@/app/locale";
import { PageHeading } from "@/components/PageHeading";
import { ActionButton, Button, ConfirmAction, Result, SaveButton, Tooltip, useFeedback, type ActionButtonIntent } from "@/components/ui";

export interface CorePageHost {
  page: CoreRegisteredPage<unknown>;
  pages: ReadonlyMap<string, CoreRegisteredPage<unknown>>;
  brandName: string;
  /** 原会话/租户/Core范围或路由对象变化时更换，释放旧页动作和表单。不是授权凭据。 */
  lifetimeKey: string;
  /** 原宿主依据当前Core授权/成员分配及业务权限计算；不能使用清单直接作准入。 */
  canAccess: (coreId: string, permissions: CorePageDescriptor["permissions"]) => boolean;
  navigate: (registeredPath: string) => void;
}

const Host = createContext<CorePageHost | null>(null);
const access = (host: CorePageHost, permissions: CorePageDescriptor["permissions"] = []) =>
  host.canAccess(host.page.coreId, [...host.page.definition.permissions, ...permissions]);

function PageBoundary({ host, children }: { host: CorePageHost; children: ReactNode }) {
  const { t } = useLocale();
  if (!access(host)) return <Result status="403" title={t("无权限")} subTitle={t("当前页面不可用")} />;
  return <Host.Provider value={host}>{children}</Host.Provider>;
}

/** 放在已认证的Core路由内；身份/对象变化释放旧页面，不在页面内部建立另一套认证。 */
export function CorePageHostProvider({ host, children }: { host: CorePageHost; children: ReactNode }) {
  if (host.pages.get(corePageKey(host.page.coreId, host.page.definition.id)) !== host.page)
    throw new Error("Core页面未使用当前宿主注册表");
  return <PageBoundary key={JSON.stringify([host.lifetimeKey, host.page.key])} host={host}>{children}</PageBoundary>;
}

export type CoreAdminPageAction<Values> = CorePageAction<FormInstance<Values>, Values> & {
  intent?: ActionButtonIntent;
  /** 确认动作沿原ConfirmAction；业务自己声明危险程度。 */
  confirmTone?: "neutral" | "danger";
};

function PageAction<Values>({ host, action }: { host: CorePageHost; action: CoreAdminPageAction<Values> }) {
  const { locale, t } = useLocale();
  const { toast } = useFeedback();
  const live = useRef({ host, action, active: true });
  live.current.host = host; live.current.action = action;
  useLayoutEffect(() => { live.current.active = true; return () => { live.current.active = false; }; }, []);
  // 确认面板也可能在原点击后等待；执行前取当前声明/权限，不保留旧回调绕过撤权。
  const current = () => {
    const value = live.current;
    if (!value.active || value.action.disabled || !access(value.host, value.action.permissions))
      throw new Error(t("当前操作不可用"));
    return value;
  };
  const label = corePageText(action.label, locale), variant = action.emphasis ?? "secondary";
  const reason = action.disabledReason ? corePageText(action.disabledReason, locale) : undefined;
  const reportFailure = (error: unknown) => {
    if (!live.current.active || error && typeof error === "object" && "errorFields" in error) return;
    toast({ type: "error", title: t("操作失败") });
  };
  const confirming = useRef<Promise<unknown> | null>(null);
  let button: ReactNode;
  if (action.kind === "navigate" || action.kind === "open") {
    button = <Button type={variant === "primary" ? "primary" : "default"} disabled={action.disabled} onClick={() => {
      try {
        const value = current(), latest = value.action;
        if (latest.kind === "open") latest.open();
        if (latest.kind === "navigate") {
          const target = value.host.pages.get(corePageKey(latest.to.coreId, latest.to.pageId));
          if (!target || !value.host.canAccess(target.coreId, target.definition.permissions)) throw new Error(t("当前页面不可用"));
          value.host.navigate(resolveCorePageLocation(value.host.pages, latest.to));
        }
      } catch { toast({ type: "error", title: t("当前操作不可用") }); }
    }}>{label}</Button>;
  } else if (action.kind === "save") {
    button = <SaveButton label={label} variant={variant} disabled={action.disabled} intent={action.intent} onActionError={reportFailure}
      form={action.form} onSave={values => {
        const latest = current().action;
        if (latest.kind !== "save" || latest.form !== action.form) return Promise.reject(new Error(t("当前操作不可用")));
        return latest.onSave(values);
      }} />;
  } else {
    const execute = () => {
      const latest = current().action;
      if (latest.kind !== "command") return Promise.reject(new Error(t("当前操作不可用")));
      return latest.execute();
    };
    button = action.confirmation
      ? <ConfirmAction label={label} prompt={corePageText(action.confirmation, locale)} tone={action.confirmTone ?? "neutral"}
          disabled={action.disabled} onConfirm={() => {
            if (confirming.current) return confirming.current;
            const request = Promise.resolve().then(execute);
            confirming.current = request;
            void request.finally(() => { if (confirming.current === request) confirming.current = null; }).catch(() => undefined);
            return request;
          }} />
      : <ActionButton label={label} variant={variant} disabled={action.disabled} intent={action.intent} onAction={execute} onActionError={reportFailure} />;
  }
  return reason && action.disabled
    ? <Tooltip title={reason}><span tabIndex={0} aria-label={`${label} · ${reason}`}>{button}</span></Tooltip>
    : button;
}

/** Core仅提供业务内容及当前操作；标题来自路由单源，原页头负责portal/清理和Form归属。 */
export function CorePage<Values = Record<string, unknown>>({ actions = [], description, view, note, children }: {
  actions?: readonly CoreAdminPageAction<Values>[];
  description?: string;
  view?: ReactNode;
  note?: { title: string; description: ReactNode };
  children: ReactNode;
}) {
  const host = useContext(Host), { locale } = useLocale();
  if (!host) throw new Error("CorePage须位于已注册且受权的CorePageHostProvider内");
  const ids = new Set<string>();
  let primary = 0;
  for (const action of actions) {
    if (!action.id || ids.has(action.id)) throw new Error("当前Core页面操作ID必须非空且唯一");
    ids.add(action.id);
    if (action.emphasis === "primary" && ++primary > 1) throw new Error("当前Core页面只能声明一个主操作");
  }
  const buttons = actions.filter(action => access(host, action.permissions)).map(action =>
    <PageAction key={JSON.stringify([action.id, action.kind, action.kind === "command" ? action.confirmation : undefined])} host={host} action={action} />);
  return <><PageHeading title={corePageText(host.page.definition.title, locale)} brandName={host.brandName}
    description={description} view={view} note={note} extra={buttons} />{children}</>;
}
