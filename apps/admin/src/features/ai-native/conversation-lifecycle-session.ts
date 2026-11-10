/** Durable minimal operation lookup, not chat storage or authorization. A send
 * starts only after the marker is verified; unknown/absence/abort never permits
 * a new key. Reconciliation reads the original receipt and never repeats writes. */
import { AI_CONVERSATION_DRAFT_VERSION, AI_CONVERSATION_UNSTARTED_DRAFT_VERSION, AI_SCENE_CODES, validateAiConversationOperationDraft,
  type AiConversationCreateDraft, type AiConversationMutationDraft, type AiConversationUnstartedCloseDraft, type AiConversationOperationObservationDraft } from '@rental-os/shared';

type Command = AiConversationCreateDraft | AiConversationMutationDraft | AiConversationUnstartedCloseDraft;
type Pending = { action: 'create' | 'archive' | 'delete' | 'release' | 'closeUnstarted'; command: Command;
  binding?: { turnId: string; originalInputRef: string } };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Ports = {
  create(command: AiConversationCreateDraft, signal: AbortSignal): Promise<unknown>;
  archive(command: AiConversationMutationDraft, signal: AbortSignal): Promise<unknown>;
  delete(command: AiConversationMutationDraft, signal: AbortSignal): Promise<unknown>;
  release?(command: AiConversationMutationDraft, signal: AbortSignal): Promise<unknown>;
  closeUnstarted?(command: AiConversationUnstartedCloseDraft, signal: AbortSignal): Promise<unknown>;
  operation(command: { draftVersion: typeof AI_CONVERSATION_DRAFT_VERSION; operationKey: string }, signal: AbortSignal): Promise<unknown>;
};
export type ConversationLifecycleState = Readonly<{ busy: boolean; locked: boolean;
  receipt: AiConversationOperationObservationDraft | null; feedback: 'idle' | 'unknown' | 'recorded' | 'unavailable' | 'conflict' }>;
const JOURNAL_MAX_LENGTH = 2048;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
function pending(value: unknown): value is Pending {
  if (!object(value) || !['create', 'archive', 'delete', 'release', 'closeUnstarted'].includes(String(value.action)) || !object(value.command)) return false;
  const closing = value.action === 'release' || value.action === 'closeUnstarted';
  if (Object.keys(value).length !== (closing ? 3 : 2) || Object.keys(value).some(key => !['action', 'command', ...(closing ? ['binding'] : [])].includes(key))) return false;
  if (closing && (!object(value.binding) || Object.keys(value.binding).length !== 2
    || Object.keys(value.binding).some(key => !['turnId', 'originalInputRef'].includes(key)) || !id(value.binding.turnId) || !id(value.binding.originalInputRef))) return false;
  const command = value.command;
  if (command.draftVersion !== (value.action === 'closeUnstarted' ? AI_CONVERSATION_UNSTARTED_DRAFT_VERSION : AI_CONVERSATION_DRAFT_VERSION)
    || !id(command.operationKey) || command.operationKey.length > 128) return false;
  const keys = value.action === 'create' ? ['draftVersion', 'operationKey', 'capabilityCode'] : ['draftVersion', 'operationKey', 'conversationId', 'expectedRevision',
    ...(value.action === 'closeUnstarted' ? ['turnId', 'originalInputRef'] : [])];
  if (Object.keys(command).length !== keys.length || Object.keys(command).some(key => !keys.includes(key))) return false;
  return value.action === 'create' ? AI_SCENE_CODES.includes(command.capabilityCode as AiConversationCreateDraft['capabilityCode'])
    : id(command.conversationId) && Number.isSafeInteger(command.expectedRevision) && (command.expectedRevision as number) >= 1 && (command.expectedRevision as number) < 4294967294
      && (value.action !== 'closeUnstarted' || object(value.binding) && command.turnId === value.binding.turnId && command.originalInputRef === value.binding.originalInputRef);
}
export class ConversationLifecycleSession {
  private active = true; private request: AbortController | null = null; private listeners = new Set<() => void>();
  private state: ConversationLifecycleState;
  constructor(private readonly ports: Ports, private readonly current: () => boolean, private readonly storage: Storage | undefined,
    private readonly key: string, private readonly newKey = () => globalThis.crypto.randomUUID(), private readonly retainReceipt = false) {
    let locked = true; try { locked = !storage || storage.getItem(key) !== null; } catch { /* fail closed without a readable journal */ }
    this.state = Object.freeze({ busy: false, locked, receipt: null, feedback: locked ? 'unknown' : 'idle' });
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  activate() { this.active = true; }
  retract() { this.request?.abort(); this.publish({ busy: false, receipt: null }); }
  dispose() { this.active = false; this.request?.abort(); }
  private check(signal?: AbortSignal) { if (!this.active || !this.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED'); }
  private publish(patch: Partial<ConversationLifecycleState>) {
    this.state = Object.freeze({ ...this.state, ...patch }); for (const listener of this.listeners) listener();
  }
  private clear(marker: string) {
    if (!this.storage || this.storage.getItem(this.key) !== marker) throw Error('AI_RESULT_UNKNOWN');
    this.storage.removeItem(this.key); if (this.storage.getItem(this.key) !== null) throw Error('AI_RESULT_UNKNOWN');
  }
  private receipt(value: unknown, original: Pending) {
    if (!validateAiConversationOperationDraft(value, original.command.operationKey) || value.status !== 'observed'
      || value.operation !== (original.action === 'release' ? 'release_turn' : original.action === 'closeUnstarted' ? 'close_unstarted' : original.action)
      || value.revision !== ('expectedRevision' in original.command ? original.command.expectedRevision + 1 : 1)
      || 'conversationId' in original.command && value.conversationId !== original.command.conversationId) throw Error('AI_RESULT_UNKNOWN');
    return structuredClone(value);
  }
  create = (capabilityCode: AiConversationCreateDraft['capabilityCode']) => this.send('create', { capabilityCode });
  mutate = (action: 'archive' | 'delete', conversationId: string, expectedRevision: number) => this.send(action, { conversationId, expectedRevision });
  close = (action: 'release' | 'closeUnstarted', conversationId: string, expectedRevision: number, turnId: string, originalInputRef: string) =>
    this.send(action, { conversationId, expectedRevision, ...(action === 'closeUnstarted' ? { turnId, originalInputRef } : {}) }, { turnId, originalInputRef });
  private async send(action: Pending['action'], fields: { capabilityCode: AiConversationCreateDraft['capabilityCode'] } | { conversationId: string; expectedRevision: number; turnId?: string; originalInputRef?: string }, binding?: Pending['binding']) {
    this.check(); if (this.request) throw Error('AI_BUSY');
    if (this.state.locked || !this.storage) throw Error('AI_RESULT_UNKNOWN');
    const controller = new AbortController(); this.request = controller;
    let attempted = false, marker: string | undefined;
    this.publish({ busy: true, receipt: null, feedback: 'idle' });
    try {
      if (this.storage.getItem(this.key) !== null) { this.publish({ locked: true }); throw Error('AI_RESULT_UNKNOWN'); }
      const original = { action, command: { draftVersion: action === 'closeUnstarted' ? AI_CONVERSATION_UNSTARTED_DRAFT_VERSION : AI_CONVERSATION_DRAFT_VERSION,
        operationKey: this.newKey(), ...fields }, ...(binding ? { binding } : {}) };
      if (!pending(original)) throw Error('AI_INVALID_INPUT');
      marker = JSON.stringify(original); if (marker.length > JOURNAL_MAX_LENGTH) throw Error('AI_INVALID_INPUT');
      this.publish({ locked: true });
      this.storage.setItem(this.key, marker); if (this.storage.getItem(this.key) !== marker) throw Error('AI_RESOURCE_UNAVAILABLE');
      if (action === 'release' && !this.ports.release || action === 'closeUnstarted' && !this.ports.closeUnstarted) throw Error('AI_RESOURCE_UNAVAILABLE');
      this.check(controller.signal); attempted = true;
      const command = structuredClone(original.command);
      const value = await (original.action === 'create' ? this.ports.create(command as AiConversationCreateDraft, controller.signal)
        : original.action === 'closeUnstarted' ? this.ports.closeUnstarted!(command as AiConversationUnstartedCloseDraft, controller.signal)
          : original.action === 'release' ? this.ports.release!(command as AiConversationMutationDraft, controller.signal)
            : this.ports[original.action](command as AiConversationMutationDraft, controller.signal));
      this.check(controller.signal); const receipt = this.receipt(value, original);
      if (this.storage?.getItem(this.key) !== marker) throw Error('AI_RESULT_UNKNOWN');
      if (!this.retainReceipt) this.clear(marker); this.publish({ locked: this.retainReceipt, receipt, feedback: 'recorded' }); return receipt;
    } catch (failure) {
      const code = (failure as { response?: { data?: { code?: string } } }).response?.data?.code;
      // These server errors precede the repository's commit-attempt boundary.
      // A damaged/lost acknowledgement is AI_RESULT_UNKNOWN, never this branch.
      if (attempted && marker && ['AI_REVISION_CONFLICT', 'AI_INVALID_INPUT'].includes(code ?? '') && this.active && this.current() && !controller.signal.aborted) {
        try { this.clear(marker); this.publish({ locked: false, receipt: null, feedback: 'conflict' }); } catch { this.publish({ locked: true, receipt: null, feedback: 'unknown' }); }
      } else if (this.active) this.publish({ receipt: null, feedback: marker ? 'unknown' : 'unavailable' });
      throw failure;
    } finally { if (this.request === controller) this.request = null; if (this.active) this.publish({ busy: false }); }
  }
  completeClosure = async (complete: (proof: { operationKey: string; expectedRevision: number; turnId: string; originalInputRef: string }, acknowledge: () => void) => Promise<void>) => {
    this.check(); if (this.request) throw Error('AI_BUSY');
    const marker = this.storage?.getItem(this.key); if (!marker || marker.length > JOURNAL_MAX_LENGTH) throw Error('AI_RESULT_UNKNOWN');
    const original: unknown = JSON.parse(marker);
    if (!pending(original) || !original.binding || !('expectedRevision' in original.command)
      || !['release', 'closeUnstarted'].includes(original.action) || !this.state.receipt) throw Error('AI_RESULT_UNKNOWN');
    this.receipt(this.state.receipt, original);
    const controller = new AbortController(); this.request = controller; this.publish({ busy: true });
    try {
      let acknowledged = false;
      await complete({ operationKey: original.command.operationKey, expectedRevision: original.command.expectedRevision, ...original.binding }, () => {
        this.check(controller.signal); this.clear(marker); acknowledged = true;
        this.publish({ locked: false, receipt: null, feedback: 'recorded' });
      });
      if (!acknowledged) throw Error('AI_RESULT_UNKNOWN');
    } finally { if (this.request === controller) this.request = null; if (this.active) this.publish({ busy: false }); }
  };
  reconcile = async () => {
    this.check(); if (this.request) throw Error('AI_BUSY');
    const controller = new AbortController(); this.request = controller;
    this.publish({ busy: true, receipt: null });
    try {
      const marker = this.storage?.getItem(this.key); if (!marker || marker.length > JOURNAL_MAX_LENGTH) throw Error('AI_RESULT_UNKNOWN');
      const original: unknown = JSON.parse(marker); if (!pending(original)) throw Error('AI_RESULT_UNKNOWN');
      const value = await this.ports.operation({ draftVersion: AI_CONVERSATION_DRAFT_VERSION, operationKey: original.command.operationKey }, controller.signal);
      this.check(controller.signal); const receipt = this.receipt(value, original);
      if (this.storage?.getItem(this.key) !== marker) throw Error('AI_RESULT_UNKNOWN');
      if (!this.retainReceipt) this.clear(marker); this.publish({ locked: this.retainReceipt, receipt, feedback: 'recorded' }); return receipt;
    } catch (failure) { if (this.active) this.publish({ locked: true, receipt: null, feedback: 'unknown' }); throw failure; }
    finally { if (this.request === controller) this.request = null; if (this.active) this.publish({ busy: false }); }
  };
}
