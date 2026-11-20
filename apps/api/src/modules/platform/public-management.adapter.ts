/** 原管理 HTTP 与同一公共应用的字段及方法映射。
 * 当前主体取自公共 ALS，固定 Rental 对象补充原事实和精确管理权限限制，输入只承载原业务字段。 */
import type { SaveSystemRoleRequest, SaveSystemUserRequest, UpdateTenantRequest, UpdateTenantStatusRequest } from "@rental-os/platform-contracts";
import type { PlatformManagementService } from "@rental-os/platform-server/management";
import { rentalPublicManagementCompatibility } from "@rental-os/rental-core/public-management-compatibility";

const RESET_PASSWORD_MESSAGE = "密码已重置为一次性临时密码，用户下次登录必须修改。";

export class OriginalPublicManagementAdapter {
  constructor(private readonly service: PlatformManagementService) {}

  listTenants() {
    return this.service.listTenants(rentalPublicManagementCompatibility);
  }

  getTenant(id: string) {
    return this.service.getTenant(id, rentalPublicManagementCompatibility);
  }

  updateTenant(id: string, input: UpdateTenantRequest) {
    return this.service.updateTenant(id, input, true, rentalPublicManagementCompatibility);
  }

  updateTenantStatus(id: string, input: UpdateTenantStatusRequest) {
    return this.service.tenantStatus(id, input, rentalPublicManagementCompatibility);
  }

  listPermissionTree() {
    return this.service.permissionTree(rentalPublicManagementCompatibility);
  }

  listRoles(tenantId?: string) {
    return this.service.listRoles(tenantId, rentalPublicManagementCompatibility);
  }

  saveRole(input: SaveSystemRoleRequest) {
    return this.service.saveRole(input, rentalPublicManagementCompatibility);
  }

  saveRolePermissions(id: string, permissions: string[], tenantId?: string) {
    return this.service.saveRolePermissions(id, permissions, tenantId, rentalPublicManagementCompatibility);
  }

  deleteRole(id: string, tenantId?: string) {
    return this.service.deleteRole(id, tenantId, rentalPublicManagementCompatibility);
  }

  listUsers(tenantId?: string) {
    return this.service.listUsers(tenantId);
  }

  saveUser(input: SaveSystemUserRequest) {
    return this.service.saveUser({ ...input, isSaasAdmin: false }, rentalPublicManagementCompatibility);
  }

  setUserStatus(id: string, active: boolean, tenantId?: string) {
    return this.service.userStatus(id, active, tenantId, rentalPublicManagementCompatibility);
  }

  async resetUserPassword(id: string, tenantId?: string) {
    const result = await this.service.resetUserPassword(id, tenantId, rentalPublicManagementCompatibility);
    return { ...result, message: RESET_PASSWORD_MESSAGE };
  }

  async resetTenantAdminPassword(tenantId: string) {
    const result = await this.service.resetTenantAdminPassword(tenantId);
    return { ...result, message: RESET_PASSWORD_MESSAGE };
  }
}
