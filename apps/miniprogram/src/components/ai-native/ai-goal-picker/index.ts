/** Native host for the canonical Goal lifecycle. All options begin unselected;
 * the caller receives only explicitly selected inputs after reading the original
 * quote. Hidden, detached or changed customer hosts withdraw buffered results. */
import type { AiClientGoalProjection, AiBookingSelection, ClientCreateQuoteRequest, ClientGoalBookingSource, ClientGoalView } from '@rental-os/shared';
import { createClientGoalSession, clientGoalStorageKey, clientGoalSelectedInput, clientGoalTimeOptions } from '../../../vendor/shared-ai-client';
import { createClientGoalApi } from '../../../api/ai-goals';
import { clientQuoteApi } from '../../../api/ai-quotes';
import { readBookingHandoff, readBookingHostCapabilities } from '../../../api/orders';
import { createClientQuoteBookingSession, clientQuoteBookingStoredRequest, type ClientQuoteBookingView } from '../client-quote-session';
import { createClientTaskCancellationSession, clientTaskCancellationStorageKey, type ClientTaskCancellationView } from '../client-task-cancellation-session';
import { clientTaskCancellationApi } from '../../../api/ai-task-cancellation';
import { PUBLIC_CONFIG } from '../../../config/public';
import { serverNow } from '../../../core/clock';
import { newKey } from '../../../core/keys';
import { contextVersion, currentSession, sessionEvents } from '../../../core/session';
import { writeRequiredStorage } from '../../../core/storage';
import { ROUTES, buildUrl, navigate } from '../../../core/ui';

type Session = ReturnType<typeof createClientGoalSession>;
type Choice = { id: string; label: string };
type FormLine = { item: string; quantity: string; unit: string; usage: string; options: Choice[]; units: Choice[] };
type Form = { lines: FormLine[]; mode: string; location: string; returnLocation: string; identity: string;
  address: string; payer: string; notice: boolean; startDate: string; startTime: string; endDate: string; endTime: string };
const form = (): Form => ({ lines: [], mode: '', location: '', returnLocation: '', identity: '', address: '', payer: '', notice: false,
  startDate: '', startTime: '', endDate: '', endTime: '' });
const blank = (): ClientGoalView => ({ status: 'closed', hasLocator: false, task: null, question: null, receipt: null, projection: null,
  sources: null, selection: null, quote: null, canExtract: false, canRead: false, canSubmit: false, canContinue: false,
  canPrepareQuote: false, canConfirmQuote: false, canSelect: false, canStartNew: false, readOnly: true });
const sessions = new WeakMap<object, Session>(), epochs = new WeakMap<object, number>(), unsubscribe = new WeakMap<object, () => void>();
const bookings = new WeakMap<object, ReturnType<typeof createClientQuoteBookingSession>>();
const cancellationSessions = new WeakMap<object, ReturnType<typeof createClientTaskCancellationSession>>();
const sources = new WeakMap<object, ClientGoalBookingSource>();
const currentBindings = new WeakMap<object, { context: Parameters<typeof createClientQuoteBookingSession>[0]['context']; key: string }>();
const shown = new WeakSet<object>(), busy = new WeakSet<object>();
// A storage read failure is unavailable, never evidence that an original
// operation did not exist. Missing values alone may open a fresh local journal.
const readGoalStorage = (key: string): unknown => {
  const value: unknown = wx.getStorageSync(key);
  return value === '' || value === null || value === undefined ? undefined : value;
};
const options = (projection: AiClientGoalProjection | null, field: string): Choice[] => projection?.choices.find(group => group.field === field)?.choices ?? [];
const namedChoices = (values: Choice[]) => values.map(choice => ({ ...choice,
  label: values.some(other => other.id !== choice.id && other.label === choice.label) ? `${choice.label} (${choice.id})` : choice.label }));
const unitName = (id: string) => ({ hour: '小时', shift: '班次', day_24h: '24小时', calendar_day: '自然日', night: '晚',
  week: '周', month: '月', usage: '使用量', package: '套餐' } as Record<string, string>)[id] ?? id;
const modeName = (id: string) => ({ store_pickup_return: '门店自取', partner_pickup_return: '合作点自取', warehouse_pickup_return: '仓库自取',
  locker_pickup_return: '柜机自取', delivery: '配送', onsite_delivery: '送达现场', carrier_shipping: '承运寄送' } as Record<string, string>)[id] ?? id;

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { serviceCode: { type: String, value: '' } },
  data: { view: blank(), form: form(), goal: '', answer: '', working: false, loggedIn: false, message: '', projectionHash: '', questionId: '',
    booking: null as ClientQuoteBookingView | null, cancellation: null as ClientTaskCancellationView | null,
    answerMaxLength: 2048, canCancel: false, selectedRows: [] as { label: string; quantity: number; pricingUnit: string; usage: string }[],
    modes: [] as Choice[], locations: [] as Choice[], returns: [] as Choice[], identities: [] as Choice[], addresses: [] as Choice[],
    timeZone: '', startAt: '', endAt: '', delivery: false, policyNotice: '', canPersonalPay: false, canEnterprisePay: false },
  lifetimes: {
    attached() { shown.add(this); epochs.set(this, 1); unsubscribe.set(this, sessionEvents.on(() => { this.invalidate(); if (shown.has(this)) void this.open(); })); void this.open(); },
    detached() { shown.delete(this); this.invalidate(); unsubscribe.get(this)?.(); unsubscribe.delete(this); },
  },
  pageLifetimes: { show() { shown.add(this); void this.open(); }, hide() { shown.delete(this); this.invalidate(); } },
  observers: { serviceCode() { this.invalidate(); if (shown.has(this)) void this.open(); } },
  methods: {
    invalidate() {
      epochs.set(this, (epochs.get(this) ?? 0) + 1); sessions.get(this)?.dispose(); sessions.delete(this); busy.delete(this);
      bookings.get(this)?.dispose(); bookings.delete(this); cancellationSessions.get(this)?.dispose(); cancellationSessions.delete(this);
      sources.delete(this); currentBindings.delete(this);
      this.setData({ view: blank(), form: form(), goal: '', answer: '', working: false, message: '', projectionHash: '', questionId: '',
        booking: null, cancellation: null, answerMaxLength: 2048, canCancel: false, selectedRows: [],
        modes: [], locations: [], returns: [], identities: [], addresses: [], timeZone: '', startAt: '', endAt: '', delivery: false,
        policyNotice: '', canPersonalPay: false, canEnterprisePay: false });
    },
    accept(view: ClientGoalView) {
      if (!shown.has(this)) return;
      const projection = view.projection, changed = projection?.projectionHash !== this.data.projectionHash;
      const questionId = view.question ? `${view.question.requestId}:${view.question.revision}` : '';
      const field = view.question?.contract.fields.length === 1 && view.question.contract.fields[0].kind === 'text'
        && view.question.contract.fields[0].fieldId === 'clarification_text' ? view.question.contract.fields[0] : null;
      this.setData({ view, ...(questionId !== this.data.questionId ? { answer: '' } : {}), questionId,
        answerMaxLength: field?.maxLength ?? 2048, canCancel: Boolean(sessions.get(this)?.cancellationOrigin()),
        selectedRows: view.selection?.lines.map((line, index) => ({ label: options(projection, `items.${index}.itemGroupId`).find(row => row.id === line.itemGroupId)?.label ?? line.itemGroupId ?? '未提供商品',
          quantity: line.quantity, pricingUnit: unitName(line.pricingUnit ?? ''), usage: line.usageQuantity === undefined ? '' : String(line.usageQuantity) })) ?? [],
        ...(changed ? { form: { ...form(), lines: (projection?.candidates?.conditions.items ?? []).map((_item, index) => ({ item: '', quantity: '', unit: '', usage: '',
          options: namedChoices(options(projection, `items.${index}.itemGroupId`)), units: options(projection, `items.${index}.pricingUnit`).map(choice => ({ ...choice, label: unitName(choice.id) })) })) }, startAt: '', endAt: '' } : {}),
        projectionHash: projection?.projectionHash ?? '', timeZone: projection?.context.timeZone ?? '',
        modes: options(projection, 'fulfillmentMode').map(choice => ({ ...choice, label: modeName(choice.id) })),
        locations: namedChoices(options(projection, 'fulfillmentLocationId')), returns: namedChoices(options(projection, 'returnLocationId')),
        identities: namedChoices(options(projection, 'bookingIdentity')), addresses: namedChoices(view.sources?.addresses ?? []) });
      this.updatePolicy();
    },
    async ensure(): Promise<Session | null> {
      const existing = sessions.get(this); if (existing) return existing;
      const owner = currentSession(), serviceCode = this.data.serviceCode, epoch = epochs.get(this), version = contextVersion();
      if (!shown.has(this) || !owner || owner.customer.customerType !== 'personal' || owner.serviceCode !== serviceCode) {
        this.setData({ loggedIn: false }); return null;
      }
      const current = () => shown.has(this) && epochs.get(this) === epoch && contextVersion() === version
        && currentSession() === owner && this.data.serviceCode === serviceCode;
      const context = { tenantCode: PUBLIC_CONFIG.tenantCode, serviceCode, customerId: owner.customer.customerId,
        surface: 'client_miniprogram' as const, current };
      let aborted = false;
      const cancellation = { signal: { get aborted() { return aborted; } }, cancel() { aborted = true; } };
      const key = clientGoalStorageKey(context), session = createClientGoalSession({ context, api: createClientGoalApi(current), cancellation,
        now: serverNow, newKey: () => newKey('client-goal'), storage: { read: () => readGoalStorage(key), write: value => writeRequiredStorage(key, value),
          archive: value => {
            const record = value as { goal?: { operationKey?: unknown } }, operationKey = record.goal?.operationKey;
            if (typeof operationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(operationKey)) throw Error('original_goal_missing');
            const archiveKey = `${key}:original:${operationKey}`, previous = readGoalStorage(archiveKey);
            if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(value)) throw Error('original_goal_changed');
            writeRequiredStorage(archiveKey, value); return readGoalStorage(archiveKey);
          } },
        changed: view => { if (current()) this.accept(view); } });
      sessions.set(this, session); currentBindings.set(this, { context, key }); this.setData({ loggedIn: true }); await session.open(); return current() ? session : null;
    },
    async run(action: (owner: Session) => Promise<unknown>) {
      if (busy.has(this) || !shown.has(this)) return;
      const epoch = epochs.get(this); busy.add(this); this.setData({ working: true, message: '' });
      try { const owner = await this.ensure(); if (owner) await action(owner); }
      catch { if (epochs.get(this) === epoch) this.setData({ message: '当前步骤暂不可用，请保留原记录并核对结果。' }); }
      finally { if (epochs.get(this) === epoch) { busy.delete(this); this.setData({ working: false }); } }
    },
    open() { return this.run(async owner => { if (owner.snapshot().hasLocator) await owner.refresh(); }); },
    onGoal(event: WechatMiniprogram.Input) { this.setData({ goal: String(event.detail.value ?? '').slice(0, 4096) }); },
    onAnswer(event: WechatMiniprogram.Input) { this.setData({ answer: String(event.detail.value ?? '').slice(0, this.data.answerMaxLength) }); },
    onExtract() { return this.run(owner => owner.extract(this.data.goal)); },
    onRead() { return this.run(async owner => {
      await owner.refresh(); const booking = await this.ensureBooking(owner, 'read');
      if (booking?.snapshot().canRead) await booking.recover();
    }); },
    onSubmitAnswer() { return this.run(owner => owner.submitClarification(this.data.answer)); },
    onContinueAnswer() { return this.run(owner => owner.continueAnswer()); },
    onConfirmQuote() { return this.run(owner => owner.confirmQuote()); },
    onChoice(event: WechatMiniprogram.TouchEvent) {
      if (!this.data.view.canPrepareQuote || this.data.working) return;
      const { field, id, row } = event.currentTarget.dataset, selected = String(id ?? ''), index = Number(row);
      const next = { ...this.data.form, lines: this.data.form.lines.map(line => ({ ...line })) };
      if (field === 'item') { if (!next.lines[index]) return; next.lines[index].item = selected; }
      else if (field === 'unit') { if (!next.lines[index]) return; next.lines[index].unit = selected; }
      else if (['mode','location','returnLocation','identity','address','payer'].includes(String(field))) {
        (next as unknown as Record<string, unknown>)[String(field)] = selected;
        if (field === 'identity') { next.payer = ''; next.notice = false; }
        if (field === 'mode') { next.location = ''; next.returnLocation = ''; next.address = ''; }
      } else return;
      this.setData({ form: next }); this.updatePolicy();
    },
    onLineInput(event: WechatMiniprogram.Input) {
      const index = Number(event.currentTarget.dataset.row), field = String(event.currentTarget.dataset.field);
      const lines = this.data.form.lines.map(line => ({ ...line }));
      if (!lines[index] || !['quantity','usage'].includes(field)) return;
      (lines[index] as unknown as Record<string, unknown>)[field] = String(event.detail.value ?? ''); this.setData({ 'form.lines': lines });
    },
    onDateTime(event: WechatMiniprogram.PickerChange) {
      const field = String(event.currentTarget.dataset.field);
      if (!['startDate','startTime','endDate','endTime'].includes(field)) return;
      this.setData({ [`form.${field}`]: String(event.detail.value) });
      try {
        const { startDate, startTime, endDate, endTime } = this.data.form;
        const starts = clientGoalTimeOptions(`${startDate}T${startTime}`, this.data.timeZone), ends = clientGoalTimeOptions(`${endDate}T${endTime}`, this.data.timeZone);
        this.setData({ startAt: starts.length === 1 ? starts[0].value : '', endAt: ends.length === 1 ? ends[0].value : '',
          message: startDate && startTime && starts.length !== 1 || endDate && endTime && ends.length !== 1 ? '所选商户时间不存在或有歧义，请更换时间。' : '' });
      } catch { this.setData({ startAt: '', endAt: '', message: '当前设备不能核对商户时区，请使用普通预约。' }); }
    },
    onNotice(event: WechatMiniprogram.CheckboxGroupChange) { this.setData({ 'form.notice': event.detail.value.includes('accepted') }); },
    updatePolicy() {
      const identity = this.data.form.identity, policy = this.data.view.sources?.enterprises?.find(row => row.corporateCustomerId === identity);
      this.setData({ delivery: ['delivery','onsite_delivery'].includes(this.data.form.mode)
        && this.data.view.sources?.fulfillment.deliveryDestination === 'customer_address',
        policyNotice: policy?.noticeText ?? '', canPersonalPay: policy?.available === true && policy.personalPaymentAllowed,
        canEnterprisePay: policy?.available === true && policy.enterprisePaymentAllowed });
    },
    onPrepareQuote() { return this.run(async owner => {
      const selected = this.data.form, policy = this.data.view.sources?.enterprises?.find(row => row.corporateCustomerId === selected.identity);
      if (!this.data.startAt || !this.data.endAt || !selected.identity || !selected.mode || !selected.location || !selected.returnLocation
        || selected.lines.some(line => line.unit === 'usage' && !line.usage.trim())
        || selected.identity !== 'personal' && (!policy?.noticeVersion || !policy.noticeText || !selected.notice || !selected.payer)) throw Error('selection_incomplete');
      const input = clientGoalSelectedInput({ bookingIdentity: selected.identity === 'personal' ? { bookingIdentity: 'personal', enterpriseContractAndPayer: false }
        : { bookingIdentity: 'enterprise_employee', corporateCustomerId: selected.identity, enterpriseContractAndPayer: selected.payer === 'enterprise',
          enterpriseDisclosure: { noticeVersion: policy!.noticeVersion!, acknowledged: true } }, fulfillmentMode: selected.mode,
        fulfillmentLocationId: selected.location, returnLocationId: selected.returnLocation, startAt: this.data.startAt, endAt: this.data.endAt,
        lines: selected.lines.map(line => ({ itemGroupId: line.item, quantity: Number(line.quantity), pricingUnit: line.unit,
          ...(line.unit === 'usage' ? { usageQuantity: Number(line.usage) } : {}) })), ...(this.data.delivery ? { deliveryAddressId: selected.address } : {}) } as ClientCreateQuoteRequest);
      await owner.prepareQuote(input, this.data.projectionHash);
    }); },
    async ensureBooking(owner: Session, purpose: 'read' | 'write') {
      const binding = currentBindings.get(this); if (!binding?.context.current() || sessions.get(this) !== owner) return null;
      const existing = bookings.get(this); if (existing) return existing;
      const reference = purpose === 'write' ? (await owner.selectedQuote())?.original : owner.quoteRecoveryReference();
      if (!reference || !binding.context.current()) return null;
      const key = `${binding.key}:booking:${reference.materialRef}`, cached = readGoalStorage(key);
      if (purpose === 'read' && cached === undefined) return null;
      let selection: AiBookingSelection;
      if (cached !== undefined) {
        const request = clientQuoteBookingStoredRequest(cached);
        if (JSON.stringify(request.original) !== JSON.stringify(reference)) throw Error('booking_origin_changed');
        selection = request.selection;
      } else {
        const source = await owner.selectedQuote(); if (!source || !binding.context.current()) return null;
        const selected = source.selection, identity = selected.bookingIdentity;
        if (!identity || !identity.bookingIdentity) throw Error('booking_identity_missing');
        selection = { quoteId: source.quote.quoteId, timeZone: source.timeZone, startAt: selected.startAt, endAt: selected.endAt,
          fulfillmentMode: selected.fulfillmentMode, fulfillmentLocationId: selected.fulfillmentLocationId,
          ...(selected.returnLocationId ? { returnLocationId: selected.returnLocationId } : {}),
          ...(selected.deliveryAddressId ? { deliveryAddressId: selected.deliveryAddressId } : {}),
          bookingIdentity: { bookingIdentity: identity.bookingIdentity,
            ...(identity.corporateCustomerId ? { corporateCustomerId: identity.corporateCustomerId } : {}),
            enterpriseContractAndPayer: identity.enterpriseContractAndPayer === true },
          lines: selected.lines.map(line => { if (!line.itemGroupId) throw Error('booking_item_missing'); return { itemGroupId: line.itemGroupId, quantity: line.quantity }; }) };
        sources.set(this, source);
      }
      const booking = createClientQuoteBookingSession({ context: binding.context, original: reference, selection: () => selection,
        readHost: readBookingHostCapabilities, api: { ...clientQuoteApi, readHandoff: readBookingHandoff }, now: serverNow,
        newKey: () => newKey('goal-booking'), storage: { read: () => readGoalStorage(key), write: value => writeRequiredStorage(key, value) },
        changed: view => { if (binding.context.current()) this.setData({ booking: view }); } });
      bookings.set(this, booking); await booking.open(); return binding.context.current() ? booking : null;
    },
    onGenerateDraft() { return this.run(async owner => {
      const booking = await this.ensureBooking(owner, 'write');
      if (booking?.snapshot().status === 'unknown') { await booking.recover(); return; }
      await booking?.generateDraft();
    }); },
    onSelect() { return this.run(async owner => {
      const binding = currentBindings.get(this), booking = bookings.get(this);
      if (!binding?.context.current() || !booking) return;
      if (booking.snapshot().status === 'unknown') { await booking.recover(); return; }
      const result = await booking.continueBooking();
      if (result.status === 'handoff_ready' && result.handoff && !result.readOnly && sessions.get(this) === owner && binding.context.current())
        this.triggerEvent('handoff', { handoffRef: result.handoff.handoffRef });
    }); },
    onBeginNew() { return this.run(async owner => {
      // A pending draft operation must remain recoverable under its original
      // goal. Only an observed stage can be left for a separately chosen goal.
      const booking = bookings.get(this) ?? await this.ensureBooking(owner, 'read');
      if (booking && (!booking.snapshot().observed || ['unknown','checking','unavailable'].includes(booking.snapshot().status))) throw Error('booking_original_unresolved');
      await owner.beginNewGoal();
      if (!owner.snapshot().hasLocator) {
        booking?.dispose(); bookings.delete(this); sources.delete(this);
        cancellationSessions.get(this)?.dispose(); cancellationSessions.delete(this);
        this.setData({ goal: '', answer: '', booking: null, cancellation: null });
      }
    }); },
    onCancelRead() { return this.stopGoal('read'); },
    onCancelRequest() { return this.stopGoal('request'); },
    onCancelFinish() { return this.stopGoal('finish'); },
    stopGoal(kind: 'read' | 'request' | 'finish') { return this.run(async owner => {
      const binding = currentBindings.get(this), origin = await owner.readCancellationOrigin();
      if (!binding?.context.current() || !origin || sessions.get(this) !== owner) return;
      let session = cancellationSessions.get(this);
      if (!session) {
        const context = { ...binding.context, orderId: `goal:${origin.reference.materialRef}` };
        const key = clientTaskCancellationStorageKey(context, origin);
        session = createClientTaskCancellationSession({ context, origin, api: clientTaskCancellationApi,
          storage: { read: () => readGoalStorage(key), write: value => writeRequiredStorage(key, value) },
          changed: view => { if (binding.context.current()) this.setData({ cancellation: view }); } });
        cancellationSessions.set(this, session);
      }
      if (kind === 'request') await session.requestCancellation();
      else if (kind === 'finish') await session.finishCancellation();
      else await session.refresh();
      await owner.refresh();
    }); },
    onLogin() { navigate(buildUrl(ROUTES.login, { redirect: ROUTES.catalog })); },
  },
});
