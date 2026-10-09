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
type PendingInspectionCommand =
  | { kind: "prepare" | "prepareReview"; request: AiInspectionPrepareSubmissionRequest }
  | { kind: "edit" | "evidence" | "submission"; request: unknown };
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
    reconcilePreparation?: (command: { kind: "prepare" | "prepareReview"; request: AiInspectionPrepareSubmissionRequest }) =>
      Promise<AiInspectionReceiptLookup & { execution: "not_attested"; mode?: "manual_review_only" | "original_single" }>;
  };
}
export const emptyInspectionView = () => ({ phase: "unavailable", pending: false, error: "", revision: 0, items: [] as unknown[],
  missing: [] as string[], evidence: [] as AiInspectionEvidenceRef[], editable: false, canRemove: false, canReview: false, canSubmit: false, canReconcile: false });

/** No timers, storage, network, token or shared state. Old epochs cannot update this view. */
export class StaffInspectionHostBinding {
  private host?: StaffInspectionHost;
  private epoch = 0;
  private shown = false;
  private pending = false;
  private detail?: InspectionHostDetail;
  private template?: RentalInspectionTemplate;
  private uncertain?: PendingInspectionCommand;
  constructor(private readonly display: (view: ReturnType<typeof emptyInspectionView>) => void,
    private readonly onContextInvalidated?: () => void) {}
  attachHost(host: StaffInspectionHost) { this.detachHost(); this.host = { ...host, context: { ...host.context }, target: { ...host.target },
    templates: { ...host.templates }, drafts: { ...host.drafts }, ...(host.submission ? { submission: { ...host.submission } } : {}),
    ...(host.evidence ? { evidence: { ...host.evidence } } : {}) }; }
  generation() { return this.epoch; }
  revision() { return this.detail?.revision; }
  detachHost() { this.epoch++; this.host = undefined; this.shown = false; this.pending = false; this.detail = undefined;
    this.template = undefined; this.uncertain = undefined; this.display(emptyInspectionView()); }
  hide() { this.epoch++; this.shown = false; this.pending = false; this.detail = undefined; this.template = undefined; this.display(emptyInspectionView()); }
  private active(epoch = this.epoch) {
    const host = this.host;
    if (!this.shown || epoch !== this.epoch || !host || host.serverEnabled !== true) return false;
    let current = false;
    try { current = host.current() === true; } catch { /* A context that cannot be verified is not usable. */ }
    if (epoch !== this.epoch || this.host !== host) return false;
    if (!current) {
      this.detachHost();
      try { this.onContextInvalidated?.(); } catch { /* Local cleanup failure cannot restore the invalid host. */ }
      return false;
    }
    return true;
  }
  async show() { this.shown = true; if (!this.active()) { this.display(emptyInspectionView()); return; } await this.read(); }
  private view(phase: string, error = "") {
    const view = emptyInspectionView(), d = this.detail, host = this.host;
    view.phase = phase; view.error = error; view.pending = this.pending;
    if (d && this.template) {
      view.revision = d.revision;
      view.items = this.template.fields.slice(0, 64).map(field => {
        const matches = d.state.candidates.filter(item => item.fieldCode === field.code);
        const candidate = matches.length === 1 ? matches[0] : undefined;
        return { key: field.code, label: boundedText(field.label, 200),
          candidate: candidate?.status === "candidate" ? (candidate.value.kind === "photo" ? candidate.value.attachmentId : candidate.value.value) : null,
          candidateId: candidate?.candidateId ?? "",
          candidateActionable: candidate?.status === "candidate" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(candidate.candidateId)
            && candidate.sources.every(source => d.state.evidence.some(ref => ref.attachmentId === source.attachmentId && ref.attachmentRevision === source.attachmentRevision)),
          decision: d.state.fields[field.code]?.decision ?? "",
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
    if (this.uncertain?.kind === "prepare" || this.uncertain?.kind === "prepareReview") {
      view.canReconcile = !this.pending && typeof host?.submission?.reconcilePreparation === "function";
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
    const host = this.host!, detail = this.detail!, epoch = this.epoch, revision = detail.revision;
    const operationId = host.operationId(kind, detail.revision);
    if (typeof operationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(operationId)) throw new Error("operation");
    if (!this.active(epoch) || this.host !== host || this.detail !== detail || detail.revision !== revision) throw new Error("context changed");
    return { ...host.target, draftId: detail.draftId, expectedRevision: detail.revision, operationId };
  }
  private async action(command: PendingInspectionCommand, run: () => Promise<unknown>) {
    if (!this.active() || this.pending || this.uncertain) return;
    const epoch = this.epoch; this.pending = true;
    // The injected callback receives a separate object, never our recovery material.
    const original: PendingInspectionCommand = JSON.parse(JSON.stringify(command));
    this.uncertain = original; this.view("pending");
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
    await this.action({ kind: "edit", request }, () => this.host!.drafts.edit!(request));
  }
  /** An explicit human choice of the exact current candidate, never a supplied final value. */
  async decideCandidate(fieldCode: string, candidateId: string, decision: "accepted" | "rejected", revision: number) {
    if (!this.active() || this.pending || this.uncertain || !this.detail || !this.host?.drafts.edit
      || this.detail.revision !== revision || !["draft_saved", "prepared"].includes(this.detail.status)
      || !["accepted", "rejected"].includes(decision) || !this.template?.fields.some(field => field.code === fieldCode)) return;
    const host = this.host, epoch = this.epoch;
    const matches = this.detail.state.candidates.filter(item => item.fieldCode === fieldCode);
    const candidate = matches.length === 1 ? matches[0] : undefined;
    if (!candidate || candidate.candidateId !== candidateId || candidate.status !== "candidate"
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(candidateId)) return;
    if (decision === "accepted" && !candidate.sources.every(source => this.detail!.state.evidence.some(ref =>
      ref.attachmentId === source.attachmentId && ref.attachmentRevision === source.attachmentRevision))) return;
    try {
      const request: AiInspectionDraftEditRequest = { ...this.base("edit"), bindingFingerprint: this.detail.bindingFingerprint,
        edits: [{ fieldCode, candidateId, decision }] };
      await this.action({ kind: "edit", request }, () => host.drafts.edit!(request));
    } catch { if (this.active(epoch)) this.view(this.loadedPhase(), "候选操作不可用，请保留人工填单"); }
  }
  async removeEvidence(attachmentId: string) {
    if (!this.active() || this.pending || this.uncertain || !this.detail || !["draft_saved", "prepared"].includes(this.detail.status) || !this.host?.drafts.replaceEvidence) return;
    if (!this.detail.state.evidence.some(ref => ref.attachmentId === attachmentId)) return;
    const request = { ...this.base("evidence"), bindingFingerprint: this.detail.bindingFingerprint,
      evidence: this.detail.state.evidence.filter(ref => ref.attachmentId !== attachmentId) };
    await this.action({ kind: "evidence", request }, () => this.host!.drafts.replaceEvidence!(request));
  }
  private preparation(kind: "review" | "prepare") {
    const host = this.host!;
    return { ...this.base(kind), actionId: host.actionId,
      ...(host.handoverSignatureFileAssetId ? { handoverSignatureFileAssetId: host.handoverSignatureFileAssetId } : {}) };
  }
  async prepareReview() {
    if (!this.active() || this.pending || this.uncertain || !this.detail || !this.host?.submission?.prepareReview) return;
    const request = this.preparation("review");
    await this.action({ kind: "prepareReview", request }, () => this.host!.submission!.prepareReview!(request));
  }
  async submit(confirmed: boolean, generation = this.epoch, revision = this.detail?.revision) {
    if (!confirmed || !this.active(generation) || this.pending || this.uncertain || !this.detail || this.detail.state.reviewRequired
      || this.detail.revision !== revision || !["draft_saved", "prepared"].includes(this.detail.status)
      || !this.host?.submission?.prepare || !this.host.submission.submit) return;
    const request = this.preparation("prepare"), host = this.host, epoch = this.epoch;
    await this.action({ kind: "prepare", request }, async () => {
      await host.submission!.prepare!(request);
      if (!this.active(epoch)) return;
      await this.load(epoch);
      if (!this.active(epoch) || this.detail?.state.submission?.mode === "manual_review_only" || this.detail?.status !== "prepared") return;
      const submit = this.base("submit");
      // Persist the exact submission before waiting; lost replies must only reconcile.
      this.uncertain = { kind: "submission", request: { ...submit } };
      await host.submission!.submit!(submit);
    });
  }
  async reconcile() {
    if (!this.active() || this.pending || !this.host) return;
    const host = this.host, epoch = this.epoch, command = this.uncertain;
    const preparing = command?.kind === "prepare" || command?.kind === "prepareReview";
    if (preparing ? !host.submission?.reconcilePreparation : !this.detail) return;
    this.pending = true; this.view("reconciling");
    let error = "";
    try {
      if (command?.kind === "prepare" || command?.kind === "prepareReview") {
        const result = await host.submission!.reconcilePreparation!({ kind: command.kind, request: { ...command.request } });
        if (!this.active(epoch) || this.uncertain !== command) return;
        // Do not unlock on the receipt alone. Its prepared fact does not attest execution.
        this.detail = undefined; this.template = undefined;
        await this.load(epoch);
        if (!this.active(epoch) || this.uncertain !== command) return;
        const current = this.currentDetail();
        const mode = command.kind === "prepareReview" ? "manual_review_only" : "original_single";
        if (result.status === "found" && result.execution === "not_attested" && result.mode === mode
          && result.result.draftId === command.request.draftId && result.result.status === "prepared"
          && Number.isSafeInteger(result.result.revision) && result.result.revision === command.request.expectedRevision + 1
          && current && current.revision >= result.result.revision
          && (current.revision > result.result.revision || current.status === "prepared"
            && current.state.submission?.mode === mode && current.state.submission.actionId === command.request.actionId)) {
          this.uncertain = undefined;
        }
        return;
      }
      if (this.detail?.status === "submission_unknown" || this.uncertain?.kind === "submission") {
        const result = await host.submission?.reconcile?.({ ...host.target, draftId: host.draftId });
        if (this.active(epoch) && result?.status === "submitted") this.uncertain = undefined;
      } else if (this.uncertain?.kind === "edit" || this.uncertain?.kind === "evidence") {
        const result = await host.drafts.reconcileOperation?.({ kind: this.uncertain.kind, request: this.uncertain.request });
        if (this.active(epoch) && result?.status === "found") this.uncertain = undefined;
      }
      if (this.active(epoch)) await this.load(epoch);
    } catch { error = "核对暂不可用，请保留原操作，不要重复提交"; }
    finally { if (this.active(epoch)) { this.pending = false; this.view(this.uncertain ? "unknown" : this.detail?.status ?? "unavailable", error); } }
  }
  private currentDetail(): InspectionHostDetail | undefined { return this.detail; }
}
