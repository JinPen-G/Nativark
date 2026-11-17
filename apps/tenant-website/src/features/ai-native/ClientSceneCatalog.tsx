/** Read-only scene metadata beside the original goal form. Mount/show/session
 * recovery never requests it. Current session, visibility and expiry bound the
 * displayed page; no directory row becomes a navigation or execution grant. */
import { useEffect, useRef, useState } from 'react';
import type { AiEntrySceneCatalogResponse } from '@rental-os/shared';
import { captureEnterpriseHostSession, subscribeCustomerSession } from '../../data/authClient';
import { readClientSceneCatalog } from './client-scene-catalog-api';

type View = { binding: string; page: AiEntrySceneCatalogResponse | null; busy: boolean; error: 'failed' | 'expired' | null; index: number };
export function ClientSceneCatalog({ scopeKey, tenantCode, serviceCode, english: en }: {
  scopeKey: string; tenantCode?: string; serviceCode?: string; english: boolean;
}) {
  const binding = JSON.stringify([scopeKey, tenantCode, serviceCode]);
  const [view, setView] = useState<View | null>(null);
  const lifetime = useRef({ binding, epoch: 0, mounted: false }); lifetime.current.binding = binding;
  const request = useRef<AbortController | null>(null), expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const owner = useRef<ReturnType<typeof captureEnterpriseHostSession>>(null), cursors = useRef<Array<string | null>>([null]);
  const retained = useRef<AiEntrySceneCatalogResponse | null>(null);
  const clear = () => {
    lifetime.current.epoch++; request.current?.abort(); request.current = null; owner.current = null;
    if (expiry.current !== null) clearTimeout(expiry.current); expiry.current = null;
    retained.current = null; cursors.current = [null]; setView(null);
  };
  useEffect(() => {
    lifetime.current.mounted = true; clear();
    const hidden = () => { if (document.hidden) clear(); };
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', clear);
    const unsubscribe = tenantCode ? subscribeCustomerSession(tenantCode, clear) : undefined;
    return () => {
      lifetime.current.mounted = false; lifetime.current.epoch++; request.current?.abort(); request.current = null; owner.current = null;
      if (expiry.current !== null) clearTimeout(expiry.current); expiry.current = null;
      retained.current = null; cursors.current = [null]; unsubscribe?.(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', clear);
    };
  }, [binding]);
  const session = captureEnterpriseHostSession();
  const eligible = !!session?.current() && session.tenantCode === tenantCode && session.workspaceCode === serviceCode;
  const shown = view?.binding === binding && owner.current?.current() && !document.hidden
    && (!view.page || Date.parse(view.page.expiresAt) > Date.now()) ? view : null;
  const read = async (index = 0, expectedPage?: AiEntrySceneCatalogResponse) => {
    const captured = captureEnterpriseHostSession();
    if (!lifetime.current.mounted || lifetime.current.binding !== binding || document.hidden || request.current || !captured?.current()
      || captured.tenantCode !== tenantCode || captured.workspaceCode !== serviceCode || !Number.isInteger(index) || index < 0 || index > (shown?.index ?? 0) + 1)
      throw Error('client_directory_changed');
    if (expectedPage && (retained.current !== expectedPage || Date.parse(expectedPage.expiresAt) <= Date.now())) {
      clear(); throw Error('client_directory_expired');
    }
    const after = index > (shown?.index ?? 0) ? shown?.page?.nextAfter : cursors.current[index];
    if (index > 0 && (!expectedPage || !after)) throw Error('client_directory_unavailable');
    const controller = new AbortController(), epoch = ++lifetime.current.epoch; request.current = controller; owner.current = captured;
    if (expiry.current !== null) clearTimeout(expiry.current); expiry.current = null;
    retained.current = null;
    setView({ binding, page: null, busy: true, error: null, index });
    const same = () => lifetime.current.mounted && lifetime.current.binding === binding && lifetime.current.epoch === epoch
      && !controller.signal.aborted && !document.hidden && captured.current();
    try {
      const page = await readClientSceneCatalog({ tenantCode: captured.tenantCode, current: same }, { limit: 20, ...(after ? { after } : {}) }, controller.signal);
      const now = Date.now(), remaining = Math.min(30000, Date.parse(page.expiresAt) - now);
      if (!same() || !(remaining > 0) || Date.parse(page.observedAt) > now) throw Error('client_directory_changed');
      if (expectedPage && JSON.stringify(page.scope) !== JSON.stringify(expectedPage.scope)) throw Error('client_directory_changed');
      retained.current = page;
      cursors.current = [...cursors.current.slice(0, index), after ?? null]; setView({ binding, page, busy: false, error: null, index });
      expiry.current = setTimeout(() => {
        if (!same()) return; lifetime.current.epoch++; retained.current = null; cursors.current = [null];
        setView({ binding, page: null, busy: false, error: 'expired', index: 0 }); expiry.current = null;
      }, remaining);
    } catch {
      if (same()) { retained.current = null; cursors.current = [null]; setView({ binding, page: null, busy: false, error: 'failed', index: 0 }); }
      else if (lifetime.current.mounted && lifetime.current.binding === binding && lifetime.current.epoch === epoch) clear();
    } finally { if (request.current === controller) request.current = null; }
  };
  const page = shown?.page, pageIndex = shown?.index ?? 0, text = (zh: string, english: string) => en ? english : zh;
  const statuses = { available: text('已观察原入口', 'Original entry observed'), manual_only: text('保留人工路径', 'Manual workflow available'),
    unavailable: text('当前不可用', 'Currently unavailable') };
  const confirmations = { read_only: text('只读', 'Read only'), explicit_prepare_or_save: text('明确准备或保存', 'Confirm preparation or save'),
    review_approval_and_original_submit: text('审核批准后在原入口提交', 'Review, approve and submit through the original workflow'),
    original_human_submit: text('人工在原入口提交', 'Human submission through the original workflow') };
  return <section aria-label={text('当前 AI 场景', 'Current AI scenes')} aria-busy={!!shown?.busy} style={{ minWidth: 0 }}>
    <button type="button" className="button button-outline" disabled={!eligible || !!shown?.busy || document.hidden}
      onClick={() => { void read().catch(() => undefined); }}>{text(page ? '重新核对 AI 场景' : '查看当前 AI 场景', page ? 'Recheck AI scenes' : 'View current AI scenes')}</button>
    {page && <button type="button" className="button button-outline" onClick={clear}>{text('收起场景目录', 'Close scene directory')}</button>}
    {!eligible && <p>{text('登录当前服务后可核对 AI 场景；普通选品和预约仍可继续。', 'Sign in to this service to check AI scenes. Ordinary browsing and booking remain available.')}</p>}
    {shown?.busy && <p role="status">{text('读取当前场景…', 'Reading current scenes…')}</p>}
    {shown?.error && <p role="status">{text(shown.error === 'expired' ? '场景观察已到期，请重新核对。' : '场景目录当前不可读取。请继续使用原人工入口。',
      shown.error === 'expired' ? 'This scene observation expired. Recheck it.' : 'The scene directory is unavailable. Use the original manual workflow.')}</p>}
    {page && <>
      <p>{text('目录只展示当前观察，办理时仍须原入口核验本人、资源与权限。', 'The directory displays current observations only. Original workflows verify identity, resources and access.')}</p>
      <p>{text('观察时间', 'Observed at')} <time dateTime={page.observedAt}>{page.observedAt}</time></p>
      {!page.entries.length && <p>{text('本页没有场景，普通预约仍可使用。', 'No scenes on this page. Ordinary booking remains available.')}</p>}
      <ul>{page.entries.map(entry => <li key={entry.entryId} style={{ overflowWrap: 'anywhere' }}>
        <strong>{entry.title}</strong>{' · '}{statuses[entry.availability.state]}{' · '}{entry.riskLevel}
        <p>{entry.goal}</p><p>{confirmations[entry.confirmation]}</p>
        <details><summary>{text('来源、权限与限制', 'Sources, access and limits')}</summary><dl>
          <dt>{text('已登记工具', 'Registered tools')}</dt><dd>{entry.tools.map(tool => tool.code).join(' · ') || text('沿原人工入口', 'Original manual workflow')}</dd>
          <dt>{text('最多返回数', 'Maximum results')}</dt><dd>{entry.output.maxResults}</dd>
          <dt>{text('原来源', 'Original source')}</dt><dd>{entry.availability.source ? `${entry.availability.source.reference} / ${entry.availability.source.revision}` : text('未观察到', 'Not observed')}</dd>
          <dt>{text('人工出口', 'Manual workflow')}</dt><dd>{entry.manualExit}</dd>
          <dt>{text('脱敏限制', 'Redaction limits')}</dt><dd>{entry.redaction.join(' · ')}</dd>
        </dl></details>
      </li>)}</ul>
      {(pageIndex > 0 || page.nextAfter) && <nav aria-label={text('场景目录分页', 'Scene directory pages')}>
        <button type="button" className="button button-outline" disabled={pageIndex === 0} onClick={() => { void read(pageIndex - 1, page).catch(() => undefined); }}>{text('上一页', 'Previous page')}</button>
        <span>{pageIndex + 1}</span>
        <button type="button" className="button button-outline" disabled={!page.nextAfter} onClick={() => { void read(pageIndex + 1, page).catch(() => undefined); }}>{text('下一页', 'Next page')}</button>
      </nav>}
    </>}
  </section>;
}
