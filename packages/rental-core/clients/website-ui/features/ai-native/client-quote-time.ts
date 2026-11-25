/** AI parameter preparation uses the current original catalog's business zone.
 * This only resolves explicit wall times; it never prices, guesses, or replaces
 * an ambiguous/invalid input with a device-zone time or the current instant. */
import { clientGoalTimeOptions } from '@rental-os/shared';

const unavailable = () => Error('client_quote_time_unavailable');
const timeZone = (value: unknown): string => {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 100) throw unavailable();
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(0); }
  catch { throw unavailable(); }
  return value;
};

export function clientQuoteCatalogTimeZone(value: unknown, target: { tenantCode: string; serviceCode: string }): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  const catalog = value as Record<string, unknown>, workspace = catalog.workspace;
  if (catalog.tenantCode !== target.tenantCode || !workspace || typeof workspace !== 'object' || Array.isArray(workspace)
    || (workspace as Record<string, unknown>).workspaceCode !== target.serviceCode) throw unavailable();
  return timeZone(catalog.timeZone);
}

export function clientQuoteTimeRange(start: string, end: string, zone: unknown) {
  const currentZone = timeZone(zone);
  let starts: ReturnType<typeof clientGoalTimeOptions>, ends: ReturnType<typeof clientGoalTimeOptions>;
  try { starts = clientGoalTimeOptions(start, currentZone); ends = clientGoalTimeOptions(end, currentZone); }
  catch { throw unavailable(); }
  if (starts.length !== 1 || ends.length !== 1 || Date.parse(ends[0].value) <= Date.parse(starts[0].value)) throw unavailable();
  return { timeZone: currentZone, startAt: starts[0].value, endAt: ends[0].value };
}
