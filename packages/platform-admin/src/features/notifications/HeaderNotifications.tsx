import { useMemo, useState } from 'react';
import { NotificationCenter } from './archive/notification-center/notification-center';
import { useNotificationText } from './locale';
import { useLocale } from "../../app/locale";
import './notifications.css';

export interface ShellNotice {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  read: boolean;
  pending?: boolean;
  priority: "high" | "normal";
  folder: "Inbox" | "Snoozed" | "Archive";
  demo?: boolean;
}
export interface ShellNotifications {
  messages: readonly ShellNotice[];
  loading: boolean;
  error: boolean;
  refresh: () => unknown;
  update: (id: string, patch: { read?: boolean; folder?: ShellNotice["folder"] }) => void;
}
import type { ReactNode } from "react";

export function HeaderNotifications({ inbox, renderDetails }: { inbox: ShellNotifications; renderDetails?: (id: string) => ReactNode }) {
  const tr = useNotificationText(), { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const items = useMemo(() => inbox.messages.filter(item => item.folder === 'Inbox').map(item => ({
    id: item.id, title: `${item.demo ? `${tr('Local AI demo')} · ` : ''}${item.title}`,
    description: item.description, read: item.read, pending: item.pending,
    time: formatNoticeTime(item.createdAt, locale), tone: item.priority === 'high' ? 'warning' as const : 'info' as const,
  })), [inbox.messages, locale]);
  const status = inbox.loading ? tr('Reading messages…') : inbox.error ? tr(items.length ? 'Messages could not be refreshed.' : 'Messages could not be loaded.') : null;
  return <NotificationCenter notifications={items} label={tr('Notifications')} open={open} onOpenChange={value => { setOpen(value); if (value) void inbox.refresh(); }}
    onReadChange={(item, read) => inbox.update(item.id, { read })}
    onDismiss={item => inbox.update(item.id, { folder: 'Archive' })}
    renderDetails={renderDetails ? item => renderDetails(item.id) : undefined}
    summaryText={status ?? undefined} emptyText={items.length === 0 ? status ?? undefined : undefined} />;
}

export function formatNoticeTime(value: string, locale: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) : '—';
}
