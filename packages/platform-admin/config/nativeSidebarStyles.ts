import { AtRule, type Root } from "postcss";

/** Compile native Tailwind classes verbatim, but keep resets/variables out of business pages. */
export function nativeSidebarStyles() {
  return { postcssPlugin: "rental-native-sidebar-scope", OnceExit(root: Root) {
    if (!root.source?.input.file?.replaceAll("\\", "/").endsWith("/animate-sidebar.css")) return;
    const variables = new Set<string>();
    root.walkAtRules("layer", layer => { if (layer.params === "theme") layer.walkDecls(decl => { if (decl.prop.startsWith("--")) variables.add(decl.prop); }); });
    const scoped = (value: string) => value.replace(/--[\w-]+/g, name => variables.has(name) ? `--asb-${name.slice(2)}` : name);
    root.walkDecls(decl => { decl.prop = scoped(decl.prop); decl.value = scoped(decl.value); });
    root.walkRules(rule => { if (rule.selectors.every(selector => selector === ":root" || selector === ":host")) rule.selector = ":scope"; });
    const properties: AtRule[] = [];
    root.walkAtRules("property", rule => { rule.params = scoped(rule.params); properties.push(rule); rule.remove(); });
    // Native layers must not lose to the existing unlayered admin reset.
    // Keep their order, but limit their cascade to this component's scope.
    root.walkAtRules("layer", layer => { if (layer.nodes) layer.replaceWith(...layer.nodes); else layer.remove(); });
    root.walkRules(rule => {
      if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
      rule.selectors = rule.selectors.flatMap(original => {
        // @scope excludes its own root from implicit ancestor matching.
        const selector = original.replace(/\.dark(?=\s)/g, ":is(.dark, :scope.dark)");
        return [selector, selector.startsWith(".") ? `:scope${selector}` : `:scope:is(${selector})`];
      });
    });
    const nodes = [...root.nodes]; root.removeAll();
    root.append(...properties, new AtRule({ name: "scope", params: "(.rental-animate-scope) to ([data-admin-content])", nodes }));
  } };
}
