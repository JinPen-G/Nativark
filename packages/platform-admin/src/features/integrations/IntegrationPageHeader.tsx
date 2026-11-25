import { PageHeading, type PageHeadingProps } from "../../components/PageHeading";
import { AnimatedIcon } from "../../components/ui/AnimatedIcon";
import { useAdminSession } from "../../runtime";
import { resolveAdminBrandName } from "../../app/branding";

export function PageHeader(props: Omit<PageHeadingProps, "brandName">) {
  const { tenant, user } = useAdminSession();
  const brandName = resolveAdminBrandName(tenant, user);
  return <PageHeading {...props} brandName={brandName} icon={<AnimatedIcon name="plugins" />} />;
}
