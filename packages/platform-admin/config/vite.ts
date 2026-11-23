/** 公共后台构建接点。统一 UIArc、Context 与动效适配；环境、代理和业务插件由宿主决定。 */
import { fileURLToPath } from "node:url";
import { motionPreferenceAdapter, motionPreferenceStyles } from "./motionPreferenceAdapter";
import { actionButtonIconAdapter } from "./actionButtonIconAdapter";
import { nativeSidebarStyles } from "./nativeSidebarStyles";
import { kanbanBoardAdapter } from "./kanbanBoardAdapter";
export { adaptKanbanRuntime, kanbanBoardAdapter } from "./kanbanBoardAdapter";

export function platformAdminVite() {
  const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));
  return {
    publicDir: source("../public"),
    plugins: [motionPreferenceAdapter(), actionButtonIconAdapter(), kanbanBoardAdapter()],
    postcss: [motionPreferenceStyles(), nativeSidebarStyles()],
    alias: {
      "@/registry": source("../../ui-arc/vendor/registry"),
      "@/lib/motion-tokens": source("../../ui-arc/vendor/lib/motion-tokens.ts"),
      "@/lib/media": source("../../ui-arc/vendor/lib/media.ts"),
      "@/lib/use-copy-feedback": source("../../ui-arc/vendor/lib/use-copy-feedback.ts"),
      "@/lib/use-today": source("../../ui-arc/vendor/lib/use-today.ts"),
      "@/lib/usePrefersReducedMotion": source("../src/lib/usePrefersReducedMotion.ts")
    }
  };
}
