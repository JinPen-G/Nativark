import type { AtRule, Root } from "postcss";

/** Preserve archived declarations/motion, but exclude the business-content subtree.
 * :where keeps the exclusion specificity-neutral, including pseudo-elements. */
export function copilotArchiveStyles() {
  return {
    postcssPlugin: "rental-copilot-archive-boundary",
    OnceExit(root: Root) {
      if (!root.source?.input.file?.replaceAll("\\", "/").endsWith("/features/copilot/archive/ai-side-panel/side-panel.css")) return;
      const boundary = ":not(:where([data-admin-content], [data-admin-content] *))";
      root.walkRules(rule => {
        if (rule.parent?.type === "atrule" && /keyframes$/i.test((rule.parent as AtRule).name)) return;
        rule.selectors = rule.selectors.map(selector => selector.replace(/(::[\w-]+)?$/, `${boundary}$1`));
      });
    },
  };
}
