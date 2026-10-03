interface ConfirmationIdentity { id?: string; revision?: string; }
type ConfirmationCallback = (input: { proposalId: string; revision: string }) => Promise<void>;
Component({
  properties: {
    proposal: { type: Object, value: null }, disabled: { type: Boolean, value: true },
    pending: { type: Boolean, value: false }, expired: { type: Boolean, value: false },
    checked: { type: Boolean, value: false }, confirmHandler: { type: null, value: null },
  },
  data: { submitting: false, errorLabel: "", checkedIdentity: "", generation: 0, alive: true },
  lifetimes: { detached() { this.setData({ alive: false, generation: this.data.generation + 1, checkedIdentity: "", errorLabel: "" }); } },
  observers: { "proposal,disabled,expired,confirmHandler"() { this.setData({ checkedIdentity: "", generation: this.data.generation + 1, errorLabel: "" }); } },
  methods: {
    identity(): string {
      const proposal = this.data.proposal as ConfirmationIdentity | null;
      return proposal && typeof proposal.id === "string" && proposal.id && typeof proposal.revision === "string" && proposal.revision ? JSON.stringify([proposal.id, proposal.revision]) : "";
    },
    onCheck(event: WechatMiniprogram.CustomEvent) {
      if (this.data.disabled || this.data.expired || this.data.pending || this.data.submitting || !this.data.alive) return;
      const checked = Array.isArray(event.detail.value) && event.detail.value.includes("read");
      this.setData({ checkedIdentity: checked ? this.identity() : "" }); this.triggerEvent("check", { checked });
    },
    async onConfirm(): Promise<void> {
      const identity = this.identity(); const handler = this.data.confirmHandler as ConfirmationCallback | null;
      if (!identity || this.data.checkedIdentity !== identity || this.data.disabled || this.data.expired || this.data.pending || this.data.submitting || !this.data.alive || typeof handler !== "function") return;
      const generation = this.data.generation; const proposal = this.data.proposal as { id: string; revision: string };
      this.setData({ submitting: true, errorLabel: "" });
      try {
        await handler({ proposalId: proposal.id, revision: proposal.revision });
        if (this.data.alive && generation === this.data.generation && this.identity() === identity && this.data.confirmHandler === handler)
          this.triggerEvent("confirm", { proposalId: proposal.id, revision: proposal.revision });
      } catch {
        if (this.data.alive && generation === this.data.generation && this.identity() === identity && this.data.confirmHandler === handler) this.setData({ errorLabel: "提交失败，请核对后重试" });
      } finally { if (this.data.alive) this.setData({ submitting: false }); }
    },
  },
});
