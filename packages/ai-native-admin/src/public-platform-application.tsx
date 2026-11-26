/** 宿主显式选择原 SaaS 模型配置页，复用唯一公共会话及缓存。
 * 页面登记不启用模型，也不提供 Core 业务权限。 */
import type { AdminRuntime } from "@rental-os/platform-admin/runtime";
import { canManagePublicResource } from "@rental-os/platform-admin/access";
import { AiAdminHostProvider, createAiAdminHost } from "./host";
import { PlatformModelSettingsPage } from "./platform-model-settings/PlatformModelSettingsPage";
import { PlatformModelSettingsView } from "./platform-model-settings/PlatformModelSettingsView";

export function createPublicPlatformModelSettingsPage(runtime: AdminRuntime, options: { finance?: boolean } = {}) {
  const Page = options.finance === true ? PlatformModelSettingsPage : PlatformModelSettingsView;
  const host = createAiAdminHost({
    runtime,
    getSession: () => {
      const state = runtime.getSession();
      return {
        ...state,
        authenticated: state.sessionVerified && Boolean(state.user),
        hasPermission: permission => canManagePublicResource(state.user, "saas", permission),
      };
    },
  });
  return function SelectedPlatformModelSettingsPage() {
    return <AiAdminHostProvider host={host}><Page /></AiAdminHostProvider>;
  };
}
