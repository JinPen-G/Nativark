/** Human rental-condition candidates, not price/stock/identity facts.
 * Missing and ambiguous values remain for the original scene to clarify. */
import type { AiSceneQuoteCandidate } from '@rental-os/shared';
import { Input, Select, Button } from '@/components/ui';
import { useAiManagementLocale } from './management-locale';
import styles from './AiManagement.module.css';

export function QuoteCandidateFields({ value, onChange, disabled = false }: {
  value: AiSceneQuoteCandidate; onChange?: (value: AiSceneQuoteCandidate) => void; disabled?: boolean;
}) {
  const { t } = useAiManagementLocale(), locked = disabled || !onChange;
  const edit = (key: 'customerName' | 'start' | 'end' | 'locationName' | 'returnLocationName', text: string) =>
    onChange?.({ ...value, [key]: text || undefined });
  const items = value.items ?? [];
  return <div className={styles.section} aria-label={t('租赁条件')}>
    <label>{t('客户类型')}<Select value={value.customerType} disabled={locked}
      options={[{ value: 'personal', label: t('个人客户') }, { value: 'corporate', label: t('企业客户') }]}
      onChange={next => onChange?.({ ...value, customerType: next as AiSceneQuoteCandidate['customerType'] })} /></label>
    <label>{t('客户名称')}<Input value={value.customerName ?? ''} maxLength={191} disabled={locked}
      onChange={event => edit('customerName', event.currentTarget.value)} /></label>
    {items.map((item, index) => <div key={index} className={styles.toolbar}>
      <label>{t('商品名称')}<Input value={item.productName ?? ''} maxLength={191} disabled={locked} onChange={event =>
        onChange?.({ ...value, items: items.map((row, i) => i === index ? { ...row, productName: event.currentTarget.value || undefined } : row) })} /></label>
      <label>{t('数量')}<Input type="number" value={item.quantity} min={1} max={10000} step={1} disabled={locked} onChange={event =>
        onChange?.({ ...value, items: items.map((row, i) => i === index ? { ...row, quantity: Number(event.currentTarget.value) } : row) })} /></label>
      <Button disabled={locked} onClick={() => onChange?.({ ...value, items: items.length > 1 ? items.filter((_, i) => i !== index) : undefined })}>{t('移除商品')}</Button>
    </div>)}
    <Button disabled={locked || items.length >= 50} onClick={() => onChange?.({ ...value, items: [...items, { quantity: 1 }] })}>{t('添加商品')}</Button>
    {(['start', 'end', 'locationName', 'returnLocationName'] as const).map((key, index) => <label key={key}>
      {t(['开始时间', '结束时间', '领取地点', '归还地点'][index])}<Input value={value[key] ?? ''}
        maxLength={key === 'start' || key === 'end' ? 80 : 191} disabled={locked} onChange={event => edit(key, event.currentTarget.value)} />
    </label>)}
    <p>{t('这些是待核对条件。缺项和歧义由原场景澄清，身份、可租性与金额以 Core 为准。')}</p>
  </div>;
}
