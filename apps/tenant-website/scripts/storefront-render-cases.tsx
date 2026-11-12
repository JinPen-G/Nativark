import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SiteProvider } from "../src/SiteContext";
import { AuthProvider } from "../src/AuthContext";
import { ToastProvider } from "../src/components/Toast";
import { SiteLayout } from "../src/components/SiteLayout";
import { HomePage } from "../src/pages/HomePage";
import { ProductsPage } from "../src/pages/ProductsPage";
import { ProductDetailPage } from "../src/pages/ProductDetailPage";
import { BookingPage } from "../src/pages/BookingPage";
import { LoginPage } from "../src/pages/LoginPage";
import { AccountPage } from "../src/pages/AccountPage";
import { OrdersPage, OrderDetailPage } from "../src/pages/OrderPages";
import { AboutPage, GuidePage, NotFoundPage } from "../src/pages/InfoPages";
import { DocumentPage } from "../src/pages/DocumentPage";
import { demoTenants } from "../src/data/catalog";
import { applyTenantFavicon } from "../src/theme";

export async function verify(root: string) {
  const memory = new Map<string, string>();
  const local = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  };
  // 只为上下文提供最小宿主，服务端渲染不执行页面副作用。
  const windowStub = Object.assign(new EventTarget(), {
    localStorage: local,
    location: { host: "127.0.0.1:4187" },
    matchMedia: () => ({ matches: false }),
  });
  Object.assign(globalThis, { localStorage: local, window: windowStub });
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("Network is forbidden in this offline check");
  };
  const cases = [
    { path: "/", pattern: "/", page: <HomePage />, marker: "rental-finder" },
    {
      path: "/products",
      pattern: "/products",
      page: <ProductsPage />,
      marker: "catalog-conditions",
    },
    {
      path: "/category/camera",
      pattern: "/category/:categoryId",
      page: <ProductsPage />,
      marker: "catalog-grid",
    },
    {
      path: "/product/camera-a7",
      pattern: "/product/:productId",
      page: <ProductDetailPage />,
      marker: "detail-tab-panel",
    },
    {
      path: "/booking/camera-a7",
      pattern: "/booking/:productId",
      page: <BookingPage />,
      marker: "booking-contact",
    },
    {
      path: "/orders",
      pattern: "/orders",
      page: <OrdersPage />,
      marker: "reservation-card",
    },
    {
      path: "/orders/SMOKE-ORDER",
      pattern: "/orders/:orderId",
      page: <OrderDetailPage />,
      marker: "order-detail-layout",
    },
    {
      path: "/login",
      pattern: "/login",
      page: <LoginPage />,
      marker: "login-code-row",
    },
    {
      path: "/login?view=register",
      pattern: "/login",
      page: <LoginPage />,
      marker: "new-password",
    },
    {
      path: "/account",
      pattern: "/account",
      page: <AccountPage />,
      marker: "member-section-toolbar",
    },
    {
      path: "/account?section=coupons",
      pattern: "/account",
      page: <AccountPage />,
      marker: "lucide-ticket-percent",
    },
    {
      path: "/account?section=notifications",
      pattern: "/account",
      page: <AccountPage />,
      marker: "lucide-bell",
    },
    {
      path: "/about",
      pattern: "/about",
      page: <AboutPage />,
      marker: "about-image",
    },
    {
      path: "/guide",
      pattern: "/guide",
      page: <GuidePage />,
      marker: "guide-list",
    },
    {
      path: "/help",
      pattern: "/help",
      page: <DocumentPage kind="help" />,
      marker: "help-search",
    },
    {
      path: "/agreement",
      pattern: "/agreement",
      page: <DocumentPage kind="user_agreement" />,
      marker: "page-state",
    },
    {
      path: "/privacy",
      pattern: "/privacy",
      page: <DocumentPage kind="privacy_policy" />,
      marker: "page-state",
    },
    {
      path: "/missing-page",
      pattern: "*",
      page: <NotFoundPage />,
      marker: "not-found-page",
    },
  ];
  let rendered = 0;
  for (const tenant of ["single", "double", "multiple"] as const)
    for (const language of ["zh", "en"])
      for (const theme of ["light", "dark"]) {
        memory.set("rental-os-tenant-language", language);
        memory.set("rental-os-theme", theme);
        memory.set(
          "rental-os-tenant-website-demo-orders",
          JSON.stringify([
            {
              id: "SMOKE-ORDER",
              tenantId: demoTenants[tenant].id,
              productId: "camera-a7",
              startDate: "2030-01-02T10:00",
              endDate: "2030-01-04T10:00",
              quantity: 1,
              fulfillment: "pickup",
              contactName: "Offline test fixture",
              contactPhone: "",
              rentalAmount: 180,
              depositAmount: 2000,
            },
          ]),
        );
        for (const item of cases) {
          const url =
            item.path +
            (item.path.includes("?") ? "&" : "?") +
            "tenant=" +
            tenant;
          const html = renderToStaticMarkup(
            <MemoryRouter initialEntries={[url]}>
              <SiteProvider>
                <AuthProvider>
                  <ToastProvider>
                    <SiteLayout>
                      <Routes>
                        <Route path={item.pattern} element={item.page} />
                      </Routes>
                    </SiteLayout>
                  </ToastProvider>
                </AuthProvider>
              </SiteProvider>
            </MemoryRouter>,
          );
          assert.ok(
            html.includes(item.marker),
            tenant +
              "/" +
              language +
              "/" +
              theme +
              item.path +
              ": missing " +
              item.marker,
          );
          assert.ok(
            !html.includes("/assets/") &&
              !html.includes("logo-black.svg") &&
              !html.includes("logo-white.svg"),
            "Legacy design asset rendered",
          );
          if (item.path === "/") {
            assert.ok(
              html.includes("lucide-calendar-days") &&
                html.includes("lucide-package-check"),
              "Rental steps lost their contextual icons",
            );
            assert.equal(
              html.match(/type="datetime-local"/g)?.length,
              2,
              "Home must collect both pickup and return times",
            );
          }
          if (item.path.startsWith("/login"))
            assert.ok(
              html.includes('disabled=""'),
              "Demo sign-in must remain disabled",
            );
          rendered++;
        }
      }
  assert.equal(networkCalls, 0);
  const link: any = {
    href: "",
    type: "",
    removeAttribute(name: string) {
      delete this[name];
    },
  };
  Object.assign(globalThis, { document: { querySelector: () => link } });
  applyTenantFavicon(demoTenants.single, "light");
  assert.equal(link.href, "/brand/yicheng.svg");
  applyTenantFavicon(demoTenants.single, "dark");
  assert.equal(link.href, "/brand/yicheng-dark.svg");
  applyTenantFavicon(
    { ...demoTenants.single, logoCompact: "/brand/customer-custom.svg" },
    "dark",
  );
  assert.equal(link.href, "/brand/customer-custom.svg");
  const index = await readFile(resolve(root, "index.html"), "utf8");
  const startup = index.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(startup);
  for (const saved of ["", "light", "dark"])
    for (const systemDark of [false, true]) {
      const favicon = { href: "" };
      const document = {
        documentElement: { dataset: {} as Record<string, string> },
        getElementById: () => favicon,
      };
      runInNewContext(startup!, {
        document,
        localStorage: { getItem: () => saved },
        matchMedia: () => ({ matches: systemDark }),
      });
      const expected = saved || (systemDark ? "dark" : "light");
      assert.equal(
        favicon.href,
        expected === "dark" ? "/brand/yicheng-dark.svg" : "/brand/yicheng.svg",
      );
    }
  console.log(
    JSON.stringify({
      componentRenders: rendered,
      networkCalls,
      faviconChecks: 9,
      browserVerified: false,
    }),
  );
}
