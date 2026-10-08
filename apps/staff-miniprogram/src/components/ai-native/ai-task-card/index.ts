import { boundedText, displayTime } from "../display-format";

interface CardProjection {
  id: string; title: string; statusLabel: string; summary: string;
  updatedLabel: string; availabilityLabel: string; partial: boolean; manualExitLabel: string;
}
const generations = new WeakMap<object, { input: unknown; blocked: boolean }>();
const detached = new WeakSet<object>();
function text(value: unknown, fallback: string, limit = 200): string {
  return typeof value === "string" && value.trim() ? boundedText(value, limit) : fallback;
}

// Display-only projection. Availability is supplied by the authorized host.
Component({
  properties: {
    task: { type: Object, value: null },
    disabled: { type: Boolean, value: false },
    available: { type: Boolean, value: false },
  },
  data: { projection: null as CardProjection | null },
  lifetimes: {
    attached() { detached.delete(this); this.project(); },
    detached() { detached.add(this); generations.delete(this); this.setData({ projection: null }); },
  },
  observers: { "task,available"() { this.project(); } },
  methods: {
    project() {
      if (detached.has(this)) return;
      const { task, available } = this.data;
      const previous = generations.get(this);
      const blocked = !available || Boolean(previous?.blocked && previous.input === task);
      generations.set(this, { input: task, blocked });
      if (blocked || !task || typeof task !== "object" || Array.isArray(task)) {
        this.setData({ projection: null }); return;
      }
      const input = task as Record<string, unknown>;
      if (typeof input.id !== "string" || !/^[^\s\x00-\x1f\x7f]{1,128}$/.test(input.id)) {
        this.setData({ projection: null }); return;
      }
      this.setData({ projection: {
        id: input.id,
        title: text(input.title, "任务不可用"),
        statusLabel: text(input.statusLabel, "状态不可用"),
        summary: text(input.summary, "暂无摘要", 4000),
        updatedLabel: input.updatedAt === undefined ? text(input.updatedLabel, "更新时间不可用") : displayTime(input.updatedAt),
        availabilityLabel: text(input.availabilityLabel, "结果不可用"),
        partial: input.partial === true,
        manualExitLabel: text(input.manualExitLabel, ""),
      } });
    },
    onOpen() {
      if (detached.has(this) || this.data.disabled || !this.data.available) return;
      this.project();
      const projection = this.data.projection;
      if (projection) this.triggerEvent("open", { taskId: projection.id });
    },
  },
});
