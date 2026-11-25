/** 原强制改密只绑定现有会话动作，呈现复用公共原页。 */
import { PasswordChangeGate as PublicPasswordChangeGate } from "@rental-os/platform-admin/session-pages";
import { useAuthStore } from "./authStore";
export function PasswordChangeGate() {
  const changePassword = useAuthStore(state => state.changePassword);
  return <PublicPasswordChangeGate onChange={input => changePassword(input.currentPassword, input.newPassword)} />;
}
