/** Choose only the visible calendar month. This never selects a date or calls a field change handler. */
export function openingCalendarMonth(value?: Date, preferred?: Date, minDate?: Date, maxDate?: Date, today = new Date()): Date {
  const valid = (date: Date | undefined): date is Date => Boolean(date && Number.isFinite(date.getTime()));
  const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
  const first = valid(minDate) ? monthStart(minDate) : undefined;
  const last = valid(maxDate) ? monthStart(maxDate) : undefined;
  let month = monthStart([value, preferred, today].find(valid)!);
  if (first && month < first) month = first;
  if (last && month > last) month = last;
  return month;
}
