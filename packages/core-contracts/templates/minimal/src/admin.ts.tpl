/** 标准页面贡献起点；传入 Core 自己的组件，公共壳/请求/权限继续使用平台正式接点。 */
import { CorePageDescriptorSchema, type CoreAdminContribution } from "@rental-os/core-contracts";
import { CORE_ID, CORE_VERSION } from "./contracts";

export const listPage = CorePageDescriptorSchema.parse({ id: "items", path: "/items", title: "条目",
  menu: {}, permissions: [{ resource: "item", action: "read" }] });
export function createAdmin<TComponent>(component: TComponent): CoreAdminContribution<TComponent> {
  if (component === undefined || component === null) throw new Error("item_page_unavailable");
  return { coreId: CORE_ID, implementationVersion: CORE_VERSION, pages: [{ ...listPage, component }] };
}
