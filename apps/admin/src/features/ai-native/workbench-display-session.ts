/** One visible display lease and opaque-frame channel. Reopening reads original
 * material only; candidates stay unsubmitted and approvals use the original UI.
 * No code/storage cache, model call, task restart or business operation here. */
import { AI_WORKBENCH_CONTEXT_DRAFT_VERSION, AI_WORKBENCH_DISPLAY_DRAFT_VERSION, AI_WORKBENCH_DISPLAY_LIMITS,
  type AiApprovalApplicationReferenceDraft, type AiWorkbenchHostDraft, type AiWorkbenchMountBindingDraft } from '@rental-os/shared';
import { buildWorkbenchFrameDocument } from './workbench-display-frame';
import { displayLease, displayMaterialBinding, displayPartialAnswers, displaySame, displayUnavailable, inspectWorkbenchDisplay, inspectWorkbenchFrameMessage,
  type WorkbenchDisplayExpectation, type WorkbenchDisplayLease, type WorkbenchDisplayMaterial, type WorkbenchDisplayPort,
  type WorkbenchDisplaySource } from './workbench-display-host';

export interface WorkbenchDisplayState {
  phase: 'idle' | 'loading' | 'ready' | 'rendered' | 'unavailable'; busy: boolean;
  frame: { document: string; binding: AiWorkbenchMountBindingDraft; runId: string; resultId: string;
    summary: NonNullable<WorkbenchDisplayMaterial['authoritativeSummary']> } | null;
  candidate: AiWorkbenchHostDraft | null; sourceId: string | null;
  candidateConflict: boolean;
  source: WorkbenchDisplaySource | null; confirmation: AiApprovalApplicationReferenceDraft | null;
  reason: 'unavailable' | 'invalid_code' | 'resource_limit' | 'unsupported' | 'revoked' | null;
}
const initial = (): WorkbenchDisplayState => ({ phase: 'idle', busy: false, frame: null, candidate: null,
  candidateConflict: false, sourceId: null, source: null, confirmation: null, reason: null });

export class WorkbenchDisplaySession {
  private state = initial();
  private readonly listeners = new Set<() => void>();
  private active = false;
  private generation = 0;
  private material: WorkbenchDisplayMaterial | null = null;
  private lease: WorkbenchDisplayLease | null = null;
  private candidateLease: WorkbenchDisplayLease | null = null;
  private candidateScope: Pick<WorkbenchDisplayExpectation, 'taskId' | 'tenantId' | 'workspaceId'> | null = null;
  private request: AbortController | null = null;
  private frame: HTMLIFrameElement | null = null;
  private channel: MessageChannel | null = null;
  private windowListener: ((event: MessageEvent) => void) | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private checks = 0;
  private sequence = 0;
  private rate = { started: 0, count: 0 };
  constructor(private readonly expected: WorkbenchDisplayExpectation | (() => WorkbenchDisplayExpectation), private readonly port: WorkbenchDisplayPort,
    private readonly current: () => boolean, private readonly at: () => number = Date.now) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  activate() { this.active = true; }
  dispose() { this.active = false; this.retract(); }
  private expectation() { return typeof this.expected === 'function' ? this.expected() : this.expected; }
  private live(generation = this.generation) {
    const expected = this.expectation(), source = this.material?.presentation.generation;
    return this.active && generation === this.generation && this.current()
      && (!source || (expected.runId === undefined || source.runId === expected.runId)
        && (expected.resultId === undefined || source.resultId === expected.resultId))
      && (!this.lease || Date.parse(this.lease.expiresAt) > this.at());
  }
  private update(next: Partial<WorkbenchDisplayState>) { this.state = { ...this.state, ...next }; this.listeners.forEach(listener => listener()); }
  private disconnect() {
    if (this.windowListener && this.frame?.ownerDocument.defaultView) this.frame.ownerDocument.defaultView.removeEventListener('message', this.windowListener);
    this.windowListener = null; this.channel?.port1.close(); this.channel?.port2.close(); this.channel = null;
    // Withdraw the document immediately; React removes the frame on its next
    // commit, but revoked content must not wait for that render to clear.
    this.frame?.removeAttribute?.('srcdoc'); this.frame = null;
    if (this.deadline) clearTimeout(this.deadline); if (this.checkTimer) clearTimeout(this.checkTimer);
    this.deadline = this.checkTimer = null;
  }
  private retainedCandidate() {
    const expected = this.expectation(), scope = this.candidateScope, candidate = this.state.candidate, lease = this.candidateLease;
    return this.active && this.current() && candidate && lease && scope
      && scope.taskId === expected.taskId && scope.tenantId === expected.tenantId && scope.workspaceId === expected.workspaceId
      && Date.parse(lease.expiresAt) > this.at() && candidate.fieldRevision === lease.fieldRevision
      && displaySame(candidate.binding, displayMaterialBinding(lease.binding)) ? candidate : null;
  }
  private expire() {
    if (this.expiry) clearTimeout(this.expiry); this.expiry = null;
    const deadlines = [this.lease?.expiresAt, this.state.candidate ? this.candidateLease?.expiresAt : undefined]
      .filter((value): value is string => value !== undefined).map(Date.parse);
    if (!deadlines.length) return;
    this.expiry = setTimeout(() => {
      this.expiry = null;
      if (!this.active || !this.current() || this.lease && Date.parse(this.lease.expiresAt) <= this.at()) { this.retract('revoked'); return; }
      if (this.state.candidate && !this.retainedCandidate()) {
        this.candidateLease = null; this.candidateScope = null; this.update({ candidate: null, candidateConflict: false });
      }
      this.expire();
    }, Math.max(0, Math.min(2147483647, Math.min(...deadlines) - this.at())));
  }
  private recoverableRead(error: unknown) {
    const value = error as { code?: unknown; response?: { status?: unknown; data?: { code?: unknown } } } | null;
    // Validation also uses AI_RESOURCE_UNAVAILABLE. Only a recognizable HTTP
    // refusal or transport timeout can retain a draft under its original lease.
    return !value?.response && (value?.code === 'ECONNABORTED' || value?.code === 'ETIMEDOUT')
      || value?.response?.data?.code === 'AI_RESOURCE_UNAVAILABLE' && value.response.status === 404;
  }
  retract(reason: WorkbenchDisplayState['reason'] = null, preserveDraft = false) {
    const candidate = preserveDraft ? this.retainedCandidate() : null;
    this.generation++; this.request?.abort(); this.request = null; this.disconnect(); this.material = null; this.lease = null;
    if (!candidate) { this.candidateLease = null; this.candidateScope = null; }
    this.state = { ...initial(), candidate, candidateConflict: !!candidate,
      ...(reason ? { phase: 'unavailable' as const, reason } : {}) }; this.listeners.forEach(listener => listener());
    this.expire();
  }
  /** A new reply or presentation read destroys the old frame, while a still
   * authorized candidate waits for the new original field material to validate. */
  suspend() { this.retract(null, true); }
  async read() {
    if (!this.live() || this.request || typeof this.port?.read !== 'function' || typeof this.port?.revalidate !== 'function') throw displayUnavailable();
    this.suspend();
    const previous = this.state.candidate, previousLease = this.candidateLease;
    const generation = this.generation, abort = new AbortController(); this.request = abort;
    const timeout = setTimeout(() => { abort.abort(); if (generation === this.generation) this.retract('unavailable', true); }, 5000);
    this.update({ phase: 'loading', busy: true, frame: null, source: null, sourceId: null, confirmation: null, reason: null });
    try {
      const expected = structuredClone(this.expectation());
      const material = await inspectWorkbenchDisplay(await this.port.read(expected.taskId, abort.signal), expected, this.at());
      if (!this.live(generation) || abort.signal.aborted) return;
      // Isolated code cannot supply its own money/status authority. Without
      // an exact original summary, leave the existing safe text/manual entry.
      if (!material.authoritativeSummary) throw displayUnavailable();
      this.material = material; this.lease = displayLease(material); this.checks = 0; this.sequence = 0; this.rate = { started: this.at(), count: 0 };
      const candidate = previous && this.retainedCandidate() === previous && previousLease && material.fieldMaterial
        && material.context.binding.conversationId === previous.binding.conversationId
        && material.context.binding.turnId === previous.binding.turnId
        && material.context.binding.capabilityCode === previous.binding.capabilityCode
        && material.context.binding.capabilityVersion === previous.binding.capabilityVersion
        && displaySame(material.context.binding.original, previous.binding.original)
        && this.lease.aclRevision === previousLease.aclRevision && this.lease.policyVersion === previousLease.policyVersion
        && displayPartialAnswers(material.fieldMaterial, previous.answers) ? previous : null;
      if (!candidate) { this.candidateLease = null; this.candidateScope = null; }
      const candidateConflict = !!candidate && (!displaySame(candidate.binding, material.context.binding)
        || candidate.fieldRevision !== material.fieldMaterial?.fieldRevision);
      const binding: AiWorkbenchMountBindingDraft = { ...material.presentation.binding,
        instanceId: crypto.randomUUID(), channelId: crypto.randomUUID() };
      const nonce = crypto.randomUUID().replace(/-/gu, '');
      const rootStyle = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(document.documentElement) : null;
      const doc = buildWorkbenchFrameDocument(material, binding, nonce, window.location.origin, candidateConflict ? [] : candidate?.answers,
        rootStyle ? { color: rootStyle.color, background: rootStyle.backgroundColor, fontFamily: rootStyle.fontFamily, colorScheme: rootStyle.colorScheme } : {});
      this.update({ phase: 'ready', frame: { document: doc, binding, runId: material.presentation.generation.runId,
        resultId: material.presentation.generation.resultId, summary: structuredClone(material.authoritativeSummary) }, candidate, candidateConflict });
      this.expire();
    } catch (error) { if (generation === this.generation && !abort.signal.aborted) this.retract('unavailable', this.recoverableRead(error)); }
    finally { clearTimeout(timeout); if (this.request === abort) this.request = null; if (generation === this.generation) this.update({ busy: false }); }
  }

  /** The ready window is checked before transferring a private port. Later
   * messages must arrive on that exact live connection and next sequence. */
  attach(frame: HTMLIFrameElement | null) {
    if (!frame) { this.disconnect(); return; }
    const model = this.state.frame, material = this.material, generation = this.generation;
    if (!model || !material || !this.live() || frame.getAttribute('sandbox') !== 'allow-scripts'
      || !frame.ownerDocument.defaultView || typeof MessageChannel !== 'function') { this.retract('unsupported', true); return; }
    this.frame = frame;
    const ownerWindow = frame.ownerDocument.defaultView;
    const accept = (data: unknown) => {
      if (!this.live(generation) || this.frame !== frame || this.state.frame !== model) throw displayUnavailable();
      const now = this.at(); if (now - this.rate.started >= 60000) this.rate = { started: now, count: 0 };
      if (++this.rate.count > AI_WORKBENCH_DISPLAY_LIMITS.messagesPerMinute) throw displayUnavailable();
      const message = inspectWorkbenchFrameMessage(data, model.binding, this.sequence, material); this.sequence = message.sequence;
      return message;
    };
    this.windowListener = event => {
      if (event.source !== frame.contentWindow || generation !== this.generation || this.frame !== frame || this.state.frame !== model) return;
      if (!this.live(generation)) { this.retract('revoked', this.active && this.current()); return; }
      try {
        if (event.origin !== 'null' || this.channel) throw displayUnavailable();
        const message = accept(event.data); if (message.kind !== 'ready') throw displayUnavailable();
        const channel = new MessageChannel(); this.channel = channel;
        channel.port1.onmessage = event => {
          if (generation !== this.generation || this.channel !== channel || this.frame !== frame || this.state.frame !== model) return;
          if (!this.live(generation)) { this.retract('revoked', this.active && this.current()); return; }
          try {
            const message = accept(event.data);
            if (message.kind === 'rendered') {
              if (this.state.phase !== 'ready') throw displayUnavailable();
              if (this.deadline) clearTimeout(this.deadline); this.deadline = null;
              this.update({ phase: 'rendered' }); this.scheduleCheck(generation);
            } else if (message.kind === 'render_failed') this.retract(message.reason, true);
            else if (message.kind === 'candidate_input') {
              if (this.state.phase !== 'rendered' || !material.fieldMaterial) throw displayUnavailable();
              const old = this.state.candidate;
              if (this.state.candidateConflict) return;
              this.candidateLease = this.lease ? structuredClone(this.lease) : null;
              const { taskId, tenantId, workspaceId } = this.expectation(); this.candidateScope = { taskId, tenantId, workspaceId };
              this.update({ candidateConflict: false, candidate: { draftVersion: AI_WORKBENCH_CONTEXT_DRAFT_VERSION, binding: displayMaterialBinding(model.binding),
                fieldRevision: message.fieldRevision, draftId: old?.draftId ?? crypto.randomUUID(), revision: (old?.revision ?? 0) + 1,
                answers: message.answers, inputOrigin: { kind: 'candidate', humanChoice: 'not_attested' },
                status: 'unsubmitted', preparation: 'not_attempted', approval: 'not_granted' }, source: null });
            } else if (message.kind === 'request_source') {
              if (this.state.phase !== 'rendered') throw displayUnavailable(); this.update({ sourceId: message.sourceId, source: null });
            } else if (message.kind === 'request_confirmation') {
              if (this.state.phase !== 'rendered') throw displayUnavailable(); this.update({ confirmation: message.proposal });
            } else throw displayUnavailable();
          } catch { this.retract('invalid_code'); }
        };
        channel.port1.start();
        frame.contentWindow!.postMessage({ kind: 'workbench_bind_port', draftVersion: AI_WORKBENCH_DISPLAY_DRAFT_VERSION,
          binding: model.binding }, '*', [channel.port2]);
        ownerWindow.removeEventListener('message', this.windowListener!); this.windowListener = null;
      } catch { this.retract('invalid_code'); }
    };
    ownerWindow.addEventListener('message', this.windowListener);
    this.deadline = setTimeout(() => this.retract('resource_limit', true), AI_WORKBENCH_DISPLAY_LIMITS.renderMs);
  }

  private async checkCurrent(signal: AbortSignal, generation: number) {
    if (!this.live(generation) || !this.lease) throw displayUnavailable();
    const previous = structuredClone(this.lease), next = await this.port.revalidate(previous, signal);
    if (!signal.aborted && this.live(generation) && next && next.aclRevision === previous.aclRevision
      && next.policyVersion === previous.policyVersion && next.binding?.taskId === previous.binding.taskId
      && next.binding.conversationId === previous.binding.conversationId && next.binding.turnId === previous.binding.turnId
      && displaySame(next.binding.original, previous.binding.original)
      && (!displaySame(next.binding, previous.binding) || next.fieldRevision !== previous.fieldRevision)) {
      this.suspend(); throw displayUnavailable();
    }
    if (signal.aborted || !this.live(generation) || !next || Object.keys(next).length !== 5
      || !displaySame(next.binding, previous.binding) || next.fieldRevision !== previous.fieldRevision
      || next.aclRevision !== previous.aclRevision || next.policyVersion !== previous.policyVersion
      || !Number.isFinite(Date.parse(next.expiresAt)) || Date.parse(next.expiresAt) <= this.at()
      || Date.parse(next.expiresAt) > Date.parse(previous.expiresAt)) throw displayUnavailable();
    if (next.expiresAt !== previous.expiresAt) {
      this.lease = structuredClone(next);
      if (this.candidateLease && displaySame(this.candidateLease.binding, previous.binding)
        && this.candidateLease.fieldRevision === previous.fieldRevision) this.candidateLease.expiresAt = new Date(Math.min(
          Date.parse(this.candidateLease.expiresAt), Date.parse(next.expiresAt))).toISOString();
      this.expire();
    }
  }
  private scheduleCheck(generation: number) {
    this.checkTimer = setTimeout(async () => {
      if (!this.live(generation)) { this.retract('revoked'); return; }
      if (++this.checks > 20) { this.retract('resource_limit', true); return; }
      if (this.request) { this.scheduleCheck(generation); return; }
      const abort = new AbortController(); this.request = abort;
      const timeout = setTimeout(() => { abort.abort(); if (generation === this.generation) this.retract('unavailable', true); }, 5000);
      try { await this.checkCurrent(abort.signal, generation); if (this.live(generation)) this.scheduleCheck(generation); }
      catch (error) { if (generation === this.generation) { const preserve = this.recoverableRead(error); this.retract(preserve ? 'unavailable' : 'revoked', preserve); } }
      finally { clearTimeout(timeout); if (this.request === abort) this.request = null; }
    }, 15000);
  }
  private async action(consume: (signal: AbortSignal) => Promise<void>) {
    if (!this.live() || this.request || !this.material || this.state.phase !== 'rendered') throw displayUnavailable();
    const generation = this.generation, abort = new AbortController(); this.request = abort; this.update({ busy: true, source: null });
    const timeout = setTimeout(() => { abort.abort(); if (generation === this.generation) this.retract('unavailable', true); }, 5000);
    try { await this.checkCurrent(abort.signal, generation); if (this.live(generation)) await consume(abort.signal); }
    catch (error) { if (generation === this.generation) { const preserve = this.recoverableRead(error); this.retract(preserve ? 'unavailable' : 'revoked', preserve); } }
    finally { clearTimeout(timeout); if (this.request === abort) this.request = null; if (generation === this.generation) this.update({ busy: false }); }
  }
  reviewCandidate() {
    const candidate = this.state.candidate;
    if (!candidate || this.state.candidateConflict || !this.port.reviewCandidate || this.retainedCandidate() !== candidate) throw displayUnavailable();
    return this.action(signal => {
      if (this.state.candidate !== candidate || this.state.candidateConflict || this.retainedCandidate() !== candidate) throw displayUnavailable();
      return this.port.reviewCandidate!(structuredClone(candidate), signal);
    });
  }
  discardCandidate() {
    if (!this.live() || this.request) throw displayUnavailable();
    this.candidateLease = null; this.candidateScope = null;
    this.update({ candidate: null, candidateConflict: false });
    this.expire();
  }
  openConfirmation() {
    const reference = this.state.confirmation, binding = this.lease?.binding;
    if (!reference || !binding || !this.port.openConfirmation) throw displayUnavailable();
    return this.action(signal => this.port.openConfirmation!(structuredClone(binding), structuredClone(reference), signal));
  }
  openSource() {
    const sourceId = this.state.sourceId, binding = this.lease?.binding, generation = this.generation;
    if (!sourceId || !binding || !this.port.readSource) throw displayUnavailable();
    return this.action(async signal => {
      const source = await this.port.readSource!(structuredClone(binding), sourceId, signal);
      if (!this.live(generation) || signal.aborted) return;
      if (!source || source.trust !== 'source_data_not_instructions' || typeof source.text !== 'string'
        || new TextEncoder().encode(source.text).byteLength > 65536) throw displayUnavailable();
      this.update({ source: structuredClone(source) });
    });
  }
}
