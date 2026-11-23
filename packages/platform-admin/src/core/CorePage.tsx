/**
 * 将Core页面/操作声明接到原页头、按钮和Form；不复制外壳、样式或业务请求。
 * 宿主供给当前受权注册表与身份代次，服务端仍独立复核权限及业务结果。
 * 保留页签沿原活动范围关闭旧动作，异步确认/校验完成时再次核对当前声明。
 */
import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import type { ButtonProps, FormInstance } from "antd";
import {
  corePageKey, corePageText, resolveCorePageLocation,
  type CoreBinding, type CorePageAction, type CorePageDescriptor, type CoreRegisteredPage
} from "@rental-os/core-contracts";
import { useLocale } from "../app/locale";
import { PageHeading } from "../components/PageHeading";
import { WorkspaceHeaderActiveContext } from "../components/workspace/WorkspaceHeaderContext";
import { ActionButton, Button, ConfirmAction, Result, SaveButton, Tooltip, useFeedback, type ActionButtonIntent } from "../components/ui";

export interface CorePageHost {
  page: CoreRegisteredPage<unknown>;
  pages: ReadonlyMap<string, CoreRegisteredPage<unknown>>;
  brandName: string;
  icon?: ReactNode;
  /** 原会话/租户/Core范围或路由对象变化时更换，释放旧页动作和表单。不是授权凭据。 */
  lifetimeKey: string;
  /** 仅由已匹配的登记路由和真实范围读取提供，定位信息不是业务授权。 */
  params?: Readonly<Record<string, string>>;
  binding?: CoreBinding;
  /** 原宿主依据当前Core授权/成员分配及业务权限计算；不能使用清单直接作准入。 */
  canAccess: (coreId: string, permissions: CorePageDescriptor["permissions"]) => boolean;
  navigate: (registeredPath: string) => void;
}

const Host = createContext<CorePageHost | null>(null);
export function useCorePageHost(): CorePageHost {
  const host = useContext(Host);
  if (!host) throw new Error("Core页面须位于已注册且受权的CorePageHostProvider内");
  return host;
}
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

export type CoreAdminActionSlot = "actions" | "navigation" | "tools" | `content:${string}`;

export type CoreAdminPageAction<Values> = CorePageAction<FormInstance<Values>, Values> & {
  intent?: ActionButtonIntent;
  /** 仅供原页面尚未报告的业务失败；已有 mutation 提示时不重复播报。 */
  onActionError?: (error: unknown) => void;
  /** 缺省进入主操作栏；返回与辅助动作仍经过同一权限和生命周期驱动。 */
  slot?: CoreAdminActionSlot;
  /** 特殊正文仍使用原按钮变体、尺寸和形状，执行由公共动作驱动。 */
  presentation?: Pick<ButtonProps, "type" | "block" | "shape" | "size" | "style"> & {
    control: "button";
    iconOnly?: boolean;
  };
  /** 原按钮呈现由公共适配承担，pending仍来自真实业务Promise。 */
  icon?: ReactNode;
  danger?: boolean;
  pending?: boolean;
  pendingLabel?: string;
  /** 确认动作沿原ConfirmAction；业务自己声明危险程度。 */
  confirmTone?: "neutral" | "danger";
};

const ActionSlots = createContext<ReadonlyMap<CoreAdminActionSlot, readonly ReactNode[]> | null>(null);

/** 将已声明动作放入原卡片或流程区，继续使用当前页的权限、生命周期和执行者。 */
export function CorePageActions({ slot }: { slot: `content:${string}` }) {
  const slots = useContext(ActionSlots);
  if (!slots) throw new Error("正文动作须位于CorePage内");
  return <>{slots.get(slot)}</>;
}

function PageAction<Values>({ host, action, visible = true }: { host: CorePageHost; action: CoreAdminPageAction<Values>; visible?: boolean }) {
  const { locale, t } = useLocale();
  const { toast } = useFeedback();
  const live = useRef({ host, action, active: true, visible });
  live.current.host = host; live.current.action = action; live.current.visible = visible;
  // 返回同一页签也不能复活退出前的确认/校验；保留按钮实例以守住原在途请求。
  const visibility = useRef({ visible });
  if (visibility.current.visible !== visible) visibility.current = { visible };
  const opening = visibility.current;
  useLayoutEffect(() => { live.current.active = true; return () => { live.current.active = false; }; }, []);
  // 确认面板也可能在原点击后等待；执行前取当前声明/权限，不保留旧回调绕过撤权。
  const current = () => {
    const value = live.current;
    if (!value.active || !value.visible || visibility.current !== opening || value.action.disabled || value.action.pending || !access(value.host, value.action.permissions))
      throw new Error(t("当前操作不可用"));
    return value;
  };
  const label = corePageText(action.label, locale), variant = action.emphasis ?? "secondary";
  const disabled = !visible || action.disabled;
  const reason = action.disabledReason ? corePageText(action.disabledReason, locale) : undefined;
  const reportFailure = (error: unknown) => {
    if (!live.current.active || !live.current.visible || visibility.current !== opening || error && typeof error === "object" && ("errorFields" in error || "name" in error && error.name === "AbortError")) return;
    live.current.action.onActionError?.(error);
  };
  const confirming = useRef<Promise<unknown> | null>(null);
  const executing = useRef<Promise<unknown> | null>(null);
  const { control, iconOnly, type: buttonType, ...presentation } = action.presentation ?? {};
  const run = async () => {
    const latest = current().action;
    if (latest.kind === "save") {
      const values = await latest.form.validateFields();
      const checked = current().action;
      if (checked.kind !== "save" || checked.form !== latest.form) throw new Error(t("当前操作不可用"));
      return checked.onSave(values);
    }
    if (latest.kind !== "command") throw new Error(t("当前操作不可用"));
    return latest.execute();
  };
  let button: ReactNode;
  if (action.kind === "navigate" || action.kind === "open") {
    button = <Button {...presentation} type={buttonType ?? (action.slot === "navigation" ? "text" : variant === "primary" ? "primary" : "default")} icon={action.icon} danger={action.danger}
      loading={action.pending} disabled={disabled} aria-label={iconOnly ? label : undefined} aria-expanded={action.ariaExpanded} onClick={() => {
      try {
        const value = current(), latest = value.action;
        if (latest.kind === "open") latest.open();
        if (latest.kind === "navigate") {
          const target = value.host.pages.get(corePageKey(latest.to.coreId, latest.to.pageId));
          if (!target || !value.host.canAccess(target.coreId, target.definition.permissions)) throw new Error(t("当前页面不可用"));
          value.host.navigate(resolveCorePageLocation(value.host.pages, latest.to));
        }
      } catch { if (live.current.active && live.current.visible && visibility.current === opening) toast({ type: "error", title: t("当前操作不可用") }); }
    }}>{iconOnly ? null : label}</Button>;
  } else if (control === "button" && !(action.kind === "command" && action.confirmation)) {
    button = <Button {...presentation} type={buttonType ?? (variant === "primary" ? "primary" : "default")}
      icon={action.icon} danger={action.danger} loading={action.pending} disabled={disabled}
      htmlType={action.kind === "save" ? "submit" : "button"}
      aria-label={iconOnly ? label : undefined} aria-expanded={action.ariaExpanded} onClick={event => {
        if (action.kind === "save") event.preventDefault();
        if (executing.current) return;
        const request = Promise.resolve().then(run);
        executing.current = request;
        void request.catch(reportFailure).finally(() => {
          if (executing.current === request) executing.current = null;
        });
      }}>{iconOnly ? null : label}</Button>;
  } else if (action.kind === "save") {
    button = <SaveButton label={label} variant={variant} disabled={disabled} intent={action.intent}
      icon={action.icon} danger={action.danger} pending={action.pending} pendingLabel={action.pendingLabel} onActionError={reportFailure}
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
      ? <ConfirmAction label={label} icon={action.icon} prompt={corePageText(action.confirmation, locale)}
          tone={action.confirmTone ?? (action.danger ? "danger" : "neutral")} pendingLabel={action.pendingLabel}
          disabled={disabled || action.pending} onConfirm={() => {
            if (confirming.current) return confirming.current;
            const request = Promise.resolve().then(execute);
            confirming.current = request;
            void request.finally(() => { if (confirming.current === request) confirming.current = null; }).catch(() => undefined);
            return request;
          }} />
      : <ActionButton label={label} variant={variant} disabled={disabled} intent={action.intent}
          icon={action.icon} danger={action.danger} pending={action.pending} pendingLabel={action.pendingLabel} onAction={execute} onActionError={reportFailure} />;
  }
  // 深链接只能定位当前页面的已登记动作；包住禁用按钮便于说明原因，不触发业务执行。
  const target = <span data-core-page={host.page.key} data-core-action={action.id}
    style={{ display: action.presentation?.block ? "flex" : "inline-flex", width: action.presentation?.block ? "100%" : undefined }}
    tabIndex={action.disabled ? 0 : -1} aria-label={reason && action.disabled ? `${label} · ${reason}` : undefined}>{button}</span>;
  return reason && action.disabled ? <Tooltip title={reason}>{target}</Tooltip> : target;
}

/** 路由提供默认标题，Core可呈现当前获权对象的动态页名/摘要；原页头负责portal、清理和Form归属。 */
export function CorePage<Values = Record<string, unknown>>({ actions = [], title, summary, description, view, tools, toolsPlacement, note, children }: {
  actions?: readonly CoreAdminPageAction<Values>[];
  title?: string;
  summary?: ReactNode;
  description?: string;
  view?: ReactNode;
  tools?: ReactNode;
  toolsPlacement?: "context" | "view";
  note?: { title: string; description: ReactNode };
  children: ReactNode;
}) {
  const host = useCorePageHost(), { locale } = useLocale();
  const active = useContext(WorkspaceHeaderActiveContext);
  const ids = new Set<string>();
  let primary = 0;
  for (const action of actions) {
    if (!action.id || ids.has(action.id)) throw new Error("当前Core页面操作ID必须非空且唯一");
    ids.add(action.id);
    if (action.emphasis === "primary" && ++primary > 1) throw new Error("当前Core页面只能声明一个主操作");
  }
  const buttons = new Map<CoreAdminActionSlot, ReactNode[]>();
  for (const action of actions) if (access(host, action.permissions)) {
    const slot = action.slot ?? "actions";
    const group = buttons.get(slot) ?? [];
    group.push(<PageAction key={JSON.stringify([action.id, action.kind, action.kind === "command" ? action.confirmation : undefined])} host={host} action={action} visible={active} />);
    buttons.set(slot, group);
  }
  return <ActionSlots.Provider value={buttons}><PageHeading title={title ?? corePageText(host.page.definition.title, locale)} brandName={host.brandName} icon={host.icon}
    summary={summary} description={description} view={view} note={note}
    extra={buttons.get("actions")} navigation={buttons.get("navigation")}
    tools={buttons.has("tools") || tools ? <>{buttons.get("tools")}{tools}</> : undefined} toolsPlacement={toolsPlacement} />{children}</ActionSlots.Provider>;
}
