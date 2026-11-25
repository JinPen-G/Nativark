/** 员工认证沿 Rental Core 正式入口，宿主供给原 Staff 请求与会话操作。 */
import { createRentalStaffAuthApi } from "@rental-os/rental-core/clients/staff";
import { request } from "../core/http";
import { clearSession, refreshToken, saveSession } from "../core/session";

export const { login, logout, switchWorkspace, changePassword } = createRentalStaffAuthApi({
  request, clearSession, refreshToken, saveSession,
});
