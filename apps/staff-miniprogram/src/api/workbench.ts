import type { RentalWorkbenchTodos } from "@rental-os/shared";
import { request } from "../core/http";

/** 工作台待办投影（按权限聚合订单/资金/工单/通知待办）。 */
export function workbenchTodos(): Promise<RentalWorkbenchTodos> {
  return request<RentalWorkbenchTodos>("/rental/v1/workbench/todos");
}
