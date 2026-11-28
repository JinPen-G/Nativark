/** 可选客户端视图。公共 UIArc 主题/语言沿正式出口复用，客户/员工认证仍由原宿主注入。 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from "react";
import { getArcPalette } from "@rental-os/platform-admin/source/app/arcTokens";
import { ADMIN_FONT_FAMILY } from "@rental-os/platform-admin/source/app/designTokens";
import { translateAdminText } from "@rental-os/platform-admin/locale";
import { CLIENT_ENGLISH, ClientError, clientErrorText, type ClientAction, type ClientLocale,
  type ClientMessage, type ClientView } from "@rental-os/platform-client-contracts";
import { bindClientBrowser, clientHash } from "./browser";

export interface ClientShellProps {
  readonly view: ClientView;
  readonly brand: { readonly name: string; readonly primaryColor?: string };
  readonly initialLocale?: ClientLocale;
  readonly initialDark?: boolean;
}
const values = (form: HTMLFormElement) => Object.fromEntries([...new FormData(form)].filter((entry): entry is [string, string] => typeof entry[1] === "string"));

function ActionForm({ action, view, locale, disabled }: { action: ClientAction; view: ClientView; locale: ClientLocale; disabled: boolean }) {
  const [open, setOpen] = useState(false), prefix = useId();
  const t = (text: ClientMessage) => translateAdminText(text, locale, undefined, CLIENT_ENGLISH);
  return <section className="zc-action">
    <button type="button" disabled={disabled} aria-expanded={open} aria-controls={`${prefix}-form`} onClick={() => setOpen(!open)}>{action.label[locale]}</button>
    {open && <form id={`${prefix}-form`} onSubmit={(event: FormEvent<HTMLFormElement>) => {
      event.preventDefault(); const input = values(event.currentTarget); event.currentTarget.reset(); setOpen(false);
      void view.execute(action.id, input);
    }}>
      <p>{t("此操作将提交到当前页面所示的业务对象。")}</p>
      {action.fields?.map(field => <label key={field.name} htmlFor={`${prefix}-${field.name}`}>
        {field.label[locale]}
        {field.kind === "textarea" ? <textarea id={`${prefix}-${field.name}`} name={field.name} required={field.required} maxLength={field.maxLength} />
          : <input id={`${prefix}-${field.name}`} name={field.name} required={field.required} maxLength={field.maxLength} />}
      </label>)}
      <div className="zc-controls"><button type="submit" className="zc-primary" disabled={disabled}>{t("确认执行")}</button>
        <button type="button" onClick={() => setOpen(false)}>{t("取消")}</button></div>
    </form>}
  </section>;
}

export function ClientShell({ view, brand, initialLocale = "zh-CN", initialDark = false }: ClientShellProps) {
  const state = useSyncExternalStore(view.subscribe, view.getSnapshot, view.getSnapshot);
  const [locale, setLocale] = useState<ClientLocale>(initialLocale), [dark, setDark] = useState(initialDark);
  const heading = useRef<HTMLHeadingElement>(null);
  const staff = view.runtime.surface === "staff-web";
  if (view.runtime.surface !== "customer-web" && !staff) throw new ClientError("unavailable");
  const palette = getArcPalette(dark, brand.primaryColor);
  const style = { fontFamily: ADMIN_FONT_FAMILY, colorScheme: dark ? "dark" : "light",
    ...Object.fromEntries(Object.entries(palette).filter(([, value]) => typeof value === "string").map(([key, value]) => [`--zc-${key}`, value])),
  } as CSSProperties;
  const t = (text: ClientMessage) => translateAdminText(text, locale, undefined, CLIENT_ENGLISH);
  useEffect(() => bindClientBrowser(view, window), [view]);
  useEffect(() => { if (state.page.status === "ready") heading.current?.focus(); }, [state.destination?.routeId, state.page.status]);
  const route = view.runtime.routes.find(item => item.id === state.destination?.routeId);
  const session = state.session;
  const scanner = route && view.runtime.find(route.id).contribution.scan;
  const feedback = state.feedback;
  return <div className={`zc-shell ${staff ? "zc-staff" : "zc-customer"}`} style={style} lang={locale}>
    <header className="zc-header">
      <a className="zc-brand" href="#/">{brand.name}</a>
      <span className="zc-surface">{t(staff ? "门店工作台" : "客户服务")}</span>
      <div className="zc-preferences">
        <label className="zc-sr" htmlFor="zc-locale">{t("语言")}</label>
        <select id="zc-locale" value={locale} onChange={event => setLocale(event.target.value as ClientLocale)}><option value="zh-CN">简体中文</option><option value="en-US">English</option></select>
        <button type="button" onClick={() => setDark(!dark)}>{t(dark ? "浅色外观" : "深色外观")}</button>
      </div>
    </header>
    {session.status === "authenticated" ? <>
      <aside className="zc-sidebar">
        <div className="zc-identity"><strong>{session.displayName}</strong><span>{session.tenantName}</span>
          {session.workspaceName && <span>{session.workspaceName}</span>}{session.locationName && <span>{session.locationName}</span>}
        </div>
        {state.scopeChoices.length > 0 && <label>{t("切换工作范围")}<select value="" onChange={event => { if (event.target.value) void view.selectScope(event.target.value); }}>
          <option value="">{t("选择已授权范围")}</option>{state.scopeChoices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
        </select></label>}
        <nav aria-label={t("导航")}>{view.runtime.routes.filter(item => item.navigation !== false).map(item =>
          <a key={item.id} href={clientHash({ routeId: item.id })} aria-current={route?.id === item.id ? "page" : undefined}>{item.label[locale]}</a>)}</nav>
        <button type="button" className="zc-signout" onClick={() => { void view.signOut(); }}>{t("退出登录")}</button>
      </aside>
      <main className="zc-main" key={state.generation}>
        <div className="zc-page-heading"><div><h1 ref={heading} tabIndex={-1}>{state.page.data?.title ?? route?.label[locale] ?? t("暂时没有可用服务。")}</h1>
          {state.page.data?.description && <p>{state.page.data.description}</p>}</div>
          {route && <button type="button" disabled={state.page.status === "loading"} onClick={() => { void view.reload(); }}>{t("刷新页面")}</button>}
        </div>
        {route && <div className="zc-tools">
          {route.searchable && <form role="search" onSubmit={event => { event.preventDefault(); view.search(values(event.currentTarget).search ?? ""); }}>
            <label htmlFor="zc-search">{t("搜索当前页面")}</label><div className="zc-input-action"><input id="zc-search" name="search" type="search" defaultValue={state.request.search} maxLength={256} /><button type="submit">{t("搜索")}</button></div>
          </form>}
          {staff && scanner && <form onSubmit={event => { event.preventDefault(); const value = values(event.currentTarget).scan; event.currentTarget.reset(); if (value) void view.scan(value).then(destination => { if (destination) window.location.hash = clientHash(destination); }); }}>
            <label htmlFor="zc-scan">{t("扫码或输入编号")}</label><div className="zc-input-action"><input id="zc-scan" name="scan" maxLength={2048} required autoComplete="off" /><button type="submit">{t("打开")}</button></div>
          </form>}
        </div>}
        {state.page.status === "loading" && <p className="zc-status" role="status">{t("正在加载…")}</p>}
        {state.page.status === "error" && <div className="zc-status" role="alert"><p>{clientErrorText(state.page.error ?? "unavailable", locale)}</p><a href="#/">{t("返回首页")}</a></div>}
        {state.page.status === "ready" && <>
          {state.page.data?.items.length ? <ul className="zc-items">{state.page.data.items.map(item => <li key={item.id}>
            <div><h2>{item.destination ? <a href={clientHash(item.destination)}>{item.title}</a> : item.title}</h2>{item.detail && <p>{item.detail}</p>}</div>
            {item.status && <span className="zc-item-status">{item.status}</span>}
          </li>)}</ul> : <p className="zc-status">{state.page.data?.emptyText}</p>}
          {!!route?.actions?.length && <section className="zc-actions" aria-label={t("操作")}>
            {!view.writable && <p role="status">{t("当前设备无法保留操作定位，暂不能提交。")}</p>}
            {route.actions.map(action => <ActionForm key={action.id} action={action} view={view} locale={locale}
              disabled={!view.writable || state.busy || !!state.receiptError || state.pending.some(reference => reference.actionId === action.id)} />)}
          </section>}
        </>}
        {feedback && <p className="zc-feedback" role={feedback.status === "error" || feedback.status === "rejected" ? "alert" : "status"}>
          {feedback.status === "error" ? clientErrorText(feedback.code, locale) : feedback.status === "unknown" ? t("结果尚未确认，请核对原结果。") : feedback.message}</p>}
        {state.receiptError && <p role="status">{t("原结果暂时无法核对，请稍后重试读取。")}</p>}
        {state.pending.length > 0 && <section className="zc-receipts"><h2>{t("待核对的操作")}</h2>
          <ul>{state.pending.map(reference => <li key={reference.operationKey}><div><strong>{route?.actions?.find(action => action.id === reference.actionId)?.label[locale] ?? reference.actionId}</strong><span>{reference.targetId}</span></div>
            <button type="button" disabled={state.busy} onClick={() => { void view.readReceipt(reference); }}>{t("读取原结果")}</button></li>)}</ul>
        </section>}
      </main>
    </> : <main className="zc-login" key={state.generation}>
      <h1>{t(staff ? "门店工作台" : "客户服务")}</h1>
      {session.status === "anonymous" ? <><p>{t(staff ? "使用你的员工账号登录。" : "使用你的客户账号登录。")}</p>
        <form onSubmit={event => { event.preventDefault(); const input = values(event.currentTarget); event.currentTarget.reset(); void view.signIn(input); }}>
          {view.runtime.session.loginFields.map(field => <label key={field.name} htmlFor={`login-${field.name}`}>{field.label[locale]}<input id={`login-${field.name}`} name={field.name} type={field.kind} autoComplete={field.autocomplete} required /></label>)}
          <button type="submit" className="zc-primary">{t("登录")}</button>
        </form></> : <p role="status">{t(session.status === "loading" ? "正在核对会话…" : "当前登录服务不可用。")}</p>}
      {session.status === "unavailable" && <button type="button" onClick={() => { void view.refreshSession(); }}>{t("重新连接")}</button>}
      {feedback?.status === "error" && <p role="alert">{clientErrorText(feedback.code, locale)}</p>}
    </main>}
  </div>;
}
