import type { AiInspectionActorScope, AiInspectionTarget, AiInspectionDraftState, AiInspectionDraftEditRequest,
  AiInspectionPrepareSubmissionRequest, AiInspectionSubmitRequest, AiInspectionReceiptLookup, AiInspectionEvidenceRef,
  RentalInspectionTemplate } from "@rental-os/shared";
import { boundedText } from "./display-format";
import type { NativeAiHost } from "./ai-task-workbench/index";

/** Internal display binding, not an HTTP DTO or an authorization source. */
export interface InspectionHostDetail {
  draftId: string; revision: number; status: string; target: AiInspectionTarget;
  templateVersion: string; bindingFingerprint: string; state: AiInspectionDraftState;
}
export interface StaffInspectionHost {
  context: AiInspectionActorScope & { audience: "staff" };
  target: AiInspectionTarget;
  draftId: string;
  serverEnabled: boolean;
  current: () => boolean;
  operationId: (kind: "edit" | "evidence" | "review" | "prepare" | "submit", revision: number) => string;
  actionId: string;
  handoverSignatureFileAssetId?: string;
  taskHost?: NativeAiHost;
  templates: { read: (target: AiInspectionTarget) => Promise<{ bindingFingerprint: string; template: RentalInspectionTemplate }> };
  drafts: {
    read: (request: AiInspectionTarget & { draftId: string }) => Promise<InspectionHostDetail>;
    edit?: (request: AiInspectionDraftEditRequest) => Promise<unknown>;
    replaceEvidence?: (request: AiInspectionTarget & { draftId: string; operationId: string; expectedRevision: number;
      bindingFingerprint: string; evidence: AiInspectionEvidenceRef[] }) => Promise<unknown>;
    reconcileOperation?: (request: { kind: "edit" | "evidence"; request: unknown }) => Promise<AiInspectionReceiptLookup>;
  };
  evidence?: { fingerprint: (target: AiInspectionTarget, refs: AiInspectionEvidenceRef[]) => Promise<string> };
  submission?: {
    prepareReview?: (request: AiInspectionPrepareSubmissionRequest) => Promise<unknown>;
    prepare?: (request: AiInspectionPrepareSubmissionRequest) => Promise<unknown>;
    submit?: (request: AiInspectionSubmitRequest) => Promise<{ status: string }>;
    reconcile?: (request: AiInspectionTarget & { draftId: string }) => Promise<{ status: string }>;
  };
}
export const emptyInspectionView = () => ({ phase: "unavailable", pending: false, error: "", items: [] as unknown[],
  missing: [] as string[], evidence: [] as AiInspectionEvidenceRef[], editable: false, canRemove: false, canReview: false, canSubmit: false, canReconcile: false });

/** No timers, storage, network, token or shared state. Old epochs cannot update this view. */
export class StaffInspectionHostBinding {
  private host?: StaffInspectionHost;
  private epoch = 0;
  private shown = false;
  private pending = false;
  private detail?: InspectionHostDetail;
  private template?: RentalInspectionTemplate;
  private uncertain?: { kind: "edit" | "evidence" | "submission" | "prepare"; request: unknown };
  constructor(private readonly display: (view: ReturnType<typeof emptyInspectionView>) => void) {}
  attachHost(host: StaffInspectionHost) { this.detachHost(); this.host = { ...host, context: { ...host.context }, target: { ...host.target },
    templates: { ...host.templates }, drafts: { ...host.drafts }, ...(host.submission ? { submission: { ...host.submission } } : {}),
    ...(host.evidence ? { evidence: { ...host.evidence } } : {}) }; }
  generation() { return this.epoch; }
  revision() { return this.detail?.revision; }
  detachHost() { this.epoch++; this.host = undefined; this.shown = false; this.pending = false; this.detail = undefined;
    this.template = undefined; this.uncertain = undefined; this.display(emptyInspectionView()); }
  hide() { this.epoch++; this.shown = false; this.pending = false; this.detail = undefined; this.template = undefined; this.display(emptyInspectionView()); }
  private active(epoch = this.epoch) {
    try { return this.shown && epoch === this.epoch && this.host?.serverEnabled === true && this.host.current() === true; }
    catch { return false; }
  }
  async show() { this.shown = true; if (!this.active()) { this.display(emptyInspectionView()); return; } await this.read(); }
  private view(phase: string, error = "") {
    const view = emptyInspectionView(), d = this.detail, host = this.host;
    view.phase = phase; view.error = error; view.pending = this.pending;
    if (d && this.template) {
      view.items = this.template.fields.slice(0, 64).map(field => {
        const candidate = d.state.candidates.find(item => item.fieldCode === field.code);
        return { key: field.code, label: boundedText(field.label, 200),
          candidate: candidate?.status === "candidate" ? (candidate.value.kind === "photo" ? candidate.value.attachmentId : candidate.value.value) : null,
          humanValue: d.state.fields[field.code]?.value ?? null,
          sourceLabel: candidate?.sources.map(source => `${source.attachmentId}@${source.attachmentRevision}`).join(", ").slice(0, 200) ?? "来源不可用" };
      });
      view.missing = d.state.missingFields.slice(0, 64); view.evidence = d.state.evidence.slice(0, 100);
      const editable = !this.pending && !this.uncertain && ["draft_saved", "prepared"].includes(d.status);
      view.editable = editable && typeof host?.drafts.edit === "function";
      view.canRemove = editable && typeof host?.drafts.replaceEvidence === "function";
      view.canReview = editable && typeof host?.submission?.prepareReview === "function";
      view.canSubmit = !this.pending && !this.uncertain && !d.state.reviewRequired && ["draft_saved", "prepared"].includes(d.status)
        && typeof host?.submission?.prepare === "function" && typeof host?.submission.submit === "function";
      view.canReconcile = !this.pending && ((d.status === "submission_unknown" || this.uncertain?.kind === "submission") && typeof host?.submission?.reconcile === "function"
        || (this.uncertain?.kind === "edit" || this.uncertain?.kind === "evidence") && typeof host?.drafts.reconcileOperation === "function");
    }
    this.display(view);
  }
  private async load(epoch: number) {
    const host = this.host!;
    const target = { ...host.target };
    const binding = await host.templates.read(target);
    if (!this.active(epoch)) return;
    const detail = await host.drafts.read({ ...target, draftId: host.draftId });
    if (!this.active(epoch)) return;
    if (detail.draftId !== host.draftId || Object.entries(target).some(([key, value]) => detail.target[key as keyof AiInspectionTarget] !== value)
      || detail.bindingFingerprint !== binding.bindingFingerprint || detail.templateVersion !== binding.template.version
      || binding.template.id !== target.templateId || binding.template.stage !== target.stage
      || !Number.isSafeInteger(detail.revision) || detail.revision < 1 || binding.template.fields.length > 100
      || detail.state.candidates.length > 100 || detail.state.evidence.length > 100) throw new Error("binding");
    if (detail.state.evidence.length) {
      if (!host.evidence?.fingerprint) throw new Error("evidence unavailable");
      await host.evidence.fingerprint(target, detail.state.evidence);
      if (!this.active(epoch)) return;
    }
    this.template = binding.template; this.detail = detail;
  }
  async read() {
    if (!this.active() || this.pending) return;
    const epoch = this.epoch; this.pending = true; this.detail = undefined; this.view("loading");
    let error = "";
    try { await this.load(epoch); }
    catch { error = "读取不可用，请保留原人工流程"; }
    finally { if (this.active(epoch)) { this.pending = false; this.view(this.loadedPhase(), error); } }
  }
  private loadedPhase() { return this.detail ? (this.uncertain ? "unknown" : this.detail.status) : "read_failed"; }
  private base(kind: Parameters<StaffInspectionHost["operationId"]>[0]) {
    const host = this.host!, detail = this.detail!;
    const operationId = host.operationId(kind, detail.revision);
    if (typeof operationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(operationId)) throw new Error("operation");
    return { ...host.target, draftId: detail.draftId, expectedRevision: detail.revision, operationId };
  }
  private async action(kind: "edit" | "evidence" | "submission" | "prepare", request: unknown, run: () => Promise<unknown>) {
    if (!this.active() || this.pending || this.uncertain) return;
    const epoch = this.epoch; this.pending = true; this.view("pending");
    const original = { kind, request }; this.uncertain = original;
    try { await run(); if (this.active(epoch)) { await this.load(epoch);
      if (this.uncertain === original || this.uncertain?.kind === "submission" && this.detail?.status === "submitted") this.uncertain = undefined; } }
    catch { /* Retain the original operation, including a nested submission. */ }
    finally { if (this.active(epoch)) { this.pending = false; this.view(this.uncertain ? "unknown" : this.detail?.status ?? "unavailable",
      this.uncertain ? "原操作结果待核对，勿重复提交" : ""); } }
  }
  async edit(fieldCode: string, text: string) {
    if (!this.active() || this.pending || this.uncertain || !this.detail || !["draft_saved", "prepared"].includes(this.detail.status) || !this.host?.drafts.edit) return;
    const field = this.template?.fields.find(item => item.code === fieldCode);
    if (!field || typeof text !== "string" || text.length > 4000 || field.type === "photo") return;
    let value: string | number | boolean = text;
    if (field.type === "number") { if (!text.trim() || !Number.isFinite(Number(text))) return; value = Number(text); }
    if (field.type === "boolean") { if (text !== "true" && text !== "false") return; value = text === "true"; }
    if (field.type === "select" && !field.options?.includes(text)) return;
    const request = { ...this.base("edit"), bindingFingerprint: this.detail.bindingFingerprint, edits: [{ fieldCode, decision: "manual" as const, value }] };
    await this.action("edit", request, () => this.host!.drafts.edit!(request));
  }
  async removeEvidence(attachmentId: string) {
    if (!this.active() || this.pending || this.uncertain || !this.detail || !["draft_saved", "prepared"].includes(this.detail.status) || !this.host?.drafts.replaceEvidence) return;
    if (!this.detail.state.evidence.some(ref => ref.attachmentId === attachmentId)) return;
    const request = { ...this.base("evidence"), bindingFingerprint: this.detail.bindingFingerprint,
      evidence: this.detail.state.evidence.filter(ref => ref.attachmentId !== attachmentId) };
    await this.action("evidence", request, () => this.host!.drafts.replaceEvidence!(request));
  }
  private preparation(kind: "review" | "prepare") {
    const host = this.host!;
    return { ...this.base(kind), actionId: host.actionId,
      ...(host.handoverSignatureFileAssetId ? { handoverSignatureFileAssetId: host.handoverSignatureFileAssetId } : {}) };
  }
  async prepareReview() {
    if (!this.active() || this.pending || this.uncertain || !this.detail || !this.host?.submission?.prepareReview) return;
    const request = this.preparation("review");
    await this.action("prepare", request, () => this.host!.submission!.prepareReview!(request));
  }
  async submit(confirmed: boolean, generation = this.epoch, revision = this.detail?.revision) {
    if (!confirmed || !this.active(generation) || this.pending || this.uncertain || !this.detail || this.detail.state.reviewRequired
      || this.detail.revision !== revision || !["draft_saved", "prepared"].includes(this.detail.status)
      || !this.host?.submission?.prepare || !this.host.submission.submit) return;
    const request = this.preparation("prepare"), host = this.host, epoch = this.epoch;
    await this.action("prepare", request, async () => {
      await host.submission!.prepare!(request);
      if (!this.active(epoch)) return;
      await this.load(epoch);
      if (!this.active(epoch) || this.detail?.state.submission?.mode === "manual_review_only" || this.detail?.status !== "prepared") return;
      const submit = this.base("submit");
      // Persist the exact submission before waiting; lost replies must only reconcile.
      this.uncertain = { kind: "submission", request: submit };
      await host.submission!.submit!(submit);
    });
  }
  async reconcile() {
    if (!this.active() || this.pending || !this.detail || !this.host) return;
    const host = this.host, epoch = this.epoch; this.pending = true; this.view("reconciling");
    try {
      if (this.detail.status === "submission_unknown" || this.uncertain?.kind === "submission") {
        const result = await host.submission?.reconcile?.({ ...host.target, draftId: host.draftId });
        if (this.active(epoch) && result?.status === "submitted") this.uncertain = undefined;
      } else if (this.uncertain?.kind === "edit" || this.uncertain?.kind === "evidence") {
        const result = await host.drafts.reconcileOperation?.({ kind: this.uncertain.kind, request: this.uncertain.request });
        if (this.active(epoch) && result?.status === "found") this.uncertain = undefined;
      }
      if (this.active(epoch)) await this.load(epoch);
    } catch { /* Keep the same unresolved operation, never retry business writes. */ }
    finally { if (this.active(epoch)) { this.pending = false; this.view(this.uncertain ? "unknown" : this.detail?.status ?? "unavailable"); } }
  }
}
