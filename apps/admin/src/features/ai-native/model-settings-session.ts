/** One configuration editor's lifecycle, not authorization or idempotency.
 * Persist only the original operation reference; never credentials or drafts.
 * An ambiguous save blocks further writes until its own receipt is observed. */
import type { AiLegacyModelConfigurationDraft, AiTenantModelSettingsInputDraft, AiTenantModelSettingsSummaryDraft } from "@rental-os/shared";

type Row = Record<string, unknown>;
const object = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 256): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
const revision = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 4294967295;
const key = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(v);
function invalid(): never { throw new Error("AI_SETTINGS_INVALID_RESPONSE"); }

/** Only the shared C07 display fields survive a server response. */
export function settingsSummary(value: unknown, tenantId: string): AiTenantModelSettingsSummaryDraft {
  if (!object(value) || value.draftVersion !== "ain-c07-draft-2" || value.tenantId !== tenantId || value.configId !== tenantId
    || !revision(value.configRevision) || typeof value.enabled !== "boolean"
    || !["not_tested", "mock_only", "verified_live", "failed", "not_verified"].includes(String(value.connectionState))) return invalid();
  const base = { draftVersion: "ain-c07-draft-2" as const, tenantId, configId: tenantId, configRevision: value.configRevision,
    enabled: value.enabled, connectionState: value.connectionState as AiTenantModelSettingsSummaryDraft["connectionState"] };
  if (value.mode === "platform_managed" && value.serviceName === "Rental OS AI" && value.routing === "automatic"
    && ["ready", "unavailable", "not_verified"].includes(String(value.availability)))
    return { ...base, mode: "platform_managed", serviceName: "Rental OS AI", routing: "automatic", availability: value.availability as "ready" | "unavailable" | "not_verified" };
  if (value.mode !== "tenant_managed" || value.configRevision < 1 || !text(value.protocol, 128) || !text(value.model)
    || !text(value.baseUrl, 2048) || !/^https:\/\/[^/@?#\s]+(?:\/[^?#\s]*)?$/u.test(value.baseUrl)
    || !["configured", "missing", "rotation_required"].includes(String(value.credentialState))) return invalid();
  if (value.models !== undefined && (!Array.isArray(value.models) || value.models.length < 1 || value.models.length > 20
    || new Set(value.models).size !== value.models.length || !value.models.includes(value.model)
    || value.models.some(model => typeof model !== 'string' || !/^[\w./:-]{1,256}$/u.test(model)))) return invalid();
  return { ...base, mode: "tenant_managed", protocol: value.protocol, model: value.model, baseUrl: value.baseUrl,
    ...(Array.isArray(value.models) ? { models: [...value.models] as string[] } : {}),
    credentialState: value.credentialState as "configured" | "missing" | "rotation_required" };
}

function legacySummary(value: unknown): AiLegacyModelConfigurationDraft {
  if (!object(value) || !["present", "absent"].includes(String(value.currentConfiguration)) || value.automaticImport !== false
    || value.sourcePreserved !== true || value.execution !== "not_granted") return invalid();
  const base = { currentConfiguration: value.currentConfiguration as "present" | "absent", automaticImport: false as const,
    sourcePreserved: true as const, execution: "not_granted" as const };
  if (value.state === "not_recorded" && value.source === null) return { ...base, state: "not_recorded", source: null };
  if (value.state !== "review_required" || !object(value.source) || !text(value.source.parameterSetId, 128)
    || !revision(value.source.versionNo) || value.source.versionNo < 1 || typeof value.source.fingerprint !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.source.fingerprint) || value.supportedProtocol !== null && value.supportedProtocol !== "openai_chat_completions"
    || value.credential !== "replacement_required" || value.conversion !== "explicit_disabled_replacement_only") return invalid();
  return { ...base, state: "review_required", source: { parameterSetId: value.source.parameterSetId,
    versionNo: value.source.versionNo, fingerprint: value.source.fingerprint }, supportedProtocol: value.supportedProtocol as "openai_chat_completions" | null,
    credential: "replacement_required", conversion: "explicit_disabled_replacement_only" };
}

type Pending = { operationKey: string; expectedRevision: number; mode: "tenant_managed" | "platform_managed" };
export type SettingsFeedback = "idle" | "saved" | "recorded" | "unknown" | "conflict" | "denied" | "unavailable" | "invalid";
export type ModelSettingsState = Readonly<{ busy: boolean; summary: AiTenantModelSettingsSummaryDraft | null;
  legacy: AiLegacyModelConfigurationDraft | null; pending: Pending | null; feedback: SettingsFeedback }>;
type Ports = { read(): Promise<unknown>; legacy(): Promise<unknown>; save(input: AiTenantModelSettingsInputDraft): Promise<unknown>;
  operation(key: string): Promise<unknown> };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export class ModelSettingsSession {
  private state: ModelSettingsState;
  private generation = 0;
  private active = true;
  private listeners = new Set<() => void>();
  constructor(private readonly tenantId: string, private readonly ports: Ports, private readonly current: () => boolean,
    private readonly operationKey: () => string, private readonly storage?: Storage, private readonly storageKey = "") {
    let pending: Pending | null = null;
    try {
      const value: unknown = JSON.parse(storage?.getItem(storageKey) ?? "null");
      if (object(value) && Object.keys(value).length === 3 && key(value.operationKey) && revision(value.expectedRevision)
        && value.expectedRevision < 4294967295 && ["platform_managed", "tenant_managed"].includes(String(value.mode)))
        pending = { operationKey: value.operationKey, expectedRevision: value.expectedRevision, mode: value.mode as Pending["mode"] };
    } catch { /* Missing storage is not an execution fallback. */ }
    this.state = { busy: false, summary: null, legacy: null, pending, feedback: pending ? "unknown" : "idle" };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  activate() { if (!this.active) { this.active = true; this.update({ busy: false }); } }
  dispose() { this.active = false; this.generation += 1; }
  private valid(generation = this.generation) { return this.active && this.current() && generation === this.generation; }
  private update(next: Partial<ModelSettingsState>) {
    if (!this.valid()) return;
    this.state = Object.freeze({ ...this.state, ...next });
    for (const listener of this.listeners) listener();
  }
  private remember(pending: Pending | null) {
    // Failure to persist the reference must not cause a second save or lose the
    // in-memory unknown. The page also displays the key for manual recovery.
    try { if (pending) this.storage?.setItem(this.storageKey, JSON.stringify(pending)); else this.storage?.removeItem(this.storageKey); } catch { /* memory retained */ }
  }
  async load() {
    if (!this.valid() || this.state.busy) return;
    const generation = this.generation;
    this.update({ busy: true, summary: null, legacy: null });
    try {
      // Legacy must be read independently: a legacy row can deliberately make
      // the current read unavailable, but still requires an explicit review.
      const legacy = legacySummary(await this.ports.legacy());
      if (!this.valid(generation)) return;
      this.update({ legacy });
      if (legacy.currentConfiguration === "absent" && legacy.state === "review_required") return;
      const summary = settingsSummary(await this.ports.read(), this.tenantId);
      if (this.valid(generation)) this.update({ summary });
    } catch (error) { if (this.valid(generation)) this.update({ feedback: this.classify(error, false), summary: null, legacy: null }); }
    finally { if (this.valid(generation)) this.update({ busy: false }); }
  }
  private classify(error: unknown, write: boolean): SettingsFeedback {
    const response = object(error) && object(error.response) ? error.response : null;
    const code = response && object(response.data) ? response.data.code : undefined;
    if (response?.status === 403 || response?.status === 401) return "denied";
    if (code === "AI_REVISION_CONFLICT") return "conflict";
    if (response?.status === 400 && code === "AI_INVALID_INPUT") return "invalid";
    return write ? "unknown" : "unavailable";
  }
  async save(value: AiTenantModelSettingsInputDraft) {
    if (!this.valid() || this.state.busy || this.state.pending) throw new Error("AI_SETTINGS_BLOCKED");
    const command = structuredClone(value), previous = this.state.summary;
    const legacy = this.state.legacy;
    const explicitLegacy = !previous && legacy?.state === "review_required" && legacy.currentConfiguration === "absent";
    if (command.configId !== this.tenantId || command.expectedRevision !== (previous?.configRevision ?? 0)
      || !previous && !explicitLegacy || command.operationKey !== undefined) throw new Error("AI_SETTINGS_BLOCKED");
    if (explicitLegacy && (command.mode !== "tenant_managed" || command.enabled || command.secretChange.operation !== "replace"
      || JSON.stringify(command.legacySource) !== JSON.stringify(legacy.source))) throw new Error("AI_SETTINGS_BLOCKED");
    const operationKey = this.operationKey();
    if (!key(operationKey)) throw new Error("AI_SETTINGS_BLOCKED");
    command.operationKey = operationKey;
    const pending: Pending = { operationKey, expectedRevision: command.expectedRevision, mode: command.mode };
    const generation = this.generation;
    this.remember(pending);
    this.update({ busy: true, pending, feedback: "idle" });
    try {
      const summary = settingsSummary(await this.ports.save(command), this.tenantId);
      if (!this.valid(generation)) return;
      const enabled = command.mode === "tenant_managed" && command.secretChange.operation === "clear" ? false : command.enabled;
      if (summary.configRevision !== pending.expectedRevision + 1 || summary.mode !== pending.mode || summary.enabled !== enabled) return invalid();
      this.remember(null);
      this.update({ summary, pending: null, feedback: "saved", legacy: null });
    } catch (error) {
      if (!this.valid(generation)) return;
      const feedback = this.classify(error, true);
      if (feedback !== "unknown") this.remember(null);
      this.update({ feedback, pending: feedback === "unknown" ? pending : null,
        ...(feedback === "denied" || feedback === "conflict" ? { summary: null, legacy: null } : {}) });
      throw new Error("AI_SETTINGS_SAVE_NOT_CONFIRMED");
    } finally { if (this.valid(generation)) this.update({ busy: false }); }
  }
  async reconcile() {
    const pending = this.state.pending;
    if (!this.valid() || this.state.busy || !pending) return;
    const generation = this.generation;
    this.update({ busy: true });
    try {
      const row = await this.ports.operation(pending.operationKey);
      if (!this.valid(generation)) return;
      if (!object(row) || row.operationKey !== pending.operationKey || row.automaticRetry !== false
        || row.execution !== "not_granted" || row.observation !== "original_configuration_save") return invalid();
      if (row.state === "unknown" && row.result === null) { this.update({ feedback: "unknown" }); return; }
      const summary = settingsSummary(row.result, this.tenantId);
      if (row.state !== "recorded" || row.expectedRevision !== pending.expectedRevision || row.resultRevision !== pending.expectedRevision + 1
        || summary.configRevision !== row.resultRevision || summary.mode !== pending.mode || !text(row.recordedAt, 40)
        || !Number.isFinite(Date.parse(row.recordedAt))) return invalid();
      // This is historical acknowledgement, NOT the current configuration.
      this.remember(null);
      this.update({ pending: null, summary: null, legacy: null, feedback: "recorded" });
    } catch (error) { if (this.valid(generation)) this.update({ feedback: this.classify(error, false), summary: null, legacy: null }); }
    finally { if (this.valid(generation)) this.update({ busy: false }); }
  }
}
