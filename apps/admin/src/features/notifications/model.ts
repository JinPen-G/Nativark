import type { RentalWorkbenchTodo } from '@rental-os/shared';

export type Folder = 'Inbox' | 'Snoozed' | 'Archive';
export type Category = 'business' | 'review' | 'ai' | 'system';
export interface Notice {
  id: string; events: string[]; category: Category; title: string; description: string;
  createdAt: string; priority: 'high' | 'normal'; pending: boolean;
  href: string; threadId?: string; demo?: boolean; orderNo?: string; workOrderId?: string;
}
export interface PersonalEntry {
  read: boolean; folder: Folder; events: string[]; updatedAt: number;
}
export type PersonalState = Record<string, PersonalEntry>;

/** Only personal message metadata is persisted. Business facts always come from scoped APIs. */
export function parsePersonalState(raw: string | null): PersonalState {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([id, item]) => {
      if (!id || id.length > 256 || !item || typeof item !== 'object') return false;
      const e = item as PersonalEntry;
      return typeof e.read === 'boolean' && ['Inbox', 'Snoozed', 'Archive'].includes(e.folder)
        && Number.isFinite(e.updatedAt) && Array.isArray(e.events) && e.events.length <= 40
        && e.events.every(key => typeof key === 'string' && key.length <= 256);
    }).sort((a, b) => (b[1] as PersonalEntry).updatedAt - (a[1] as PersonalEntry).updatedAt).slice(0, 500)
      .map(([id, item]) => { const e = item as PersonalEntry; return [id, {
        read: e.read, folder: e.folder, events: e.events, updatedAt: e.updatedAt,
      }]; }));
  } catch { return {}; }
}

export function messageState(notice: Notice, entry: PersonalEntry | undefined) {
  const changed = Boolean(entry && notice.events.some(id => !entry.events.includes(id)));
  return {
    folder: !entry || changed ? 'Inbox' as Folder : entry.folder,
    read: Boolean(entry?.read && !changed),
  };
}

export function groupTodos(todos: RentalWorkbenchTodo[]): Notice[] {
  const groups = new Map<string, RentalWorkbenchTodo[]>();
  for (const item of todos) {
    const id = item.orderId ? `order:${item.orderId}` : item.workOrderId ? `work:${item.workOrderId}` : item.id;
    groups.set(id, [...(groups.get(id) ?? []), item]);
  }
  return [...groups].map(([id, items]) => {
    items.sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high') || b.createdAt.localeCompare(a.createdAt));
    const first = items[0];
    const review = items.some(i => ['fee_review', 'offline_payment_pending', 'no_show_confirmation'].includes(i.type));
    return {
      id: `todo:${id}`, events: items.map(item => `${item.type}:${item.id}${item.type === 'work_order' ? `:${item.priority}` : ''}`),
      category: items.every(i => i.type === 'notification_failure') ? 'system' : review ? 'review' : 'business',
      title: items.length === 1 ? first.title : `${first.orderNo ?? first.title} · ${items.length}`,
      description: items.map(item => items.length > 1 ? `${item.title}：${item.description}` : item.description).join('\n'),
      createdAt: items.map(i => i.createdAt).sort().at(-1) ?? '',
      priority: first.priority, pending: true, href: first.href, orderNo: first.orderNo,
      workOrderId: items.every(item => item.type === 'work_order') ? first.workOrderId : undefined,
    } satisfies Notice;
  });
}
