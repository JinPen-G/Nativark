import { identityRows } from "../identity-rows";
import { boundedText } from "../display-format";
const detachedViews = new WeakSet<object>();
function inspectionValue(value: unknown): string {
  if (value === null || value === undefined) return "缺失";
  if (typeof value === "number") return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)) ? String(value) : "非法值";
  if (typeof value === "bigint") { const exact = value.toString(); return exact.length <= 4000 ? exact : "非法值"; }
  if (typeof value === "string") return boundedText(value);
  return "非法值";
}
Component({
  properties: { items: { type: Array, value: [] }, missing: { type: Array, value: [] }, readonly: { type: Boolean, value: true } },
  data: { visibleItems: [] as { key: string; label: string; candidate: string; humanValue: string; sourceLabel: string }[], visibleMissing: [] as string[] },
  lifetimes: { attached() { detachedViews.delete(this); this.project(); }, detached() { detachedViews.add(this); this.setData({ visibleItems: [], visibleMissing: [] }); } },
  observers: { "items,missing"() { this.project(); } },
  methods: {
    project() {
      if (detachedViews.has(this)) return;
      const items = identityRows(this.data.items, ["key"], 64).map(item => ({
        key: item.key as string, label: typeof item.label === "string" ? boundedText(item.label, 200) : "检查项不可用",
        candidate: inspectionValue(item.candidate), humanValue: inspectionValue(item.humanValue),
        sourceLabel: typeof item.sourceLabel === "string" ? boundedText(item.sourceLabel, 200) : "来源不可用",
      }));
      const missing: unknown[] = Array.isArray(this.data.missing) ? this.data.missing : [];
      this.setData({ visibleItems: items, visibleMissing: missing.slice(0, 50).filter((item): item is string => typeof item === "string").map(item => boundedText(item, 200)) });
    },
    onHumanInput(event: WechatMiniprogram.CustomEvent) {
      if (detachedViews.has(this) || this.data.readonly || typeof event?.detail?.value !== "string") return;
      const key = event.currentTarget?.dataset?.key;
      if (!this.data.visibleItems.some(item => item.key === key)) return;
      this.triggerEvent("draftchange", { key, humanValue: boundedText(event.detail.value) });
    },
  },
});
