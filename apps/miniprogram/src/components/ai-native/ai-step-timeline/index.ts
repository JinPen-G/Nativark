Component({
  properties: { steps: { type: Array, value: [] }, taskId: { type: String, value: "" } },
  data: { visibleSteps: [] as unknown[] },
  observers: { steps(value: unknown[]) { this.setData({ visibleSteps: Array.isArray(value) ? value.slice(0, 50) : [] }); } },
});
