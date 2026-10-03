function inspectionValue(value: unknown): string {
  if (value === null || value === undefined) return "缺失";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "非法值";
  if (typeof value === "string") return value.slice(0, 4000);
  return "非法值";
}
Component({
  properties: { items: { type: Array, value: [] }, missing: { type: Array, value: [] }, readonly: { type: Boolean, value: true } },
  data: { visibleItems: [] as { key: string; label: string; candidate: string; humanValue: string; sourceLabel: string }[], visibleMissing: [] as string[] },
  lifetimes: { attached() { this.project(); }, detached() { this.setData({ visibleItems: [], visibleMissing: [] }); } },
  observers: { "items,missing"() { this.project(); } },
  methods: {
    project() {
      const items = (this.data.items as Record<string, unknown>[]).slice(0, 50).filter(item => item && typeof item.key === "string").map(item => ({
        key: String(item.key).slice(0, 64), label: typeof item.label === "string" ? item.label.slice(0, 200) : "检查项不可用",
        candidate: inspectionValue(item.candidate), humanValue: inspectionValue(item.humanValue),
        sourceLabel: typeof item.sourceLabel === "string" ? item.sourceLabel.slice(0, 200) : "来源不可用",
      }));
      this.setData({ visibleItems: items, visibleMissing: (this.data.missing as unknown[]).slice(0, 50).filter((item): item is string => typeof item === "string").map(item => item.slice(0, 200)) });
    },
    onHumanInput(event: WechatMiniprogram.CustomEvent) {
      if (this.data.readonly || typeof event.detail?.value !== "string") return;
      const key = event.currentTarget.dataset.key;
      if (!this.data.visibleItems.some(item => item.key === key)) return;
      this.triggerEvent("draftchange", { key, humanValue: event.detail.value.slice(0, 4000) });
    },
  },
});
