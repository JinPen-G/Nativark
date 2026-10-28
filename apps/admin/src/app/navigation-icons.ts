import type { AnimatedIconName } from "@/components/ui/AnimatedIcon";

/** Display mapping only; authorization and navigation remain in the route registry. */
export function routeIconName(path: string): AnimatedIconName {
  if (path.startsWith("/ai-operator")) return "ai";
  if (path === "/notifications") return "messages";
  if (path === "/workbench") return "dashboard";
  if (path.includes("reports")) return "report";
  if (/orders|work-orders|reconciliation/.test(path)) return path.includes("reconciliation") ? "finance" : "orders";
  if (/pricing|discount|coupon|services|plans/.test(path)) return "pricing";
  if (path.includes("membership")) return "customers";
  if (/accounts|roles|qualification/.test(path)) return "access";
  if (/integrations|channel/.test(path)) return "plugins";
  if (/assets|item-groups|locations/.test(path)) return "inventory";
  return "rules";
}
