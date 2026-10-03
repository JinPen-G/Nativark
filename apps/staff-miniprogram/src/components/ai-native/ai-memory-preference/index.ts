import { memoryProjection } from "../memory-projection";
const detachedViews = new WeakSet<object>();
interface MemoryRow { id: string; revision: string; label: string; value: string; status: string; }
Component({
  properties: { items: { type: Array, value: [] }, available: { type: Boolean, value: false }, nowIso: { type: String, value: "" } },
  data: { rows: [] as MemoryRow[] },
  lifetimes: {
    attached() { detachedViews.delete(this); this.project(); },
    detached() { detachedViews.add(this); this.setData({ rows: [] }); },
  },
  observers: { "items,available,nowIso"() { this.project(); } },
  methods: {
    project() {
      if (detachedViews.has(this)) return;
      if (!this.data.available) { this.setData({ rows: [] }); return; }
      const rows = (this.data.items as Record<string, unknown>[]).slice(0, 50)
        .filter(item => item && typeof item.id === "string" && typeof item.revision === "string")
        .map(item => ({ id: String(item.id).slice(0, 128), revision: String(item.revision).slice(0, 128), ...memoryProjection(item, this.data.nowIso) }));
      this.setData({ rows });
    },
  },
});
