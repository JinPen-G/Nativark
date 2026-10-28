import { useCallback } from 'react';
import { useLocale } from '@/app/locale';

const english: Record<string, string> = {
  'AI 服务设置': 'AI settings', 'AI 任务中心': 'AI tasks',
  '服务配置': 'Configuration', '平台额度': 'Platform credit', '调用记录': 'Call history',
  'Rental OS AI（推荐）': 'Rental OS AI', '自带 AI 供应商': 'Your AI provider',
  '保存 AI 设置': 'Save settings', '保存中…': 'Saving…', '请求已返回': 'Request returned',
  '协议': 'Protocol', '密钥操作': 'API key', '保留现有密钥': 'Keep key', '替换密钥': 'Replace key', '清除密钥': 'Remove key',
  '可用模型': 'Available models', '默认模型': 'Default model', '获取模型': 'Get models', '识别协议类型': 'Detect protocol',
  '选择模型或输入模型 ID，最多 20 个': 'Select or enter up to 20 model IDs',
  '读取本人任务': 'Load my tasks', '刷新任务': 'Refresh tasks', '读取已结束': 'Loaded',
  '任务状态': 'Task status', '任务详情': 'Task details', '无权限查看 AI 任务': 'You do not have access to AI tasks',
  '暂无 AI 任务': 'No AI tasks', 'AI 任务列表': 'AI tasks', '任务分页': 'Task pages',
  '等待补充信息': 'Needs input', '等待人工确认': 'Needs approval', '等待外部核对': 'Waiting externally',
  '取消已请求': 'Stop requested', '待核对': 'Needs review', '服务未验证': 'Not verified',
  '启用 AI 服务': 'Enable AI',
  '自带供应商直接计费；平台额度仅用于平台 AI。': 'Your provider bills you directly. Platform credit applies to platform AI only.',
  '平台尚未发布可申请的 AI 计费配置，请联系 SaaS 管理员。': 'AI credit is not configured. Contact your platform administrator.',
  '模型服务由平台提供，使用额度在“平台额度”中申请。': 'Models are provided by the platform. Request credit under Platform credit.',
  '费用由供应商收取，平台记录 Token 用量。': 'Your provider bills you directly. Token usage is recorded here.',
  '获取模型后，请保存并测试连接。': 'Save your settings, then test the connection.',
  '请完善配置': 'Complete the configuration',
  '更改尚未保存': 'Unsaved changes',
  '测试可能产生供应商费用。': 'Your provider may charge for this test.',
  '额度为累计上限，不按月重置。': 'Credit limits are cumulative and do not reset monthly.',
  '各空间上限合计不得超过批准总额；已使用及待核对金额仍计入占用。': 'Combined workspace limits cannot exceed approved credit. Spent and pending amounts remain allocated.',
  '查看我的任务': 'My tasks',
  '读取任务，查看进度与待办事项。': 'Load your tasks to review progress and pending actions.',
  '停止刷新状态': 'Stop live updates',
  '自动刷新状态': 'Live updates',
  '每3秒更新，最长10分钟；任务结束后停止。': 'Updates every 3 seconds for up to 10 minutes, until the task ends.',
  '仅更新所选任务的状态。': 'Updates the selected task only.',
  '执行步骤': 'Steps', '确认记录': 'Approvals', '任务信息': 'Task information',
  '人工确认': 'Review & approve', '补充信息': 'Provide details', '取消任务': 'Cancel task', '用量记录': 'Usage',
  '批准与继续执行分开确认。': 'Approval and execution require separate confirmation.',
  '提交回答会尝试继续原任务，可能产生模型用量。': 'Submitting a response may resume this task and incur model usage.',
  '仅显示本页用量，不代表任务总费用或供应商账单。': 'Usage on this page is not the task total or your provider bill.',
  '停止后不再启动新步骤；已发生的操作不会自动撤销或退款。': 'Stopping prevents new steps. Previous actions are not automatically reversed or refunded.',
  '订单解读': 'Order insights',
  '开业诊断': 'Setup review', '报价说明': 'Quote review',
};

/** New feature copy shares the existing language preference and dictionary fallback. */
export function useAiManagementLocale() {
  const locale = useLocale();
  const translate = useCallback((text: string) => locale.locale === 'en-US' && english[text] ? english[text] : locale.t(text), [locale.locale, locale.t]);
  return { ...locale, t: translate };
}
