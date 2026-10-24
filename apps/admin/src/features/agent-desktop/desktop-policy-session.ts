/** Human policy editor: current scope, durable original-key journal and no automatic write retries. */
import { parseRentalDesktopPolicySave, parseRentalDesktopBusinessPolicyRead, parseRentalDesktopPolicySaved,
  parseRentalDesktopPolicyObservation, type RentalDesktopBusinessPolicy, type RentalDesktopBusinessPolicyRead,
  type RentalDesktopPolicySave } from '@rental-os/shared';

type Pending = { operationKey: string; expectedRevision: number };
type Feedback = 'idle' | 'saved' | 'recorded' | 'unknown' | 'conflict' | 'denied' | 'unavailable' | 'invalid';
export interface DesktopPolicyState { busy: boolean; policy: RentalDesktopBusinessPolicyRead | null; pending: Pending | null; feedback: Feedback }
type Ports = { read(signal: AbortSignal): Promise<unknown>; save(value: RentalDesktopPolicySave, signal: AbortSignal): Promise<unknown>;
  operation(key: string, signal: AbortSignal): Promise<unknown> };
type Journal = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
function failure(error: unknown): Feedback {
  const response = error && typeof error === 'object' && 'response' in error ? error.response as { status?: number; data?: { code?: string } } : undefined;
  const code = response?.data?.code;
  if (response?.status === 401 || response?.status === 403 || code === 'AI_ACCESS_DENIED' || code === 'AI_SCOPE_CHANGED') return 'denied';
  if (code === 'AI_REVISION_CONFLICT') return 'conflict';
  if (code === 'AI_INVALID_INPUT') return 'invalid';
  return 'unavailable';
}
export class DesktopPolicySession {
  private value: DesktopPolicyState;
  private active = false;
  private journalInvalid = false;
  private flight: AbortController | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly ports: Ports, private readonly current: () => boolean, private readonly newKey: () => string,
    private readonly journal: Journal | undefined, private readonly journalKey: string) {
    let pending: Pending | null = null;
    try {
      const row: unknown = JSON.parse(journal?.getItem(journalKey) ?? 'null');
      if (row && typeof row === 'object' && 'operationKey' in row && 'expectedRevision' in row
        && Object.keys(row).length === 2 && typeof row.operationKey === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(row.operationKey)
        && typeof row.expectedRevision === 'number' && Number.isInteger(row.expectedRevision) && row.expectedRevision >= 0 && row.expectedRevision <= 2147483646)
        pending = { operationKey: row.operationKey, expectedRevision: row.expectedRevision };
      else if (row !== null) throw new Error('Invalid original policy reference');
      this.value = { busy: false, policy: null, pending, feedback: pending ? 'unknown' : 'idle' };
    } catch { this.journalInvalid = true; this.value = { busy: false, policy: null, pending: null, feedback: 'unavailable' }; }
  }
  snapshot = () => this.value;
  get recoveryAvailable() { return !!this.journal && !this.journalInvalid; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  activate() { this.active = true; }
  dispose() { this.active = false; this.flight?.abort(); this.flight = null; }
  private valid(controller?: AbortController) { return this.active && this.current() && (!controller || this.flight === controller && !controller.signal.aborted); }
  private update(patch: Partial<DesktopPolicyState>) {
    if (!this.valid()) return;
    this.value = Object.freeze({ ...this.value, ...patch });
    for (const listener of this.listeners) listener();
  }
  private start(): AbortController {
    if (!this.valid() || this.flight) throw new Error('AI_ACCESS_DENIED');
    const controller = new AbortController(); this.flight = controller; this.update({ busy: true }); return controller;
  }
  private finish(controller: AbortController) { if (this.flight === controller) { this.flight = null; this.update({ busy: false }); } }
  async load() {
    const controller = this.start(); this.update({ policy: null });
    try {
      const policy = parseRentalDesktopBusinessPolicyRead(await this.ports.read(controller.signal));
      if (!this.valid(controller)) throw new Error('AI_ACCESS_DENIED');
      this.update({ policy, feedback: this.journalInvalid ? 'unavailable' : this.value.pending ? 'unknown' : 'idle' });
    } catch (error) { if (this.valid(controller)) this.update({ policy: null, feedback: failure(error) }); throw error; }
    finally { this.finish(controller); }
  }
  async save(policy: RentalDesktopBusinessPolicy) {
    if (!this.value.policy || this.value.pending || this.journalInvalid) throw new Error('Read current policy and reconcile original save first');
    const command = parseRentalDesktopPolicySave({ operationKey: this.newKey(), expectedRevision: this.value.policy.state === 'configured' ? this.value.policy.revision : 0, policy });
    const controller = this.start(), pending = { operationKey: command.operationKey, expectedRevision: command.expectedRevision };
    let sent = false;
    try {
      // Persist the non-secret original key before sending. Failed storage cannot leave an unrecoverable save.
      if (!this.journal) throw new Error('Original policy journal unavailable');
      this.journal.setItem(this.journalKey, JSON.stringify(pending));
      if (this.journal.getItem(this.journalKey) !== JSON.stringify(pending)) throw new Error('Original policy reference not retained');
      this.update({ pending });
      if (!this.valid(controller)) throw new Error('AI_ACCESS_DENIED');
      sent = true;
      const receipt = parseRentalDesktopPolicySaved(await this.ports.save(command, controller.signal));
      if (!this.valid(controller)) throw new Error('AI_ACCESS_DENIED');
      if (receipt.operationKey !== pending.operationKey || receipt.result.revision !== pending.expectedRevision + 1
        || JSON.stringify(receipt.result.policy) !== JSON.stringify(command.policy)) throw new Error('Invalid policy save receipt');
      this.journal.removeItem(this.journalKey);
      this.update({ pending: null, policy: null, feedback: 'saved' });
    } catch (error) {
      if (!this.valid(controller)) throw error;
      const classified = failure(error), definitelyRejected = ['invalid', 'conflict', 'denied'].includes(classified);
      if (sent && !definitelyRejected) this.update({ pending, policy: null, feedback: 'unknown' });
      else {
        // A failed storage cleanup leaves the same key visible and all new writes blocked.
        try { this.journal?.removeItem(this.journalKey); this.update({ pending: null, policy: null, feedback: classified }); }
        catch { this.update({ pending, policy: null, feedback: 'unknown' }); }
      }
      throw error;
    } finally { this.finish(controller); }
  }
  async reconcile() {
    const pending = this.value.pending;
    if (!pending) throw new Error('Original policy reference missing');
    const controller = this.start();
    try {
      const receipt = parseRentalDesktopPolicyObservation(await this.ports.operation(pending.operationKey, controller.signal));
      if (!this.valid(controller)) throw new Error('AI_ACCESS_DENIED');
      if (receipt.state === 'not_observed') { this.update({ feedback: 'unknown', policy: null }); return { ok: false }; }
      if (receipt.operationKey !== pending.operationKey || receipt.result.revision !== pending.expectedRevision + 1) throw new Error('Invalid original policy receipt');
      this.journal?.removeItem(this.journalKey);
      this.update({ pending: null, policy: null, feedback: 'recorded' });
      return { ok: true };
    } catch (error) { if (this.valid(controller)) this.update({ policy: null, feedback: failure(error) }); throw error; }
    finally { this.finish(controller); }
  }
}
