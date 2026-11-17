/** Bounded original fault evidence under the parent Task read lifetime. This
 * component keeps no cache, reads no business events and offers no execution. */
import { validateAiTaskFaultObservationDraft, type AiTaskFaultObservationDraft } from '@rental-os/shared';
import { useAiManagementLocale } from './management-locale';
import { safeDisplayText } from './safe-display';
import { formatTimestamp } from './formatters';
import styles from './AiManagement.module.css';

const runLabels: Record<string, readonly [string, string]> = {
  queued: ['排队中', 'Queued'], running: ['运行中', 'Running'], waiting_input: ['等待补充信息', 'Waiting for input'],
  waiting_confirmation: ['等待人工确认', 'Waiting for confirmation'], waiting_external: ['等待外部结果', 'Waiting for external evidence'],
  cancel_requested: ['已请求取消', 'Cancellation requested'], succeeded: ['原运行完成', 'Original run succeeded'],
  partially_succeeded: ['原运行部分完成', 'Original run partially succeeded'], failed: ['原运行失败', 'Original run failed'],
  cancelled: ['原运行已取消', 'Original run cancelled'],
};
const resourceLabels = {
  steps: ['步骤', 'Steps'], calls: ['调用', 'Calls'], active_ms: ['活动时间（ms）', 'Active time (ms)'],
  output_bytes: ['输出字节', 'Output bytes'],
} as const;
const alertLabels = {
  db_query_wait: ['数据库读取等待', 'Database read wait'], expired_lease_with_unresolved_resources: ['到期租约仍有关联占用', 'Expired lease with unresolved resources'],
  unresolved_resource_age: ['原资源占用等待', 'Original unresolved resource age'], bound_outbox_pending: ['关联业务事件等待投递', 'Bound business event awaiting delivery'],
  recovery_pending: ['原恢复等待终结证据', 'Original recovery awaiting terminal evidence'],
} as const;
const eventLabels: Record<string, readonly [string, string]> = {
  pending: ['待投递', 'Pending delivery'], claimed: ['已领取，等待结果', 'Claimed, awaiting result'],
  retry_scheduled: ['已登记原重试计划', 'Original retry scheduled'], ready: ['原候选已准备', 'Original candidate ready'],
  closed: ['原事件已关闭', 'Original event closed'], expired: ['原事件已过期', 'Original event expired'],
  dead_letter: ['原事件进入死信', 'Original event in dead letter'],
};

export function TaskFaultObservation({ observation }: { observation?: AiTaskFaultObservationDraft }) {
  const { locale } = useAiManagementLocale(), en = locale === 'en-US';
  const text = (zh: string, english: string) => en ? english : zh;
  const label = (pair: readonly [string, string]) => pair[en ? 1 : 0];
  const title = text('原任务故障观察', 'Original task fault observation');
  if (!observation) return <section aria-label={title} className={styles.section}>
    <h3>{title}</h3><p>{text('故障证据未记录，不能据此判断没有故障。', 'Fault evidence is not recorded; this does not establish an absence of faults.')}</p>
  </section>;
  if (!validateAiTaskFaultObservationDraft(observation)) return <section aria-label={title} className={styles.section}>
    <h3>{title}</h3><p>{text('故障证据当前不可用，请重读原运行观察。', 'Fault evidence is unavailable; read the original runtime observation again.')}</p>
  </section>;
  const { dbRead, worker, events, recovery, alerts } = observation;
  const pendingRecovery = recovery.items.filter(row => row.state === 'pending');
  const truncated = worker.runs.truncated || worker.unresolvedResources.truncated || worker.faults.truncated
    || events.taskTimeline.truncated || events.businessOutbox.state === 'recorded' && events.businessOutbox.truncated
    || recovery.truncated || alerts.state === 'evaluated' && alerts.truncated;
  const leaseText = (lease: AiTaskFaultObservationDraft['worker']['runs']['items'][number]['lease']) => lease.state === 'expired'
    ? text('租约已到期，结果仍需核对', 'Lease expired; the outcome still needs reconciliation')
    : lease.state === 'current' ? text('原租约仍在期限内', 'Original lease is within its recorded term') : text('未持有租约', 'No lease held');
  return <section aria-label={title} className={styles.section}>
    <h3>{title}</h3>
    <p>{alerts.state === 'not_evaluated' ? text('告警未评估，不能据此判断没有故障。', 'Alerts are not evaluated; this does not establish an absence of faults.')
      : alerts.items.length ? text('原证据窗口触发了诊断告警。', 'The original evidence window triggered diagnostic alerts.')
        : text('本窗口未触发已配置阈值，不代表没有故障。', 'No configured threshold was triggered in this window; this does not establish an absence of faults.')}</p>
    <p className={styles.help}>{text('仅展示当前获准读取的原证据；租约到期或结果未知不授予重发、释放额度或业务回滚。',
      'Current authorized original evidence only; an expired lease or unknown outcome does not permit redispatch, resource release or business rollback.')}</p>
    <dl className={styles.facts}>
      <div><dt>{text('观察时间', 'Observed at')}</dt><dd>{formatTimestamp(observation.observedAt).value}</dd></div>
      <div><dt>{text('本次数据库读取等待', 'Database waits during this read')}</dt><dd>{text('查询次数', 'Queries')}: {dbRead.queryCount}
        {' · '}{text('累计', 'Cumulative')}: {dbRead.cumulativeWaitMs} ms{' · '}{text('最大', 'Maximum')}: {dbRead.maximumWaitMs} ms</dd></div>
    </dl>
    <p className={styles.help}>{text('读取等待不代表执行耗时；未记录 worker 存活状态。', 'Read waits are not execution latency; worker liveness is not recorded.')}</p>
    {alerts.state === 'evaluated' && <details>
      <summary>{text('原诊断告警', 'Original diagnostic alerts')} · {alerts.items.length}</summary>
      <p>{text('原策略修订', 'Original policy revision')}: {safeDisplayText(alerts.policyId, 191)} · {alerts.policyRevision}</p>
      <dl className={styles.facts}>{alerts.items.map(row => <div key={row.id}>
        <dt>{label(alertLabels[row.code])}</dt><dd>{text('原依据', 'Original reference')}: {safeDisplayText(row.referenceId, 256)}</dd>
        <dd>{text('观察值', 'Observed value')}: {row.measured} ms{' · '}{text('阈值', 'Threshold')}: {row.threshold} ms</dd>
      </div>)}</dl>
      <p className={styles.help}>{text('仅为原窗口诊断，未请求发送通知。', 'Diagnostics for the original window only; notification delivery was not requested.')}</p>
    </details>}
    {worker.state === 'not_recorded' && <p>{text('原运行和资源证据未记录。', 'Original run and resource evidence is not recorded.')}</p>}
    <details>
      <summary>{text('原运行与租约', 'Original runs and leases')} · {worker.runs.items.length}</summary>
      <dl className={styles.facts}>{worker.runs.items.map(row => <div key={row.runId}>
        <dt>{text('原运行', 'Original run')}</dt><dd>{safeDisplayText(row.runId, 36)} · {runLabels[row.status] ? label(runLabels[row.status]) : safeDisplayText(row.status, 64)}</dd>
        <dd>{text('原修订', 'Original revision')}: {row.revision}{' · '}{text('栅栏', 'Fence')}: {row.fencingToken}</dd>
        <dd>{leaseText(row.lease)}{row.lease.expiresAt && <> · {formatTimestamp(row.lease.expiresAt).value}</>}
          {row.lease.overdueMs !== null && <> · {text('到期后等待', 'Overdue')}: {row.lease.overdueMs} ms</>}</dd>
        {row.holderId && <dd>{text('原持有人', 'Original holder')}: {safeDisplayText(row.holderId, 191)}</dd>}
      </div>)}</dl>
    </details>
    <details>
      <summary>{text('未核对资源', 'Unresolved resources')} · {worker.unresolvedResources.items.length}</summary>
      <dl className={styles.facts}>{worker.unresolvedResources.items.map(row => <div key={row.chargeId}>
        <dt>{label(resourceLabels[row.resource])} · {row.amount}</dt><dd>{safeDisplayText(row.chargeId, 191)}</dd>
        <dd>{row.status === 'unknown' ? text('结果未知，保留原占用', 'Unknown outcome; original resources remain held')
          : text('原资源预留尚未结算', 'Original reserved resources are not settled')}</dd>
        <dd>{text('原运行', 'Original run')}: {safeDisplayText(row.runId, 36)}{' · '}{text('栅栏', 'Fence')}: {row.fencingToken}</dd>
        <dd>{text('原持有人', 'Original holder')}: {safeDisplayText(row.holderId, 191)}</dd>
        <dd>{formatTimestamp(row.openedAt).value}{' · '}{text('等待时间', 'Pending age')}: {row.ageMs} ms</dd>
      </div>)}</dl>
      <p className={styles.help}>{text('原资源数量不是费用或已确认实耗。', 'Original resource quantities are not costs or confirmed consumption.')}</p>
    </details>
    <details>
      <summary>{text('原失败与未知步骤', 'Original failed and unknown steps')} · {worker.faults.items.length}</summary>
      <dl className={styles.facts}>{worker.faults.items.map(row => <div key={`${row.stepId}:${row.revision}`}>
        <dt>{row.status === 'unknown' ? text('原步骤结果未知', 'Original step outcome unknown') : text('原步骤失败', 'Original step failed')}</dt>
        <dd>{safeDisplayText(row.stepId, 36)} · {text('原修订', 'Original revision')}: {row.revision}</dd>
        {row.errorCode && <dd>{safeDisplayText(row.errorCode, 128)}</dd>}
        {row.evidence.state === 'recorded' ? <dd>{text('原事件证据', 'Original event evidence')}: {safeDisplayText(row.evidence.referenceId, 191)}
          {' · '}{text('游标', 'Cursor')}: {row.evidence.cursor}{' · '}{formatTimestamp(row.evidence.occurredAt).value}</dd>
          : <dd>{text('对应步骤事件证据未记录。', 'Matching step event evidence is not recorded.')}</dd>}
      </div>)}</dl>
    </details>
    <p>{events.taskTimeline.state === 'recorded' ? <>{text('本窗口保留的任务事件', 'Task events retained in this window')}: {events.taskTimeline.retainedInWindow}
      {' · '}{text('原任务游标', 'Original task cursor')}: {events.taskTimeline.taskCursor}</>
      : text('任务事件记录未观察到。', 'Task event records were not observed.')}</p>
    <p className={styles.help}>{text('保留的任务事件不是业务投递积压。', 'Retained task events are not the business delivery backlog.')}</p>
    {events.businessOutbox.state === 'not_recorded' ? <p>{text('业务事件关联未记录；积压需沿原业务权限入口核对。',
      'Business event bindings are not recorded; check backlog through the original business-authorized entry.')}</p> : <details>
      <summary>{text('原关联业务事件', 'Original bound business events')} · {events.businessOutbox.items.length}</summary>
      <p>{text('本窗口等待投递', 'Awaiting delivery in this window')}: {events.businessOutbox.pendingInWindow}
        {' · '}{text('最长等待', 'Oldest pending age')}: {events.businessOutbox.oldestPendingAgeMs === null ? text('未记录', 'Not recorded') : `${events.businessOutbox.oldestPendingAgeMs} ms`}</p>
      <dl className={styles.facts}>{events.businessOutbox.items.map(row => <div key={row.eventId}>
        <dt>{eventLabels[row.status] ? label(eventLabels[row.status]) : safeDisplayText(row.status, 64)}</dt><dd>{safeDisplayText(row.eventId, 36)}</dd>
        <dd>{text('原关联依据', 'Original binding reference')}: {safeDisplayText(row.sourceRef, 191)}</dd>
        <dd>{text('原运行', 'Original run')}: {safeDisplayText(row.runId, 36)}{' · '}{text('原尝试次数', 'Original attempts')}: {row.attempts}</dd>
        <dd>{leaseText(row.lease)}{row.pendingAgeMs !== null && <> · {text('等待时间', 'Pending age')}: {row.pendingAgeMs} ms</>}</dd>
      </div>)}</dl>
    </details>}
    {recovery.state === 'not_recorded' ? <p>{text('原恢复运行未记录。', 'Original recovery runs are not recorded.')}</p> : pendingRecovery.length > 0 && <details>
      <summary>{text('原恢复等待', 'Original recovery waits')} · {pendingRecovery.length}</summary>
      <dl className={styles.facts}>{pendingRecovery.map(row => <div key={row.referenceId}>
        <dt>{text('等待原恢复终结证据', 'Awaiting original recovery terminal evidence')}</dt><dd>{safeDisplayText(row.runId, 36)} · {text('栅栏', 'Fence')}: {row.fencingToken}</dd>
        <dd>{safeDisplayText(row.referenceId, 191)}{' · '}{text('等待时间', 'Pending age')}: {row.pendingAgeMs === null ? text('起始时间未记录', 'Start time not recorded') : `${row.pendingAgeMs} ms`}</dd>
      </div>)}</dl>
    </details>}
    {truncated && <p>{text('证据窗口不完整，不推算全部运行、资源或事件。', 'The evidence window is incomplete; do not extrapolate all runs, resources or events.')}</p>}
  </section>;
}
