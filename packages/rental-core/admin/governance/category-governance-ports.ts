/** 原品类页面只消费已绑定的宿主会话和运输，不创建身份或改变 Core 权限。 */
import { useMemo } from "react";
import { useRentalAssistantContext } from "../assistant/host";
import { createCategoryGovernanceApi } from "./categoryGovernance";

export function useCategoryGovernance() {
  const { session } = useRentalAssistantContext();
  const categoryGovernanceApi = useMemo(() => createCategoryGovernanceApi(session.request), [session]);
  return { ...session, categoryGovernanceApi };
}
