import type { Plugin } from "vite";

/** Preserve the reserved component byte-for-byte; adapt its one hard-coded idle glyph.
 * Guard the source contract so an upstream update cannot silently restore arrows everywhere. */
export function actionButtonIconAdapter(): Plugin {
  return {
    name: "rental-action-button-icon", enforce: "pre",
    transform(source, id) {
      if (!id.replaceAll("\\", "/").split("?")[0].endsWith("/packages/ui-arc/vendor/registry/components/action-button/action-button.tsx")) return;
      const original = 'import { ArrowRight } from "lucide-react";';
      if (source.split(original).length !== 2 || !source.includes('<ArrowRight className={styles.arrow}')) {
        this.error("UIArc ActionButton idle-icon contract changed; review the icon adapter before upgrading.");
      }
      return { code: source.replace(original, 'import { ActionButtonIdleIcon as ArrowRight } from "@/components/ui/ActionButtonIcon";'), map: null };
    },
  };
}
