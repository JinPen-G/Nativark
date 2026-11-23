/** 旧后台只提供原品牌标题、配置助手和会话更新；页面呈现复用公共原实现。 */
import { AppearancePage as PublicAppearancePage } from "@rental-os/platform-admin/appearance";
import { PageHeader } from "@/components/PageHeader";
import { CopilotSection } from "@/features/copilot/CopilotSection";
import { useAuthStore } from "@/features/auth/authStore";
export function AppearancePage() {
  const onAccountThemeSaved = useAuthStore(state => state.setAccountThemeColor);
  const onTenantAppearanceSaved = useAuthStore(state => state.setTenantBranding);
  return <PublicAppearancePage PageHeader={PageHeader} CopilotSection={CopilotSection}
    onAccountThemeSaved={onAccountThemeSaved} onTenantAppearanceSaved={onTenantAppearanceSaved} />;
}
