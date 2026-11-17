import { PageHeading, type PageHeadingProps } from "../../components/PageHeading";
import { AnimatedIcon } from "../../components/ui/AnimatedIcon";
import { useAdminSession } from "../../runtime";

export function PageHeader(props: Omit<PageHeadingProps, "brandName">) {
  const { tenant, user } = useAdminSession();
  const brandName = user?.isSaasAdmin ? "Nativark"
    : tenant?.brandName?.trim() || tenant?.tenantName?.trim() || "Nativark";
  return <PageHeading {...props} brandName={brandName} icon={<AnimatedIcon name="plugins" />} />;
}
