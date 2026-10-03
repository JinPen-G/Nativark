interface ClarificationField { key: string; label: string; value?: string; error?: string; readonly?: boolean; required?: boolean; }
type ClarificationHandler = (input: { taskId: string; inputRevision: string; draft: Record<string, string> }) => Promise<void>;
Component({
  properties: { fields: { type: Array, value: [] }, inputRevision: { type: String, value: "" }, taskId: { type: String, value: "" }, disabled: { type: Boolean, value: false }, submitHandler: { type: null, value: null } },
  data: { localDraft: {} as Record<string, string>, visibleFields: [] as ClarificationField[], submitting: false, errorLabel: "", generation: 0, alive: true },
  lifetimes: {
    attached() { this.refreshFields(); },
    detached() { this.setData({ localDraft: {}, visibleFields: [], alive: false, generation: this.data.generation + 1 }); },
  },
  observers: {
    "inputRevision,taskId,fields,submitHandler"() { this.setData({ localDraft: {}, errorLabel: "", generation: this.data.generation + 1 }); this.refreshFields(); },
  },
  methods: {
    refreshFields() {
      const fields = (this.data.fields as ClarificationField[]).slice(0, 30);
      const seen = new Set<string>();
      const visible = fields.filter(field => {
        if (!field || typeof field.key !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(field.key) || ["__proto__", "constructor", "prototype"].includes(field.key) || typeof field.label !== "string" || seen.has(field.key)) return false;
        seen.add(field.key); return true;
      }).map(field => ({ key: field.key, label: field.label.slice(0, 200), value: Object.prototype.hasOwnProperty.call(this.data.localDraft, field.key) ? this.data.localDraft[field.key] : typeof field.value === "string" ? field.value.slice(0, 4000) : "", error: typeof field.error === "string" ? field.error.slice(0, 200) : "", readonly: field.readonly === true, required: field.required === true }));
      this.setData({ visibleFields: visible });
    },
    onFieldInput(event: WechatMiniprogram.CustomEvent) {
      const key = event.currentTarget.dataset.key;
      const field = this.data.visibleFields.find(item => item.key === key);
      if (!field || field.readonly || this.data.disabled || this.data.submitting || !this.data.alive || typeof event.detail?.value !== "string") return;
      this.setData({ localDraft: { ...this.data.localDraft, [field.key]: event.detail.value.slice(0, 4000) } }); this.refreshFields();
    },
    async onSubmit(): Promise<void> {
      const handler = this.data.submitHandler as ClarificationHandler | null;
      if (this.data.disabled || this.data.submitting || !this.data.alive || !this.data.taskId || !this.data.inputRevision || typeof handler !== "function") return;
      if (this.data.visibleFields.some(field => field.required && !field.value?.trim())) { this.setData({ errorLabel: "请填写必填信息" }); return; }
      const generation = this.data.generation;
      const input = { taskId: this.data.taskId, inputRevision: this.data.inputRevision, draft: Object.fromEntries(this.data.visibleFields.map(field => [field.key, field.value ?? ""])) };
      this.setData({ submitting: true, errorLabel: "" });
      try { await handler(input); if (this.data.alive && generation === this.data.generation) this.triggerEvent("submit", input); }
      catch { if (this.data.alive && generation === this.data.generation) this.setData({ errorLabel: "提交失败，请重试" }); }
      finally { if (this.data.alive) this.setData({ submitting: false }); }
    },
  },
});
