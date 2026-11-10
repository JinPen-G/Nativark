import type { AiTaskRuleDraftReviewResponse } from '@rental-os/shared';
import styles from './AiManagement.module.css';

const labels = {
  'fulfillment.pickupInspectionRequired': ['交付检查', 'Pickup inspection'],
  'fulfillment.returnInspectionRequired': ['归还检查', 'Return inspection'],
  'fulfillment.evidenceRequired': ['履约凭证', 'Fulfillment evidence'],
  'fulfillment.allowDifferentReturnLocation': ['异地归还', 'Different return location'],
  'damage.manualReviewRequired': ['损坏人工审核', 'Manual damage review'],
  'cancellation.weatherExceptionEnabled': ['天气例外', 'Weather exception'],
  'qualification.documentTypes': ['资质材料类型', 'Qualification document types'],
  'qualification.minimumValidityDays': ['资质最短有效天数', 'Minimum qualification validity days']
} as const;
export function RuleDraftDifferences({ review, translate }: { review: Pick<AiTaskRuleDraftReviewResponse, 'changes' | 'normalizations'>;
  translate(text: string): string }) {
  const value = (input: boolean | number | string[]) => typeof input === 'boolean' ? translate(input ? '启用' : '关闭')
    : Array.isArray(input) ? input.length ? input.join('、') : translate('无') : String(input);
  return <div className={styles.section}>
    <dl className={styles.facts}>{review.changes.map(change => <div key={change.field}>
      <dt>{translate(labels[change.field][0])}</dt><dd>{value(change.before)} → {value(change.after)}</dd>
    </div>)}</dl>
    {review.normalizations.length > 0 && <section className={styles.section} aria-label={translate('Core 规范化')}>
      <h3>{translate('Core 规范化')}</h3><p className={styles.help}>{translate('以下为原规则服务的只读规范化，随业务草稿一同保存，不代表资质已审核。')}</p>
      <dl className={styles.facts}>{review.normalizations.map(change => <div key={change.field}>
        <dt>{translate(labels[change.field][0])}</dt><dd>{value(change.before)} → {value(change.after)}</dd>
      </div>)}</dl>
    </section>}
  </div>;
}
