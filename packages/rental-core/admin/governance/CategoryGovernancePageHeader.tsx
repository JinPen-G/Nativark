/** 原平台品类页继续使用同一品牌、路由图标和公共页头。 */
import { PageHeading, resolveAdminBrandName, type PageHeadingProps } from "@rental-os/platform-admin/shell";
import { AnimatedIcon } from "@rental-os/platform-admin/source/components/ui/AnimatedIcon";
import { useCategoryGovernance } from "./category-governance-ports";

export function PageHeader(props: Omit<PageHeadingProps, "brandName" | "icon">) {
  const { useAuthStore } = useCategoryGovernance();
  const auth = useAuthStore();
  return <PageHeading {...props} brandName={resolveAdminBrandName(auth.tenant, auth.user)} icon={<AnimatedIcon name="rules" />} />;
}
