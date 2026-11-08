/** Explicit platform evidence read, not a probe launcher, enable switch or tenant host. */
import { useEffect, useRef, useState } from 'react';
import type { AiPlatformModelCapabilityObservationDraft } from '@rental-os/shared';
import { platformAiSettingsApi } from '@/api/platformAiSettings';
import { useAiManagementLocale as useLocale } from './management-locale';
import { currentSessionEpoch } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { ActionButton, Alert, DataTableStatus, DataTableText, Table } from '@/components/ui';
import { formatTimestamp } from './formatters';
import styles from './AiManagement.module.css';

const capabilities = ['text', 'streaming', 'tools', 'structured_output', 'vision', 'audio', 'embedding', 'reasoning'] as const;
export const platformCapabilityLabels = { text: '文本', streaming: '流式', tools: '工具调用', structured_output: '结构化输出',
  vision: '视觉', audio: '音频', embedding: '向量', reasoning: '推理' };
export function PlatformCapabilityObservation({ profileId, identity }: { profileId: string; identity: string }) {
  const { t } = useLocale();
  const [result, setResult] = useState<AiPlatformModelCapabilityObservationDraft | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const flight = useRef<AbortController | null>(null), mounted = useRef(true);
  const active = useRef({ profileId, identity }); active.current = { profileId, identity };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; flight.current?.abort(); }; }, []);
  const current = () => {
    const auth = useAuthStore.getState();
    return mounted.current && !document.hidden && active.current.profileId === profileId && active.current.identity === identity
      && JSON.stringify([auth.user, currentSessionEpoch()]) === identity && !!auth.token && !!auth.user?.isSaasAdmin
      && auth.hasPermission('system:ai-provider:view');
  };
  const read = async () => {
    if (flight.current || !current()) throw Error('AI_ACCESS_DENIED');
    const controller = new AbortController(); flight.current = controller; setBusy(true); setError(false); setResult(null);
    try {
      const value = structuredClone(await platformAiSettingsApi.capabilities(profileId, controller.signal));
      if (!current() || controller.signal.aborted) return;
      if (!value || value.profileId !== profileId || !Number.isInteger(value.configurationRevision) || value.configurationRevision < 1
        || value.configurationRevision > 4294967295 || typeof value.enabled !== 'boolean' || !formatTimestamp(value.observedAt).available
        || value.execution !== 'read_only_no_probe_or_dispatch' || value.admission !== 'not_granted'
        || !Array.isArray(value.items) || value.items.length !== capabilities.length
        || value.items.some((item, i) => !item || item.capability !== capabilities[i] || typeof item.allowed !== 'boolean'
          || !['verified_supported', 'unverified', 'configuration_disabled'].includes(item.readiness)
          || !value.enabled && item.readiness !== 'configuration_disabled'
          || value.enabled && item.readiness === 'configuration_disabled'
          || item.recorded !== null && (!item.recorded || !['supported', 'unsupported', 'unverified'].includes(item.recorded.status)
            || !['connection_test', 'declared', 'manual'].includes(item.recorded.source)
            || !Number.isInteger(item.recorded.observedRevision) || item.recorded.observedRevision < 1
            || item.recorded.observedRevision > value.configurationRevision || !formatTimestamp(item.recorded.checkedAt).available
            || item.recorded.expiresAt !== null && !formatTimestamp(item.recorded.expiresAt).available
            || !['mock', 'live', 'not_attested'].includes(item.recorded.mode)
            || item.recorded.applicability !== (item.recorded.observedRevision === value.configurationRevision ? 'current_configuration' : 'historical_configuration'))
          || item.readiness === 'verified_supported' && (!item.allowed || item.recorded?.status !== 'supported'
            || item.recorded.source !== 'connection_test' || item.recorded.mode !== 'live' || item.recorded.applicability !== 'current_configuration'
            || !item.recorded.expiresAt || Date.parse(item.recorded.expiresAt) <= Date.parse(value.observedAt)
            || Date.parse(item.recorded.checkedAt) > Date.parse(value.observedAt)))) throw Error('AI_RESOURCE_UNAVAILABLE');
      setResult(value);
    } catch (failure) {
      if (current() && !controller.signal.aborted) setError(true);
      throw failure;
    } finally {
      if (flight.current === controller) { flight.current = null; if (mounted.current) setBusy(false); }
    }
  };
  return <section className={styles.stack} aria-label={t('平台能力证据')} aria-busy={busy}>
    <h3>{t('平台能力证据')}</h3>
    <p className={styles.help}>{t('只读取原证据并复核当前准入，不发起验证或模型调用。白名单、记录宣称支持、当前核验支持分别展示；没有记录不等于不支持。')}</p>
    <div className={styles.toolbar}><ActionButton variant="secondary" label={t('读取平台能力证据')} successLabel={t('能力观察已返回，非执行许可')} disabled={busy} onAction={read} /></div>
    {error && <Alert type="warning" title={t('当前能力证据不可读取，旧结果已清除。请核对当前平台权限与原配置。')} />}
    {result && <>
      <p className={styles.help} role="status">{t('配置修订')}: {result.configurationRevision}；{t('观察时间')}: {formatTimestamp(result.observedAt).value}。
        {t('这是该时点的观察，不保证后续配置、证据或授权不变。')}</p>
      <Table rowKey="capability" dataSource={result.items} pagination={false} columns={[
        { title: t('能力'), dataIndex: 'capability', render: value => t(platformCapabilityLabels[value as keyof typeof platformCapabilityLabels]) },
        { title: t('当前核验'), render: (_, item) => <DataTableStatus tone={item.readiness === 'verified_supported' ? 'success' : 'neutral'}>
          {t(item.readiness === 'verified_supported' ? '已核验支持' : item.readiness === 'configuration_disabled' ? '配置停用，仅历史观察' : '未验证')}
        </DataTableStatus> },
        { title: t('配置白名单'), dataIndex: 'allowed', render: value => t(value ? '允许' : '未允许') },
        { title: t('原记录'), render: (_, item) => item.recorded ? <DataTableText
          primary={t(item.recorded.status === 'supported' ? '记录为支持' : item.recorded.status === 'unsupported' ? '记录为不支持' : '记录未验证')}
          secondary={`${t({ connection_test: '连接验证', declared: '配置声明', manual: '手工登记' }[item.recorded.source])} · ${t({ mock: '模拟', live: '实际验证', not_attested: '未取得证明' }[item.recorded.mode])}`} /> : t('未观察到原记录，保持未验证。') },
        { title: t('记录修订'), render: (_, item) => item.recorded ? <DataTableText primary={`${t('修订')} ${item.recorded.observedRevision}`}
          secondary={t(item.recorded.applicability === 'current_configuration' ? '对应当前配置' : '对应历史配置')} /> : '—' },
        { title: t('检测时间'), render: (_, item) => item.recorded ? formatTimestamp(item.recorded.checkedAt).value : '—' },
        { title: t('失效时间'), render: (_, item) => item.recorded?.expiresAt ? formatTimestamp(item.recorded.expiresAt).value : t('未登记') },
      ]} />
    </>}
    <p className={styles.help}>{t('平台主体发起付费验证尚未接入本入口；不能借用租户身份探测。Embedding与Reasoning缺客观验证方法时保持未验证，不按模型名称推断。')}</p>
  </section>;
}
