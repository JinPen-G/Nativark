/** Plain-text projection of the original checked opening material.
 * Preserves per-section states, source versions and recorded integration facts.
 * It does not infer aggregate readiness, run probes or save/publish settings. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, AI_SCOPE_DRAFT_SCHEMAS,
  AI_OPENING_INTEGRATION_OBSERVATION_SCHEMAS, type AiOpeningBusinessMaterialDraft,
  type AiOpeningSectionMaterialDraft, type AiOpeningIntegrationState } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';

const definitions = JSON.parse(JSON.stringify({ ...AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS,
  ...AI_SCOPE_DRAFT_SCHEMAS, ...AI_OPENING_INTEGRATION_OBSERVATION_SCHEMAS })
  .replaceAll('#/components/schemas/', '#/$defs/'));
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const valid = ajv.compile<AiOpeningBusinessMaterialDraft>({ $ref: '#/$defs/AiOpeningBusinessMaterialDraft', $defs: definitions });
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const quoted = (value: string) => JSON.stringify(value);
const sectionStates: Record<AiOpeningSectionMaterialDraft['status'], string> = {
  source_unavailable: '原事实源不可用',
  readiness_check_passed: '原分区检查已通过',
  missing_configuration: '缺少配置',
  readiness_unsatisfied: '原分区开业检查未通过',
  unclassified: '当前来源尚无法分类',
};
const integrationStates: Record<AiOpeningIntegrationState, string> = {
  not_loaded: '原配置状态未加载',
  not_implemented: '适配器未实现',
  missing_configuration: '缺少配置',
  configured_unverified: '已配置，未核验',
  mock: '原记录为模拟检测',
  failed: '原检测记录失败',
  historical_live_success: '历史实测记录通过，当前配置未由该记录核验',
  current_live_success: '原实测记录与当前配置匹配',
};

export function buildOpeningDiagnosisText(value: unknown): string {
  let material: AiOpeningBusinessMaterialDraft;
  try {
    const copy = structuredClone(value);
    if (!valid(copy) || new Set(copy.sections.map(section => section.key)).size !== copy.sections.length) throw unavailable();
    material = copy;
  } catch { throw unavailable(); }

  const lines = ['原开业检查结果', `观察时间 ${material.observedAt}`,
    `经营配置版本 ${quoted(material.configVersion)}`, '以下仅覆盖本次原材料的已读取分区。'];
  for (const section of material.sections) {
    lines.push(`${quoted(section.title)}（${section.required ? '必需' : '可选'}） ${sectionStates[section.status]}`);
    if (section.summary !== undefined) lines.push(`原检查摘要 ${quoted(section.summary)}`);
    if (section.issue) lines.push(`原检查说明 ${quoted(section.issue)}`);
    const source = section.evidence;
    lines.push(`来源 ${source.resourceType} / ${quoted(source.resourceId)} · 版本 ${quoted(source.version)} · 观察时间 ${source.observedAt}`);
  }

  const integrations = material.integrationObservation;
  if (integrations?.state === 'observed') {
    lines.push('第三方服务的已保存配置与检测记录', `记录观察时间 ${integrations.observation.observedAt}`);
    for (const row of integrations.observation.items) {
      lines.push(`${quoted(row.capability)} / ${quoted(row.provider)} ${integrationStates[row.state]}`);
      if (row.missingFields?.length) lines.push(`原记录缺少字段 ${row.missingFields.map(quoted).join('、')}`);
      if (row.configurationUpdatedAt) lines.push(`原配置修订时间 ${row.configurationUpdatedAt}`);
      if (row.test?.checkedAt) lines.push(`原检测时间 ${row.test.checkedAt}`);
      if (row.test && !row.test.matchesCurrentConfiguration) lines.push('该原检测记录未核验当前配置。');
    }
    if (integrations.observation.hasMore) lines.push('仅加载有界配置窗口，窗口外服务状态未加载。');
  } else {
    lines.push(integrations?.reason === 'current_integration_permission_required'
      ? '当前权限下未读取第三方配置与检测记录。' : '第三方配置与检测记录未加载。');
  }
  // The material can carry a saved live test. It cannot attest a new probe,
  // whole-tenant readiness, or the later proposal/draft/publication lifecycle.
  lines.push('外部凭据与实时连接未核验。', '业务草稿、发布与采用结果未加载。', '各分区为独立读取观察。');
  const text = lines.join('\n');
  if (Buffer.byteLength(text, 'utf8') > 131072) throw unavailable();
  return text;
}
