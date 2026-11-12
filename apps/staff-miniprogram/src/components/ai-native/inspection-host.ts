import type { AiInspectionActorScope, AiInspectionTarget, AiInspectionDraftState, AiInspectionDraftEditRequest,
  AiInspectionPrepareSubmissionRequest, AiInspectionSubmitRequest, AiInspectionReceiptLookup, AiInspectionOperationResult, AiInspectionEvidenceRef,
  RentalInspectionTemplate, AiInspectionRecognitionTaskReference, AiStaffInspectionSavedReference,
  AiInspectionResultReadResponse, AiInspectionRecognitionBasisIssueDraft, AiInspectionReviewIssueDraft,
  AiInspectionSavedCandidateReview } from "@rental-os/shared";
import { boundedText } from "./display-format";
import { validateInspectionWire, isInspectionSavedCandidateReview } from "./inspection-wire";
import type { NativeAiHost } from "./ai-task-workbench/index";

type InspectionDisplayTemplate = Pick<RentalInspectionTemplate, 'id' | 'version' | 'stage' | 'fields'>;
const reviewLabels: Record<AiInspectionReviewIssueDraft, string> = {
  baseline_missing: '缺少领取基线', meter_replaced: '计量表更换待核实', reading_backwards: '读数倒退待核实',
  field_unavailable: '检查依据不可用', source_unclear: '原材料不清楚',
};
const reviewReasons: Record<string, string> = {
  source_blurred: '原材料模糊，无法确认读数', source_missing: '原材料缺少该字段',
  original_basis_not_recorded: '没有记录本次识别的原检查依据',
  original_basis_unavailable: '原检查依据当前无法核对', draft_evidence_changed: '原候选来源与当前草稿不一致',
  original_attribute_format_invalid: '识别值不符合原字段格式',
  asset_identifier_not_recorded: '分配资源未记录可核对的标识',
  asset_identifier_mismatch: '识别标识与分配资源不一致',
  original_meter_evidence_recorded: '原记录存在计量表更换依据，请按人工异常流程核实',
  pickup_baseline_missing: '缺少领取时的原读数', pickup_reading_missing: '原领取记录未填写读数',
  original_pickup_reading_missing: '原领取记录未填写读数',
  original_pickup_reading_not_unique: '原领取记录存在多个读数，尚不能确定依据',
  pickup_reading_not_unique: '原领取记录存在多个读数，尚不能确定依据',
  original_pickup_unit_mismatch: '当前检查单位与原领取读数单位不一致',
  frozen_unit_missing: '原领取模板未记录读数单位', pickup_reading_not_resource_specific: '原领取读数未明确属于本次资源',
  original_pickup_reading_invalid: '原领取读数无法用于核对',
  original_usage_validation_failed: '当前读数未通过原业务增量校验',
  pickup_baseline_unknown: '原领取基线尚不可核对',
};
/** Translate server findings only; resource, unit and reading comparisons stay in Core. */
function reviewMessage(issue: AiInspectionRecognitionBasisIssueDraft): string {
  const reason = Object.prototype.hasOwnProperty.call(reviewReasons, issue.reason)
    ? reviewReasons[issue.reason] : boundedText(issue.reason, 512);
  return `${reviewLabels[issue.code]}：${reason}`;
}
function candidateSources(candidate: AiInspectionDraftState['candidates'][number]): string[] {
  return candidate.sources.map(source => {
    const original = `${source.attachmentId} · 修订 ${source.attachmentRevision}`;
    if (source.kind === 'audio') return `${original} · 录音 ${(source.span.startMs / 1000).toFixed(2)}–${(source.span.endMs / 1000).toFixed(2)} 秒`;
    const region = source.region;
    return `${original} · 图片区域：左 ${(region.x * 100).toFixed(1)}%、上 ${(region.y * 100).toFixed(1)}%、宽 ${(region.width * 100).toFixed(1)}%、高 ${(region.height * 100).toFixed(1)}%`;
  });
}
function candidateDifference(candidate: AiInspectionDraftState['candidates'][number] | undefined,
  human: AiInspectionDraftState['fields'][string] | undefined): string {
  if (human?.decision === 'rejected') return '已人工拒绝此候选';
  if (!candidate || candidate.status !== 'candidate') return '候选未明确，请人工核实';
  if (!human || human.value === null) return '尚未填写人工值';
  const value = candidate.value.kind === 'photo' ? candidate.value.attachmentId : candidate.value.value;
  return value === human.value ? '人工值与候选一致' : '人工值与候选不同';
}
/** Internal display binding, not an HTTP DTO or an authorization source. */
export interface InspectionHostDetail {
  draftId: string; revision: number; status: string; target: AiInspectionTarget;
  templateVersion: string; bindingFingerprint: string; state: AiInspectionDraftState;
  candidateReviews?: AiInspectionSavedCandidateReview[];
}
function savedCandidateReview(detail: InspectionHostDetail, candidateId: string): AiInspectionSavedCandidateReview | undefined {
  if (!Array.isArray(detail.candidateReviews) || detail.candidateReviews.length > 100) return;
  const matches = detail.candidateReviews.filter(review => review?.candidateId === candidateId);
  return matches.length === 1 && isInspectionSavedCandidateReview(matches[0]) ? matches[0] : undefined;
}
function canAdoptCandidate(review: AiInspectionSavedCandidateReview | undefined): boolean {
  return review?.adoption === 'human_confirmation_required' && review.sourcesMatchDraftEvidence === true
    && review.basis.status === 'recorded' && review.reviewIssues.length === 0 && review.basisIssues.length === 0;
}
function savedReviewMessages(review: AiInspectionSavedCandidateReview | undefined): string[] {
  if (!review) return ['当前候选复核尚不可用，请重读原稿；仍可人工更正或拒绝'];
  if (review.basisIssues.length) return review.basisIssues.map(reviewMessage);
  if (review.reviewIssues.length) return review.reviewIssues.map(code => reviewLabels[code]);
  if (!review.sourcesMatchDraftEvidence) return ['原候选来源与当前草稿不一致，请人工核实'];
  if (review.basis.status !== 'recorded') return ['原检查依据未记录，请人工核实'];
  return review.adoption === 'unavailable' ? ['当前候选不可直接采用，请按原人工流程核实'] : [];
}
type PendingInspectionCommand =
  | { kind: "prepare" | "prepareReview"; request: AiInspectionPrepareSubmissionRequest }
  | { kind: "edit" | "evidence" | "submission" | "recognition"; request: unknown };
/** Feature-local consumption of the existing result-read/save endpoints. Not a dispatch request. */
export type InspectionRecognitionReference = AiInspectionRecognitionTaskReference & { taskId: string; resultId: string };
export type InspectionRecognitionObservation = AiInspectionResultReadResponse;
/** Original business receipt observation, independent of the draft back-write. */
export interface InspectionSubmissionObservation {
  status: string; inspectionId?: string; draftLinked?: boolean;
}
export interface StaffInspectionHost {
  context: AiInspectionActorScope & { audience: "staff" };
  target: AiInspectionTarget;
  draftId: string;
  serverEnabled: boolean;
  current: () => boolean;
  operationId: (kind: "edit" | "evidence" | "review" | "prepare" | "submit" | "candidates", revision: number) => string;
  actionId: string;
  handoverSignatureFileAssetId?: string;
  taskHost?: NativeAiHost;
  recognition?: {
    reference: InspectionRecognitionReference;
    read: () => Promise<InspectionRecognitionObservation>;
    save?: (operationId: string) => Promise<unknown>;
    reconcileSave?: (operationId: string) => Promise<AiInspectionReceiptLookup>;
  };
  templates: { read: (target: AiInspectionTarget) => Promise<{ bindingFingerprint: string; template: InspectionDisplayTemplate }> };
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
    submit?: (request: AiInspectionSubmitRequest) => Promise<InspectionSubmissionObservation>;
    reconcile?: (request: AiInspectionTarget & { draftId: string }) => Promise<InspectionSubmissionObservation>;
    reconcilePreparation?: (command: { kind: "prepare" | "prepareReview"; request: AiInspectionPrepareSubmissionRequest }) =>
      Promise<AiInspectionReceiptLookup & { execution: "not_attested"; mode?: "manual_review_only" | "original_single" }>;
  };
}
export interface StaffInspectionReceiptHost {
  mode: "receipt_only";
  context: AiInspectionActorScope & { audience: "staff" };
  target: AiInspectionTarget; draftId: string; serverEnabled: true; current: () => boolean;
  recognition?: { reference: AiStaffInspectionSavedReference; read: () => Promise<AiInspectionReceiptLookup> };
  submission?: { read: () => Promise<InspectionSubmissionObservation> };
}
export const emptyInspectionView = () => ({ mode: "unavailable", phase: "unavailable", pending: false, error: "", revision: 0, items: [] as unknown[],
  missing: [] as string[], evidence: [] as AiInspectionEvidenceRef[], editable: false, canRemove: false, canReview: false, canSubmit: false, canReconcile: false,
  originalReceiptObserved: false, originalInspectionId: "", draftLinkStatus: "unknown", canReadReceipts: false,
  recognitionSaveObserved: false, recognitionSavedRevision: 0,
  recognitionStatus: "unavailable", recognitionItems: [] as unknown[], recognitionBasisLabel: '', recognitionReviewSummary: '',
  recognitionReviewIssues: [] as { key: string; fieldLabel: string; message: string; recordLabel: string }[],
  canReadRecognition: false, canSaveRecognition: false });

/** No timers, storage, network, token or shared state. Old epochs cannot update this view. */
export class StaffInspectionHostBinding {
  private host?: StaffInspectionHost;
  private receiptHost?: StaffInspectionReceiptHost;
  private epoch = 0;
  private shown = false;
  private pending = false;
  private detail?: InspectionHostDetail;
  private template?: InspectionDisplayTemplate;
  private uncertain?: PendingInspectionCommand;
  private receipt?: InspectionSubmissionObservation;
  private recognitionSaveCommand?: Pick<AiInspectionDraftEditRequest, "draftId" | "operationId" | "expectedRevision">;
  private recognitionSavedRevision?: number;
  private recognition?: InspectionRecognitionObservation;
  private fieldErrors: Record<string, string> = {};
  private disposed = false;
  constructor(private readonly display: (view: ReturnType<typeof emptyInspectionView>) => void,
    private readonly onContextInvalidated?: () => void) {}
  attachHost(host: StaffInspectionHost) { if (this.disposed) return; this.detachHost(); this.host = { ...host, context: { ...host.context }, target: { ...host.target },
    templates: { ...host.templates }, drafts: { ...host.drafts }, ...(host.submission ? { submission: { ...host.submission } } : {}),
    ...(host.recognition ? { recognition: { ...host.recognition, reference: { ...host.recognition.reference } } } : {}),
    ...(host.evidence ? { evidence: { ...host.evidence } } : {}) }; }
  attachReceiptHost(host: StaffInspectionReceiptHost) {
    if (this.disposed) return;
    this.detachHost();
    if (host.mode !== "receipt_only") return;
    this.receiptHost = { ...host, context: { ...host.context }, target: { ...host.target },
      ...(host.recognition ? { recognition: { ...host.recognition, reference: { ...host.recognition.reference } } } : {}),
      ...(host.submission ? { submission: { ...host.submission } } : {}) };
    const reference = host.recognition?.reference;
    if (reference) this.recognitionSaveCommand = { draftId: reference.draftId, operationId: reference.operationId, expectedRevision: reference.expectedRevision };
  }
  generation() { return this.epoch; }
  isActive(generation: number) { return this.active(generation); }
  revision() { return this.detail?.revision; }
  detachHost() { this.epoch++; this.host = undefined; this.receiptHost = undefined; this.shown = false; this.pending = false; this.detail = undefined;
    this.recognitionSaveCommand = undefined; this.recognitionSavedRevision = undefined;
    this.template = undefined; this.uncertain = undefined; this.receipt = undefined; this.recognition = undefined; this.fieldErrors = {}; if (!this.disposed) this.display(emptyInspectionView()); }
  dispose() { this.disposed = true; this.detachHost(); }
  hide() { this.epoch++; this.shown = false; this.pending = false; this.detail = undefined; this.template = undefined; this.receipt = undefined; this.recognition = undefined;
    this.recognitionSavedRevision = undefined;
    this.fieldErrors = {};
    if (!this.disposed) this.display(emptyInspectionView()); }
  private active(epoch = this.epoch) {
    const host = this.host ?? this.receiptHost;
    if (this.disposed || !this.shown || epoch !== this.epoch || !host || host.serverEnabled !== true) return false;
    let current = false;
    try { current = host.current() === true; } catch { /* A context that cannot be verified is not usable. */ }
    if (epoch !== this.epoch || (this.host ?? this.receiptHost) !== host) return false;
    if (!current) {
      this.detachHost();
      try { this.onContextInvalidated?.(); } catch { /* Local cleanup failure cannot restore the invalid host. */ }
      return false;
    }
    return true;
  }
  async show() { if (this.disposed) return; this.shown = true; if (!this.active()) { this.display(emptyInspectionView()); return; } await this.read(); }
  private view(phase: string, error = "") {
    const view = emptyInspectionView(), d = this.detail, host = this.host;
    view.mode = this.receiptHost ? "receipt_only" : "current";
    view.phase = phase; view.error = error; view.pending = this.pending;
    view.canReadReceipts = !this.pending && (!!host?.submission?.reconcile || !!this.recognitionSaveCommand && !!host?.recognition?.reconcileSave
      || !!this.receiptHost?.recognition || !!this.receiptHost?.submission);
    view.recognitionSaveObserved = this.recognitionSavedRevision !== undefined;
    view.recognitionSavedRevision = this.recognitionSavedRevision ?? 0;
    if (this.receipt) {
      view.originalReceiptObserved = true;
      view.originalInspectionId = this.receipt.inspectionId!;
      view.draftLinkStatus = this.receipt.draftLinked === true ? "linked" : this.receipt.draftLinked === false ? "not_linked" : "unknown";
    }
    if (d && this.template) {
      view.canReadRecognition = !this.pending && !this.uncertain && !this.receipt && !!host?.recognition && host.recognition.reference.expectedRevision === d.revision;
      view.recognitionStatus = this.recognition?.status ?? "unavailable";
      view.recognitionItems = this.recognition?.candidates.map(candidate => ({
        candidateId: boundedText(candidate.candidateId, 191), fieldCode: boundedText(candidate.fieldCode, 200), status: candidate.status,
        value: candidate.status === "candidate" ? boundedText(String(candidate.value.kind === "photo" ? candidate.value.attachmentId : candidate.value.value), 4000) : "待人工核实",
        sourceLabels: candidateSources(candidate),
      })) ?? [];
      if (this.recognition) {
        view.recognitionBasisLabel = this.recognition.basis.status === 'recorded' ? '原检查依据已记录' : '原检查依据未记录，请人工核实';
        view.recognitionReviewSummary = this.recognition.reviewIssues.map(code => reviewLabels[code]).join('；');
        view.recognitionReviewIssues = this.recognition.basisIssues.map((issue, index) => ({ key: String(index),
          fieldLabel: boundedText(this.template!.fields.find(field => field.code === issue.fieldCode)?.label ?? issue.fieldCode, 200),
          message: reviewMessage(issue), recordLabel: issue.originalRecordId ? `原检查记录：${issue.originalRecordId}` : '' }));
      }
      view.revision = d.revision;
      view.items = this.template.fields.slice(0, 64).map(field => {
        const matches = d.state.candidates.filter(item => item.fieldCode === field.code);
        const candidate = matches.length === 1 ? matches[0] : undefined;
        const review = candidate ? savedCandidateReview(d, candidate.candidateId) : undefined;
        return { key: field.code, label: boundedText(field.label, 200), error: this.fieldErrors[field.code] ?? "",
          candidate: candidate?.status === "candidate" ? (candidate.value.kind === "photo" ? candidate.value.attachmentId : candidate.value.value) : null,
          candidateId: candidate?.candidateId ?? "",
          candidateActionable: candidate?.status === "candidate" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(candidate.candidateId),
          candidateCanAccept: Boolean(candidate?.status === 'candidate' && canAdoptCandidate(review)),
          reviewMessages: candidate ? savedReviewMessages(review) : [],
          decision: d.state.fields[field.code]?.decision ?? "",
          humanValue: d.state.fields[field.code]?.value ?? null,
          differenceLabel: candidateDifference(candidate, d.state.fields[field.code]),
          sourceLabels: candidate ? candidateSources(candidate) : [],
          sourceLabel: candidate?.sources.map(source => `${source.attachmentId}@${source.attachmentRevision}`).join(", ").slice(0, 200) ?? "来源不可用" };
      });
      view.missing = d.state.missingFields.slice(0, 64); view.evidence = d.state.evidence.slice(0, 100);
      const editable = !this.pending && !this.uncertain && !this.receipt && ["draft_saved", "prepared"].includes(d.status);
      view.editable = editable && typeof host?.drafts.edit === "function";
      view.canRemove = editable && typeof host?.drafts.replaceEvidence === "function";
      view.canReview = editable && typeof host?.submission?.prepareReview === "function";
      view.canSaveRecognition = editable && this.recognition?.status === "available" && !!host?.recognition?.save;
      view.canSubmit = !this.pending && !this.uncertain && !this.receipt && !d.state.reviewRequired && ["draft_saved", "prepared"].includes(d.status)
        && typeof host?.submission?.prepare === "function" && typeof host?.submission.submit === "function";
      view.canReconcile = !this.pending && ((d.status === "submission_unknown" || this.uncertain?.kind === "submission") && typeof host?.submission?.reconcile === "function"
        || (this.uncertain?.kind === "edit" || this.uncertain?.kind === "evidence") && typeof host?.drafts.reconcileOperation === "function");
    }
    if (this.uncertain?.kind === "prepare" || this.uncertain?.kind === "prepareReview") {
      view.canReconcile = !this.pending && typeof host?.submission?.reconcilePreparation === "function";
    }
    if (this.uncertain?.kind === "recognition") view.canReconcile = !this.pending && !!host?.recognition?.reconcileSave;
    if (this.uncertain?.kind === "submission") view.canReconcile = !this.pending && !!host?.submission?.reconcile;
    if (this.uncertain?.kind === "edit" || this.uncertain?.kind === "evidence") view.canReconcile = !this.pending && !!host?.drafts.reconcileOperation;
    this.display(view);
  }
  private clearMaterial() {
    this.detail = undefined; this.template = undefined; this.recognition = undefined; this.fieldErrors = {};
  }
  private async load(epoch: number) {
    this.clearMaterial();
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
    if (this.receiptHost) { await this.readReceipts(); return; }
    if (!this.active() || this.pending) return;
    const epoch = this.epoch; this.pending = true; this.clearMaterial(); this.receipt = undefined; this.recognitionSavedRevision = undefined; this.view("loading");
    let error = "";
    try { await this.load(epoch); }
    catch { error = "读取不可用，请保留原人工流程"; }
    finally { if (this.active(epoch)) { this.pending = false; this.view(this.loadedPhase(), error); } }
  }
  private loadedPhase() { return this.uncertain ? "unknown" : this.detail?.status ?? "read_failed"; }
  async readReceipts() {
    if (!this.active() || this.pending) return;
    const host = this.host, receiptHost = this.receiptHost, epoch = this.epoch, command = this.recognitionSaveCommand;
    const recognitionRead = receiptHost?.recognition?.read ?? (command && host?.recognition?.reconcileSave
      ? () => host.recognition!.reconcileSave!(command.operationId) : undefined);
    const submissionRead = receiptHost?.submission?.read ?? (host?.submission?.reconcile
      ? () => host.submission!.reconcile!({ ...host.target, draftId: host.draftId }) : undefined);
    if (!submissionRead && !(command && recognitionRead)) { this.view("receipt_unavailable", "当前没有可核对的原收据能力，请人工核对"); return; }
    this.pending = true; this.clearMaterial(); this.receipt = undefined; this.recognitionSavedRevision = undefined;
    this.view("receipt_reading");
    const errors: string[] = [];
    try {
      if (command && recognitionRead) {
        try {
          const result = await recognitionRead();
          if (!this.active(epoch)) return;
          if (!this.observeRecognitionSave(result, command)) errors.push("原识别保存尚无法确认，不要换键重做");
        } catch { errors.push("原识别保存收据不可用"); }
      }
      if (!this.active(epoch)) return;
      if (submissionRead) {
        try {
          const result = await submissionRead();
          if (!this.active(epoch)) return;
          if (this.observeReceipt(result)) {
            if (this.uncertain?.kind === "submission") this.uncertain = undefined;
          } else errors.push("未确认原检查提交，请保留原操作");
        } catch { errors.push("原检查收据不可用"); }
      }
    } finally {
      if (this.active(epoch)) { this.pending = false; this.view(this.uncertain ? "unknown"
        : this.receipt || this.recognitionSavedRevision !== undefined ? "receipt_observed" : "receipt_unconfirmed", errors.join("；")); }
    }
  }
  private observeRecognitionSave(result: AiInspectionReceiptLookup | undefined,
    command: Pick<AiInspectionDraftEditRequest, "draftId" | "operationId" | "expectedRevision">) {
    if (result?.status !== "found" || result.result.draftId !== command.draftId || result.result.status !== "draft_saved"
      || !Number.isSafeInteger(result.result.revision) || result.result.revision !== command.expectedRevision + 1) return false;
    this.recognitionSavedRevision = result.result.revision;
    return true;
  }
  async readRecognition() {
    if (!this.active() || this.pending || this.uncertain || this.receipt || !this.detail || !this.host?.recognition) return;
    const host = this.host, port = host.recognition!, epoch = this.epoch, revision = this.detail.revision;
    if (port.reference.expectedRevision !== revision || port.reference.draftId !== host.draftId || Object.entries(host.target).some(([key, expected]) =>
      port.reference[key as keyof InspectionRecognitionReference] !== expected)) {
      this.recognition = undefined; this.view(this.loadedPhase(), "原识别引用与当前检查不一致，请保留人工流程"); return;
    }
    this.clearMaterial(); this.receipt = undefined; this.recognitionSavedRevision = undefined; this.pending = true; this.view("recognition_reading");
    let error = "";
    try {
      const value = await port.read();
      if (!this.active(epoch)) return;
      await this.load(epoch);
      if (!this.active(epoch)) return;
      if (!validateInspectionWire('result-read', 'response', value)
        || this.detail?.revision !== revision || revision !== port.reference.expectedRevision
        || Object.entries(port.reference).some(([key, expected]) => value[key as keyof InspectionRecognitionObservation] !== expected)
        || value.trust !== "untrusted_candidate" || value.automaticRetry !== false || value.execution !== "not_attempted" || value.persistence !== "not_saved"
        || !["available", "unknown", "failed"].includes(value.status) || !Array.isArray(value.candidates) || value.candidates.length > 100
        || value.status !== "available" && value.candidates.length > 0
        || JSON.stringify(value).length > 128000 || value.candidates.some(candidate =>
          !candidate || typeof candidate.candidateId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(candidate.candidateId)
          || !this.template?.fields.some(field => field.code === candidate.fieldCode) || !["candidate", "missing", "blurred"].includes(candidate.status)
          || !Array.isArray(candidate.sources) || candidate.sources.length > 100
          || candidate.sources.some(source => !source || !this.detail?.state.evidence.some(ref =>
            ref.attachmentId === source.attachmentId && ref.attachmentRevision === source.attachmentRevision))
          || candidate.status === "candidate" && (!candidate.value || !["number", "boolean", "text", "select", "photo"].includes(candidate.value.kind)
            || candidate.value.kind === "number" && !Number.isFinite(candidate.value.value)
            || candidate.value.kind === "boolean" && typeof candidate.value.value !== "boolean"
            || ["text", "select"].includes(candidate.value.kind) && (typeof (candidate.value as { value?: unknown }).value !== "string"
              || String((candidate.value as { value?: unknown }).value).length > 4000)))) throw Error("recognition binding changed");
      this.recognition = JSON.parse(JSON.stringify(value));
    } catch { if (this.active(epoch)) this.clearMaterial(); error = "原识别结果不可用，请保留人工填单；不自动重新识别"; }
    finally { if (this.active(epoch)) { this.pending = false; this.view(this.loadedPhase(), error); } }
  }
  async saveRecognition() {
    if (!this.active() || this.pending || this.uncertain || this.receipt || !this.detail || !this.host?.recognition?.save
      || this.recognition?.status !== "available" || this.detail.revision !== this.recognition.expectedRevision
      || !["draft_saved", "prepared"].includes(this.detail.status)) return;
    const port = this.host.recognition, request = this.base("candidates"), epoch = this.epoch;
    this.recognitionSaveCommand = { draftId: request.draftId, operationId: request.operationId, expectedRevision: request.expectedRevision };
    // Saving candidate evidence is not human adoption or business submission.
    this.recognition = undefined;
    await this.action({ kind: "recognition", request }, async () => {
      const result = await port.save!(request.operationId) as { status?: string; result?: AiInspectionOperationResult };
      if (!this.active(epoch)) return;
      if (result?.status !== "saved" || !result.result
        || !this.observeRecognitionSave({ status: "found", result: result.result }, request)) {
        throw Error("candidate save requires reconciliation");
      }
    });
  }
  private observeReceipt(value: InspectionSubmissionObservation | undefined) {
    if (value?.status !== "submitted" || typeof value.inspectionId !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value.inspectionId)) return false;
    this.receipt = { status: "submitted", inspectionId: value.inspectionId,
      ...(typeof value.draftLinked === "boolean" ? { draftLinked: value.draftLinked } : {}) };
    return true;
  }
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
    this.recognition = undefined; this.receipt = undefined; this.recognitionSavedRevision = undefined;
    // The injected callback receives a separate object, never our recovery material.
    const original: PendingInspectionCommand = JSON.parse(JSON.stringify(command));
    this.uncertain = original; this.view("pending");
    try { await run(); if (this.active(epoch)) { await this.load(epoch);
      if (this.active(epoch) && (this.uncertain === original || this.uncertain?.kind === "submission" && this.detail?.status === "submitted")) this.uncertain = undefined; } }
    catch { if (this.active(epoch)) this.clearMaterial(); }
    finally { if (this.active(epoch)) { this.pending = false; this.view(this.uncertain ? "unknown" : this.detail?.status ?? "unavailable",
      this.uncertain ? "原操作结果待核对，勿重复提交" : ""); } }
  }
  async edit(fieldCode: string, text: string) {
    if (!this.active() || this.pending || this.uncertain || this.receipt || !this.detail || !["draft_saved", "prepared"].includes(this.detail.status) || !this.host?.drafts.edit) return;
    const field = this.template?.fields.find(item => item.code === fieldCode);
    if (!field) return;
    const invalid = () => { this.fieldErrors[fieldCode] = "值不符合当前模板，请在原人工流程核实"; this.view(this.loadedPhase()); };
    if (typeof text !== "string" || text.length > 4000 || field.type === "photo") { invalid(); return; }
    let value: string | number | boolean = text;
    if (field.type === "number") { if (!text.trim() || !Number.isFinite(Number(text)) || Number.isInteger(Number(text)) && !Number.isSafeInteger(Number(text))) { invalid(); return; } value = Number(text); }
    if (field.type === "boolean") { if (text !== "true" && text !== "false") { invalid(); return; } value = text === "true"; }
    if (field.type === "select" && !field.options?.includes(text)) { invalid(); return; }
    const epoch = this.epoch;
    try {
      const matches = this.detail.state.candidates.filter(candidate => candidate.fieldCode === fieldCode);
      const candidate = matches.length === 1 && matches[0].sources.every(source => this.detail!.state.evidence.some(ref =>
        ref.attachmentId === source.attachmentId && ref.attachmentRevision === source.attachmentRevision)) ? matches[0] : undefined;
      const request: AiInspectionDraftEditRequest = { ...this.base("edit"), bindingFingerprint: this.detail.bindingFingerprint,
        edits: [{ fieldCode, decision: candidate ? 'modified' : 'manual', value, ...(candidate ? { candidateId: candidate.candidateId } : {}) }] };
      delete this.fieldErrors[fieldCode];
      await this.action({ kind: "edit", request }, () => this.host!.drafts.edit!(request));
    } catch { if (this.active(epoch)) invalid(); }
  }
  /** An explicit human choice of the exact current candidate, never a supplied final value. */
  async decideCandidate(fieldCode: string, candidateId: string, decision: "accepted" | "rejected", revision: number) {
    if (!this.active() || this.pending || this.uncertain || this.receipt || !this.detail || !this.host?.drafts.edit
      || this.detail.revision !== revision || !["draft_saved", "prepared"].includes(this.detail.status)
      || !["accepted", "rejected"].includes(decision) || !this.template?.fields.some(field => field.code === fieldCode)) return;
    const host = this.host, epoch = this.epoch;
    const matches = this.detail.state.candidates.filter(item => item.fieldCode === fieldCode);
    const candidate = matches.length === 1 ? matches[0] : undefined;
    if (!candidate || candidate.candidateId !== candidateId || candidate.status !== "candidate"
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(candidateId)) return;
    if (decision === "accepted" && (!canAdoptCandidate(savedCandidateReview(this.detail, candidateId))
      || !candidate.sources.every(source => this.detail!.state.evidence.some(ref =>
        ref.attachmentId === source.attachmentId && ref.attachmentRevision === source.attachmentRevision)))) return;
    try {
      const request: AiInspectionDraftEditRequest = { ...this.base("edit"), bindingFingerprint: this.detail.bindingFingerprint,
        edits: [{ fieldCode, candidateId, decision }] };
      await this.action({ kind: "edit", request }, () => host.drafts.edit!(request));
    } catch { if (this.active(epoch)) this.view(this.loadedPhase(), "候选操作不可用，请保留人工填单"); }
  }
  async removeEvidence(attachmentId: string) {
    if (!this.active() || this.pending || this.uncertain || this.receipt || !this.detail || !["draft_saved", "prepared"].includes(this.detail.status) || !this.host?.drafts.replaceEvidence) return;
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
    if (!this.active() || this.pending || this.uncertain || this.receipt || !this.detail || !this.host?.submission?.prepareReview) return;
    const request = this.preparation("review");
    await this.action({ kind: "prepareReview", request }, () => this.host!.submission!.prepareReview!(request));
  }
  async submit(confirmed: boolean, generation = this.epoch, revision = this.detail?.revision) {
    if (!confirmed || !this.active(generation) || this.pending || this.uncertain || this.receipt || !this.detail || this.detail.state.reviewRequired
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
      const result = await host.submission!.submit!(submit);
      if (this.active(epoch)) this.observeReceipt(result);
    });
  }
  async reconcile() {
    if (!this.active() || this.pending || !this.host) return;
    const host = this.host, epoch = this.epoch, command = this.uncertain;
    const readingSubmission = command?.kind === "submission" || this.detail?.status === "submission_unknown";
    const available = command?.kind === "prepare" || command?.kind === "prepareReview" ? !!host.submission?.reconcilePreparation
      : command?.kind === "recognition" ? !!host.recognition?.reconcileSave
      : command?.kind === "edit" || command?.kind === "evidence" ? !!host.drafts.reconcileOperation
      : !!host.submission?.reconcile && readingSubmission;
    if (!available) return;
    this.pending = true; this.receipt = undefined; this.recognitionSavedRevision = undefined; this.clearMaterial(); this.view("reconciling");
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
      if (command?.kind === "recognition") {
        const request = command.request as { operationId: string; expectedRevision: number };
        const result = await host.recognition?.reconcileSave?.(request.operationId);
        if (!this.active(epoch) || this.uncertain !== command) return;
        const observed = this.observeRecognitionSave(result, { ...request, draftId: host.draftId });
        this.detail = undefined; this.template = undefined;
        await this.load(epoch);
        if (this.active(epoch) && this.uncertain === command && observed && result?.status === "found" && this.detail
          && this.currentDetail()!.revision >= result.result.revision) this.uncertain = undefined;
        return;
      } else if (readingSubmission) {
        const result = await host.submission?.reconcile?.({ ...host.target, draftId: host.draftId });
        if (this.active(epoch) && this.observeReceipt(result)) this.uncertain = undefined;
      } else if (command?.kind === "edit" || command?.kind === "evidence") {
        // The host cannot mutate the original recovery key/material. A found
        // receipt alone does not prove that this draft's operation completed.
        const request = command.request as { draftId: string; expectedRevision: number };
        const result = await host.drafts.reconcileOperation?.({ kind: command.kind,
          request: JSON.parse(JSON.stringify(command.request)) });
        if (!this.active(epoch) || this.uncertain !== command) return;
        await this.load(epoch);
        if (!this.active(epoch) || this.uncertain !== command) return;
        const current = this.currentDetail();
        if (result?.status === "found" && result.result.draftId === request.draftId
          && result.result.revision === request.expectedRevision + 1 && current
          && current.draftId === request.draftId && current.revision >= result.result.revision) this.uncertain = undefined;
        return;
      }
      if (this.active(epoch)) await this.load(epoch);
    } catch { error = "核对暂不可用，请保留原操作，不要重复提交"; }
    finally { if (this.active(epoch)) { this.pending = false; this.view(this.uncertain ? "unknown" : this.detail?.status ?? "unavailable", error); } }
  }
  private currentDetail(): InspectionHostDetail | undefined { return this.detail; }
}
