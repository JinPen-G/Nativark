import { useQuery } from "@tanstack/react-query";
import { subscriptionApi } from "@/api/subscription";
import { useAuthStore } from "@/features/auth/authStore";

/** Current read-only labels from Core. Missing labels retain the stable code; they never broaden entitlement or adoption. */
export function useSubscriptionCategoryLabels() {
  const user = useAuthStore(state => state.user);
  const hasPermission = useAuthStore(state => state.hasPermission);
  const platform = Boolean(user?.isSaasAdmin);
  const query = useQuery({ queryKey: ["subscription", "category-labels", platform ? "platform" : user?.tenantId, user?.id],
    queryFn: () => subscriptionApi.categoryLabels(platform), enabled: Boolean(user) && hasPermission(platform ? "system:tenant:subscription:manage" : "rental-os:subscription:view") });
  const labels = new Map((query.data ?? []).map(category => [category.code, category.name]));
  return { ...query, label: (code: string) => labels.get(code) ?? code,
    options: (query.data ?? []).map(category => ({ value: category.code, label: category.name })) };
}
