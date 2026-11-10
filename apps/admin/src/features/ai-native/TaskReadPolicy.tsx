import {useEffect,useMemo,useReducer,useRef} from 'react';
import type {AiTaskReadPolicyQuery} from '@rental-os/shared';
import {ActionButton,Alert,ConfirmAction} from '@/components/ui';
import {useAuthStore} from '@/features/auth/authStore';
import {aiTaskReadPolicyApi} from '@/api/aiTaskReadPolicy';
import {createTaskReadPolicySession,taskReadPolicyStore} from './task-read-policy-session';
import {useAiManagementLocale} from './management-locale';
import {formatTimestamp} from './formatters';
import styles from './AiManagement.module.css';
/** Explicit original manager policy action. It must remain reachable through
 * the TaskCenter's retained conversation/Task reference when listing Tasks
 * is denied by missing read policies. No policy is written on mount/read. */
export function TaskReadPolicy({query,identity,current}:{query:AiTaskReadPolicyQuery;identity:string;current():boolean}){
  const auth=useAuthStore(),{t}=useAiManagementLocale(),[,changed]=useReducer(n=>n+1,0),owner=useRef({identity,current});owner.current={identity,current};
  const stableOwner=JSON.stringify([auth.tenant?.tenantId,auth.currentWorkspaceId,auth.user?.id,query.taskId]);
  const session=useMemo(()=>{let storage:Storage|undefined;try{storage=window.localStorage;}catch{/* The original locator must be saved before dispatch. */}
    return createTaskReadPolicySession({query,tenantId:auth.tenant?.tenantId??'',workspaceId:auth.currentWorkspaceId??'',
      current:()=>owner.current.identity===identity&&!document.hidden&&owner.current.current(),changed,api:aiTaskReadPolicyApi,
      store:taskReadPolicyStore(`rental-os-task-reading:${stableOwner}`,storage)});},[identity,stableOwner]);
  useEffect(()=>{session.activate();const clear=()=>session.clear();document.addEventListener('visibilitychange',clear);return()=>{document.removeEventListener('visibilitychange',clear);session.dispose();};},[session]);
  if(!auth.hasPermission('system:params:manage')||!current())return null;
  const data=session.view,rows=data.review?.items??data.operation?.items;
  const labels={read_metadata:'任务信息',read_events:'任务事件',read_step_terminal:'原步骤结果'};
  return <section className={styles.stack} aria-label={t('本任务读取政策')}>
    <p>{t('仅管理员明确启用本任务的读取政策。不会启动模型或授予业务执行。')}</p>
    {data.invalid&&<Alert type="warning" title={t('原启用定位不可读取，不能再次启用。')}/>}
    {data.pending?<><Alert type="warning" title={t('原启用结果待核对。')} description={t('仅读取原CAS收据；部分或未观察结果不代表未写入，不重发。')}/>
      <ActionButton label={t('核对原启用结果')} disabled={!!data.busy||data.invalid} onAction={()=>session.operation()}/></>
      :<ActionButton label={t('核对本任务读取政策')} disabled={!!data.busy||data.invalid} onAction={()=>session.inspect()}/>}
    {rows&&<dl>{rows.map(row=><div key={row.operation}><dt>{t(labels[row.operation])}</dt><dd>{t(row.current?(row.active?'当前有效':'已过期或当前权限不足'):'未配置')}
      {row.current&&` · ${formatTimestamp(row.current.expiresAt).value}`}</dd><dd>{t('本次期限')}：{formatTimestamp(row.desired.expiresAt).value}</dd></div>)}</dl>}
    {!data.pending&&data.review&&<ConfirmAction label={t('明确启用本任务读取')} prompt={t('按已核对的原权限要求与期限，启用本任务三项读取政策？不会启动模型或执行业务。')}
      disabled={!!data.busy||data.invalid} onConfirm={()=>session.enable()}/>}
    {data.operation?.completeRecorded&&<Alert type="success" title={t('原读取政策CAS已记录。')} description={t('当前有效性仍按期限与权限核对；请重新读取原任务。')}/>}
    {data.operation&&!data.operation.completeRecorded&&<Alert type="warning" title={t('原启用只观察到部分结果，保留定位继续核对。')}/>}
    {!!data.error&&<Alert type="warning" title={t(data.pending?'原启用未能确认，请核对原收据。':'当前管理员权限、原任务或政策已变化，请重新核对。')}/>}
  </section>;
}
