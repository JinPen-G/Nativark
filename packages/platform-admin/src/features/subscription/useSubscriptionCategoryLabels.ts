import { useAdminSession } from "../../runtime";
import { hasSubscriptionPermission } from "./subscription-access";
import { useQuery } from "@tanstack/react-query";
import { useSubscriptionApi } from "./client";

/** Current read-only labels from Core. Missing labels retain the stable code; they never broaden entitlement or adoption. */
export function useSubscriptionCategoryLabels() {
  const { user, sessionVerified } = useAdminSession();
  const subscriptionApi = useSubscriptionApi();
  const platform = Boolean(user?.isSaasAdmin);
  const query = useQuery({ queryKey: ["subscription", "category-labels", platform ? "platform" : user?.tenantId, user?.id],
    queryFn: () => subscriptionApi.categoryLabels(platform), enabled: sessionVerified && Boolean(user) && hasSubscriptionPermission(user, platform ? "system:tenant:subscription:manage" : "rental-os:subscription:view") });
  const labels = new Map((query.data ?? []).map(category => [category.code, category.name]));
  return { ...query, label: (code: string) => labels.get(code) ?? code,
    options: (query.data ?? []).map(category => ({ value: category.code, label: category.name })) };
}
