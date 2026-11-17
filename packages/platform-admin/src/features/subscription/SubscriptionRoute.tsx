import type { ReactNode } from "react";
import { Result } from "../../components/ui";
import { useAdminSession } from "../../runtime";
import { hasSubscriptionPermission, type SubscriptionPermission } from "./subscription-access";

export function SubscriptionRoute({ permission, children }: { permission: SubscriptionPermission; children: ReactNode }) {
  const { user, sessionVerified } = useAdminSession();
  return sessionVerified && hasSubscriptionPermission(user, permission) ? children : <Result status="403" title="403" />;
}
