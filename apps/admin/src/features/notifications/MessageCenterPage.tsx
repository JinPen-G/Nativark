import { useEffect, useMemo } from 'react';
import { Bell, ClipboardCheck, Sparkles, Wrench } from 'lucide-react';
import { useLocale } from '@/app/locale';
import { resolveAdminBrandName } from '@/app/branding';
import { useAuthStore } from '@/features/auth/authStore';
import { NoticeActions } from "./NoticeActions";
import { InboxTriage, type Message } from './archive/inbox-triage/InboxTriage';
import { useNotifications } from './NotificationProvider';
import { useNotificationText } from './locale';
import { formatNoticeTime } from './HeaderNotifications';
import type { PersonalEntry } from './model';
import './notifications.css';

const categories = { business: 'Business', review: 'Review', ai: 'AI & automation', system: 'System' };
const icons = { business: Wrench, review: ClipboardCheck, ai: Sparkles, system: Bell };
export default function MessageCenterPage() {
  const inbox = useNotifications(), tr = useNotificationText(), { locale } = useLocale();
  const auth = useAuthStore();
  useEffect(() => { document.title = `${tr('Message center')} · ${resolveAdminBrandName(auth.tenant, auth.user)}`; }, [locale, auth.tenant, auth.user]);
  const messages = useMemo(() => inbox.messages.map(item => {
    const Icon = icons[item.category];
    return { id: item.id, sender: tr(categories[item.category]), subject: `${item.demo ? `${tr('Local AI demo')} · ` : ''}${item.title}`,
      preview: item.demo ? `${tr('Local AI demo')} · ${item.description}` : item.orderNo ? `${item.orderNo} · ${item.description}` : item.description,
      body: item.description, time: formatNoticeTime(item.createdAt, locale), icon: <Icon size={18} />,
      unread: !item.read, pending: item.pending, folder: item.folder, restoreData: inbox.personal[item.id],
    } satisfies Message;
  }), [inbox.messages, inbox.personal, locale]);
  return <div className="notification-page">
    <InboxTriage messages={messages} onMessageChange={(item, patch) => inbox.update(item.id, { folder: patch.folder, read: patch.unread === undefined ? undefined : !patch.unread })}
      renderDetails={item => <NoticeActions id={item.id} surface="inbox" />}
      onRestore={item => inbox.restore(item.id, item.restoreData as PersonalEntry | undefined)}
      feedback={inbox.error ? tr('Messages could not be refreshed.') : !inbox.storageAvailable ? tr('Session only') : undefined}
      emptyText={inbox.loading && messages.length === 0 ? tr('Reading messages…') : inbox.error && messages.length === 0 ? tr('Messages could not be loaded.') : undefined}
      />
  </div>;
}
