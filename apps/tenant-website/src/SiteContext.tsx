import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { siteRepository } from './data/siteRepository';
import { loadRemoteSite } from './data/remoteSite';
import { resolveSite } from './data/resolveTenant';
import { applyColorMode, applyTenantTheme, getInitialTheme, THEME_STORAGE_KEY, type ThemeMode } from './theme';
import { createTranslator, LANGUAGE_STORAGE_KEY, localizeProduct, localizeTenant, type Language } from './i18n';
import type { CategoryMode, DemoTenantKey, Product, Tenant } from './types';

interface SiteContextValue {
  tenant: Tenant;
  /** 演示模式下的 demo key；真实租户模式为 undefined。 */
  tenantKey: DemoTenantKey;
  /** 是否为真实租户模式（?tenantCode= 触发，消费后端接口）。 */
  isRemote: boolean;
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
      return saved === 'en' ? 'en' : 'zh';
    } catch {
      return 'zh';
    }
  });
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  // 多租户识别：优先 ?tenant= 演示、其次 ?tenantCode=、再按域名/子域，最后环境变量。
  // categoryMode 之后由 bootstrap.services.length 自动决定，无需按租户写死。
  const resolution = useMemo(() => resolveSite(location.search, typeof window !== 'undefined' ? window.location.host : ''), [location.search]);
  const remoteTenantCode = resolution.kind === 'remote' ? resolution.tenantCode : null;
  const tenantKey = resolution.kind === 'demo' ? resolution.demoKey : 'multiple';

  const [remote, setRemote] = useState<{ code: string; tenant: Tenant } | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  useEffect(() => {
    if (!remoteTenantCode) {
      siteRepository.resetActiveProducts();
      setRemote(null);
      setRemoteError(null);
      return;
    }
    let cancelled = false;
    setRemote(null);
    setRemoteError(null);
    loadRemoteSite(remoteTenantCode)
      .then(site => {
        if (cancelled) return;
        siteRepository.setActiveProducts(site.products);
        setRemote({ code: remoteTenantCode, tenant: site.tenant });
      })
      .catch(() => { if (!cancelled) setRemoteError('无法加载该租户官网数据'); });
    return () => { cancelled = true; };
  }, [remoteTenantCode]);

  const sourceTenant = remote?.tenant ?? siteRepository.getTenant(tenantKey);
  const tenant = useMemo(() => localizeTenant(sourceTenant, language), [sourceTenant, language]);
  const count = tenant.categories.length;
  const mode: CategoryMode = count === 1 ? 'single' : count === 2 ? 'double' : 'multiple';
  const isRemote = Boolean(remoteTenantCode);
  // 链接参数：演示模式带 ?tenant=；真实模式仅当租户来自显式 ?tenantCode= 时才回带（域名/环境变量识别的无需带，保持干净 URL）。
  const explicitCode = new URLSearchParams(location.search).get('tenantCode')?.trim() || null;
  const href = (path: string) => {
    const param = resolution.kind === 'demo' ? `tenant=${tenantKey}` : explicitCode ? `tenantCode=${encodeURIComponent(explicitCode)}` : null;
    if (!param) return path;
    return `${path}${path.includes('?') ? '&' : '?'}${param}`;
  };
  const t = useMemo(() => createTranslator(language), [language]);
  const localize = useMemo(() => (product: Product) => localizeProduct(product, language), [language]);

  useEffect(() => {
    document.title = `${tenant.name} · ${tenant.slogan}`;
    document.documentElement.lang = language;
    applyTenantTheme(sourceTenant);
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
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Local storage may be unavailable in a restricted preview; the in-memory state still works.
    }
  }, [theme]);

  function toggleLanguage() {
    setLanguage(current => current === 'zh' ? 'en' : 'zh');
  }

  function toggleTheme() {
    setTheme(current => current === 'light' ? 'dark' : 'light');
  }

  // 真实租户模式下，数据就绪前先展示轻量占位，避免用演示数据闪一下。
  if (remoteTenantCode && !remote) {
    return <div className="remote-gate" role="status">{remoteError ? remoteError : '正在加载…'}</div>;
  }

  return <SiteContext.Provider value={{ tenant, tenantKey, isRemote, mode, href, language, setLanguage, toggleLanguage, t, localizeProduct: localize, theme, setTheme, toggleTheme }}>{children}</SiteContext.Provider>;
}

export function useSite() {
  const value = useContext(SiteContext);
  if (!value) throw new Error('SiteProvider is required');
  return value;
}
