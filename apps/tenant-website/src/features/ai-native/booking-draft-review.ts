/** Present an already validated original Draft. Labels and time formatting
 * are optional presentation inputs; this projection never reads, persists,
 * changes a selection or derives a missing field source. */
import type { AiBookingDraft, AiBookingInputSource } from '@rental-os/shared';

export interface BookingReviewLabel { id: string; label: string }
export interface BookingReviewField {
  value: string;
  original: string;
  source: string;
}
export interface BookingDraftReview {
  quoteId: string;
  timeZone: BookingReviewField;
  start: BookingReviewField;
  end: BookingReviewField;
  fulfillmentLocation: BookingReviewField;
  returnLocation: BookingReviewField;
  services: {
    id: string;
    name: BookingReviewField;
    quantity: BookingReviewField;
    start: BookingReviewField;
    end: BookingReviewField;
    location: BookingReviewField;
  }[];
}

export function bookingReviewSource(value: AiBookingInputSource | undefined, english: boolean): string {
  switch (value) {
    case 'user_explicit': return english ? 'Selected by you' : '用户明确选择';
    case 'core_normalized': return english ? 'Completed by Core' : 'Core 补齐';
    case 'server_default': return english ? 'Server default' : '服务端默认';
    case 'authorized_fact': return english ? 'Authorized fact' : '受权事实';
    case 'model_candidate': return english ? 'Model suggestion' : '模型候选';
    default: return english ? 'Source not recorded' : '来源未记录';
  }
}

export function projectBookingDraftReview(draft: AiBookingDraft | null, options: {
  english?: boolean;
  locations?: readonly BookingReviewLabel[];
  services?: readonly BookingReviewLabel[];
  formatTime?(original: string, timeZone: string): string;
} = {}): BookingDraftReview | null {
  if (!draft) return null;
  const material = draft.material, selection = material.selection, english = options.english === true;
  const named = (id: string, labels?: readonly BookingReviewLabel[]) => {
    const matches = labels?.filter(row => row.id === id && row.label.trim()) ?? [];
    const values = [...new Set(matches.map(row => row.label))];
    return values.length === 1 ? `${values[0]} (${id})` : id;
  };
  const field = (value: string | undefined, source: AiBookingInputSource | undefined, label?: string): BookingReviewField => ({
    value: label ?? value ?? (english ? 'Not recorded' : '未记录'), original: value ?? '',
    source: bookingReviewSource(source, english)
  });
  const time = (value: string | undefined, source: AiBookingInputSource | undefined): BookingReviewField => {
    let label = value;
    if (value && options.formatTime) {
      try { label = options.formatTime(value, selection.timeZone); }
      catch { /* Keep the exact original instant; never substitute the device zone. */ }
    }
    return field(value, source, label);
  };
  return {
    quoteId: material.quote.quoteId,
    timeZone: field(selection.timeZone, material.sources.timeZone),
    start: time(selection.startAt, material.sources.startAt),
    end: time(selection.endAt, material.sources.endAt),
    fulfillmentLocation: field(selection.fulfillmentLocationId, material.sources.fulfillmentLocationId,
      named(selection.fulfillmentLocationId, options.locations)),
    returnLocation: field(selection.returnLocationId, material.sources.returnLocationId,
      selection.returnLocationId ? named(selection.returnLocationId, options.locations) : undefined),
    services: (selection.services ?? []).map(service => {
      const matches = material.serviceSources?.filter(row => row.serviceId === service.serviceId) ?? [];
      // A legacy aggregate services label cannot stand in for any of these fields.
      const sources = matches.length === 1 ? matches[0].fields : undefined;
      return {
        id: service.serviceId,
        name: field(service.serviceId, sources?.serviceId, named(service.serviceId, options.services)),
        quantity: field(String(service.quantity), sources?.quantity),
        start: time(service.scheduledStartAt, sources?.scheduledStartAt),
        end: time(service.scheduledEndAt, sources?.scheduledEndAt),
        location: field(service.serviceLocationId, sources?.serviceLocationId,
          service.serviceLocationId ? named(service.serviceLocationId, options.locations) : undefined)
      };
    })
  };
}
