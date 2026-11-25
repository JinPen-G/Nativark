/** 原品类助手提供自己的范围键和原请求，复用同一结构化关系编辑器。 */
import type { ComponentProps } from "react";
import { CategoryCompatibilityRelationsEditor as RentalEditor } from "@rental-os/rental-core/admin/governance/logic";
import { categoryPreparationApi } from "@/api/categoryPreparation";
export function CategoryCompatibilityRelationsEditor(props: Omit<ComponentProps<typeof RentalEditor>, "api">) {
  return <RentalEditor {...props} api={categoryPreparationApi} />;
}
