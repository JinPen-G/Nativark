/** 原管理端沿唯一认证实例消费公共 Core 管理合同。 */
import { createCoreManagementApi } from "@rental-os/platform-admin/source/core/management-client";
import { adminRuntime } from "@/app/adminRuntime";
export { coreManagementRejectedBeforeCommit } from "@rental-os/platform-admin/source/core/management-client";
export const coreManagementApi = createCoreManagementApi(adminRuntime);
