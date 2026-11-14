/** Read-only original Draft details before the existing human choice. */
import type { AiBookingDraft } from '@rental-os/shared';
import { handoffLocalInput } from './booking-handoff';
import { projectBookingDraftReview, type BookingReviewField, type BookingReviewLabel } from './booking-draft-review';

const wrap = { overflowWrap: 'anywhere' as const, minWidth: 0 };
function ReviewField(props: { label: string; field: BookingReviewField; time?: boolean }) {
  const { label, field } = props;
  return <div style={wrap}><dt>{label}</dt><dd style={{ marginInlineStart: 0 }}>
    {props.time && field.original ? <time dateTime={field.original}>{field.value}</time> : field.value}
    <small style={{ display: 'block' }}>{field.source}</small>
    {props.time && field.original !== field.value && <small style={{ display: 'block' }}>{field.original}</small>}
  </dd></div>;
}

export function BookingDraftReview(props: {
  draft: AiBookingDraft | null; english: boolean; locations?: readonly BookingReviewLabel[];
}) {
  const en = props.english, review = projectBookingDraftReview(props.draft, {
    english: en, locations: props.locations,
    formatTime: (original, timeZone) => handoffLocalInput(original, timeZone).replace('T', ' ')
  });
  if (!review) return null;
  const text = (chinese: string, english: string) => en ? english : chinese;
  return <section aria-label={text('核对原预约条件', 'Review original booking conditions')} style={wrap}>
    <h4>{text('核对原预约条件', 'Review original booking conditions')}</h4>
    <p>{text('请核对以下原预约条件后再继续。标注“Core 补齐”的时间或地点来自原报价。',
      'Review these original booking conditions before continuing. Times or locations marked “Completed by Core” come from the original quote.')}</p>
    <dl style={{ display: 'grid', gap: 'var(--s12)' }}>
      <ReviewField label={text('时区', 'Time zone')} field={review.timeZone} />
      <ReviewField label={text('取用时间', 'Rental start')} field={review.start} time />
      <ReviewField label={text('归还时间', 'Rental end')} field={review.end} time />
      <ReviewField label={text('取用／配送地点', 'Fulfillment location')} field={review.fulfillmentLocation} />
      <ReviewField label={text('归还地点', 'Return location')} field={review.returnLocation} />
    </dl>
    {review.services.length > 0 && <><h4>{text('原预约服务', 'Original booking services')}</h4>
      <ol>{review.services.map(service => <li key={service.id} style={wrap}>
        <dl style={{ display: 'grid', gap: 'var(--s12)' }}>
          <ReviewField label={text('服务引用', 'Service reference')} field={service.name} />
          <ReviewField label={text('数量', 'Quantity')} field={service.quantity} />
          <ReviewField label={text('服务开始', 'Service start')} field={service.start} time />
          <ReviewField label={text('服务结束', 'Service end')} field={service.end} time />
          <ReviewField label={text('服务地点', 'Service location')} field={service.location} />
        </dl>
      </li>)}</ol></>}
  </section>;
}
