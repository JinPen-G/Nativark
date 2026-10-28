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
  'Pending notifications': '待处理消息', 'No pending tasks': '暂无待处理事项', 'Tasks that need action appear here.': '需要处理的事项会显示在这里。',
  'Work order': '工单', 'Appearance damage': '外观损伤', Assignee: '处理人', Unassigned: '未派工', Claim: '领取工单', Assign: '派工', Reassign: '转交',
  'Confirm assignment': '确认派工', Cancel: '取消', Back: '返回核对', 'Assignment updated.': '派工信息已确认。', 'Assignment failed.': '派工失败。',
  'An action is already pending.': '该操作正在处理中，请勿重复提交。', 'This action is no longer available.': '当前操作已不可用，请重新核对。',
  'The work order changed. Review it again.': '工单已更新，请重新核对后操作。', 'This assignee is no longer available.': '该处理人当前不可选，请重新选择。',
  'Assignment result is unknown. Check the work order before trying again.': '派工结果尚未确认，请先进入工单核对，避免重复提交。',
  'Work order details are unavailable.': '暂时无法读取工单资料。', 'Reading work order…': '正在读取工单…',
  'Review draft': '核对草稿', 'Needs more info': '需要补充', 'Download demo result': '下载示例结果', 'Confirm demo draft': '确认示例草稿',
  'This draft changed. Review it again.': '草稿已更新，请重新核对。', 'What needs to change?': '需要补充的内容', 'Save request': '记录补充要求',
  'Request saved in the conversation. Local demo only.': '补充要求已记录到原对话，仅本地演示，尚未自动执行。',
};
const englishFacts: Record<string, string> = {
  '租赁安排': 'Rental', '租金': 'Rental charge', '可退押金': 'Refundable deposit', '待支付合计': 'Total due', '交接事项': 'Handover items',
  '关联订单': 'Orders', '负责人': 'Assignees', '交付时间': 'Handover time', '协同安排': 'Tasks', '涉及门店': 'Locations', '计划时间': 'Schedule',
};
export function useNotificationText() {
  const { locale } = useLocale();
  return (text: string, values?: Record<string, string | number>) => (locale === 'zh-CN' ? labels[text] ?? text : englishFacts[text] ?? text)
    .replace(/\{(\w+)\}/g, (match, key: string) => String(values?.[key] ?? match));
}
