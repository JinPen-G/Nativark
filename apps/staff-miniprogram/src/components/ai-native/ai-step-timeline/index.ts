import { boundedText } from "../display-format";

interface StepRow { id: string; ordinal: number | null; label: string; statusLabel: string; sourceLabel: string; }
interface ViewGeneration { taskId: string; steps: unknown; blocked: boolean; }
const generations = new WeakMap<object, ViewGeneration>();
function label(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? boundedText(value) : fallback;
}

// Local display isolation only. The host must authorize every new projection.
Component({
  properties: {
    steps: { type: Array, value: [] },
    taskId: { type: String, value: "" },
    available: { type: Boolean, value: false },
  },
  data: { visibleSteps: [] as StepRow[] },
  lifetimes: {
    attached() { this.project(); },
    detached() { generations.delete(this); this.setData({ visibleSteps: [] }); },
  },
  observers: { "steps,taskId,available"() { this.project(); } },
  methods: {
    project() {
      const { taskId, steps, available } = this.data;
      const previous = generations.get(this);
      const sameInput = previous?.steps === steps;
      const blocked = !available || !taskId ||
        Boolean(sameInput && (previous?.blocked || previous?.taskId !== taskId));
      generations.set(this, { taskId, steps, blocked });
      if (blocked || !Array.isArray(steps)) { this.setData({ visibleSteps: [] }); return; }
      const visibleSteps: StepRow[] = (steps as unknown[]).slice(0, 50)
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
        .filter(item => typeof item.id === "string" && item.id.length > 0 && item.id.length <= 128 &&
          (item.taskId === undefined || item.taskId === taskId))
        .map(item => ({
          id: item.id as string,
          ordinal: typeof item.ordinal === "number" && Number.isSafeInteger(item.ordinal) && item.ordinal > 0 ? item.ordinal : null,
          label: label(item.label, "步骤不可用"),
          statusLabel: label(item.statusLabel, "无法识别／待刷新"),
          sourceLabel: label(item.sourceLabel, "来源不可用"),
        }));
      this.setData({ visibleSteps });
    },
  },
});
