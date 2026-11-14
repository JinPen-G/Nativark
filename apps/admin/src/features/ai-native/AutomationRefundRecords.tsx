/** Explicit original refund-record observation. Statuses come from the
 * persisted finance reader; this panel never refreshes a provider or retries
 * money. Closing/hiding retracts the record and cancels its read. */
import { useEffect, useRef, useState } from 'react';
import { ActionButton, Alert, Button, Modal } from '@/components/ui';
import { readAutomationOriginalRefund, type AutomationOriginalRefundRecord } from '@/api/aiAutomationOriginalRefunds';
import type { AutomationReviewOriginalTarget } from './automation-review-session';
import { useAiManagementLocale } from './management-locale';
import { formatTimestamp } from './formatters';
import { safeDisplayText } from './safe-display';
import styles from './AiManagement.module.css';

export function AutomationRefundRecords({ target, current, close }: {
  target: AutomationReviewOriginalTarget; current(): boolean; close(): void;
}) {
  const { locale } = useAiManagementLocale(), en = locale === 'en-US';
  const [record, setRecord] = useState<AutomationOriginalRefundRecord | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null), owner = useRef(current); owner.current = current;
  const valid = () => owner.current() && !document.hidden;
  useEffect(() => {
    const clear = () => { request.current?.abort(); request.current = null; setRecord(null); setBusy(false); };
    document.addEventListener('visibilitychange', clear);
    return () => { clear(); document.removeEventListener('visibilitychange', clear); };
  }, [target]);
  const labels = en ? { pending: 'Pending', accepted: 'Accepted', funding_pending: 'Funding reconciliation pending',
    succeeded: 'Original refund record succeeded', failed: 'Failed', closed: 'Closed' } : {
    pending: '待处理', accepted: '已受理', funding_pending: '退款资金待核对', succeeded: '原退款记录成功', failed: '失败', closed: '已关闭',
  };
  return <Modal open={valid()} title={en ? 'Original refund record' : '原退款记录'} onCancel={close}
    footer={<Button onClick={close}>{en ? 'Close' : '关闭'}</Button>}>
    <section className={styles.stack}>
      <p>{en ? 'Read the saved original operation. Accepted is separate from succeeded; this does not refresh the channel or retry a refund.'
        : '核对原操作已保存的记录。受理与成功分别显示，不刷新渠道或再次退款。'}</p>
      <p>{safeDisplayText(target.resource.id, 191)}</p>
      <ActionButton label={en ? 'Read original record' : '读取原记录'} disabled={busy || !valid()} onAction={async () => {
        if (request.current || !valid()) throw Error('AI_SCOPE_CHANGED');
        const controller = new AbortController(); request.current = controller; setRecord(null); setBusy(true); setError(false);
        try { const value = await readAutomationOriginalRefund(target, controller.signal, valid);
          if (request.current !== controller || controller.signal.aborted || !valid()) throw Error('AI_SCOPE_CHANGED'); setRecord(value); }
        catch (failure) { if (request.current === controller && !controller.signal.aborted && valid()) setError(true); throw failure; }
        finally { if (request.current === controller) { request.current = null; if (valid()) setBusy(false); } }
      }} />
      {error && <Alert type="warning" title={en ? 'The original record could not be verified. Recheck access and the original source.' : '原记录未能核验，请复查权限和同一原来源。'} />}
      {record && valid() && <dl className={styles.facts}>
        <div><dt>{en ? 'Recorded status' : '原记录状态'}</dt><dd>{labels[record.status]}</dd></div>
        <div><dt>{en ? 'Accepted at' : '受理时间'}</dt><dd>{record.acceptedAt ? formatTimestamp(record.acceptedAt).value : en ? 'Not recorded' : '未记录'}</dd></div>
        <div><dt>{en ? 'Succeeded at' : '成功时间'}</dt><dd>{record.succeededAt ? formatTimestamp(record.succeededAt).value : en ? 'Not recorded' : '未记录'}</dd></div>
        <div><dt>{en ? 'Funding recorded at' : '资金登记时间'}</dt><dd>{record.fundedAt ? formatTimestamp(record.fundedAt).value : en ? 'Not recorded' : '未记录'}</dd></div>
        <div><dt>{en ? 'Record updated at' : '原记录更新时间'}</dt><dd>{formatTimestamp(record.updatedAt).value}</dd></div>
      </dl>}
    </section>
  </Modal>;
}
