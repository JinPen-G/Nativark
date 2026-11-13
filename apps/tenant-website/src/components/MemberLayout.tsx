import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useSite } from "../SiteContext";
import { useAuth } from "../AuthContext";
import { Address, Bell, LogOut, Receipt, Ticket } from "./SiteIcon";
import { Breadcrumbs, PageHeading } from "./PageHeader";
import { useActiveRail } from "../hooks/useActiveRail";

export type MemberSection =
  | "orders"
  | "addresses"
  | "coupons"
  | "notifications";

export function MemberLayout({
  active,
  title,
  description,
  children,
}: {
  active: MemberSection;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { href, t, isRemote, language } = useSite();
  const { customerName, isAuthenticated, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const rail = useActiveRail<HTMLElement>(`${active}:${language}`);
  const en = language === "en";
  const name = customerName || (en ? "Your account" : "我的账户");
  const links = [
    { id: "orders", label: t("orders"), to: "/orders", Icon: Receipt },
    {
      id: "addresses",
      label: t("addressBook"),
      to: "/account?section=addresses",
      Icon: Address,
    },
    {
      id: "coupons",
      label: t("coupons"),
      to: "/account?section=coupons",
      Icon: Ticket,
    },
    {
      id: "notifications",
      label: t("notifications"),
      to: "/account?section=notifications",
      Icon: Bell,
    },
  ];

  async function signOut() {
    setSigningOut(true);
    setLogoutError("");
    try {
      await logout();
    } catch {
      setLogoutError(
        en ? "Could not sign out. Please try again." : "退出失败，请重试。",
      );
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="shell member-page">
      <Breadcrumbs
        items={[
          { label: t("home"), to: href("/") },
          { label: t("accountTitle") },
        ]}
      />
      <div className="member-layout">
        <aside className="member-navigation">
          <div className="member-profile">
            <span className="member-avatar" aria-hidden="true">
              {Array.from(name)[0]}
            </span>
            <div>
              <strong>{name}</strong>
              <p>
                {isRemote
                  ? t("accountTitle")
                  : en
                    ? "Demo visitor"
                    : "演示访客"}
              </p>
            </div>
          </div>
          <nav className="member-nav" ref={rail} aria-label={t("accountTitle")}>
            {links.map(({ id, label, to, Icon }) => (
              <Link
                key={id}
                to={href(to)}
                className={active === id ? "active" : ""}
                aria-current={active === id ? "page" : undefined}
              >
                <Icon aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>
          {isRemote && isAuthenticated && (
            <button
              className="member-logout"
              type="button"
              disabled={signingOut}
              onClick={() => {
                void signOut();
              }}
            >
              <LogOut aria-hidden="true" />
              {signingOut
                ? en
                  ? "Signing out…"
                  : "正在退出…"
                : t("logoutCta")}
            </button>
          )}
          {logoutError && (
            <p className="form-error" role="alert">
              {logoutError}
            </p>
          )}
        </aside>
        <div className="member-main">
          <PageHeading title={title} description={description} />
          {!isRemote && (
            <p className="preview-notice">
              {en
                ? "Demo visitor. Bookings are saved in this browser. Sign in to a live tenant for account services."
                : "当前为演示访客。预约记录保存在此浏览器，账户服务需登录真实租户。"}
            </p>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
