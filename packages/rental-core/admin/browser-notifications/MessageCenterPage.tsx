import { useEffect, useMemo, type ComponentType } from 'react';
import { Bell, ClipboardCheck, ClipboardList, Sparkles, Wrench } from 'lucide-react';
import { useLocale } from '@rental-os/platform-admin/locale';
import { resolveAdminBrandName } from '@rental-os/platform-admin/shell';
import { EmptyScene } from '@rental-os/platform-admin/ui';
import { InboxTriage, type Message } from './archive/inbox-triage/InboxTriage';
import type { createRentalNotificationProvider } from './NotificationProvider';
import type { RentalBrowserNotificationsOptions } from './types';
import { useNotificationText } from '@rental-os/platform-admin/notifications';
import { formatNoticeTime } from '@rental-os/platform-admin/source/features/notifications/HeaderNotifications';
import type { PersonalEntry } from './model';
import '@rental-os/platform-admin/source/features/notifications/notifications.css';

const categories = { business: 'Business', review: 'Review', ai: 'AI & automation', system: 'System' };
const icons = { business: Wrench, review: ClipboardCheck, ai: Sparkles, system: Bell };
/** 消息中心正文复用现有通知 Provider 与内联动作，不建立另一份消息或身份状态。 */
export function createRentalMessageCenterPage(
  options: Pick<RentalBrowserNotificationsOptions, "session">,
  useNotifications: ReturnType<typeof createRentalNotificationProvider>["useNotifications"],
  NoticeActions: ComponentType<{ id: string; surface?: "popup" | "inbox" }>,
) {
const useAuthStore = options.session.useAuthStore;
function MessageCenterPage() {
  const inbox = useNotifications(), tr = useNotificationText(), { locale } = useLocale();
  const auth = useAuthStore();
  useEffect(() => { document.title = `${tr('Message center')} · ${resolveAdminBrandName(auth.tenant, auth.user)}`; }, [locale, auth.tenant, auth.user]);
  const messages = useMemo(() => inbox.messages.map(item => {
    const Icon = item.workOrderId ? Wrench : item.orderNo ? ClipboardList : icons[item.category];
    const description = item.description.replace(/\bappearance_damage\b/g, tr('Appearance damage'));
    return { id: item.id, sender: item.orderNo ?? tr(item.workOrderId ? 'Work order' : categories[item.category]), subject: item.title,
      preview: item.demo ? `${tr('Local AI demo')} · ${description}` : description,
      body: description, time: formatNoticeTime(item.createdAt, locale), icon: <Icon size={18} />,
      unread: !item.read, pending: item.pending, folder: item.folder, restoreData: inbox.personal[item.id],
    } satisfies Message;
  }), [inbox.messages, inbox.personal, locale]);
  return <div className="notification-page">
    <InboxTriage messages={messages} onMessageChange={(item, patch) => inbox.update(item.id, { folder: patch.folder, read: patch.unread === undefined ? undefined : !patch.unread })}
      renderDetails={item => <NoticeActions id={item.id} surface="inbox" />}
      renderEmpty={(title, description, action, caughtUp) => <EmptyScene compact scene={caughtUp ? "inbox" : "empty"} title={title} description={description} action={action} />}
      onRestore={item => inbox.restore(item.id, item.restoreData as PersonalEntry | undefined)}
      feedback={inbox.error ? tr('Messages could not be refreshed.') : !inbox.storageAvailable ? tr('Session only') : undefined}
      emptyText={inbox.loading && messages.length === 0 ? tr('Reading messages…') : inbox.error && messages.length === 0 ? tr('Messages could not be loaded.') : undefined}
      />
  </div>;
}

return MessageCenterPage;
}
