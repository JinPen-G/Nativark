import { demoTenants, products } from "./catalog";
import type { DemoOrder, DemoTenantKey, Product, Tenant } from "../types";

const orderStorageKey = "rental-os-tenant-website-demo-orders";

// 当前生效的商品集：演示模式用静态 catalog；真实租户模式由 remoteSite 注入 API 数据。
// 页面全部同步消费本边界，因此真实数据在 SiteProvider 异步加载完成后一次性注入。
let activeProducts: Product[] = products;

// 本边界提供目录读取和明确标记的本地演示记录，正式订单由原客户端 API 读取。
export const siteRepository = {
  getTenant(key: DemoTenantKey): Tenant {
    return demoTenants[key];
  },
  setActiveProducts(next: Product[]): void {
    activeProducts = next;
  },
  resetActiveProducts(): void {
    activeProducts = products;
  },
  getProducts(tenant: Tenant): Product[] {
    const enabled = new Set(tenant.categories.map((category) => category.id));
    return activeProducts.filter((product) => enabled.has(product.categoryId));
  },
  getProduct(tenant: Tenant, id: string): Product | undefined {
    return this.getProducts(tenant).find((product) => product.id === id);
  },
  getOrders(tenant: Tenant): DemoOrder[] {
    try {
      const all = JSON.parse(
        localStorage.getItem(orderStorageKey) || "[]",
      ) as DemoOrder[];
      return Array.isArray(all)
        ? all.filter(
            (order) =>
              order &&
              typeof order === "object" &&
              typeof order.id === "string" &&
              typeof order.productId === "string" &&
              order.tenantId === tenant.id,
          )
        : [];
    } catch {
      return [];
    }
  },
  async saveOrder(order: DemoOrder): Promise<void> {
    const write = () => {
      const all = JSON.parse(
        localStorage.getItem(orderStorageKey) || "[]",
      ) as unknown;
      if (!Array.isArray(all))
        throw new Error("演示记录无法读取，请先核对原记录。");
      const previous = all.find((item) => item && item.id === order.id);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(order))
          throw new Error("同编号记录已存在，请先核对原记录。");
        return;
      }
      const serialized = JSON.stringify([order, ...all]);
      localStorage.setItem(orderStorageKey, serialized);
      if (localStorage.getItem(orderStorageKey) !== serialized)
        throw new Error("演示记录尚未确认保存。");
    };
    // 支持的浏览器将不同标签页的演示保存串行化，同编号重试复用原记录。
    if (typeof navigator !== "undefined" && navigator.locks)
      await navigator.locks.request(orderStorageKey, write);
    else write();
  },
  getAllOrders(): DemoOrder[] {
    try {
      const all = JSON.parse(
        localStorage.getItem(orderStorageKey) || "[]",
      ) as DemoOrder[];
      return Array.isArray(all) ? all : [];
    } catch {
      return [];
    }
  },
};

export function rentalDays(startDate: string, endDate: string): number {
  // 兼容纯日期与 datetime-local（含 T 时间）：按自然日计（取日期部分），时段时间不影响天数。
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00`);
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(
    0,
    Math.round((end.getTime() - start.getTime()) / 86400000) + 1,
  );
}
