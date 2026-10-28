import { useState } from 'react';
import { useIsMutating, useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { matchPath, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Check, Clock3, Download, UserRoundCheck, UserRoundPen } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { APP_ROUTES, canAccessRoute } from '@/app/navigation';
import { currentSessionEpoch, isTransientRefreshError } from '@/app/queryClient';
import { rentalCoreApi } from '@/api/rentalCore';
import { useAuthStore } from '@/features/auth/authStore';
import { useOperator } from '@/features/ai-operator/OperatorContext';
import { confirmationDetails } from '@/features/ai-operator/confirmationDetails';
import { useNotifications } from './NotificationProvider';
import { useNotificationText } from './locale';
import type { Notice } from './model';

class AssignmentError extends Error { constructor(message: string, readonly unknownOutcome: boolean, readonly owner?: string, readonly epoch?: number) { super(message); } }
const assignmentLocks = new Set<string>();
const uncertainAssignments = new Set<string>();
const scope = () => { const s = useAuthStore.getState(); return JSON.stringify([s.user?.id, s.tenant?.tenantId, s.currentWorkspaceId]); };

/** Additive business slot: original read/folder/dismiss controls stay in their source components. */
export function NoticeActions({ id, surface = 'popup' }: { id: string; surface?: 'popup' | 'inbox' }) {
  const inbox = useNotifications(), auth = useAuthStore(), operator = useOperator(), navigate = useNavigate(), tr = useNotificationText();
  const item = inbox.messages.find(message => message.id === id);
  if (!item) return null;
  const href = allowedHref(item, auth);
  return <div className="notification-business">
    {item.workOrderId && <WorkOrderActions item={item} />}
    {item.threadId && <AiDraftActions item={item} />}
    <div className="notification-business-links"><Button size="small" disabled={!href} icon={<ArrowUpRight size={14} />} onClick={() => {
      const fresh = inbox.messages.find(message => message.id === id), current = useAuthStore.getState();
      const path = fresh && allowedHref(fresh, current);
      if (!path) return;
      inbox.update(id, { read: true });
      if (fresh?.threadId) operator.openConversation(fresh.threadId);
      navigate(path);
    }}>{tr(item.demo ? 'Open workspace' : 'Open record')}</Button>
      {surface === 'popup' && item.folder === 'Inbox' && <Button size="small" icon={<Clock3 size={14} />} onClick={() => inbox.update(id, { folder: 'Snoozed' })}>{tr('Snooze')}</Button>}
    </div>
  </div>;
}

function allowedHref(item: Notice, auth: ReturnType<typeof useAuthStore.getState>) {
  const href = item.workOrderId ? APP_ROUTES.workOrderDetail.path.replace(':workOrderId', encodeURIComponent(item.workOrderId)) : item.href;
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return null;
  const url = new URL(href, 'https://rental.invalid');
  if (url.origin !== 'https://rental.invalid') return null;
  const route = Object.values(APP_ROUTES).filter(entry => matchPath({ path: entry.path, end: false }, url.pathname)).sort((a, b) => b.path.length - a.path.length)[0];
  return route && canAccessRoute(route, auth.hasPermission, auth.hasCapability, auth.tenant?.categoryCode,
    !!auth.user?.isSaasAdmin, auth.hasTenantMembershipPermission) ? href : null;
}

function WorkOrderActions({ item }: { item: Notice }) {
  const auth = useAuthStore(), tr = useNotificationText(), client = useQueryClient(), inbox = useNotifications();
  const [editing, setEditing] = useState(false), [assignee, setAssignee] = useState<string>(), [version, setVersion] = useState<string>();
  const owner = scope(), mutationKey = ['notifications', 'assignment', owner, item.workOrderId];
  const operationKey = `${owner}:${item.workOrderId}`;
  const canView = auth.sessionVerified && auth.hasPermission('rental-core:maintenance:view');
  const canManage = canView && auth.hasPermission('rental-core:maintenance:manage');
  const records = useQuery({ queryKey: ['notifications', 'work-order-context', owner, auth.user], queryFn: () => rentalCoreApi.workOrders(), enabled: canView });
  const row = (!records.isError || isTransientRefreshError(records.error)) && Array.isArray(records.data) ? records.data.find(value => value.id === item.workOrderId) : undefined;
  const eligibleStatus = !!row && ['pending', 'in_progress'].includes(row.status);
  const assignees = useQuery({ queryKey: ['notifications', 'assignees', owner, auth.user, row?.locationId],
    queryFn: () => rentalCoreApi.workOrderAssignees(row!.locationId), enabled: canManage && eligibleStatus });
  const candidates = (!assignees.isError || isTransientRefreshError(assignees.error)) && Array.isArray(assignees.data) ? assignees.data : [];
  const busy = useIsMutating({ mutationKey }) > 0;
  const unknownInCache = useMutationState({ filters: { mutationKey }, select: mutation => mutation.state.error instanceof AssignmentError && mutation.state.error.unknownOutcome }).some(Boolean);
  const unknown = uncertainAssignments.has(operationKey) || unknownInCache;
  const assign = useMutation({ mutationKey, retry: false,
    mutationFn: async (target: string) => {
      const expectedScope = scope(), epoch = currentSessionEpoch(), lock = `${expectedScope}:${item.workOrderId}`;
      const live = () => scope() === expectedScope && currentSessionEpoch() === epoch && useAuthStore.getState().hasPermission('rental-core:maintenance:manage');
      if (assignmentLocks.has(lock) || uncertainAssignments.has(lock) || unknown) throw new AssignmentError(tr('An action is already pending.'), false);
      assignmentLocks.add(lock); let sent = false;
      try {
        if (!live() || !row || !target) throw new Error(tr('This action is no longer available.'));
        const rows = await rentalCoreApi.workOrders();
        const current = Array.isArray(rows) ? rows.find(value => value.id === row.id) : undefined;
        if (!live()) throw new Error(tr('This action is no longer available.'));
        if (!current || current.workspaceId !== useAuthStore.getState().currentWorkspaceId || !['pending', 'in_progress'].includes(current.status)
          || current.updatedAt !== (editing ? version : row.updatedAt)) throw new Error(tr('The work order changed. Review it again.'));
        const available = await rentalCoreApi.workOrderAssignees(current.locationId);
        if (!live() || !Array.isArray(available) || !available.some(person => person.id === target)) throw new Error(tr('This assignee is no longer available.'));
        const result = current.assigneeId === target ? current : await (sent = true, rentalCoreApi.assignWorkOrder(current.id, { assigneeId: target }));
        if (!result || result.id !== current.id || result.workspaceId !== current.workspaceId || result.assigneeId !== target) throw new AssignmentError(tr('Assignment result is unknown. Check the work order before trying again.'), true, expectedScope, epoch);
        return { result, expectedScope, epoch };
      } catch (error) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        const uncertain = sent && (!status || status >= 500 || status === 408);
        if (uncertain) uncertainAssignments.add(lock);
        throw new AssignmentError(uncertain ? tr('Assignment result is unknown. Check the work order before trying again.') : error instanceof Error ? error.message : tr('Assignment failed.'), uncertain, expectedScope, epoch);
      } finally { assignmentLocks.delete(lock); }
    },
    onSuccess: async ({ expectedScope, epoch }) => {
      if (scope() !== expectedScope || currentSessionEpoch() !== epoch) return;
      setEditing(false); inbox.update(item.id, { read: true });
      await Promise.all([client.invalidateQueries({ queryKey: ['notifications'] }), client.invalidateQueries({ queryKey: ['rental-core', 'work-orders'] }), client.invalidateQueries({ queryKey: ['rental-core', 'workbench-todos'] })]);
    },
    onError: error => { if (error instanceof AssignmentError && error.owner === scope() && error.epoch === currentSessionEpoch()) void records.refetch(); },
  });
  if (!canView) return null;
  if (!row) return <p className="notification-action-status" role="status">{tr(records.isError ? 'Work order details are unavailable.' : 'Reading work order…')}</p>;
  return <>
    <dl className="notification-facts"><div><dt>{tr('Work order')}</dt><dd>{row.workNo}</dd></div><div><dt>{tr('Assignee')}</dt><dd>{row.assigneeName ?? row.assigneeId ?? tr('Unassigned')}</dd></div></dl>
    {canManage && eligibleStatus && <>
      <div className="notification-business-buttons">
        {!row.assigneeId && candidates.some(person => person.id === auth.user?.id) && <Button size="small" disabled={busy || unknown} icon={<UserRoundCheck size={14} />} onClick={() => assign.mutate(auth.user!.id)}>{tr('Claim')}</Button>}
        <Button size="small" disabled={busy || unknown || !candidates.length} icon={<UserRoundPen size={14} />} onClick={() => { setVersion(row.updatedAt); setAssignee(row.assigneeId); setEditing(true); }}>{tr(row.assigneeId ? 'Reassign' : 'Assign')}</Button>
      </div>
      {editing && <form className="notification-inline-form" onSubmit={event => { event.preventDefault(); if (assignee) assign.mutate(assignee); }}>
        <label>{tr('Assignee')}<Select aria-label={tr('Assignee')} value={assignee} onChange={value => setAssignee(value as string)} disabled={busy || unknown}
          options={candidates.map(person => ({ value: person.id, label: `${person.displayName} · ${person.account}` }))} /></label>
        <div className="notification-business-buttons"><Button size="small" htmlType="button" disabled={busy} onClick={() => setEditing(false)}>{tr('Cancel')}</Button><Button type="primary" size="small" htmlType="submit" loading={busy} disabled={!assignee || unknown}>{tr('Confirm assignment')}</Button></div>
      </form>}
    </>}
    {(assign.isError || assign.isSuccess) && <p className="notification-action-status" role={assign.isError ? 'alert' : 'status'}>{assign.error?.message ?? tr('Assignment updated.')}</p>}
  </>;
}

function AiDraftActions({ item }: { item: Notice }) {
  const operator = useOperator(), inbox = useNotifications(), tr = useNotificationText();
  const [mode, setMode] = useState<'review' | 'changes' | null>(null), [note, setNote] = useState(''), [status, setStatus] = useState('');
  const thread = operator.threads.find(value => value.id === item.threadId), capability = operator.available.find(value => value.id === thread?.capabilityId);
  if (!thread?.artifact || thread.running || !capability) return null;
  const facts = confirmationDetails(thread.artifact);
  function download() {
    if (!thread?.artifact) return;
    const a = thread.artifact, text = [a.title, a.summary, ...(a.metrics ?? []).map(metric => `${metric.label}：${metric.value}`), a.columns.join(' | '), ...a.rows.map(row => row.join(' | ')), a.note].join('\n\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), link = document.createElement('a');
    link.href = url; link.download = `${a.title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80)}-示例.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <>
    <p className="notification-action-status">{thread.receipt ?? (thread.revisionRequest ? `${tr('Needs more info')}: ${thread.revisionRequest}` : tr('Local AI demo'))}</p>
    <div className="notification-business-buttons">
      {capability.action && !thread.receipt && <><Button size="small" disabled={!!thread.revisionRequest} onClick={() => { setMode('review'); setStatus(''); }}>{tr('Review draft')}</Button><Button size="small" onClick={() => { setMode('changes'); setNote(thread.revisionRequest ?? ''); setStatus(''); }}>{tr('Needs more info')}</Button></>}
      <Button size="small" icon={<Download size={14} />} onClick={download}>{tr('Download demo result')}</Button>
    </div>
    {mode === 'review' && !thread.receipt && !thread.revisionRequest && <div className="notification-inline-review"><p>{facts.description}</p><dl className="notification-facts">{facts.facts.map(fact => <div key={fact.label}><dt>{tr(fact.label)}</dt><dd>{fact.value}</dd></div>)}</dl>
      <div className="notification-business-buttons"><Button size="small" onClick={() => setMode(null)}>{tr('Back')}</Button><Button size="small" type="primary" icon={<Check size={14} />} onClick={() => { if (operator.confirmConversation(thread.id, thread.runId)) { inbox.update(item.id, { read: true }); setMode(null); } else setStatus(tr('This draft changed. Review it again.')); }}>{tr('Confirm demo draft')}</Button></div></div>}
    {mode === 'changes' && !thread.receipt && <form className="notification-inline-form" onSubmit={event => { event.preventDefault(); if (operator.requestConversationChanges(thread.id, thread.runId, note)) { inbox.update(item.id, { read: true }); setMode(null); setStatus(tr('Request saved in the conversation. Local demo only.')); } else setStatus(tr('This draft changed. Review it again.')); }}>
      <label>{tr('What needs to change?')}<Input.TextArea aria-label={tr('What needs to change?')} value={note} onChange={event => setNote(event.target.value)} maxLength={1000} autoSize={{ minRows: 2, maxRows: 4 }} /></label>
      <div className="notification-business-buttons"><Button size="small" htmlType="button" onClick={() => setMode(null)}>{tr('Cancel')}</Button><Button size="small" type="primary" htmlType="submit" disabled={!note.trim()}>{tr('Save request')}</Button></div>
    </form>}
    {status && <p className="notification-action-status" role="status">{status}</p>}
  </>;
}
