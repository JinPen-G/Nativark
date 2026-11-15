/** Current scene metadata, read only after a human click. Hide, identity change
 * and expiry withdraw the page; reopening never restores or requests a page.
 * No generated navigation, execution control or local authorization is derived. */
import { useEffect, useRef, useState } from 'react';
import type { AiEntrySceneCatalogResponse } from '@rental-os/shared';
import { ActionButton, Alert } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { currentSessionEpoch } from '@/app/queryClient';
import { useAiManagementLocale } from './management-locale';
import { safeDisplayText } from './safe-display';
import { readEntrySceneCatalog } from './entry-scene-catalog-api';
import styles from './AiManagement.module.css';

const authBinding = () => {
  const auth = useAuthStore.getState();
  return JSON.stringify([auth.token, auth.user, auth.tenant?.tenantId, auth.currentWorkspaceId, currentSessionEpoch()]);
};
type View = { binding: string; page: AiEntrySceneCatalogResponse | null; busy: boolean; error: 'failed' | 'expired' | null; index: number };

export function EntrySceneCatalog({ identity, enabled, current }: { identity: string; enabled: boolean; current(): boolean }) {
  const auth = useAuthStore(), { locale } = useAiManagementLocale();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const sessionBinding = authBinding();
  const binding = JSON.stringify([identity, sessionBinding]);
  const [view, setView] = useState<View | null>(null);
  const lifecycle = useRef({ binding, enabled, current, mounted: false, epoch: 0 });
  lifecycle.current.binding = binding; lifecycle.current.enabled = enabled; lifecycle.current.current = current;
  const request = useRef<AbortController | null>(null), expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursors = useRef<Array<string | null>>([null]);
  const retained = useRef<AiEntrySceneCatalogResponse | null>(null);
  const clear = () => {
    lifecycle.current.epoch++; request.current?.abort(); request.current = null;
    if (expiry.current !== null) clearTimeout(expiry.current); expiry.current = null;
    retained.current = null; cursors.current = [null]; setView(null);
  };
  useEffect(() => {
    lifecycle.current.mounted = true;
    clear();
    const hidden = () => { if (document.hidden) clear(); };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      lifecycle.current.mounted = false; lifecycle.current.epoch++; request.current?.abort(); request.current = null;
      if (expiry.current !== null) clearTimeout(expiry.current); expiry.current = null;
      retained.current = null; cursors.current = [null]; document.removeEventListener('visibilitychange', hidden);
    };
  }, [binding, enabled]);
  const allowed = () => lifecycle.current.mounted && lifecycle.current.binding === binding && lifecycle.current.enabled
    && !document.hidden && lifecycle.current.current() && authBinding() === sessionBinding;
  const shown = view?.binding === binding && enabled && !document.hidden && current() && authBinding() === sessionBinding
    && (!view.page || Date.parse(view.page.expiresAt) > Date.now()) ? view : null;
  const read = async (index = 0, expectedPage?: AiEntrySceneCatalogResponse) => {
    if (!allowed() || request.current || !Number.isInteger(index) || index < 0 || index > (shown?.index ?? 0) + 1) throw Error('AI_SCOPE_CHANGED');
    if (expectedPage && (retained.current !== expectedPage || Date.parse(expectedPage.expiresAt) <= Date.now())) {
      clear(); throw Error('AI_DIRECTORY_EXPIRED');
    }
    const after = index > (shown?.index ?? 0) ? shown?.page?.nextAfter : cursors.current[index];
    if (index > 0 && (!expectedPage || !after)) throw Error('AI_DIRECTORY_UNAVAILABLE');
    const controller = new AbortController(), epoch = ++lifecycle.current.epoch;
    request.current = controller;
    if (expiry.current !== null) clearTimeout(expiry.current); expiry.current = null;
    retained.current = null;
    setView({ binding, page: null, busy: true, error: null, index });
    const same = () => allowed() && lifecycle.current.epoch === epoch && !controller.signal.aborted;
    try {
      const page = await readEntrySceneCatalog({ limit: 20, ...(after ? { after } : {}) }, controller.signal);
      const scope = page.scope;
      if (!same() || (auth.user?.isSaasAdmin ? page.audience !== 'platform' || scope.kind !== 'platform'
        : page.audience !== 'operations' || scope.kind !== 'workspace' || scope.tenantId !== auth.tenant?.tenantId
          || scope.workspaceId !== auth.currentWorkspaceId)) throw Error('AI_SCOPE_CHANGED');
      const now = Date.now(), remaining = Math.min(30000, Date.parse(page.expiresAt) - now);
      if (!(remaining > 0) || Date.parse(page.observedAt) > now) throw Error('AI_DIRECTORY_EXPIRED');
      retained.current = page;
      cursors.current = [...cursors.current.slice(0, index), after ?? null];
      setView({ binding, page, busy: false, error: null, index });
      expiry.current = setTimeout(() => {
        if (!same()) return;
        lifecycle.current.epoch++; retained.current = null; cursors.current = [null];
        setView({ binding, page: null, busy: false, error: 'expired', index: 0 }); expiry.current = null;
      }, remaining);
    } catch (error) {
      if (same()) { retained.current = null; cursors.current = [null]; setView({ binding, page: null, busy: false, error: 'failed', index: 0 }); }
      else if (lifecycle.current.mounted && lifecycle.current.binding === binding && lifecycle.current.epoch === epoch) clear();
      throw error;
    } finally { if (request.current === controller) request.current = null; }
  };
  if (!enabled) return null;
  const page = shown?.page, pageIndex = shown?.index ?? 0;
  const status = { available: text('已观察原入口', 'Original entry observed'), manual_only: text('保留人工路径', 'Manual workflow available'),
    unavailable: text('当前不可用', 'Currently unavailable') };
  const confirmation = { read_only: text('只读', 'Read only'), explicit_prepare_or_save: text('明确准备或保存', 'Confirm preparation or save'),
    review_approval_and_original_submit: text('审核批准后在原入口提交', 'Review, approve and submit through the original workflow'),
    original_human_submit: text('人工在原入口提交', 'Human submission through the original workflow') };
  return <section className={styles.section} aria-label={text('当前 AI 场景', 'Current AI scenes')} aria-busy={!!shown?.busy}>
    <div className={styles.toolbar}>
      <ActionButton variant="secondary" label={text(page ? '重新核对 AI 场景' : '查看当前 AI 场景', page ? 'Recheck AI scenes' : 'View current AI scenes')}
        pendingLabel={text('读取中…', 'Reading…')} disabled={!!shown?.busy || !auth.token || !enabled || document.hidden}
        onAction={() => read()} />
      {page && <ActionButton variant="secondary" label={text('收起场景目录', 'Close scene directory')} onAction={async () => clear()} />}
    </div>
    {shown?.error && <Alert type="warning" title={text(shown.error === 'expired' ? '场景观察已到期，请重新核对。' : '场景目录当前不可读取。',
      shown.error === 'expired' ? 'This scene observation expired. Recheck it.' : 'The scene directory is unavailable.')}
      description={text('原人工入口仍可使用，目录结果不授予任务或业务执行权限。', 'Use the original manual workflow. Directory results do not grant Task or business execution access.')} />}
    {page && <>
      <p className={styles.help} role="status">{text('以下是当前有界场景观察，办理时仍须原入口核验权限与对象。',
        'This is a bounded current scene observation. Original workflows still verify access and resources.')}</p>
      <p className={styles.help}>{text('观察时间', 'Observed at')} <time dateTime={page.observedAt}>{page.observedAt}</time></p>
      {!page.entries.length && <p>{text('本页没有场景，继续使用原人工入口。', 'No scenes on this page. Use the original manual workflow.')}</p>}
      <ul>{page.entries.map(entry => <li key={entry.entryId} style={{ overflowWrap: 'anywhere' }}>
        <strong>{safeDisplayText(entry.title, 128)}</strong>{' · '}{status[entry.availability.state]}{' · '}{entry.riskLevel}
        <p>{safeDisplayText(entry.goal, 1000)}</p>
        <p>{confirmation[entry.confirmation]}</p>
        <details><summary>{text('来源、权限与限制', 'Sources, access and limits')}</summary><dl>
          <dt>{text('已登记工具', 'Registered tools')}</dt><dd>{entry.tools.map(tool => tool.code).join(' · ') || text('沿原人工入口', 'Original manual workflow')}</dd>
          <dt>{text('原权限要求', 'Original access requirements')}</dt><dd>{entry.requiredPermissions.join(' · ') || text('由原入口核对本人及资源范围', 'The original workflow verifies identity and resource scope')}</dd>
          <dt>{text('最多返回数', 'Maximum results')}</dt><dd>{entry.output.maxResults}</dd>
          <dt>{text('原来源', 'Original source')}</dt><dd>{entry.availability.source ? `${entry.availability.source.reference} / ${entry.availability.source.revision}` : text('未观察到', 'Not observed')}</dd>
          <dt>{text('人工出口', 'Manual workflow')}</dt><dd>{entry.manualExit}</dd>
          <dt>{text('脱敏限制', 'Redaction limits')}</dt><dd>{entry.redaction.join(' · ')}</dd>
        </dl></details>
      </li>)}</ul>
      {(pageIndex > 0 || page.nextAfter) && <nav className={styles.toolbar} aria-label={text('场景目录分页', 'Scene directory pages')}>
        <ActionButton label={text('上一页', 'Previous page')} disabled={pageIndex === 0} onAction={() => read(pageIndex - 1, page)} />
        <span>{pageIndex + 1}</span>
        <ActionButton label={text('下一页', 'Next page')} disabled={!page.nextAfter} onAction={() => read(pageIndex + 1, page)} />
      </nav>}
    </>}
  </section>;
}
