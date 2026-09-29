import type { SubscriptionExpiryReminder } from "@rental-os/shared";
import { serviceLocalTime } from "./subscriptionOperations";

export type ReminderFacts = SubscriptionExpiryReminder & { revision?: number; timeZone?: string };
type ReminderIdentity = { accountId: string; tenantId: string };
type ReminderStorage = Pick<Storage, "getItem" | "setItem">;

/** Closing is scoped to the service calendar day, not 24h or the machine's timezone. */
export function reminderDismissalKey(identity: ReminderIdentity, reminder: ReminderFacts, now = Date.now()): string | null {
  if (!identity.accountId || !identity.tenantId || !Number.isInteger(reminder.revision) || !reminder.endAt || !Number.isFinite(Date.parse(reminder.endAt)) || reminder.stage === "none") return null;
  try {
    const day = serviceLocalTime(new Date(now).toISOString(), reminder.timeZone || "UTC").slice(0, 10);
    return `rental-subscription-reminder:${JSON.stringify([identity.accountId, identity.tenantId, reminder.revision, reminder.stage, day])}`;
  } catch { return null; }
}

export function reminderIsDismissed(storage: ReminderStorage | undefined, key: string | null): boolean {
  if (!storage || !key) return false;
  try { return storage.getItem(key) === "closed"; } catch { return false; }
}

export function dismissReminder(storage: ReminderStorage | undefined, key: string): void {
  try { storage?.setItem(key, "closed"); } catch { /* Private mode: the mounted card still remembers its dismissal. */ }
}
