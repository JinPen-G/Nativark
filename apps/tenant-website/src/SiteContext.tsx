import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { siteRepository } from "./data/siteRepository";
import { loadRemoteBootstrap, loadRemoteCatalogs } from "./data/remoteSite";
import { resolveSite, type SiteResolution } from "./data/resolveTenant";
import { clientApi, type BootstrapResponse } from "./data/apiClient";
import {
  applyColorMode,
  applyTenantTheme,
  applyTenantFavicon,
  getInitialTheme,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "./theme";
import {
  createTranslator,
  LANGUAGE_STORAGE_KEY,
  localizeProduct,
  localizeTenant,
  type Language,
} from "./i18n";
import type { CategoryMode, DemoTenantKey, Product, Tenant } from "./types";

interface SiteContextValue {
  tenant: Tenant;
  /** 演示模式下的 demo key；真实租户模式为 undefined。 */
  tenantKey: DemoTenantKey;
  /** 真实租户编码（?tenantCode= / 子域名 / 自定义域名反查得到）；演示模式为 null。认证按它隔离会话。 */
  tenantCode: string | null;
  /** 是否为真实租户模式（?tenantCode= 触发，消费后端接口）。 */
  isRemote: boolean;
  /** True only after the real host binding was resolved, never inferred from query absence. */
  enterpriseDomainBound: boolean;
  /** 商品目录是否已就绪（真实租户模式下第二阶段加载）；演示模式恒为 true。 */
  productsReady: boolean;
  productsError: boolean;
  bootstrap: BootstrapResponse | null;
  mode: CategoryMode;
  href: (path: string) => string;
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: ReturnType<typeof createTranslator>;
  localizeProduct: (product: Product) => Product;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

const SiteContext = createContext<SiteContextValue | null>(null);

export function SiteProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [language, setLanguage] = useState<Language>(() => {
    try {
      const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      return saved === "en" ? "en" : "zh";
    } catch {
      return "zh";
    }
  });
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  // 多租户识别：?tenant= 演示 > ?tenantCode= > 平台子域名 >（客户自定义域名，异步反查）> 环境变量兜底。
  // categoryMode 之后由 bootstrap.services.length 自动决定，无需按租户写死。
  const host = typeof window !== "undefined" ? window.location.host : "";
  const resolution = useMemo(
    () => resolveSite(location.search, host),
    [location.search, host],
  );

  // 自定义域名需向后端反查（异步）；其余识别是同步的。effective 是反查后的最终归属。
  const [effective, setEffective] = useState<SiteResolution>(() =>
    resolution.kind === "host" ? resolution.fallback : resolution,
  );
  const [hostResolving, setHostResolving] = useState(
    resolution.kind === "host",
  );
  const [hostError, setHostError] = useState(false);
  const [resolvedBinding, setResolvedBinding] = useState<{
    host: string;
    tenantCode: string;
  } | null>(null);

  useEffect(() => {
    setResolvedBinding(null);
    setHostError(false);
    if (resolution.kind !== "host") {
      setEffective(resolution);
      setHostResolving(false);
      return;
    }
    let cancelled = false;
    setHostResolving(true);
    clientApi
      .resolveHost(resolution.host)
      .then((result) => {
        if (!cancelled) {
          setEffective(
            result.tenantCode
              ? { kind: "remote", tenantCode: result.tenantCode }
              : resolution.fallback,
          );
          setHostError(
            !result.tenantCode && resolution.fallback.kind === "demo",
          );
          setResolvedBinding(
            result.tenantCode
              ? { host: resolution.host, tenantCode: result.tenantCode }
              : null,
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEffective(resolution.fallback);
          setResolvedBinding(null);
          setHostError(resolution.fallback.kind === "demo");
        }
      })
      .finally(() => {
        if (!cancelled) setHostResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resolution]);

  const remoteTenantCode =
    effective.kind === "remote" ? effective.tenantCode : null;
  const tenantKey = effective.kind === "demo" ? effective.demoKey : "multiple";

  const [remote, setRemote] = useState<{
    code: string;
    tenant: Tenant;
    bootstrap: BootstrapResponse;
  } | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [productsReady, setProductsReady] = useState(false);
  const [productsError, setProductsError] = useState(false);

  useEffect(() => {
    if (!remoteTenantCode) {
      siteRepository.resetActiveProducts();
      setRemote(null);
      setRemoteError(null);
      setProductsReady(true);
      setProductsError(false);
      return;
    }
    let cancelled = false;
    setRemote(null);
    setRemoteError(null);
    setProductsReady(false);
    setProductsError(false);
    siteRepository.setActiveProducts([]);
    // 第一阶段：bootstrap 就绪即渲染品牌/导航/形态；第二阶段：目录到位后补齐商品与二级分类。
    loadRemoteBootstrap(remoteTenantCode)
      .then(({ tenant, bootstrap }) => {
        if (cancelled) return undefined;
        setRemote({ code: remoteTenantCode, tenant, bootstrap });
        return loadRemoteCatalogs(remoteTenantCode, bootstrap)
          .then((result) => {
            if (cancelled) return;
            siteRepository.setActiveProducts(result.products);
            setRemote({
              code: remoteTenantCode,
              tenant: result.tenant,
              bootstrap,
            });
            setProductsReady(true);
            setProductsError(result.catalogsFailed);
          })
          .catch(() => {
            if (!cancelled) {
              setProductsReady(true);
              setProductsError(true);
            }
          });
      })
      .catch(() => {
        if (!cancelled) setRemoteError("无法加载该租户官网数据");
      });
    return () => {
      cancelled = true;
    };
  }, [remoteTenantCode]);

  const activeRemote = remote?.code === remoteTenantCode ? remote : null;
  const sourceTenant =
    activeRemote?.tenant ?? siteRepository.getTenant(tenantKey);
  const tenant = useMemo(
    () => localizeTenant(sourceTenant, language),
    [sourceTenant, language],
  );
  const count = tenant.categories.length;
  const mode: CategoryMode =
    count === 1 ? "single" : count === 2 ? "double" : "multiple";
  const isRemote = Boolean(remoteTenantCode);
  // 链接参数：演示模式带 ?tenant=；真实模式仅当租户来自显式 ?tenantCode= 时才回带（域名/子域/环境变量识别的无需带，保持干净 URL）。
  const explicitCode =
    new URLSearchParams(location.search).get("tenantCode")?.trim() || null;
  const href = (path: string) => {
    const identity =
      effective.kind === "demo"
        ? ["tenant", tenantKey]
        : explicitCode
          ? ["tenantCode", explicitCode]
          : null;
    if (!identity) return path;
    const hashIndex = path.indexOf("#");
    const hash = hashIndex < 0 ? "" : path.slice(hashIndex);
    const route = hashIndex < 0 ? path : path.slice(0, hashIndex);
    const queryIndex = route.indexOf("?");
    const pathname = queryIndex < 0 ? route : route.slice(0, queryIndex);
    const query = new URLSearchParams(
      queryIndex < 0 ? "" : route.slice(queryIndex + 1),
    );
    query.delete(identity[0] === "tenant" ? "tenantCode" : "tenant");
    query.set(identity[0], identity[1]);
    return `${pathname}?${query}${hash}`;
  };
  const t = useMemo(() => createTranslator(language), [language]);
  const localize = useMemo(
    () => (product: Product) => localizeProduct(product, language),
    [language],
  );

  useEffect(() => {
    const title =
      tenant.seoTitle?.trim() || `${tenant.name} · ${tenant.slogan}`;
    document.title = title;
    document.documentElement.lang = language;
    applyTenantTheme(sourceTenant);
    // SEO：官网渠道配置的描述/关键词写入 <meta>，缺省用品牌描述兜底。
    const description =
      tenant.seoDescription?.trim() ||
      tenant.heroDescription?.replace(/\n/g, " ").trim() ||
      tenant.slogan;
    const setMeta = (
      selector: string,
      attr: string,
      key: string,
      content: string,
    ) => {
      if (!content) return;
      let tag = document.head.querySelector<HTMLMetaElement>(selector);
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute(attr, key);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
    };
    setMeta('meta[name="description"]', "name", "description", description);
    if (tenant.seoKeywords?.trim())
      setMeta(
        'meta[name="keywords"]',
        "name",
        "keywords",
        tenant.seoKeywords.trim(),
      );
    // Open Graph：分享到社交/IM 时的标题、描述与预览图。
    setMeta('meta[property="og:title"]', "property", "og:title", title);
    setMeta(
      'meta[property="og:description"]',
      "property",
      "og:description",
      description,
    );
    setMeta('meta[property="og:type"]', "property", "og:type", "website");
    if (tenant.heroImage) {
      const img = tenant.heroImage.startsWith("/")
        ? `${window.location.origin}${tenant.heroImage}`
        : tenant.heroImage;
      setMeta('meta[property="og:image"]', "property", "og:image", img);
    }
  }, [language, sourceTenant, tenant]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Local storage may be unavailable in a restricted preview; the in-memory state still works.
    }
  }, [language]);

  useEffect(() => {
    applyColorMode(theme);
    applyTenantFavicon(sourceTenant, theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Local storage may be unavailable in a restricted preview; the in-memory state still works.
    }
  }, [theme, sourceTenant]);

  function toggleLanguage() {
    setLanguage((current) => (current === "zh" ? "en" : "zh"));
  }

  function toggleTheme() {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  }

  // 真实租户模式下，数据就绪前先展示轻量占位，避免用演示数据闪一下。
  if (hostResolving || hostError || (remoteTenantCode && !activeRemote)) {
    const failed = hostError || Boolean(remoteError);
    return (
      <main className="remote-gate">
        <div className="remote-gate-content">
          <img
            src={
              theme === "dark"
                ? "/brand/yicheng-dark.svg"
                : "/brand/yicheng.svg"
            }
            alt=""
            width="40"
            height="40"
          />
          <h1>
            {failed
              ? language === "en"
                ? "This storefront could not be loaded"
                : "官网暂时无法加载"
              : language === "en"
                ? "Preparing your storefront"
                : "正在加载租户官网"}
          </h1>
          <p role={failed ? "alert" : "status"}>
            {failed
              ? language === "en"
                ? "Refresh this page to check the current storefront again."
                : "请刷新页面，重新核对当前官网信息。"
              : language === "en"
                ? "Loading the current merchant and rental catalog…"
                : "正在读取当前商户与租赁目录…"}
          </p>
          {failed && (
            <button
              className="button button-dark"
              type="button"
              onClick={() => window.location.reload()}
            >
              {language === "en" ? "Reload storefront" : "重新加载官网"}
            </button>
          )}
        </div>
      </main>
    );
  }

  return (
    <SiteContext.Provider
      value={{
        tenant,
        tenantKey,
        tenantCode: remoteTenantCode,
        isRemote,
        enterpriseDomainBound:
          resolution.kind === "host" &&
          resolvedBinding?.host === resolution.host &&
          resolvedBinding?.tenantCode === remoteTenantCode,
        productsReady,
        productsError,
        bootstrap: activeRemote?.bootstrap ?? null,
        mode,
        href,
        language,
        setLanguage,
        toggleLanguage,
        t,
        localizeProduct: localize,
        theme,
        setTheme,
        toggleTheme,
      }}
    >
      {children}
    </SiteContext.Provider>
  );
}

export function useSite() {
  const value = useContext(SiteContext);
  if (!value) throw new Error("SiteProvider is required");
  return value;
}
