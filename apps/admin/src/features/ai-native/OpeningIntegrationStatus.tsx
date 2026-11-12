/** Original authorized configuration/test metadata. It is not another Core
 * readiness item or a live connection test. Missing access retracts details. */
import type { AiOpeningIntegrationFactsDraft, AiOpeningIntegrationState } from '@rental-os/shared';
import { useAiManagementLocale } from './management-locale';
import { formatTimestamp } from './formatters';
import { safeDisplayText } from './safe-display';
import styles from './AiManagement.module.css';

export function OpeningIntegrationStatus({ facts }: { facts?: AiOpeningIntegrationFactsDraft }) {
  const { locale } = useAiManagementLocale(), en = locale === 'en-US';
  if (!facts) return null;
  if (facts.state === 'unavailable') return <p className={styles.help}>{en
    ? 'Service configuration metadata is unavailable under the current access. Configure services through the original entry.'
    : '当前权限下未读取服务配置元数据，请沿原服务配置入口核对。'}</p>;
  const labels: Record<AiOpeningIntegrationState, string> = en ? {
    not_loaded: 'Not loaded', not_implemented: 'Adapter not implemented', missing_configuration: 'Configuration missing',
    configured_unverified: 'Configured, unverified', mock: 'Mock result', failed: 'Recorded test failed',
    historical_live_success: 'Historical live test passed', current_live_success: 'Recorded live test matches current configuration',
  } : { not_loaded: '未加载', not_implemented: '适配器未实现', missing_configuration: '缺少配置', configured_unverified: '已配置，未核验',
    mock: '模拟检测', failed: '原检测失败', historical_live_success: '历史实测通过', current_live_success: '原实测记录与当前配置匹配' };
  return <section className={styles.stack} aria-label={en ? 'Service configuration status' : '服务配置状态'}>
    <h3>{en ? 'Service configuration status' : '服务配置状态'}</h3>
    <p>{en ? 'Only saved configuration and test records are read. This performs no new test and does not change the nine Core readiness checks.'
      : '仅读取已保存的配置和检测记录，不发起新测试，不改变 Core 九项开业判定。'}</p>
    <dl className={styles.facts}>{facts.observation.items.map((row, index) => <div key={`${row.configId ?? row.provider}:${index}`}>
      <dt>{safeDisplayText(row.capability, 20)} · {safeDisplayText(row.provider, 40)}</dt>
      <dd>{labels[row.state]}</dd>
      {row.missingFields && row.missingFields.length > 0 && <dd>{en ? 'Missing fields' : '缺少字段'}：{row.missingFields.map(field => safeDisplayText(field, 64)).join('、')}</dd>}
      {row.configurationUpdatedAt && <dd>{en ? 'Configuration revision time' : '配置修订时间'}：{formatTimestamp(row.configurationUpdatedAt).value}</dd>}
      {row.test?.checkedAt && <dd>{en ? 'Original test time' : '原检测时间'}：{formatTimestamp(row.test.checkedAt).value}</dd>}
      {row.test && !row.test.matchesCurrentConfiguration && <dd>{en ? 'The test record does not verify the current configuration.' : '该检测记录不能证明当前配置有效。'}</dd>}
    </div>)}</dl>
    {facts.observation.hasMore && <p className={styles.help}>{en ? 'Only a bounded configuration window was loaded. Unseen providers are not classified as missing.'
      : '本次只读取有界配置窗口，未见到的服务不判定为缺配置。'}</p>}
    <p className={styles.help}>{en ? 'Credential-field presence does not establish authentication, delivery, payment or refund success.'
      : '凭据字段存在不代表认证、投递、支付或退款成功。'}</p>
  </section>;
}
