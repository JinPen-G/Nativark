/** 原客户端授权标题沿同一品牌、图标和公共页头呈现。 */
import { PageHeading, resolveAdminBrandName, type PageHeadingProps } from "@rental-os/platform-admin/shell";
import { AnimatedIcon } from "@rental-os/platform-admin/source/components/ui/AnimatedIcon";
import { useRentalDesktopContext } from "./page-context";

export function PageHeader(props: Omit<PageHeadingProps, "brandName" | "icon">) {
  const { session } = useRentalDesktopContext();
  const auth = session.useAuthStore();
  return <PageHeading {...props} brandName={resolveAdminBrandName(auth.tenant, auth.user)} icon={<AnimatedIcon name="rules" />} />;
}
