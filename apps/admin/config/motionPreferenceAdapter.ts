import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import type { AtRule, Rule } from "postcss";

/** Dependency boundary only: preserve every upstream export and original animation;
 * let original components read the same browser setting as the workspace. */
export function motionPreferenceAdapter(): Plugin {
  const id = "\0rental-motion-preference";
  const upstream = fileURLToPath(import.meta.resolve("motion/react")).replaceAll("\\", "/");
  const hook = fileURLToPath(new URL("../src/lib/usePrefersReducedMotion.ts", import.meta.url)).replaceAll("\\", "/");
  return {
    name: "rental-motion-preference", enforce: "pre",
    resolveId(source) { if (source === "motion/react") return id; },
    load(source) {
      if (source !== id) return;
      return `export * from ${JSON.stringify(upstream)}; export { usePrefersReducedMotion as useReducedMotion } from ${JSON.stringify(hook)};`;
    },
  };
}

/** Adapt reduced-motion CSS at build time without editing reserved UIArc files.
 * This also lets explicit Full motion override the OS, while System follows it.
 * All current source queries are standalone; preserve unrelated media rules. */
export function motionPreferenceStyles() {
  return {
    postcssPlugin: "rental-motion-preference-styles",
    AtRule: {
      media(rule: AtRule) {
        const match = /^\(prefers-reduced-motion:\s*(reduce|no-preference)\)$/.exec(rule.params.trim());
        if (!match) return;
        const root = `html[data-reduced-motion="${match[1] === "reduce"}"]`;
        rule.walkRules((child: Rule) => {
          if (child.parent?.type === "atrule" && /keyframes$/i.test((child.parent as AtRule).name)) return;
          child.selectors = child.selectors.map(selector => selector.startsWith("::") ? root + selector
            : selector.startsWith(":root") ? selector.replace(":root", root)
              : selector.startsWith("html") && /^(?:html)(?=[\s.:#[>+~]|$)/.test(selector) ? selector.replace(/^html/, root)
                : `:where(${root}) ${selector}`);
        });
        rule.replaceWith(...(rule.nodes ?? []));
      },
    },
  };
}
