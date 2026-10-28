import { useMemo, useState } from 'react';
import { NotificationCenter } from './archive/notification-center/notification-center';
import { useNotifications } from './NotificationProvider';
import { useNotificationText } from './locale';
import { useLocale } from '@/app/locale';
import './notifications.css';

export function HeaderNotifications() {
  const inbox = useNotifications(), tr = useNotificationText(), { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const items = useMemo(() => inbox.messages.filter(item => item.folder === 'Inbox').map(item => ({
    id: item.id, title: `${item.demo ? `${tr('Local AI demo')} · ` : ''}${item.title}`,
    description: item.description, read: item.read,
    time: formatNoticeTime(item.createdAt, locale), tone: item.priority === 'high' ? 'warning' as const : 'info' as const,
  })), [inbox.messages, locale]);
  const status = inbox.loading ? tr('Reading messages…') : inbox.error ? tr(items.length ? 'Messages could not be refreshed.' : 'Messages could not be loaded.') : null;
  return <NotificationCenter notifications={items} label={tr('Notifications')} open={open} onOpenChange={value => { setOpen(value); if (value) void inbox.refresh(); }}
    onReadChange={(item, read) => inbox.update(item.id, { read })}
    onDismiss={item => inbox.update(item.id, { folder: 'Archive' })}
    summaryText={status ?? undefined} emptyText={items.length === 0 ? status ?? undefined : undefined} />;
}

export function formatNoticeTime(value: string, locale: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) : '—';
}
