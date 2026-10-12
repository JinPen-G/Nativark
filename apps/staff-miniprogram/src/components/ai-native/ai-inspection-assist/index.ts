import { StaffInspectionHostBinding, emptyInspectionView, type StaffInspectionHost } from "../inspection-host";
const bindings = new WeakMap<object, StaffInspectionHostBinding>();
const dialogs = new WeakSet<object>();
Component({
  data: emptyInspectionView(),
  lifetimes: {
    created() {
      bindings.set(this, new StaffInspectionHostBinding(view => this.setData(view),
        () => this.selectComponent("#workbench")?.detachHost?.()));
    },
    detached() { bindings.get(this)?.dispose(); bindings.delete(this); this.selectComponent?.("#workbench")?.detachHost?.(); },
  },
  methods: {
    attachHost(host: StaffInspectionHost) {
      this.detachHost(); bindings.get(this)?.attachHost(host);
      if (host.taskHost && host.serverEnabled === true) this.selectComponent("#workbench")?.attachHost?.(host.taskHost);
    },
    detachHost() { bindings.get(this)?.detachHost(); this.selectComponent("#workbench")?.detachHost?.(); },
    async hostShow() {
      const binding = bindings.get(this), generation = binding?.generation();
      await binding?.show();
      if (binding && bindings.get(this) === binding && generation !== undefined && binding.isActive(generation)) {
        this.selectComponent("#workbench")?.hostShow?.(true);
      }
    },
    hostHide() { bindings.get(this)?.hide(); this.selectComponent("#workbench")?.hostHide?.(); },
    hostLogout() { this.detachHost(); },
    async onRead() { await bindings.get(this)?.read(); },
    async onReadRecognition() { await bindings.get(this)?.readRecognition(); },
    async onSaveRecognition() { await bindings.get(this)?.saveRecognition(); },
    async onEdit(event: WechatMiniprogram.CustomEvent) { await bindings.get(this)?.edit(event.detail?.key, event.detail?.humanValue); },
    async onCandidate(event: WechatMiniprogram.CustomEvent) {
      await bindings.get(this)?.decideCandidate(event.detail?.key, event.detail?.candidateId, event.detail?.decision, event.detail?.revision);
    },
    async onRemove(event: WechatMiniprogram.TouchEvent) { await bindings.get(this)?.removeEvidence(String(event.currentTarget.dataset.id ?? "")); },
    async onReview() { await bindings.get(this)?.prepareReview(); },
    async onReconcile() { await bindings.get(this)?.reconcile(); },
    async onSubmit() {
      if (!this.data.canSubmit || this.data.pending || dialogs.has(this)) return;
      // No automatic submission: the system dialog is an explicit human action.
      const binding = bindings.get(this);
      const generation = binding?.generation();
      const revision = binding?.revision();
      dialogs.add(this);
      try {
        const confirmed = await new Promise<boolean>(resolve => wx.showModal({ title: "提交原检查入口", content: "请核实全部字段和签名。草稿不判责、不计算费用；服务端仍须验证。", success: result => resolve(result.confirm), fail: () => resolve(false) }));
        if (bindings.get(this) === binding && generation !== undefined) await binding?.submit(confirmed, generation, revision);
      } catch { if (bindings.get(this) === binding && generation === binding?.generation()) this.setData({ error: "提交入口不可用，请使用原人工流程" }); }
      finally { dialogs.delete(this); }
    },
  },
});
