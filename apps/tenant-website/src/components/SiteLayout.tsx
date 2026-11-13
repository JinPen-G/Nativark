import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Link,
  NavLink,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  Globe2,
  Menu,
  Moon,
  Search,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import { useSite } from "../SiteContext";
import { useAuth } from "../AuthContext";

/** 消费者网站导航与页面壳，当前租户及客户身份来自共用上下文。 */
export function SiteLayout({ children }: { children: ReactNode }) {
  const {
    tenant,
    href,
    language,
    toggleLanguage,
    theme,
    toggleTheme,
    isRemote,
    productsError,
  } = useSite();
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const navigationType = useNavigationType();
  const en = language === "en";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  const previousPath = useRef<string | null>(null);
  const nav = [
    { path: "/products", label: en ? "Explore rentals" : "探索商品" },
    { path: "/guide", label: en ? "How to rent" : "怎么租" },
    { path: "/about", label: en ? "Our stores" : "关于与门店" },
  ];
  useEffect(() => {
    setMenuOpen(false);
    const changed =
      previousPath.current !== null &&
      previousPath.current !== location.pathname;
    previousPath.current = location.pathname;
    if (changed) {
      if (!location.hash && navigationType !== "POP")
        window.scrollTo({ top: 0, behavior: "instant" });
      document
        .querySelector<HTMLElement>("main")
        ?.focus({ preventScroll: true });
    }
    if (!location.hash) return;
    const reveal = () => {
      const target = document.getElementById(location.hash.slice(1));
      target?.scrollIntoView({ behavior: "instant", block: "start" });
      return Boolean(target);
    };
    if (reveal()) return;
    // 路由按需加载时等待目标内容挂载，门店与指南锚点仍能正确定位。
    const observer = new MutationObserver(() => {
      if (reveal()) observer.disconnect();
    });
    const main = document.querySelector("main");
    if (main) observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [location, navigationType]);
  useEffect(() => {
    if (!menuOpen) return;
    const closeWithKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    const closeOutside = (event: PointerEvent) => {
      if (!header.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", closeWithKey);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeWithKey);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [menuOpen]);
  const logo = theme === "dark" ? tenant.logoDark || tenant.logo : tenant.logo;
  return (
    <div className="site-root">
      <a className="skip-link" href="#main-content">
        {en ? "Skip to content" : "跳转到内容"}
      </a>
      <header className="site-header" ref={header}>
        <div className="shell header-inner">
          <Link
            className="brand-link"
            to={href("/")}
            aria-label={en ? `${tenant.name} home` : `${tenant.name}首页`}
          >
            {logo && <img src={logo} alt="" width="32" height="32" />}
            <span>{tenant.name}</span>
          </Link>
          <nav
            className="desktop-nav"
            aria-label={en ? "Main navigation" : "主导航"}
          >
            {nav.map((item) => (
              <NavLink
                key={item.path}
                to={href(item.path)}
                className={({ isActive }) =>
                  isActive ||
                  (item.path === "/products" &&
                    /^\/(category|product|booking)\//.test(location.pathname))
                    ? "active"
                    : ""
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="header-actions">
            <button
              className="icon-button language-button"
              type="button"
              onClick={toggleLanguage}
              aria-label={en ? "切换到中文" : "Switch to English"}
            >
              <Globe2 />
              <span>{en ? "中" : "EN"}</span>
            </button>
            <button
              className="icon-button theme-button"
              type="button"
              onClick={toggleTheme}
              aria-label={
                en
                  ? `Switch to ${theme === "light" ? "dark" : "light"} theme`
                  : theme === "light"
                    ? "切换深色模式"
                    : "切换浅色模式"
              }
            >
              {theme === "light" ? <Moon /> : <Sun />}
            </button>
            <Link
              className="icon-button header-search"
              to={href("/products")}
              aria-label={en ? "Search rentals" : "搜索商品"}
            >
              <Search />
            </Link>
            <Link
              className="account-link"
              aria-label={en ? "My rentals" : "我的租赁"}
              to={href(isAuthenticated || !isRemote ? "/orders" : "/login")}
            >
              <UserRound />
              <span>{en ? "My rentals" : "我的租赁"}</span>
            </Link>
            <button
              className="icon-button menu-toggle"
              ref={menuButton}
              type="button"
              aria-label={
                menuOpen
                  ? en
                    ? "Close menu"
                    : "关闭菜单"
                  : en
                    ? "Open menu"
                    : "打开菜单"
              }
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav
            className="mobile-nav shell"
            id="mobile-navigation"
            aria-label={en ? "Mobile navigation" : "移动导航"}
          >
            {nav.map((item) => (
              <NavLink key={item.path} to={href(item.path)}>
                {item.label}
                <ArrowUpRight />
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main id="main-content" tabIndex={-1}>
        {productsError && (
          <div className="shell catalog-load-notice" role="alert">
            <p>
              {en
                ? "Some rentals could not be loaded. Reload to check the full catalog."
                : "部分商品目录未能加载，请重新加载后查看。"}
            </p>
            <button
              className="button button-outline"
              type="button"
              onClick={() => window.location.reload()}
            >
              {en ? "Reload catalog" : "重新加载目录"}
            </button>
          </div>
        )}
        {children}
      </main>
      <footer className="site-footer">
        <div className="shell footer-main">
          <div className="footer-brand">
            <Link className="brand-link" to={href("/")}>
              <img src={logo} alt="" width="32" height="32" />
              <span>{tenant.name}</span>
            </Link>
            <p>
              {isRemote
                ? tenant.footerText || tenant.slogan
                : en
                  ? "For the days you need it. Find your equipment, choose your dates, and make a plan."
                  : "选好装备，定下租期。让这次拍摄、出游和日常计划，都轻松开始。"}
            </p>
          </div>
          <div className="footer-column">
            <h2>{en ? "Explore" : "开始探索"}</h2>
            <Link to={href("/products")}>
              {en ? "All rentals" : "全部商品"}
            </Link>
            <Link to={href("/orders")}>{en ? "My rentals" : "我的租赁"}</Link>
            <Link to={href("/account")}>{en ? "My account" : "账户中心"}</Link>
          </div>
          <div className="footer-column">
            <h2>{en ? "Here to help" : "租赁服务"}</h2>
            <Link to={href("/guide")}>{en ? "Rental guide" : "租赁指南"}</Link>
            <Link to={href("/about#stores")}>
              {en ? "Find a store" : "查找门店"}
            </Link>
            <Link to={href("/help")}>
              {en ? "Help & questions" : "帮助与常见问题"}
            </Link>
          </div>
          <div className="footer-contact">
            <h2>{en ? "Let’s talk" : "联系门店"}</h2>
            {isRemote && tenant.phone ? (
              <a href={"tel:" + tenant.phone}>{tenant.phone}</a>
            ) : (
              <Link className="footer-contact-link" to={href("/help")}>
                {en ? "Get rental help" : "了解租赁问题"}
                <ArrowUpRight />
              </Link>
            )}
            <p>
              {isRemote
                ? tenant.customerService
                : en
                  ? "A complete storefront demo."
                  : "当前为完整网站演示。"}
            </p>
            {!isRemote && (
              <span className="demo-label">
                <Check />
                {en ? "Demo catalog" : "演示商品目录"}
              </span>
            )}
          </div>
        </div>
        <div className="shell footer-bottom">
          <span>
            © {new Date().getFullYear()} {tenant.name}
          </span>
          <div>
            <Link to={href("/agreement")}>{en ? "Terms" : "用户协议"}</Link>
            <Link to={href("/privacy")}>{en ? "Privacy" : "隐私政策"}</Link>
            {tenant.showPoweredBy && <span>Powered by Rental OS</span>}
          </div>
        </div>
      </footer>
    </div>
  );
}
