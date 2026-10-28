import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Dayjs } from 'dayjs';
import type { AiTenantCallRecord, AiTenantCallRecords } from '@rental-os/shared';
import { aiCreditApi } from '@/api/aiCredit';
import { currentSessionEpoch } from '@/app/queryClient';
import { APP_ROUTES } from '@/app/navigation';
import { useAiManagementLocale as useLocale } from './management-locale';
import { useAuthStore } from '@/features/auth/authStore';
import { ActionButton, Alert, DatePicker, ListFilterItem, Select, Table } from '@/components/ui';
import styles from './AiManagement.module.css';
const states = { registered: '已登记', reserved: '待派发', dispatched: '已派发，待核对', settled: '已结算', cancelled: '派发前取消', unknown: '结果待核对' };
export function AiCallRecords({ identity }: { identity: string }) {
  const { t } = useLocale(), field = useId(), alive = useRef(true), epoch = useRef(currentSessionEpoch());
  const [days, setDays] = useState(7), [mode, setMode] = useState('all');
  const [period, setPeriod] = useState<[Dayjs, Dayjs] | null>(null), [rangeError, setRangeError] = useState(false);
  const [data, setData] = useState<AiTenantCallRecords | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const range = useRef<{ since: string; until: string } | null>(null);
  const sequence = useRef(0);
  const current = () => { const auth = useAuthStore.getState(); return alive.current && currentSessionEpoch() === epoch.current
    && identity === JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user]); };
  const load = async (cursor?: string) => {
    const run = ++sequence.current;
    if (!cursor || !range.current) {
      const until = new Date(); range.current = period ? { since: period[0].toISOString(), until: period[1].toISOString() }
        : { until: until.toISOString(), since: new Date(until.getTime() - days * 86400000).toISOString() };
    }
    setBusy(true); setError(false);
    try {
      const result = await aiCreditApi.calls({ ...range.current, ...(cursor ? { cursor } : {}),
        ...(mode === 'all' ? {} : { mode: mode as 'platform_managed' | 'tenant_managed' }) });
      if (!current() || run !== sequence.current) return;
      setData(previous => JSON.stringify(previous) === JSON.stringify(result) ? previous : result);
    } catch { if (current() && run === sequence.current) { setData(null); setError(true); } }
    finally { if (current() && run === sequence.current) setBusy(false); }
  };
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; sequence.current++; }; }, [identity, days, mode, period]);
  const columns = useMemo(() => [
    { title: t('调用时间'), dataIndex: 'createdAt', key: 'time', render: (value: string) => new Date(value).toLocaleString() },
    { title: t('调用人'), dataIndex: 'actorName', key: 'actor' },
    { title: t('经营空间'), dataIndex: 'workspaceName', key: 'workspace' },
    { title: t('服务来源 / 模型'), key: 'model', render: (_: unknown, row: AiTenantCallRecord) => <>
      <span>{t(row.mode === 'platform_managed' ? '平台 AI' : row.mode === 'tenant_managed' ? '自带供应商' : '配置待核对')}</span><br />{row.modelLabel}</> },
    { title: t('状态'), dataIndex: 'state', key: 'state', render: (value: AiTenantCallRecord['state']) => t(states[value]) },
    { title: t('输入 / 输出 Token'), key: 'tokens', render: (_: unknown, row: AiTenantCallRecord) => <>
      {row.inputTokens ?? t('待核对')} / {row.outputTokens ?? t('待核对')}
      {row.cachedInputTokens !== null && <><br /><span className="muted">{t('其中缓存命中')} {row.cachedInputTokens}</span></>}
    </> },
    { title: t('平台使用金额'), key: 'amount', render: (_: unknown, row: AiTenantCallRecord) => row.mode === 'tenant_managed'
      ? t('供应商直接计费') : row.amount !== null && row.currency ? `${row.currency} ${row.amount}` : t('待核对') },
    { title: t('关联任务'), dataIndex: 'taskId', key: 'task', render: (value: string) => <code>{value}</code> }
  ], [t]);
  const filters = <>
    <ListFilterItem label={t('时间范围')} priority active={days !== 7}>
      <Select id={`${field}-days`} aria-label={t('时间范围')} value={days} disabled={busy} options={[1, 7, 31].map(value => ({ value, label: t(`最近 ${value} 天`) }))}
        onChange={value => { setPeriod(null); setRangeError(false); setDays(Number(value)); }} /></ListFilterItem>
    <ListFilterItem label={t('自定义日期')} width="dateRange" active={!!period}>
      <DatePicker.RangePicker showTime value={period} disabled={busy} allowClear
        placeholder={[t('自定义开始时间'), t('自定义结束时间')]} onChange={value => {
          if (!value?.[0] || !value[1]) { setPeriod(null); setRangeError(false); return; }
          const duration = value[1].valueOf() - value[0].valueOf();
          if (duration <= 0 || duration > 31 * 86400000 || value[1].valueOf() > Date.now() + 60000) { setRangeError(true); return; }
          setRangeError(false); setPeriod([value[0], value[1]]);
        }} /></ListFilterItem>
    <ListFilterItem label={t('服务来源')} active={mode !== 'all'}>
      <Select id={`${field}-mode`} aria-label={t('服务来源')} value={mode} disabled={busy} options={[{ value: 'all', label: t('全部') },
        { value: 'platform_managed', label: t('平台 AI') }, { value: 'tenant_managed', label: t('自带供应商') }]} onChange={value => setMode(String(value))} /></ListFilterItem>
  </>;
  return <section className={styles.section} aria-label={t('AI 调用记录')} aria-busy={busy}>
    {rangeError && <Alert type="warning" title={t('请选择不超过 31 天且不晚于当前时间的历史区间。')} />}
    {error && <Alert type="warning" title={t('调用记录暂不可用，或当前没有租户管理员权限。旧记录已清除。')} />}
    <Table<AiTenantCallRecord> rowKey="id" columns={columns} dataSource={data?.records ?? []} pagination={false}
      toolbar={filters} onRefresh={() => load()} loading={busy && !data} scroll={{ x: 'max-content' }} />
    <Link to={APP_ROUTES.aiTasks.path}>{t('打开 AI 任务中心')}</Link>
    {data?.nextCursor && <ActionButton label={t('下一页')} disabled={busy} onAction={() => load(data.nextCursor!)} />}
  </section>;
}
