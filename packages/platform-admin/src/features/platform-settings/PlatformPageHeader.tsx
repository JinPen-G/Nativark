/** 原页面页头继续消费公共标题、Portal 和可信会话品牌。 */
import { PageHeading, type PageHeadingProps } from "../../components/PageHeading";
import { useAdminSession } from "../../runtime";

export function PageHeader(props: Omit<PageHeadingProps, "brandName">) {
  const { tenant, user } = useAdminSession();
  return <PageHeading {...props} brandName={user?.isSaasAdmin ? "Nativark" : tenant?.tenantName ?? "Nativark"} />;
}
