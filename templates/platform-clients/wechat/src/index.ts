/** 原生微信生命周期与展示映射；wx 只做存储/扫码，认证及业务来自原 Core 宿主。 */
import { ClientError, clientText, clientErrorText, createClientRuntime, createClientView, createClientOperationStore,
  type ClientLocale, type ClientRuntimeOptions, type ClientView, type ClientViewState, type ClientMessage } from "@rental-os/platform-client-contracts";
import { getArcPalette } from "@rental-os/platform-admin/source/app/arcTokens";
import { ADMIN_FONT_FAMILY } from "@rental-os/platform-admin/source/app/designTokens";

export interface WechatClientAssembly extends Omit<ClientRuntimeOptions, "surface"> {
  readonly brand: { readonly name: string; readonly primaryColor?: string };
  readonly operationNamespace?: string;
}
export interface WechatClientApp {
  readonly surface: "wechat-customer" | "wechat-staff";
  readonly view?: ClientView;
  readonly brandName: string;
  readonly primaryColor?: string;
  readonly ready?: Promise<void>;
}
export function createWechatClientApp(surface: WechatClientApp["surface"], assemble: () => WechatClientAssembly | undefined | Promise<WechatClientAssembly | undefined>) {
  let view: ClientView | undefined;
  return {
    surface, brandName: "", primaryColor: undefined as string | undefined, view: undefined as ClientView | undefined, ready: Promise.resolve(),
    onLaunch(this: WechatClientApp & { view?: ClientView; brandName: string; primaryColor?: string; ready: Promise<void> }) {
      this.ready = Promise.resolve().then(assemble).then(assembly => {
        if (!assembly) return;
        const runtime = createClientRuntime({ ...assembly, surface });
        const store = createClientOperationStore({ keys: () => wx.getStorageInfoSync().keys,
          get: key => { const value: unknown = wx.getStorageSync(key); return typeof value === "string" && value ? value : null; },
          set: (key, value) => wx.setStorageSync(key, value), remove: key => wx.removeStorageSync(key),
        }, assembly.operationNamespace ?? surface);
        view = createClientView(runtime, store); this.view = view; this.brandName = assembly.brand.name; this.primaryColor = assembly.brand.primaryColor;
      }).catch(() => { /* 缺真实装配/安全随机源保持不可用，页面不得以弱随机或空成功继续。 */ });
    },
    onHide() { view?.suspend(); },
  };
}

type InputEvent = WechatMiniprogram.CustomEvent<{ value: string | Record<string, string> }>;
type TapEvent = WechatMiniprogram.TouchEvent;
interface PageHandle { setData(data: Record<string, unknown>): void }
export function createWechatClientPage(getClient: () => WechatClientApp) {
  let view: ClientView | undefined, unsubscribe: (() => void) | undefined, page: PageHandle | undefined;
  let locale: ClientLocale = "zh-CN", state: ClientViewState | undefined, lastGeneration = -1, active = false, dark = false;
  let actionId: string | undefined, scanValue = "", searchValue = "", showAttempt = 0;
  let initialDestination: { routeId: string; params: Record<string, string> } | undefined;
  const t = (text: ClientMessage) => clientText(text, locale);
  function render() {
    if (!page || !active) return;
    state = view?.getSnapshot();
    const changed = state?.generation !== lastGeneration;
    if (changed) { actionId = undefined; scanValue = ""; searchValue = ""; lastGeneration = state?.generation ?? -1; }
    const route = view?.runtime.routes.find(item => item.id === state?.destination?.routeId);
    const action = route?.actions?.find(item => item.id === actionId);
    const session = state?.session, authenticated = session?.status === "authenticated";
    const feedback = state?.feedback;
    const palette = getArcPalette(dark, getClient().primaryColor);
    page.setData({
      themeStyle: Object.entries(palette).filter(([, value]) => typeof value === "string").map(([key, value]) => `--client-${key}:${value}`).join(";") + `;font-family:${ADMIN_FONT_FAMILY}`,
      locale, brand: getClient().brandName, surfaceTitle: t(getClient().surface === "wechat-staff" ? "门店工作台" : "客户服务"),
      authenticated, anonymous: session?.status === "anonymous", loadingSession: session?.status === "loading",
      unavailable: !session || session.status === "unavailable", generation: lastGeneration,
      identity: authenticated ? [session.displayName, session.tenantName, session.workspaceName, session.locationName].filter(Boolean).join(" / ") : "",
      loginFields: view?.runtime.session.loginFields.map(field => ({ ...field, label: field.label[locale], value: "" })) ?? [],
      navigation: view?.runtime.routes.filter(item => item.navigation === true).map(item => ({ id: item.id, label: item.label[locale], current: item.id === route?.id })) ?? [],
      scopeChoices: state?.scopeChoices ?? [], title: state?.page.data?.title ?? route?.label[locale] ?? t("暂时没有可用服务。"),
      description: state?.page.data?.description ?? "", items: state?.page.status === "ready" ? state.page.data?.items ?? [] : [],
      pageReady: state?.page.status === "ready", pageLoading: state?.page.status === "loading",
      pageError: state?.page.status === "error" ? clientErrorText(state.page.error ?? "unavailable", locale) : "",
      emptyText: state?.page.data?.emptyText ?? "", searchable: !!route?.searchable,
      scannable: !!route && !!view?.runtime.find(route.id).contribution.scan,
      searchValue, scanValue, busy: state?.busy ?? false,
      actions: route?.actions?.map(item => ({ id: item.id, label: item.label[locale],
        disabled: !view?.writable || !!state?.busy || !!state?.receiptError || !!state?.pending.some(reference => reference.actionId === item.id) })) ?? [],
      action: action ? { id: action.id, label: action.label[locale], fields: action.fields?.map(field => ({ ...field, label: field.label[locale], value: "" })) ?? [] } : null,
      pending: state?.pending.map(reference => ({ ...reference, label: route?.actions?.find(item => item.id === reference.actionId)?.label[locale] ?? reference.actionId })) ?? [],
      receiptError: state?.receiptError ? t("原结果暂时无法核对，请稍后重试读取。") : "",
      feedback: feedback?.status === "error" ? clientErrorText(feedback.code, locale) : feedback?.status === "unknown" ? t("结果尚未确认，请核对原结果。") : feedback?.message ?? "",
      copy: { login: t("登录"), logout: t("退出登录"), reconnect: t("重新连接"), relogin: t("重新登录"), loadingSession: t("正在核对会话…"),
        unavailable: t("当前登录服务不可用。"), scopes: t("切换工作范围"), search: t("搜索"), searchLabel: t("搜索当前页面"),
        scan: t("扫描二维码"), scanLabel: t("扫码或输入编号"), open: t("打开"), refresh: t("刷新页面"), loading: t("正在加载…"),
        confirm: t("确认执行"), cancel: t("取消"), actionHint: t("此操作将提交到当前页面所示的业务对象。"),
        pending: t("待核对的操作"), receipt: t("读取原结果"), home: t("返回首页") },
      themeLabel: t(dark ? "浅色外观" : "深色外观"),
    });
  }
  const index = (event: TapEvent) => Number(event.currentTarget.dataset.index);
  return {
    data: { unavailable: true },
    onLoad(this: PageHandle, options: Record<string, string | undefined>) {
      page = this; view = getClient().view;
      if (options.route) initialDestination = { routeId: options.route,
        params: Object.fromEntries(Object.entries(options).filter((entry): entry is [string, string] => entry[0] !== "route" && typeof entry[1] === "string")) };
    },
    async onShow() {
      active = true; const attempt = ++showAttempt;
      page?.setData({ loadingSession: true, unavailable: false, surfaceTitle: t(getClient().surface === "wechat-staff" ? "门店工作台" : "客户服务"),
        copy: { loadingSession: t("正在核对会话…") } });
      await getClient().ready;
      if (!active || attempt !== showAttempt) return;
      view = getClient().view; unsubscribe?.(); unsubscribe = view?.subscribe(render);
      if (view) { void view.resume(); if (initialDestination || !view.getSnapshot().destination) view.navigate(initialDestination); }
      initialDestination = undefined; render();
    },
    onHide() { active = false; showAttempt++; unsubscribe?.(); unsubscribe = undefined; actionId = undefined; scanValue = ""; searchValue = "";
      page?.setData({ authenticated: false, identity: "", items: [], pending: [], action: null, loginFields: [], feedback: "" }); view?.suspend(); },
    onUnload() {
      active = false; showAttempt++; unsubscribe?.(); unsubscribe = undefined; page = undefined;
      // 卸载可能没有先收到 onHide；原键保存/准备的迟到完成也不得继续派发。
      view?.suspend();
    },
    changeLanguage() { locale = locale === "zh-CN" ? "en-US" : "zh-CN"; render(); },
    changeTheme() {
      dark = !dark; const palette = getArcPalette(dark, getClient().primaryColor);
      wx.setNavigationBarColor({ frontColor: dark ? "#ffffff" : "#000000", backgroundColor: palette.background }); render();
    },
    signIn(event: InputEvent) { if (typeof event.detail.value === "object") void view?.signIn(event.detail.value); },
    signOut() { void view?.signOut(); }, reconnect() { void view?.resume(); },
    selectScope(event: InputEvent) { const choice = state?.scopeChoices[Number(event.detail.value)]; if (choice) void view?.selectScope(choice.id); },
    navigate(event: TapEvent) { const id: unknown = event.currentTarget.dataset.id; if (typeof id === "string") view?.navigate({ routeId: id }); },
    home() { view?.navigate(); },
    openItem(event: TapEvent) { const item = state?.page.data?.items[index(event)]; if (item?.destination) view?.navigate(item.destination); },
    searchInput(event: InputEvent) { if (typeof event.detail.value === "string") searchValue = event.detail.value; },
    search() { view?.search(searchValue); },
    scanInput(event: InputEvent) { if (typeof event.detail.value === "string") scanValue = event.detail.value; },
    openCode() { if (scanValue) void view?.scan(scanValue); },
    scan() {
      const original = view, generation = original?.getSnapshot().generation;
      // 扫码弹窗回来也须复核页面代次，结果不能落到新的身份或业务页面。
      wx.scanCode({ onlyFromCamera: true, success(result) {
        if (active && original && original === view && generation === original.getSnapshot().generation) void original.scan(result.result);
      } });
    },
    reload() { void view?.reload(); },
    openAction(event: TapEvent) {
      const id: unknown = event.currentTarget.dataset.id;
      if (typeof id === "string" && !state?.busy) { actionId = id; render(); }
    },
    cancelAction() { actionId = undefined; render(); },
    execute(event: InputEvent) {
      if (!actionId || typeof event.detail.value !== "object" || !view || !state?.destination) return;
      const action = view.runtime.find(state.destination.routeId).route.actions?.find(item => item.id === actionId);
      const input = event.detail.value;
      if (!action || action.fields?.some(field => field.required && !input[field.name]?.trim()
        || field.maxLength !== undefined && (input[field.name]?.length ?? 0) > field.maxLength)) {
        wx.showToast({ title: t("请补全必填信息并核对输入长度。"), icon: "none" }); return;
      }
      const id = actionId; actionId = undefined; render(); void view.execute(id, input);
    },
    readReceipt(event: TapEvent) { const reference = state?.pending[index(event)]; if (reference) void view?.readReceipt(reference); },
  };
}
