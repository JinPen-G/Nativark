Component({
  properties: { fields: { type: Array, value: [] }, inputRevision: { type: String, value: "" }, taskId: { type: String, value: "" }, disabled: { type: Boolean, value: false } },
  data: { localDraft: {} as Record<string, string> },
  observers: { "inputRevision,taskId"() { this.setData({ localDraft: {} }); } },
  methods: {
    onFieldInput(event: WechatMiniprogram.CustomEvent) { const key = String(event.currentTarget.dataset.key ?? ""); if (!key || this.data.disabled) return; const draft = { ...(this.data.localDraft as Record<string, string>), [key]: String(event.detail?.value ?? "") }; this.setData({ localDraft: draft }); },
    onSubmit() { if (!this.data.disabled) this.triggerEvent("submit", { taskId: this.data.taskId, inputRevision: this.data.inputRevision, draft: this.data.localDraft }); },
  },
});
