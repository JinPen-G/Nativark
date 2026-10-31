/** Platform Profile management journal. Current observations and original save
 * receipts are separate. Never stores a key, grants dispatch or probes a host. */
import type { AiPlatformModelSettingsInputDraft, AiPlatformModelSettingsSummaryDraft } from "@rental-os/shared";
import { readSettingsReference, retainSettingsReference, clearSettingsReference } from './settings-operation-reference';
type Row = Record<string, unknown>;
const row = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const rev = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 4294967295;
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
export const PLATFORM_MODEL_CAPABILITIES = ["text", "streaming", "tools", "structured_output", "vision", "audio", "embedding", "reasoning"] as const;
function invalid(): never { throw Error("AI_SETTINGS_INVALID_RESPONSE"); }
function saved(v: unknown, profileId: string) {
  if (!row(v) || v.profileId !== profileId || !rev(v.revision) || typeof v.enabled !== "boolean" || typeof v.credentialConfigured !== "boolean") return invalid();
  return { profileId, revision: v.revision, enabled: v.enabled, credentialConfigured: v.credentialConfigured };
}
function summary(v: unknown, profileId: string): AiPlatformModelSettingsSummaryDraft {
  const base = saved(v, profileId);
  if (!row(v) || v.mode !== "platform_managed" || !text(v.protocol, 128) || !text(v.model, 256)
    || !Array.isArray(v.allowedCapabilities) || v.allowedCapabilities.length > 8 || new Set(v.allowedCapabilities).size !== v.allowedCapabilities.length
    || v.allowedCapabilities.some(c => !PLATFORM_MODEL_CAPABILITIES.includes(c))
    || v.verification !== "not_assessed_by_configuration_read" || v.observation !== "current_configuration_not_write_receipt"
    || v.baseUrl !== undefined && (!text(v.baseUrl, 2048) || !/^https:\/\/[^/@?#\s]+(?:\/[^?#\s]*)?$/u.test(v.baseUrl))
    || v.maxOutputTokens !== undefined && (typeof v.maxOutputTokens !== "number" || !Number.isInteger(v.maxOutputTokens) || v.maxOutputTokens < 1 || v.maxOutputTokens > 32768)) return invalid();
  return { ...base, mode: "platform_managed", protocol: v.protocol, model: v.model,
    allowedCapabilities: [...v.allowedCapabilities] as AiPlatformModelSettingsSummaryDraft["allowedCapabilities"],
    ...(v.baseUrl === undefined ? {} : { baseUrl: v.baseUrl as string }), ...(v.maxOutputTokens === undefined ? {} : { maxOutputTokens: v.maxOutputTokens as number }),
    verification: "not_assessed_by_configuration_read", observation: "current_configuration_not_write_receipt" };
}
type Pending = { operationKey: string; expectedRevision: number };
type Ports = { read(id: string): Promise<unknown>; save(id: string, input: AiPlatformModelSettingsInputDraft): Promise<unknown>; operation(id: string, key: string): Promise<unknown> };
export class PlatformModelSettingsSession {
  private state: Readonly<{ busy: boolean; summary: AiPlatformModelSettingsSummaryDraft | null; creating: boolean; pending: Pending | null;
    feedback: "idle" | "saved" | "recorded" | "unknown" | "conflict" | "denied" | "invalid" | "unavailable" | "reference_unavailable" }>;
  private generation = 0;
  private active = true;
  private referenceBlocked = false;
  private listeners = new Set<() => void>();
  constructor(private readonly id: string, private readonly ports: Ports, private readonly current: () => boolean,
    private readonly canManage: () => boolean, private readonly newKey: () => string,
    private readonly storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">, private readonly storageKey = "") {
    if (!/^[A-Za-z0-9][\w.:-]{0,35}$/u.test(id)) throw Error("AI_INVALID_INPUT");
    const reference = readSettingsReference<Pending>(storage, storageKey, v => row(v) && Object.keys(v).length === 2
      && typeof v.operationKey === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(v.operationKey)
      && typeof v.expectedRevision === 'number' && Number.isInteger(v.expectedRevision) && v.expectedRevision >= 0 && v.expectedRevision < 4294967295
      ? { operationKey: v.operationKey, expectedRevision: v.expectedRevision } : null);
    this.referenceBlocked = reference.blocked;
    this.state = { busy: false, summary: null, creating: false, pending: reference.pending,
      feedback: reference.blocked ? 'reference_unavailable' : reference.pending ? 'unknown' : 'idle' };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  activate() { if (!this.active) { this.active = true; this.update({ busy: false }); } }
  dispose() { this.active = false; this.generation++; }
  private valid(g = this.generation) { return this.active && g === this.generation && this.current(); }
  private update(next: Partial<typeof this.state>) { if (this.valid()) { this.state = Object.freeze({ ...this.state, ...next, ...(this.referenceBlocked ? { feedback: 'reference_unavailable' as const } : {}) }); for (const f of this.listeners) f(); } }
  private remember(p: Pending | null) {
    if (p) retainSettingsReference(this.storage, this.storageKey, p);
    else {
      if (!this.state.pending) throw Error('AI_SETTINGS_REFERENCE_UNAVAILABLE');
      clearSettingsReference(this.storage, this.storageKey, this.state.pending);
    }
  }
  private classify(error: unknown, write: boolean): typeof this.state.feedback {
    const r = row(error) && row(error.response) ? error.response : null, code = r && row(r.data) ? r.data.code : undefined;
    if (r?.status === 401 || r?.status === 403) return "denied";
    if (code === "AI_REVISION_CONFLICT") return "conflict";
    if (r?.status === 400 && code === "AI_INVALID_INPUT") return "invalid";
    return write ? "unknown" : "unavailable";
  }
  prepareInitial() {
    if (!this.valid() || !this.canManage() || this.state.busy || this.state.pending || this.referenceBlocked || this.state.summary) throw Error("AI_SETTINGS_BLOCKED");
    // An explicit request to CAS revision zero, not an inference that a failed
    // read proved absence. Existing profiles must still reject server-side.
    this.update({ creating: true, feedback: "idle" });
  }
  async load() {
    if (!this.valid() || this.state.busy) return;
    const g = this.generation;
    this.update({ busy: true, summary: null, creating: false });
    try { const result = summary(await this.ports.read(this.id), this.id); if (this.valid(g)) this.update({ summary: result }); }
    catch (e) { if (this.valid(g)) this.update({ feedback: this.classify(e, false) }); }
    finally { if (this.valid(g)) this.update({ busy: false }); }
  }
  async save(value: AiPlatformModelSettingsInputDraft) {
    if (!this.valid() || !this.canManage() || this.state.busy || this.state.pending || this.referenceBlocked || !this.state.summary && !this.state.creating) throw Error("AI_SETTINGS_BLOCKED");
    const input = structuredClone(value), expected = this.state.summary?.revision ?? 0, operationKey = this.newKey();
    if (input.operationKey !== undefined || input.expectedRevision !== expected || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(operationKey)
      || expected === 0 && (input.enabled || input.secretChange.operation !== "replace")) throw Error("AI_SETTINGS_BLOCKED");
    input.operationKey = operationKey;
    const pending = { operationKey, expectedRevision: expected }, g = this.generation;
    try { this.remember(pending); }
    catch { this.referenceBlocked = true; this.update({ feedback: 'reference_unavailable' }); throw Error('AI_SETTINGS_REFERENCE_UNAVAILABLE'); }
    if (!this.valid(g)) return;
    this.update({ busy: true, pending });
    try {
      const result = saved(await this.ports.save(this.id, input), this.id);
      if (!this.valid(g)) return;
      if (result.revision !== expected + 1 || result.enabled !== (input.secretChange.operation === "clear" ? false : input.enabled)) return invalid();
      this.remember(null); this.update({ pending: null, summary: null, creating: false, feedback: "saved" });
    } catch (e) {
      if (!this.valid(g)) return;
      const feedback = this.classify(e, true);
      let retained = feedback === 'unknown';
      if (!retained) { try { this.remember(null); } catch { retained = true; } }
      this.update({ feedback: retained ? 'unknown' : feedback, pending: retained ? pending : null,
        ...(feedback === "denied" || feedback === "conflict" ? { summary: null, creating: false } : {}) });
      throw Error("AI_SETTINGS_SAVE_NOT_CONFIRMED");
    } finally { if (this.valid(g)) this.update({ busy: false }); }
  }
  async reconcile() {
    const pending = this.state.pending, g = this.generation;
    if (!this.valid() || this.state.busy || !pending) return;
    this.update({ busy: true });
    try {
      const result = await this.ports.operation(this.id, pending.operationKey);
      if (!this.valid(g)) return;
      if (!row(result) || result.operationKey !== pending.operationKey || result.automaticRetry !== false || result.execution !== "not_granted"
        || result.observation !== "original_configuration_save") return invalid();
      if (result.state === "unknown" && result.result === null) { this.update({ feedback: "unknown" }); return; }
      const acknowledged = saved(result.result, this.id);
      if (result.state !== "recorded" || result.expectedRevision !== pending.expectedRevision || result.resultRevision !== pending.expectedRevision + 1
        || acknowledged.revision !== result.resultRevision || !text(result.recordedAt, 40) || !Number.isFinite(Date.parse(result.recordedAt))) return invalid();
      this.remember(null); this.update({ pending: null, summary: null, creating: false, feedback: "recorded" });
    } catch (e) { if (this.valid(g)) this.update({ feedback: this.classify(e, false), summary: null, creating: false }); }
    finally { if (this.valid(g)) this.update({ busy: false }); }
  }
}
