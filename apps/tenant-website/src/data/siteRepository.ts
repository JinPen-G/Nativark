import { demoTenants, products } from './catalog';
import type { DemoOrder, DemoTenantKey, Product, Tenant } from '../types';

const orderStorageKey = 'rental-os-tenant-website-demo-orders';

// The UI consumes this boundary. Replace these functions with tenant-scoped API calls later.
export const siteRepository = {
  getTenant(key: DemoTenantKey): Tenant { return demoTenants[key]; },
  getProducts(tenant: Tenant): Product[] {
    const enabled = new Set(tenant.categories.map(category => category.id));
    return products.filter(product => enabled.has(product.categoryId));
  },
  getProduct(tenant: Tenant, id: string): Product | undefined {
    return this.getProducts(tenant).find(product => product.id === id);
  },
  getOrders(tenant: Tenant): DemoOrder[] {
    try {
      const all = JSON.parse(localStorage.getItem(orderStorageKey) || '[]') as DemoOrder[];
      return Array.isArray(all) ? all.filter(order => order.tenantId === tenant.id) : [];
    } catch { return []; }
  },
  saveOrder(order: DemoOrder): void {
    const all = this.getAllOrders();
    localStorage.setItem(orderStorageKey, JSON.stringify([order, ...all]));
  },
  getAllOrders(): DemoOrder[] {
    try {
      const all = JSON.parse(localStorage.getItem(orderStorageKey) || '[]') as DemoOrder[];
      return Array.isArray(all) ? all : [];
    } catch { return []; }
  },
};

export function rentalDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}
