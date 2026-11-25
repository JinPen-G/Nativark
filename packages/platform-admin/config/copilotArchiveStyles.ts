import type { AtRule, Root } from "postcss";

/** 保留原 Copilot 样式和动效，只排除业务正文；旧应用与所选 Rental 包共用此构建边界。 */
export function copilotArchiveStyles() {
  return {
    postcssPlugin: "rental-copilot-archive-boundary",
    OnceExit(root: Root) {
      const file = root.source?.input.file?.replaceAll("\\", "/");
      if (!file || !["/features/copilot/archive/ai-side-panel/side-panel.css",
        "/assistant/copilot/archive/ai-side-panel/side-panel.css"].some(suffix => file.endsWith(suffix))) return;
      const boundary = ":not(:where([data-admin-content], [data-admin-content] *))";
      root.walkRules(rule => {
        if (rule.parent?.type === "atrule" && /keyframes$/i.test((rule.parent as AtRule).name)) return;
        // 旧宿主也显式登记此插件；重复组合不叠加选择器或改变原伪元素。
        rule.selectors = rule.selectors.map(selector => selector.includes(boundary) ? selector
          : selector.replace(/(::[\w-]+)?$/, `${boundary}$1`));
      });
    },
  };
}
