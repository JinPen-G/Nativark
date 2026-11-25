import type { RentalWorkbenchTodos } from "../../src/contracts";
import type { RentalStaffClientPorts } from "./ports";

/** 工作台待办投影（按权限聚合订单/资金/工单/通知待办）。 */
export function createRentalStaffWorkbenchApi({ request }: RentalStaffClientPorts) {
  function workbenchTodos(): Promise<RentalWorkbenchTodos> {
    return request<RentalWorkbenchTodos>("/rental/v1/workbench/todos");
  }

  return { workbenchTodos };
}
