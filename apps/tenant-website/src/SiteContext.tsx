import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { siteRepository } from './data/siteRepository';
import { applyColorMode, applyTenantTheme, getInitialTheme, THEME_STORAGE_KEY, type ThemeMode } from './theme';
import { createTranslator, LANGUAGE_STORAGE_KEY, localizeProduct, localizeTenant, type Language } from './i18n';
import type { CategoryMode, DemoTenantKey, Product, Tenant } from './types';

interface SiteContextValue {
  tenant: Tenant;
  tenantKey: DemoTenantKey;
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
  const tenantKey = useMemo<DemoTenantKey>(() => {
    const key = new URLSearchParams(location.search).get('tenant');
    return key === 'single' || key === 'double' || key === 'multiple' ? key : 'multiple';
  }, [location.search]);
  const sourceTenant = siteRepository.getTenant(tenantKey);
  const tenant = useMemo(() => localizeTenant(sourceTenant, language), [sourceTenant, language]);
  const count = tenant.categories.length;
  const mode: CategoryMode = count === 1 ? 'single' : count === 2 ? 'double' : 'multiple';
  const href = (path: string) => `${path}${path.includes('?') ? '&' : '?'}tenant=${tenantKey}`;
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

  return <SiteContext.Provider value={{ tenant, tenantKey, mode, href, language, setLanguage, toggleLanguage, t, localizeProduct: localize, theme, setTheme, toggleTheme }}>{children}</SiteContext.Provider>;
}

export function useSite() {
  const value = useContext(SiteContext);
  if (!value) throw new Error('SiteProvider is required');
  return value;
}
