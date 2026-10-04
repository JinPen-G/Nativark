const detachedPanels = new WeakSet<object>();
Component({
  properties: {
    state: { type: String, value: "unavailable" },
    message: { type: String, value: "" },
    actionText: { type: String, value: "" },
    manualText: { type: String, value: "人工处理" },
    disabled: { type: Boolean, value: false },
    actionAvailable: { type: Boolean, value: false },
    manualAvailable: { type: Boolean, value: false },
  },
  lifetimes: {
    attached() { detachedPanels.delete(this); },
    detached() { detachedPanels.add(this); },
  },
  methods: {
    onAction() {
      if (!detachedPanels.has(this) && !this.data.disabled && this.data.actionAvailable === true && typeof this.data.actionText === "string" && this.data.actionText.trim()) this.triggerEvent("action");
    },
    onManual() {
      if (!detachedPanels.has(this) && !this.data.disabled && this.data.manualAvailable === true && typeof this.data.manualText === "string" && this.data.manualText.trim()) this.triggerEvent("manual");
    },
  },
});
