import { useLocale } from '@/app/locale';

const labels: Record<string, string> = {
  Notifications: '通知', All: '全部', Unread: '未读', 'Mark all read': '全部已读',
  'Mark unread': '标为未读', 'Mark read': '标为已读', Dismiss: '归档',
  'Clear read': '归档已读', 'Close notifications': '关闭通知', 'Show notifications': '筛选通知',
  'All notifications': '全部通知', 'Unread notifications': '未读通知',
  'Nothing unread': '没有未读消息', 'All clear': '暂无消息', 'You’ve seen every update.': '已读完当前消息。',
  'New updates will appear here.': '新消息会显示在这里。', 'View all updates': '查看全部消息',
  'You’re all caught up': '已读完当前消息', '{count} updates waiting for you': '{count} 条未读消息',
  'This update is ready to review.': '可以展开查看详情。', unread: '未读', read: '已读',
  'Hide details': '收起详情', 'Show details': '展开详情',
  Messages: '消息中心', Inbox: '收件箱', Snoozed: '稍后', Archive: '归档', Folders: '消息分类',
  'Unread only': '只看未读', Snooze: '稍后', 'Move to Inbox': '移回收件箱',
  'No unread messages': '没有未读消息', 'Inbox is clear': '收件箱为空',
  'Snoozed is empty': '没有稍后提醒', 'Archive is empty': '没有归档消息',
  'You are all caught up.': '已读完当前消息。', 'Messages you archive land here.': '归档消息会保留在这里。',
  'Messages you snooze land here.': '设为稍后查看的消息会显示在这里。',
  'Nothing needs your attention.': '当前空间暂无新待办。', 'Show all messages': '查看全部消息',
  'Back to inbox': '返回收件箱', Archived: '已归档', SnoozedStatus: '已设为稍后提醒',
  'Moved to inbox': '已移回收件箱', snooze: '稍后', archive: '归档', 'move to inbox': '移回收件箱',
  'Open a message to snooze or archive it': '展开消息可稍后提醒或归档',
  'Open a message to move it': '展开消息可恢复', Undo: '撤销',
  Business: '业务待办', Review: '审核协作', 'AI & automation': 'AI 与自动化', System: '系统提醒',
  'All categories': '全部分类', 'Pending only': '只看待处理', 'Open workspace': '核对结果',
  'Open record': '查看业务', 'Message center': '消息中心', 'Refresh messages': '刷新消息',
  'Reading messages…': '正在读取消息…', 'Messages could not be refreshed.': '消息刷新失败，原有消息仍保留。',
  'Messages could not be loaded.': '暂时无法读取消息，请重试。', Retry: '重试',
  'Saved on this device': '个人消息状态保存在本机', 'Session only': '本机存储不可用，状态仅本次会话有效',
  'Local AI demo': 'AI 本地演示', 'Pending': '待处理',
};
export function useNotificationText() {
  const { locale } = useLocale();
  return (text: string, values?: Record<string, string | number>) => (locale === 'zh-CN' ? labels[text] ?? text : text)
    .replace(/\{(\w+)\}/g, (match, key: string) => String(values?.[key] ?? match));
}
