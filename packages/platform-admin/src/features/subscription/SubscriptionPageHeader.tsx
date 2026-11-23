import { PageHeading, type PageHeadingProps } from "../../components/PageHeading";
import { useAdminSession } from "../../runtime";
import { AnimatedIcon } from "../../components/ui/AnimatedIcon";
import { resolveAdminBrandName } from "../../app/branding";

/** 公共订阅沿宿主当前会话展示租户品牌，页头和工作区动作复用原公共组件。 */
export function PageHeader(props: Omit<PageHeadingProps, "brandName">) {
  const { tenant, user } = useAdminSession();
  const brandName = resolveAdminBrandName(tenant, user);
  return <PageHeading {...props} brandName={brandName} icon={<AnimatedIcon name="rules" />} />;
}
