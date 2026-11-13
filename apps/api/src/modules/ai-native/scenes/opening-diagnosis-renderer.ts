/** Plain-text projection of the original checked opening material.
 * Preserves per-section states, source versions and recorded integration facts.
 * It does not infer aggregate readiness, run probes or save/publish settings. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, AI_SCOPE_DRAFT_SCHEMAS,
  AI_OPENING_INTEGRATION_OBSERVATION_SCHEMAS, type AiOpeningBusinessMaterialDraft,
  type AiOpeningSectionMaterialDraft, type AiOpeningIntegrationState } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { readAiOpeningCalendarSource } from '../tools/diagnostic-read-facts.service';

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
    readAiOpeningCalendarSource(copy.calendarSource, copy.scope, copy.observedAt);
    if (copy.calendarSource && !copy.sections.some(section => section.key === 'business_calendar')) throw unavailable();
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
    if (section.key === 'business_calendar') {
      const calendar = material.calendarSource;
      if (!calendar) lines.push('当前日历来源未加载，不能确定已采用版本。');
      else {
        for (const row of calendar.years) {
          if (row.status === 'not_adopted') { lines.push(`${row.year} 年：未采用已发布日历。`); continue; }
          const binding = row.binding, official = binding.officialSource;
          lines.push(`${row.year} 年：当前日历版本 ${quoted(binding.version)} · 原修订 ${binding.revision}`,
            `日历引用 ${quoted(binding.id)} · 原发布时间 ${binding.publishedAt}`);
          if (Object.values(official).every(value => value === null)) lines.push('原官方来源引用未记录；不代表当前日历未发布。');
          else lines.push(`原官方来源版本 ${official.version === null ? '未记录' : quoted(official.version)}`,
            `原官方来源引用 ${official.versionId === null ? '未记录' : quoted(official.versionId)}`,
            `原官方发布时间 ${official.publishedAt ?? '未记录'} · 原导入时间 ${official.importedAt ?? '未记录'}`);
        }
        lines.push(`日历来源观察 ${calendar.observations.startedAt} — ${calendar.observations.completedAt}`,
          calendar.observations.consistency === 'caller_transaction_reads'
            ? '日历来源在调用方原事务内读取。' : '日历来源来自独立持久化读取，不是整体快照。',
          '官方引用仅为原日历记录，未重新核验官方来源。');
      }
    }
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
  lines.push('外部凭据与实时连接未核验。', material.calendarSource
    ? '日历仅显示当前原发布与采用记录；本次未保存草稿、发布或采用。' : '业务草稿、发布与采用结果未加载。', '各分区为独立读取观察。');
  const text = lines.join('\n');
  if (Buffer.byteLength(text, 'utf8') > 131072) throw unavailable();
  return text;
}
