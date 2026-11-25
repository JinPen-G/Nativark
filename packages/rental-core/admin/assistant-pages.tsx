/** 原三个 AI 页面合入同一 Rental 贡献，复用既有助手、设置与任务中心正文。
 * 本入口不创建会话、QueryClient 或执行器；页面仍经过当前 Core 目录和原服务端权限。
 */
import type { CoreAdminContribution, CorePageDescriptor } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { AiModelSettingsPage } from "@rental-os/ai-native-admin/tenant-model-settings";
import { rentalPagePermissions } from "@rental-os/rental-core/permissions";
import type { createRentalAssistant } from "./assistant";
import { useRentalAssistantContext } from "./assistant/host";
import { TaskCenterPage } from "./task-center";

const serviceGroup = { default: "服务与渠道", translations: { "en-US": "Services & channels" } };
export const RENTAL_ASSISTANT_PAGES = {
  aiOperator: {
    id: "ai-operator", path: "/ai-operator", title: { default: "Agent工作台", translations: { "en-US": "Agent" } },
    permissions: rentalPagePermissions("ai-operator"),
  },
  aiSettings: {
    id: "ai-settings", path: "/settings/ai", title: { default: "AI 服务设置", translations: { "en-US": "AI service settings" } },
    permissions: rentalPagePermissions("ai-settings"), menu: { group: serviceGroup, order: 40 },
  },
  aiTasks: {
    id: "ai-tasks", path: "/ai/tasks", title: { default: "AI 任务中心", translations: { "en-US": "AI task center" } },
    permissions: rentalPagePermissions("ai-tasks"), menu: { group: serviceGroup, order: 50 },
  },
} satisfies Record<string, CorePageDescriptor>;

export function createRentalAssistantAdminContribution(
  implementationVersion: string,
  { assistant }: { assistant: ReturnType<typeof createRentalAssistant> },
): CoreAdminContribution<CoreRouteComponent> {
  function SettingsContents() {
    const context = useRentalAssistantContext(), navigation = context.useNavigation();
    // 原调用记录的链接来自当前真实登记；不以原 URL 或设置权限捏造任务中心入口。
    const taskCenterPath = navigation.resolve(RENTAL_ASSISTANT_PAGES.aiTasks.path) ?? undefined;
    return <AiModelSettingsPage taskCenterPath={taskCenterPath} />;
  }
  function SettingsPage() {
    return <assistant.Provider><SettingsContents /></assistant.Provider>;
  }
  function TasksPage() {
    return <assistant.Provider><TaskCenterPage /></assistant.Provider>;
  }
  return {
    coreId: "rental", implementationVersion,
    pages: [
      { ...RENTAL_ASSISTANT_PAGES.aiOperator, component: assistant.AiOperatorPage },
      { ...RENTAL_ASSISTANT_PAGES.aiSettings, component: SettingsPage },
      { ...RENTAL_ASSISTANT_PAGES.aiTasks, component: TasksPage },
    ],
  };
}
