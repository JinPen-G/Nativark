/** Local, registered navigation intents. Model/user text never becomes a URL or selector. */
export type CopilotDestination = { id: string; path: string; label: string; anchor?: string; fallback?: string; tab?: string; keywords: RegExp };
export const COPILOT_DESTINATIONS: CopilotDestination[] = [
  { id: 'overdue', path: '/rental/settings', tab: 'rules', anchor: 'overdue-fees', fallback: 'business-rules', label: '逾期规则', keywords: /逾期|宽限|overdue|grace/i },
  { id: 'cancellation', path: '/rental/settings', tab: 'rules', anchor: 'cancellation-rules', fallback: 'business-rules', label: '取消规则', keywords: /取消规则|取消费用|免费取消|cancellation/i },
  { id: 'business-rules', path: '/rental/settings', tab: 'rules', anchor: 'business-rules', label: '业务规则', keywords: /业务规则|business rules/i },
  { id: 'calendar', path: '/rental/settings', tab: 'calendar', anchor: 'governance-view', label: '营业日历', keywords: /营业日历|节假日|holiday|calendar/i },
  { id: 'pricing-method', path: '/rental/settings', tab: 'category', anchor: 'pricing-method', label: '计价方式', keywords: /计价方式|计价单位|默认单位|pricing units/i },
  { id: 'fulfillment-method', path: '/rental/settings', tab: 'category', anchor: 'fulfillment-method', label: '租赁与履约方式', keywords: /履约方式|交付方式|提前锁定|fulfillment settings/i },
  { id: 'theme', path: '/settings/appearance', anchor: 'theme-color', label: '管理后台主题色', keywords: /主题色|主色|theme color|accent/i },
  { id: 'radius', path: '/settings/appearance', anchor: 'admin-radii', label: '管理后台圆角（分组）', keywords: /圆角|radius|radii/i },
  { id: 'motion', path: '/settings/appearance', anchor: 'motion', label: '界面动效', keywords: /动效|动画|减少动态|motion|animation/i },
  { id: 'sound', path: '/settings/appearance', anchor: 'sound', label: '音效设置', keywords: /音效|声音|静音|sound|audio|mute/i },
];
export function navigationTarget(state: unknown, path: string) {
  const value = (state as { copilotTarget?: unknown } | null)?.copilotTarget;
  return typeof value === 'string' ? COPILOT_DESTINATIONS.find(target => target.id === value && target.path === path) : undefined;
}
