import { memoryProjection } from "../memory-projection";
import { identityRows } from "../identity-rows";
const detachedViews = new WeakSet<object>();
interface MemoryRow { id: string; revision: string; rowKey: string; label: string; value: string; status: string; }
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
      const rows = identityRows(this.data.items, ["id", "revision"])
        .map(item => ({ id: item.id as string, revision: item.revision as string, rowKey: JSON.stringify([item.id, item.revision]), ...memoryProjection(item, this.data.nowIso) }));
      this.setData({ rows });
    },
  },
});
