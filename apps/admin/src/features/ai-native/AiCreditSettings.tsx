/** Ordinary tenant credit requests/space ceilings and SaaS decisions. Neither
 * form edits provider rates, seeds task permissions or retries unknown writes. */
import { useEffect, useId, useRef, useState } from 'react';
import type { AiCreditRequest, AiCreditSummary } from '@rental-os/shared';
import { aiCreditApi } from '@/api/aiCredit';
import { useAiManagementLocale as useLocale } from './management-locale';
import styles from './AiManagement.module.css';
import { currentSessionEpoch } from '@/app/queryClient';
import { ActionButton, Alert, ConfirmAction, Input, Select } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { readCreditOperationReference, retainCreditOperationReference, clearCreditOperationReference, emptyCreditReference,
  type CreditReferenceState, type CreditReferenceStorage } from './credit-operation-reference';
const identityNow = (platform = false) => { const auth = useAuthStore.getState(); return platform
  ? JSON.stringify([auth.user, currentSessionEpoch()]) : JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user]); };
const money = (value: string) => value.replace(/(\.\d*?[1-9])0+$|\.0+$/u, '$1');
const statusText = { pending: '等待平台审批', approved: '已获批', rejected: '未获批' };
function useCurrent(identity: string, platform = false) {
  const alive = useRef(true), epoch = useRef(currentSessionEpoch());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return () => alive.current && identityNow(platform) === identity && currentSessionEpoch() === epoch.current;
}
type Pending = { operationKey: string; currency: string; amount: string };
type AllocationPending = Pick<Parameters<typeof aiCreditApi.allocate>[0], 'operationKey' | 'currency' | 'expectedRevision'>;
type DecisionPending = { requestId: string; operationKey: string };
function referenceStorage(): CreditReferenceStorage | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}
function savedAllocation(key: string): CreditReferenceState<AllocationPending> {
  return readCreditOperationReference(referenceStorage(), key, input => {
    const value = input as Partial<AllocationPending> | null;
    return value && typeof value === 'object' && typeof value.operationKey === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.operationKey)
      && typeof value.currency === 'string' && /^[A-Z]{3}$/u.test(value.currency)
      && Number.isSafeInteger(value.expectedRevision) && value.expectedRevision! > 0 && value.expectedRevision! <= 4294967295
      ? { operationKey: value.operationKey, currency: value.currency, expectedRevision: value.expectedRevision! } : null;
  });
}
function savedDecision(key: string, requestId: string): CreditReferenceState<DecisionPending> {
  return readCreditOperationReference(referenceStorage(), key, value => {
    const input = typeof value === 'string' ? { requestId, operationKey: value } : value as Partial<DecisionPending> | null;
    return input && input.requestId === requestId && typeof input.operationKey === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.operationKey)
      ? { requestId, operationKey: input.operationKey } : null;
  });
}
function knownRejection(error: unknown) {
  const response = (error as { response?: { status?: number; data?: { code?: string } } })?.response;
  return (response?.status === 400 && response.data?.code === 'AI_INVALID_INPUT')
    || (response?.status === 409 && ['AI_CREDIT_REQUEST_PENDING', 'AI_CREDIT_ALLOCATION_EXCEEDED', 'AI_CREDIT_ALREADY_COMMITTED', 'AI_REVISION_CONFLICT'].includes(response.data?.code ?? ''))
    || (response?.status === 503 && response.data?.code === 'AI_PLATFORM_PRICING_NOT_CONFIGURED');
}
function savedPending(key: string): CreditReferenceState<Pending> {
  return readCreditOperationReference(referenceStorage(), key, input => {
    const value = input as Partial<Pending> | null;
    return value && typeof value === 'object' && typeof value.operationKey === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.operationKey)
      && typeof value.currency === 'string' && /^[A-Z]{3}$/u.test(value.currency) && typeof value.amount === 'string'
      && /^(0|[1-9][0-9]{0,17})(?:\.\d{1,6})?$/u.test(value.amount) && /[1-9]/u.test(value.amount)
      ? { operationKey: value.operationKey, currency: value.currency, amount: value.amount } : null;
  });
}
export function TenantAiCreditSettings({ identity }: { identity: string }) {
  const { t } = useLocale(), field = useId(), current = useCurrent(identity);
  const owner = useAuthStore.getState(), storageKey = `ai_credit_request:${owner.tenant?.tenantId}:${owner.user?.id}`;
  const [summary, setSummary] = useState<AiCreditSummary | null>(null), [busy, setBusy] = useState(false);
  const [currency, setCurrency] = useState(''), [amount, setAmount] = useState('');
  const [requestJournal, setRequestJournal] = useState(() => savedPending(storageKey));
  const pending = requestJournal.reference;
  const [message, setMessage] = useState(''), [limits, setLimits] = useState<Record<string, string>>({});
  const allocationStorage = `${storageKey}:allocation`;
  const [allocationJournal, setAllocationJournal] = useState(() => savedAllocation(allocationStorage));
  const allocationPending = allocationJournal.reference;
  const allocationUnknown = !!allocationPending || allocationJournal.blocked;
  const selectedCurrency = currency || summary?.currencies[0] || summary?.balances[0]?.currency || '';
  const balance = summary?.balances.find(row => row.currency === selectedCurrency);
  const load = async () => {
    setBusy(true);
    try {
      const value = await aiCreditApi.read(); if (!current()) return;
      setSummary(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value);
      setMessage('');
    } catch { if (current()) { setSummary(null); setMessage(t('额度暂不可用，请联系平台管理员检查平台 AI 配置和额度服务。')); } }
    finally { if (current()) setBusy(false); }
  };
  useEffect(() => { void load(); }, [identity]);
  const clearPending = (original = requestJournal) => {
    clearCreditOperationReference(referenceStorage(), storageKey, original);
    setRequestJournal(emptyCreditReference<Pending>());
  };
  const apply = async () => {
    if (pending || requestJournal.blocked || busy || !current() || !selectedCurrency || !/^(0|[1-9][0-9]{0,17})(?:\.\d{1,6})?$/u.test(amount)
      || !/[1-9]/u.test(amount)) throw Error(t('请输入有效申请金额。'));
    const command = { operationKey: window.crypto.randomUUID(), currency: selectedCurrency, amount };
    // Persist the original locator BEFORE sending; storage failure prevents write.
    let journal: CreditReferenceState<Pending>;
    try { journal = retainCreditOperationReference(referenceStorage(), storageKey, command); }
    catch (error) { setRequestJournal({ ...savedPending(storageKey), blocked: true }); throw error; }
    setRequestJournal(journal); setBusy(true);
    try {
      if (!current()) return;
      await aiCreditApi.request(command); if (!current()) return;
      clearPending(journal); setAmount(''); await load(); setMessage(t('申请已提交，等待 SaaS 平台管理员审批。'));
    } catch (error) { if (current()) {
      if (knownRejection(error)) { clearPending(journal); setMessage(t('申请未通过校验，或已有待审批申请，请刷新后检查金额与申请状态。')); }
      else setMessage(t('申请未确认，请先核对原申请；不要重复申请。'));
    } throw error; }
    finally { if (current()) setBusy(false); }
  };
  const observe = async () => {
    if (!pending || !current()) return;
    const result = await aiCreditApi.receipt(pending.operationKey); if (!current()) return;
    if (result.state !== 'recorded') { setMessage(t('尚不能确认原申请是否保存，请保留原申请编号。')); return; }
    clearPending(); await load();
  };
  const allocate = async () => {
    if (!balance || !summary || allocationUnknown || busy || !current()) throw Error(t('请重新读取获批额度。'));
    const allocationKey = (workspaceId: string) => `${balance.currency}:${balance.revision}:${workspaceId}`;
    const allocations = summary.workspaces.map(space => ({ workspaceId: space.id, amount: limits[allocationKey(space.id)]
      ?? balance.allocations.find(row => row.workspaceId === space.id)?.amount ?? '0' }));
    const command = { operationKey: window.crypto.randomUUID(), currency: balance.currency, expectedRevision: balance.revision, allocations };
    let journal: CreditReferenceState<AllocationPending>;
    try { journal = retainCreditOperationReference(referenceStorage(), allocationStorage,
      { operationKey: command.operationKey, currency: command.currency, expectedRevision: command.expectedRevision }); }
    catch (error) { setAllocationJournal({ ...savedAllocation(allocationStorage), blocked: true }); throw error; }
    setAllocationJournal(journal); setBusy(true);
    const clear = () => { clearCreditOperationReference(referenceStorage(), allocationStorage, journal);
      setAllocationJournal(emptyCreditReference<AllocationPending>()); };
    try { if (!current()) return; await aiCreditApi.allocate(command); if (current()) { clear(); await load(); } }
    catch (error) { if (current()) {
      if (knownRejection(error)) { clear(); setMessage(t('分配未通过校验，请检查金额、已占用额度及当前设置。')); }
      else setMessage(t('分配结果未确认，请核对原分配收据，不要再次保存。'));
    } throw error; }
    finally { if (current()) setBusy(false); }
  };
  const observeAllocation = async () => {
    if (!allocationPending || !current()) return;
    const result = await aiCreditApi.allocationReceipt({ operationKey: allocationPending.operationKey, currency: allocationPending.currency });
    if (!current()) return;
    if (result.state !== 'recorded' || result.result.state !== 'allocated' || result.result.revision !== allocationPending.expectedRevision + 1) {
      setMessage(t('尚不能确认原分配是否保存，请保留原编号。')); return;
    }
    clearCreditOperationReference(referenceStorage(), allocationStorage, allocationJournal);
    setAllocationJournal(emptyCreditReference<AllocationPending>()); await load();
  };
  return <section className={`${styles.editor} ${styles.section}`} aria-label={t('平台 AI 额度')}>
    <p className={styles.help}>{t('额度为累计上限，不按月重置。')}</p>
    {(requestJournal.blocked || allocationJournal.blocked) && <Alert type="warning"
      title={t('原操作引用无法可靠保存或读取，已停止发送。请恢复浏览器存储并核对原保存结果。')} />}
    {message && <Alert type="info" title={message} />}
    <div className={styles.toolbar}><ActionButton variant="secondary" label={t('刷新额度')} disabled={busy} onAction={load} /></div>
    {summary && <>
      {(summary.currencies.length > 0 || summary.balances.length > 0) && <div className={`${styles.field} ${styles.compactField}`}><label htmlFor={`${field}-currency`}>{t('计费币种')}</label>
      <Select id={`${field}-currency`} value={selectedCurrency || undefined} disabled={busy || !!pending || requestJournal.blocked}
        options={[...new Set([...summary.currencies, ...summary.balances.map(row => row.currency)])].map(value => ({ value, label: value }))}
        onChange={value => { setCurrency(String(value)); setLimits({}); }} /></div>}
      {balance && <dl className={styles.facts}>
        <div><dt>{t('平台已批准总额')}</dt><dd>{balance.currency} {money(balance.grantedAmount)}</dd></div>
        <div><dt>{t('已使用')}</dt><dd>{balance.currency} {money(balance.spentAmount)}</dd></div>
        <div><dt>{t('待结算占用')}</dt><dd>{balance.currency} {money(balance.heldAmount)}</dd></div>
        <div><dt>{t('剩余可用')}</dt><dd>{balance.currency} {money(balance.availableAmount)}</dd></div>
      </dl>}
      {!summary.currencies.length && <Alert type="info" title={t('平台尚未发布可申请的 AI 计费配置，请联系 SaaS 管理员。')} />}
      {summary.currencies.length > 0 && <div className={styles.requestRow}><div className={styles.field}><label htmlFor={`${field}-amount`}>{t('申请增加额度')}</label>
      <Input id={`${field}-amount`} inputMode="decimal" value={amount} maxLength={25} disabled={busy || !!pending || requestJournal.blocked}
        onChange={event => setAmount(event.target.value)} /></div>
      <ActionButton label={t('提交额度申请')} successLabel={t('申请已提交，等待审批')}
        disabled={busy || !!pending || requestJournal.blocked || !summary.currencies.includes(selectedCurrency) || !amount} onAction={apply} /></div>}
      {balance && <>
        <h4>{t('空间金额上限')}</h4>
        <p className={styles.help}>{t('各空间上限合计不得超过批准总额；已使用及待核对金额仍计入占用。')}</p>
        <ul className={styles.allocations}>{summary.workspaces.map(space => <li key={space.id}>
          <label htmlFor={`${field}-${space.id}`}>{space.name}</label>
          <Input id={`${field}-${space.id}`} inputMode="decimal" maxLength={25} disabled={busy || allocationUnknown}
            value={limits[`${balance.currency}:${balance.revision}:${space.id}`] ?? balance.allocations.find(row => row.workspaceId === space.id)?.amount ?? '0'}
            onChange={event => setLimits(previous => ({ ...previous, [`${balance.currency}:${balance.revision}:${space.id}`]: event.target.value }))} />
        </li>)}</ul>
        <ActionButton label={t('保存空间上限')} successLabel={t('空间上限已保存')} disabled={busy || allocationUnknown} onAction={allocate} />
      </>}
      {!!summary.requests.length && <><h4>{t('近期申请')}</h4><ul>{summary.requests.map(row => <li key={row.id}>
        {row.currency} {money(row.requestedAmount)} · {t(statusText[row.state])}
        {row.grantedAmount !== null && ` · ${t('获批')} ${money(row.grantedAmount)}`}
      </li>)}</ul>{!summary.requestHistoryComplete && <p>{t('这里只显示最近 20 条申请。')}</p>}</>}
    </>}
    {pending && <><p>{t('原申请编号')}：<code>{pending.operationKey}</code></p>
      <ActionButton label={t('核对原申请')} disabled={busy} onAction={observe} /></>}
    {allocationPending && <><p>{t('原分配编号')}：<code>{allocationPending.operationKey}</code></p>
      <ActionButton label={t('核对原分配收据')} disabled={busy} onAction={observeAllocation} /></>}
  </section>;
}

export function PlatformAiCreditSettings({ identity }: { identity: string }) {
  const { t } = useLocale(), current = useCurrent(identity, true);
  const userId = useAuthStore(state => state.user?.id);
  const [journals, setJournals] = useState<{ requestId: string; operationKey: string; reference: CreditReferenceState<DecisionPending> }[]>([]);
  const [rows, setRows] = useState<AiCreditRequest[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const load = async (next?: string) => {
    setBusy(true);
    try {
      const prefix = `ai_credit_decision:${userId}:`, found: typeof journals = [];
      for (let index = 0; index < window.sessionStorage.length && found.length < 20; index++) {
        const key = window.sessionStorage.key(index);
        if (key?.startsWith(prefix)) {
          const requestId = key.slice(prefix.length), reference = savedDecision(key, requestId);
          if (reference.reference || reference.blocked) found.push({ requestId,
            operationKey: reference.reference?.operationKey ?? '', reference });
        }
      }
      setJournals(found);
    } catch { /* individual original locators remain untouched */ }
    try { const result = await aiCreditApi.platformRead(next); if (!current()) return;
      setRows(result.requests); setCursor(result.nextCursor); setMessage('');
    } catch { if (current()) { setRows([]); setMessage(t('额度申请暂不可用，或当前权限不足。')); } }
    finally { if (current()) setBusy(false); }
  };
  useEffect(() => { void load(); }, [identity]);
  const observe = async (journal: typeof journals[number]) => {
    if (!current() || !journal.reference.reference) return;
    const result = await aiCreditApi.platformReceipt(journal.requestId, journal.operationKey); if (!current()) return;
    if (result.state !== 'recorded' || result.originalDecision === 'unknown') {
      setMessage(t('原审批仍待核对，请保留编号；不能重复增额。')); return;
    }
    clearCreditOperationReference(referenceStorage(), `ai_credit_decision:${userId}:${journal.requestId}`, journal.reference);
    await load();
    setMessage(t(result.originalDecision === 'matched' ? '原审批结果已核对，请以实际获批金额为准。' : '该申请已由另一项审批处理，本次原操作不能再次增额。'));
  };
  return <section aria-label={t('租户 AI 额度申请')}><h3>{t('租户 AI 额度申请')}</h3>
    <p>{t('审批只增加租户可使用的平台 AI 金额，不自动授权其业务工具或高风险操作。')}</p>
    {message && <Alert type="warning" title={message} />}
    <ActionButton label={t('刷新待审批申请')} disabled={busy} onAction={() => load()} />
    {journals.map(journal => <div key={journal.requestId}><p>{t('待核对原审批')}：<code>{journal.requestId}</code></p>
      {journal.reference.blocked && <Alert type="warning"
        title={t('原操作引用无法可靠保存或读取，已停止发送。请恢复浏览器存储并核对原保存结果。')} />}
      <ActionButton label={t('核对原审批')} disabled={busy || !journal.reference.reference} onAction={() => observe(journal)} /></div>)}
    {!busy && !rows.length && !message && <p>{t('暂无待审批申请。')}</p>}
    {rows.map(row => <CreditDecision key={row.id} row={row} identity={identity} onSaved={() => load()} />)}
    {cursor && <ActionButton label={t('下一页')} disabled={busy} onAction={() => load(cursor)} />}
  </section>;
}
function CreditDecision({ row, identity, onSaved }: { row: AiCreditRequest; identity: string; onSaved: () => Promise<void> }) {
  const { t } = useLocale(), field = useId(), current = useCurrent(identity, true), auth = useAuthStore();
  const [amount, setAmount] = useState(row.requestedAmount), [busy, setBusy] = useState(false);
  const storageKey = `ai_credit_decision:${auth.user?.id}:${row.id}`;
  const [journal, setJournal] = useState(() => savedDecision(storageKey, row.id));
  const uncertain = !!journal.reference || journal.blocked;
  useEffect(() => { setJournal(savedDecision(storageKey, row.id)); }, [storageKey, row.id]);
  const decide = async (decision: 'approve' | 'reject') => {
    if (!current() || uncertain || busy || !auth.hasPermission('system:ai-provider:manage')) throw Error(t('当前不能提交审批。'));
    const operationKey = window.crypto.randomUUID();
    let retained: CreditReferenceState<DecisionPending>;
    try { retained = retainCreditOperationReference(referenceStorage(), storageKey, { requestId: row.id, operationKey }); }
    catch (error) { setJournal({ ...savedDecision(storageKey, row.id), blocked: true }); throw error; }
    setJournal(retained); setBusy(true);
    const clear = () => { clearCreditOperationReference(referenceStorage(), storageKey, retained);
      setJournal(emptyCreditReference<DecisionPending>()); };
    try { if (!current()) return; await aiCreditApi.platformDecide({ requestId: row.id, expectedRevision: row.revision, operationKey,
      decision, ...(decision === 'approve' ? { amount } : {}) }); if (!current()) return;
      clear(); await onSaved();
    } catch (error) {
      if (current() && knownRejection(error)) clear();
      throw error;
    } finally { if (current()) setBusy(false); }
  };
  const observe = async () => {
    if (!current()) return;
    const original = savedDecision(storageKey, row.id); setJournal(original);
    if (!original.reference) return;
    const result = await aiCreditApi.platformReceipt(row.id, original.reference.operationKey); if (!current()) return;
    // A pending row or an unknown original decision is not COMMIT evidence.
    if (result.state !== 'recorded' || result.request.state === 'pending' || result.originalDecision === 'unknown') return;
    clearCreditOperationReference(referenceStorage(), storageKey, original);
    setJournal(emptyCreditReference<DecisionPending>()); await onSaved();
  };
  return <section aria-label={`${t('额度申请')} ${row.tenantName}`}>
    <h4>{row.tenantName}</h4><p>{t('申请金额')}：{row.currency} {money(row.requestedAmount)}</p>
    <label htmlFor={field}>{t('批准增加金额')}</label>
    <Input id={field} inputMode="decimal" maxLength={25} value={amount} disabled={busy || uncertain} onChange={event => setAmount(event.target.value)} />
    <ConfirmAction label={t('批准额度')} prompt={t('批准后将增加该租户的平台 AI 总额度，金额不可超过本次申请。')}
      disabled={busy || uncertain || !auth.hasPermission('system:ai-provider:manage')} onConfirm={() => decide('approve')} />
    <ConfirmAction label={t('拒绝申请')} prompt={t('拒绝本次额度申请？不会扣减此前批准的额度。')}
      disabled={busy || uncertain || !auth.hasPermission('system:ai-provider:manage')} onConfirm={() => decide('reject')} />
    {journal.blocked && <Alert type="warning"
      title={t('原操作引用无法可靠保存或读取，已停止发送。请恢复浏览器存储并核对原保存结果。')} />}
    {uncertain && <><p>{t('原审批尚未确认，请核对原申请，不能重复增额。')}</p>
      <ActionButton label={t('核对原审批')} disabled={busy || !journal.reference} onAction={observe} /></>}
  </section>;
}
