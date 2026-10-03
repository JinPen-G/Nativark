import type { AiTenantModelSettingsSummaryDraft } from '../../../../../packages/shared/src/ai-usage-draft';

export interface AiServiceSummaryProps { summary?: AiTenantModelSettingsSummaryDraft | null; }
const connection = { not_tested: '未验证', mock_only: '仅模拟验证', verified_live: '真实连接已验证', failed: '连接不可用' } as const;
export function AiServiceSummary({ summary }: AiServiceSummaryProps) {
  if (!summary || summary.draftVersion !== 'ain-c07-draft-2') return <p role="status">AI 配置不可用：缺少摘要或契约版本不匹配</p>;
  const state = connection[summary.connectionState] ?? '未知验证状态';
  if (summary.mode === 'platform_managed') return <section aria-label="AI 服务摘要"><h3>Rental OS AI</h3><p>{!summary.enabled ? '未启用' : summary.availability === 'ready' ? '服务可用' : summary.availability === 'not_verified' ? '服务未验证' : '服务不可用'}</p><p>{state}</p></section>;
  if (summary.mode !== 'tenant_managed') return <p role="status">AI 模式不可识别</p>;
  return <section aria-label="AI 服务摘要"><h3>自定义 AI 服务 / BYOK</h3><p>{!summary.enabled ? '未启用' : summary.credentialState === 'missing' ? '未配置凭据' : summary.credentialState === 'rotation_required' ? '凭据需要更新' : state}</p><dl><dt>协议</dt><dd>{summary.protocol.slice(0, 128)}</dd><dt>模型标识</dt><dd>{summary.model.slice(0, 256)}</dd></dl><p>{state}</p></section>;
}
