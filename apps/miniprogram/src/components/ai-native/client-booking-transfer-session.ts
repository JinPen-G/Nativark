/** Explicit original transfer intents and minimal same-owner recovery. Opening
 * restores only local locators, never a server read, consume or navigation.
 * Native runtime validation uses only the formal customer bundle. */
import {
  aiClientHostCapabilitiesSchema, aiClientBookingTransferIssueRequestSchema, aiClientBookingTransferRequestSchema,
  aiClientBookingTransferIssueResponseSchema, aiClientBookingTransferReceiptSchema
} from '../../vendor/shared-ai-client';
import type { AiClientHostCapabilities, AiClientBookingTransferIssueRequest, AiClientBookingTransferRequest,
  AiClientBookingTransferIssueResponse, AiClientBookingTransferReceipt } from '@rental-os/shared';

export interface ClientBookingTransferContext {
  tenantCode: string; serviceCode: string; customerId: string;
  surface: 'tenant_website' | 'client_miniprogram'; current(): boolean;
}
export interface ClientBookingTransferApi {
  readHost(): Promise<unknown>;
  issue(value: AiClientBookingTransferIssueRequest): Promise<unknown>;
  readIssue(value: AiClientBookingTransferIssueRequest): Promise<unknown>;
  consume(value: AiClientBookingTransferRequest): Promise<unknown>;
  readReceipt(value: AiClientBookingTransferRequest): Promise<unknown>;
}
export interface ClientBookingTransferStorage {
  read(): unknown; write(value: unknown): void;
  select?(transferRef: string): void;
}
type Locator = { version: 'booking-transfer-operation-1'; owner: string } & (
  { kind: 'issue'; attempted: true; command: AiClientBookingTransferIssueRequest }
  | { kind: 'consume'; attempted: boolean; command: AiClientBookingTransferRequest }
);
export interface ClientBookingTransferView {
  status: 'idle' | 'ready' | 'checking' | 'issued' | 'consumed' | 'unknown' | 'expired' | 'unavailable' | 'invalidated';
  kind: 'issue' | 'consume'; hasLocator: boolean; attempted: boolean;
  canRetain: boolean; canIssue: boolean; canConsume: boolean; canRead: boolean; canContinue: boolean;
  transferRef: string | null; handoffRef: string | null; expiresAt: string | null;
  issue: AiClientBookingTransferIssueResponse | null; receipt: AiClientBookingTransferReceipt | null;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
export const clientBookingTransferOwner = (context: Pick<ClientBookingTransferContext, 'tenantCode' | 'serviceCode' | 'customerId' | 'surface'>) =>
  JSON.stringify([context.tenantCode, context.serviceCode, context.customerId, context.surface]);
export function clientBookingTransferStorageKey(context: Parameters<typeof clientBookingTransferOwner>[0],
  kind: 'issue' | 'consume', reference?: string): string {
  const source = kind === 'issue' ? aiClientBookingTransferIssueRequestSchema.parse({ handoffRef: reference,
    operationKey: 'locator', targetSurface: context.surface === 'tenant_website' ? 'client_miniprogram' : 'tenant_website' }).handoffRef
    : reference === undefined ? '' : aiClientBookingTransferRequestSchema.parse({ transferRef: reference, operationKey: 'locator' }).transferRef;
  return `rental-os:booking-transfer:${encodeURIComponent(clientBookingTransferOwner(context))}:${kind}:${source}`;
}
function parseLocator(value: unknown): Locator {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('booking_transfer_locator_invalid');
  const row = value as Record<string, unknown>, keys = ['version', 'owner', 'kind', 'attempted', 'command'];
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))
    || row.version !== 'booking-transfer-operation-1' || typeof row.owner !== 'string' || row.owner.length > 1024
    || typeof row.attempted !== 'boolean') throw Error('booking_transfer_locator_invalid');
  if (row.kind === 'issue' && row.attempted === true) return { version: row.version, owner: row.owner, kind: 'issue',
    attempted: true, command: aiClientBookingTransferIssueRequestSchema.parse(row.command) };
  if (row.kind === 'consume') return { version: row.version, owner: row.owner, kind: 'consume',
    attempted: row.attempted, command: aiClientBookingTransferRequestSchema.parse(row.command) };
  throw Error('booking_transfer_locator_invalid');
}

/** One journal per original transfer, with a single recent-reference hint.
 * Reads never migrate/write. The old owner slot stays recoverable in place;
 * selecting another reference cannot overwrite its original operation key. */
export function createClientBookingTransferStorage(input: {
  context: ClientBookingTransferContext; kind: 'issue' | 'consume'; handoffRef?: string; initialRef?: string;
  read(key: string): unknown; write(key: string, value: unknown): void;
}) {
  const owner = clientBookingTransferOwner(input.context), base = clientBookingTransferStorageKey(input.context, input.kind, input.handoffRef);
  const index = `${clientBookingTransferStorageKey(input.context, 'consume')}recent`;
  let selected: string | null = null, initialized = input.kind === 'issue';
  const current = () => { if (!input.context.current()) throw Error('booking_transfer_context_changed'); };
  const reference = (value: string) => aiClientBookingTransferRequestSchema.parse({ transferRef: value, operationKey: 'locator' }).transferRef;
  const validate = (value: unknown, ref?: string): Locator | null => {
    if (value === undefined || value === null) return null;
    const row = parseLocator(value);
    if (row.owner !== owner || row.kind !== input.kind || !same(value, row)
      || row.kind === 'consume' && ref !== undefined && row.command.transferRef !== ref
      || row.kind === 'issue' && row.command.handoffRef !== input.handoffRef) throw Error('booking_transfer_locator_changed');
    return row;
  };
  const slot = () => input.kind === 'consume' && selected !== null
    ? clientBookingTransferStorageKey(input.context, 'consume', selected) : base;
  const original = (ref: string) => {
    const row = validate(input.read(clientBookingTransferStorageKey(input.context, 'consume', ref)), ref);
    const legacy = validate(input.read(base));
    const previous = legacy?.kind === 'consume' && legacy.command.transferRef === ref ? legacy : null;
    if (row && previous && !same(row.command, previous.command)) throw Error('booking_transfer_locator_changed');
    return previous?.attempted && row?.attempted === false ? previous : row ?? previous;
  };
  const select = (value: string) => { current(); const ref = reference(value); original(ref); selected = ref; initialized = true; };
  const read = (): unknown => {
    current();
    if (input.kind === 'issue') return input.read(base);
    if (!initialized) {
      const stored = input.read(index);
      if (input.initialRef !== undefined) {
        select(input.initialRef);
        if (!original(selected!)) throw Error('booking_transfer_locator_changed');
      } else if (stored !== undefined && stored !== null) {
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw Error('booking_transfer_index_invalid');
        const value = stored as Record<string, unknown>;
        if (Object.keys(value).length !== 3 || value.version !== 'booking-transfer-reference-1'
          || value.owner !== owner || typeof value.transferRef !== 'string') throw Error('booking_transfer_index_invalid');
        select(value.transferRef);
        if (!original(selected!)) throw Error('booking_transfer_locator_changed');
      } else {
        const legacy = validate(input.read(base));
        if (legacy?.kind === 'consume') select(legacy.command.transferRef);
        else initialized = true;
      }
    }
    return selected === null ? undefined : original(selected);
  };
  return Object.freeze({
    read, select,
    reference: () => selected,
    key: slot,
    write(value: unknown) {
      current(); const next = validate(value, selected ?? undefined);
      if (!next || input.kind === 'consume' && selected === null) throw Error('booking_transfer_locator_changed');
      const previous = input.kind === 'consume' ? original(selected!) : validate(input.read(base));
      if (previous && (!same(previous.command, next.command) || previous.attempted && !next.attempted)) throw Error('booking_transfer_locator_changed');
      input.write(slot(), copy(next));
      if (!same(input.read(slot()), next)) throw Error('booking_transfer_locator_not_retained');
      if (input.kind === 'consume') {
        const hint = { version: 'booking-transfer-reference-1', owner, transferRef: selected };
        input.write(index, hint);
        if (!same(input.read(index), hint)) throw Error('booking_transfer_locator_not_retained');
      }
    }
  });
}

export function createClientBookingTransferSession(input: {
  context: ClientBookingTransferContext; kind: 'issue' | 'consume'; handoffRef?: string;
  api: ClientBookingTransferApi; now(): number; newKey(): string;
  storage: ClientBookingTransferStorage; changed(view: ClientBookingTransferView): void;
}) {
  const owner = clientBookingTransferOwner(input.context), targetSurface = input.context.surface === 'tenant_website' ? 'client_miniprogram' : 'tenant_website';
  let closed = false, busy = false, opened = false, invalidCache = false, expired = false, generation = 0;
  let saved: Locator | null = null, host: AiClientHostCapabilities | null = null;
  let issue: AiClientBookingTransferIssueResponse | null = null, receipt: AiClientBookingTransferReceipt | null = null;
  let receiptOnly = false;
  let timer: ReturnType<typeof setTimeout> | undefined, deadline: number | undefined;
  const current = () => { try { return !closed && input.context.current(); } catch { return false; } };
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; deadline = undefined; };
  const empty = (status: ClientBookingTransferView['status']): ClientBookingTransferView => ({
    status, kind: input.kind, hasLocator: saved !== null || invalidCache, attempted: saved?.attempted ?? false,
    canRetain: false, canIssue: false, canConsume: false, canRead: false, canContinue: false,
    transferRef: null, handoffRef: null, expiresAt: null, issue: null, receipt: null
  });
  let view = empty('idle');
  const withdraw = () => { expired = true; issue = null; receipt = null; clearTimer(); };
  const updateDeadline = () => {
    if (!current()) { withdraw(); return; }
    if (expired) return;
    const times = [host?.expiresAt, issue?.expiresAt, receipt?.expiresAt]
      .filter((value): value is string => value !== undefined && value !== null).map(value => Date.parse(value));
    const now = input.now();
    if (!Number.isFinite(now) || times.some(value => !Number.isFinite(value))) { withdraw(); return; }
    if (!times.length) { clearTimer(); return; }
    const next = Math.min(...times);
    if (next <= now) { withdraw(); return; }
    if (timer !== undefined && deadline === next) return;
    clearTimer(); deadline = next;
    timer = setTimeout(() => { timer = undefined; deadline = undefined; withdraw(); emit('expired'); }, Math.min(next - now, 300000));
  };
  const writable = () => Boolean(host?.enabled && host.policy.allowCreate && host.capabilities.bookingDrafts);
  const emit = (status: ClientBookingTransferView['status']) => {
    updateDeadline();
    if (!current()) return;
    const available = opened && !busy && !invalidCache, live = !expired;
    view = { ...empty(expired && status !== 'unknown' ? 'expired' : status),
      canRetain: available && input.kind === 'consume' && (saved === null || Boolean(input.storage.select)),
      canIssue: available && input.kind === 'issue' && saved === null && !expired,
      canConsume: available && input.kind === 'consume' && saved?.kind === 'consume' && saved.attempted === false && live && status === 'ready',
      canRead: available && Boolean(saved?.attempted),
      canContinue: available && live && !receiptOnly && writable() && receipt?.state === 'consumed' && status === 'consumed',
      transferRef: live ? issue?.state === 'issued' ? issue.transferRef
        : saved?.kind === 'consume' ? saved.command.transferRef : null : null,
      handoffRef: live && receipt?.state === 'consumed' ? receipt.handoffRef : null,
      expiresAt: live ? issue?.expiresAt ?? receipt?.expiresAt ?? null : null,
      issue: live ? issue : null, receipt: live ? receipt : null };
    input.changed(copy(view));
  };
  const assertJournal = () => {
    if (!current() || saved && !same(input.storage.read(), saved)) throw Error('booking_transfer_locator_changed');
  };
  const persist = (next: Locator) => {
    const closedValue = parseLocator(copy(next)); assertJournal();
    const before = input.storage.read();
    if (!saved && before !== undefined && before !== null) throw Error('booking_transfer_locator_changed');
    // If write succeeds but its acknowledgement/read-back is lost, hold this
    // original locator in memory. Nothing may mint another operation key.
    saved = closedValue;
    emit(busy ? 'checking' : 'ready');
    input.storage.write(copy(closedValue));
    if (!same(input.storage.read(), closedValue)) throw Error('booking_transfer_locator_not_retained');
  };
  const checkHost = async (write: boolean) => {
    const next = aiClientHostCapabilitiesSchema.parse(await input.api.readHost());
    if (!current() || next.customerType !== 'personal' || next.customerId !== input.context.customerId
      || next.tenantCode !== input.context.tenantCode || next.serviceCode !== input.context.serviceCode
      || next.surface !== input.context.surface || Date.parse(next.expiresAt) <= input.now()
      || host && !same(next.scope, host.scope)) throw Error('booking_transfer_host_changed');
    host = next;
    if (write && !writable()) throw Error('booking_transfer_write_unavailable');
  };
  const hostBasis = () => host && { scope: host.scope, customerId: host.customerId, surface: host.surface,
    releaseRevision: host.releaseRevision, policy: host.policy, capabilities: host.capabilities };
  const acceptIssue = (value: unknown) => {
    const result = aiClientBookingTransferIssueResponseSchema.parse(value);
    if (saved?.kind !== 'issue' || result.operationKey !== saved.command.operationKey
      || result.handoffRef !== saved.command.handoffRef || result.targetSurface !== saved.command.targetSurface) throw Error('booking_transfer_issue_changed');
    if (result.expiresAt !== null && Date.parse(result.expiresAt) - input.now() > 60000) throw Error('booking_transfer_lifetime_invalid');
    if (issue?.state === 'issued' && result.state === 'issued'
      && !same({ ...issue }, { ...result })) throw Error('booking_transfer_issue_changed');
    issue = result; return result.state === 'issued' ? 'issued' as const : 'unknown' as const;
  };
  const acceptReceipt = (value: unknown) => {
    const result = aiClientBookingTransferReceiptSchema.parse(value);
    if (saved?.kind !== 'consume' || result.operationKey !== saved.command.operationKey
      || result.transferRef !== saved.command.transferRef) throw Error('booking_transfer_receipt_changed');
    if (result.expiresAt !== null && Date.parse(result.expiresAt) - input.now() > 60000) throw Error('booking_transfer_lifetime_invalid');
    if (receipt?.state === 'consumed' && result.state === 'consumed' && !same(receipt, result)) throw Error('booking_transfer_receipt_changed');
    receipt = result; return result.state === 'consumed' ? 'consumed' as const : 'unknown' as const;
  };
  const run = async (write: boolean, work: () => Promise<ClientBookingTransferView['status']>) => {
    if (busy || !opened || !current() || invalidCache) return false;
    busy = true; const epoch = generation; emit('checking');
    let status: ClientBookingTransferView['status'] = 'unavailable', checked = false;
    try {
      await checkHost(write); assertJournal(); const basis = copy(hostBasis());
      status = await work();
      await checkHost(false); assertJournal();
      if (epoch !== generation || !same(basis, hostBasis())) throw Error('booking_transfer_host_changed');
      expired = false; checked = true;
    } catch {
      issue = null; receipt = null;
      status = saved?.attempted ? 'unknown' : 'unavailable';
    } finally { busy = false; if (epoch === generation && current()) emit(status); }
    return checked && epoch === generation && current();
  };
  const readOriginal = async () => {
    if (!saved?.attempted) return;
    receiptOnly = false;
    return run(false, async () => saved?.kind === 'issue'
      ? acceptIssue(await input.api.readIssue(copy(saved.command)))
      : saved?.kind === 'consume' ? acceptReceipt(await input.api.readReceipt(copy(saved.command))) : 'unavailable');
  };
  return Object.freeze({
    snapshot(): ClientBookingTransferView {
      if (!current()) { withdraw(); return empty('invalidated'); }
      const wasExpired = expired; updateDeadline();
      if (!wasExpired && expired) emit('expired');
      return copy(view);
    },
    open() {
      if (opened || !current()) return;
      opened = true;
      try {
        if (input.kind === 'issue') aiClientBookingTransferIssueRequestSchema.parse({ handoffRef: input.handoffRef,
          operationKey: 'check', targetSurface });
        const stored = input.storage.read();
        if (stored !== undefined && stored !== null) {
          const original = parseLocator(stored);
          if (original.owner !== owner || original.kind !== input.kind || !same(stored, original)
            || original.kind === 'issue' && (original.command.handoffRef !== input.handoffRef || original.command.targetSurface !== targetSurface)) throw Error('booking_transfer_locator_changed');
          saved = original; emit(original.attempted ? 'unknown' : 'ready');
        } else emit('idle');
      } catch { invalidCache = true; emit('unavailable'); }
    },
    retain(transferRef: string) {
      if (!view.canRetain || !current()) return;
      let ref: string;
      try {
        ref = aiClientBookingTransferRequestSchema.parse({ transferRef: transferRef.trim(), operationKey: 'validate' }).transferRef;
      } catch { emit('unavailable'); return; }
      try {
        if (input.storage.select) {
          assertJournal(); input.storage.select(ref);
          const stored = input.storage.read(), original = stored === undefined || stored === null ? null : parseLocator(stored);
          if (original && (original.owner !== owner || original.kind !== 'consume' || original.command.transferRef !== ref || !same(stored, original))) {
            throw Error('booking_transfer_locator_changed');
          }
          generation++; clearTimer(); host = null; issue = null; receipt = null; receiptOnly = false; expired = false; saved = original;
          if (original) {
            emit(original.attempted ? 'unknown' : 'ready'); input.storage.write(copy(original));
            if (!same(input.storage.read(), original)) throw Error('booking_transfer_locator_not_retained');
            return;
          }
        }
        const command = aiClientBookingTransferRequestSchema.parse({ transferRef: ref, operationKey: input.newKey() });
        persist({ version: 'booking-transfer-operation-1', owner, kind: 'consume', attempted: false, command }); emit('ready');
      } catch { invalidCache = true; emit('unavailable'); }
    },
    async issue() {
      if (!view.canIssue || !current()) return;
      return run(true, async () => {
        const command = aiClientBookingTransferIssueRequestSchema.parse({ handoffRef: input.handoffRef, targetSurface, operationKey: input.newKey() });
        persist({ version: 'booking-transfer-operation-1', owner, kind: 'issue', attempted: true, command });
        return acceptIssue(await input.api.issue(copy(command)));
      });
    },
    async consume() {
      if (!view.canConsume || saved?.kind !== 'consume' || saved.attempted || !current()) return;
      return run(true, async () => {
        if (saved?.kind !== 'consume' || saved.attempted) throw Error('booking_transfer_original_only');
        persist({ ...saved, attempted: true });
        return acceptReceipt(await input.api.consume(copy(saved.command)));
      });
    },
    read: readOriginal,
    async readReceiptHandoff(): Promise<{ handoffRef: string } | null> {
      if (busy || !current() || saved?.kind !== 'consume' || !saved.attempted) return null;
      receiptOnly = true;
      const command = copy(saved.command);
      let originalRef: string | null = null;
      const checked = await run(false, async () => {
        const result = aiClientBookingTransferReceiptSchema.parse(await input.api.readReceipt(command));
        const status = acceptReceipt(result);
        if (result.state === 'consumed') originalRef = result.handoffRef;
        return status;
      });
      // This awaited read may return an expired original reference to a
      // receipt-only host. It never restores the expired display or execution.
      return checked && current() && originalRef && saved?.kind === 'consume' && same(saved.command, command)
        && host?.capabilities.bookingReceiptRead && Date.parse(host.expiresAt) > input.now() ? { handoffRef: originalRef } : null;
    },
    async continueHandoff(): Promise<{ handoffRef: string } | null> {
      if (busy || !current() || saved?.kind !== 'consume' || !saved.attempted) return null;
      // Even after manual recovery, this user intent reads the original receipt
      // again. The parent must then enter the original independently guarded host.
      await readOriginal();
      updateDeadline();
      return current() && view.canContinue && receipt?.state === 'consumed' ? { handoffRef: receipt.handoffRef } : null;
    },
    dispose() {
      if (closed) return;
      closed = true; generation++; clearTimer(); host = null; issue = null; receipt = null; view = empty('invalidated');
      input.changed(copy(view));
    }
  });
}
