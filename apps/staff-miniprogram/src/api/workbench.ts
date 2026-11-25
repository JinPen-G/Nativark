/** 员工工作台薄入口，待办事实由同一 Rental 客户端与原服务端提供。 */
import { createRentalStaffWorkbenchApi } from "@rental-os/rental-core/clients/staff";
import { request } from "../core/http";

export const { workbenchTodos } = createRentalStaffWorkbenchApi({ request });
