/** Explicitly carries saved employee values into the existing inspection form.
 * A current original draft/template read is required again before adoption.
 * It neither adopts raw model candidates nor submits an order or inspection. */
import type { AiInspectionDraftReadResponse, AiInspectionFieldValue, AiInspectionTarget,
  AiInspectionTemplateResponseDraft, RentalInspectionTemplate } from '@rental-os/shared';
import type { StaffInspectionTaskApi } from '../../api/ai-inspection-tasks';
import type { InspectionFieldRow } from '../../core/inspection-form';
import type { StaffInspectionTaskContext } from './inspection-task-session';
import { isInspectionSavedCandidateReview } from './inspection-wire';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const targetKeys = ['orderId', 'allocationId', 'templateId', 'stage'] as const;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
const display = (value: string) => value.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 200);

export interface InspectionHumanHandoff {
  target: AiInspectionTarget; draftId: string; revision: number; templateVersion: string;
  fields: Array<{ code: string; type: InspectionFieldRow['type']; value: AiInspectionFieldValue }>;
  omitted: string[];
  current(): boolean;
  revalidate(): Promise<void>;
}

function verifySource(context: StaffInspectionTaskContext, template: AiInspectionTemplateResponseDraft,
  draft: AiInspectionDraftReadResponse): void {
  const source = context.source;
  if (!context.current() || draft.draftId !== source.draftId || !['draft_saved', 'prepared'].includes(draft.status)
    || !targetKeys.every(key => draft.target[key] === source[key]
      && (key === 'templateId' ? template.template.id : template[key]) === source[key])
    || template.audience !== 'staff' || template.scope.kind !== 'workspace'
    || template.scope.tenantId !== context.tenantId || template.scope.workspaceId !== context.workspaceId
    || template.owner.actorKind !== 'user' || template.owner.actorId !== context.ownerId
    || template.template.id !== source.templateId || template.template.stage !== source.stage
    || template.template.enabled !== true || draft.assetId !== template.assetId
    || draft.templateVersion !== template.template.version || draft.bindingFingerprint !== template.bindingFingerprint
    || template.template.fields.length > 100 || new Set(template.template.fields.map(field => field.code)).size !== template.template.fields.length
    || !Number.isSafeInteger(draft.revision) || draft.revision < 1) throw Error('原检查草稿、模板或当前权限已变化');
}

/** Called only by an explicit employee action; reads cannot start recognition. */
export async function readInspectionHumanHandoff(context: StaffInspectionTaskContext,
  api: Pick<StaffInspectionTaskApi, 'readTemplate' | 'readDraft'>): Promise<InspectionHumanHandoff> {
  const source = copy(context.source);
  const target = { orderId: source.orderId, allocationId: source.allocationId, templateId: source.templateId, stage: source.stage };
  if (!context.current()) throw Error('当前检查对象已变化');
  const template = await api.readTemplate(target), draft = await api.readDraft(source);
  verifySource(context, template, draft);
  const fields: InspectionHumanHandoff['fields'] = [], omitted: string[] = [];
  for (const definition of template.template.fields) {
    const human = draft.state.fields[definition.code];
    if (!human || human.decision === 'rejected' || human.value === null) {
      if (definition.required || human?.decision === 'rejected') omitted.push(`${display(definition.label)}：未有可采用人工值，请在原表单核实`);
      continue;
    }
    if (human.actorId !== context.ownerId || !['accepted', 'modified', 'manual'].includes(human.decision)) throw Error('原人工检查值归属不可核对');
    if (!['boolean', 'number', 'text', 'select', 'photo'].includes(definition.type)) {
      omitted.push(`${display(definition.label)}：请在原人工检查中填写`); continue;
    }
    if (human.decision === 'accepted') {
      const candidates = draft.state.candidates.filter(candidate => candidate.candidateId === human.candidateId && candidate.fieldCode === definition.code);
      const reviews = draft.candidateReviews.filter(review => review.candidateId === human.candidateId);
      const candidate = candidates.length === 1 ? candidates[0] : undefined, review = reviews.length === 1 ? reviews[0] : undefined;
      const value = candidate?.status === 'candidate' ? candidate.value.kind === 'photo' ? candidate.value.attachmentId : candidate.value.value : undefined;
      if (!candidate || candidate.status !== 'candidate' || !review || !isInspectionSavedCandidateReview(review)
        || review.adoption !== 'human_confirmation_required' || !review.sourcesMatchDraftEvidence
        || review.basis.status !== 'recorded' || review.reviewIssues.length || review.basisIssues.length
        || value !== human.value || !candidate.sources.every(ref => draft.state.evidence.some(evidence => evidence.attachmentId === ref.attachmentId
          && evidence.attachmentRevision === ref.attachmentRevision))) {
        omitted.push(`${display(definition.label)}：原候选仍待核实，请人工填写`); continue;
      }
    }
    const value = human.value;
    if (definition.type === 'boolean' ? typeof value !== 'boolean'
      : definition.type === 'number' ? typeof value !== 'number' || !Number.isFinite(value)
        : typeof value !== 'string' || (definition.required && !value.trim())
          || definition.type === 'select' && !definition.options?.includes(value)
          || definition.type === 'photo' && (!id(value) || !draft.state.evidence.some(ref => ref.attachmentId === value))) {
      throw Error('原人工检查值与当前模板不一致');
    }
    fields.push({ code: definition.code, type: definition.type as InspectionFieldRow['type'], value });
  }
  const snapshot = { template: copy(template), draft: copy(draft) };
  const revalidate = async () => {
    if (!context.current() || !same(context.source, source)) throw Error('当前检查对象已变化');
    const before = await api.readDraft(source), latestTemplate = await api.readTemplate(target), after = await api.readDraft(source);
    verifySource(context, latestTemplate, after);
    if (!same(before, snapshot.draft) || !same(after, snapshot.draft) || !same(latestTemplate, snapshot.template)) throw Error('原人工检查值已变化，请重新核对');
  };
  await revalidate();
  return { target: copy(draft.target), draftId: draft.draftId, revision: draft.revision, templateVersion: draft.templateVersion,
    fields, omitted, current: () => context.current() && same(context.source, source), revalidate };
}

export interface InspectionFormPage {
  data: { id: string; groups?: Array<{ allocationId: string; title: string; fields: InspectionFieldRow[] }>;
    allocations?: Array<{ id: string; title: string; selected: boolean; quantity: string; max: number; fields: InspectionFieldRow[] }>;
    sharedFields: InspectionFieldRow[] };
  template?: RentalInspectionTemplate;
  boolCodes: string[];
}
export interface InspectionHumanFormPreview {
  resource: string; draftLabel: string;
  changes: Array<{ code: string; label: string; scope: string; before: string; after: string }>;
  omitted: string[];
}
export interface InspectionHumanFormPlan {
  preview: InspectionHumanFormPreview;
  revalidate(): Promise<void>;
  apply(): { groups?: InspectionFormPage['data']['groups']; allocations?: InspectionFormPage['data']['allocations']; sharedFields: InspectionFieldRow[] };
}
const formSnapshot = (page: InspectionFormPage) => JSON.stringify({ id: page.data.id, template: page.template, boolCodes: page.boolCodes,
  groups: page.data.groups?.map(row => ({ allocationId: row.allocationId, title: row.title, fields: row.fields })),
  allocations: page.data.allocations?.map(row => ({ id: row.id, title: row.title, selected: row.selected, quantity: row.quantity, max: row.max, fields: row.fields })),
  sharedFields: page.data.sharedFields });
const shownValue = (row: InspectionFieldRow) => row.type === 'boolean' ? row.checked ? '已勾选' : '未勾选'
  : row.type === 'photo' ? `${row.photos.length}份原照片凭证` : display(row.value) || '未填写';

/** The original page owns aggregation. Only the selected resource's boolean
 * rows change; shared fields are clearly shown as order-wide before adoption. */
export function prepareInspectionHumanForm(page: InspectionFormPage, stage: 'pickup' | 'return', handoff: InspectionHumanHandoff,
  current: () => boolean): InspectionHumanFormPlan {
  if (!current() || !handoff.current() || page.data.id !== handoff.target.orderId || stage !== handoff.target.stage
    || page.template?.id !== handoff.target.templateId || page.template.version !== handoff.templateVersion) throw Error('当前检查表单与原草稿不一致');
  const groups = page.data.groups ? copy(page.data.groups) : undefined, allocations = page.data.allocations ? copy(page.data.allocations) : undefined;
  const matches = stage === 'pickup' ? groups?.filter(row => row.allocationId === handoff.target.allocationId)
    : allocations?.filter(row => row.id === handoff.target.allocationId);
  if (matches?.length !== 1 || stage === 'return' && !allocations?.some(row => row.id === handoff.target.allocationId && row.selected)) {
    throw Error('请先在原表单选择本草稿对应的归还资源');
  }
  const resource = matches[0], sharedFields = copy(page.data.sharedFields), preview: InspectionHumanFormPreview = {
    resource: display(resource.title), draftLabel: `原检查草稿 ${handoff.draftId.slice(-12)} · 版本 ${handoff.revision}`, changes: [], omitted: [...handoff.omitted] };
  for (const field of handoff.fields) {
    const rows = field.type === 'boolean' ? resource.fields : sharedFields, candidates = rows.filter(row => row.code === field.code);
    const row = candidates.length === 1 ? candidates[0] : undefined;
    if (!row || row.type !== field.type || field.type === 'boolean' && !page.boolCodes.includes(field.code)) throw Error('原检查字段已变化');
    const before = shownValue(row), previous = copy(row);
    if (field.type === 'boolean') row.checked = field.value as boolean;
    else if (field.type === 'photo') {
      if (!row.photos.some(photo => photo.id === field.value)) {
        if (row.photos.length >= 5) throw Error(`请先在原表单核对${display(row.label)}的照片数量`);
        row.photos.push({ id: String(field.value), path: '' });
      }
    } else row.value = String(field.value);
    if (!same(row, previous)) preview.changes.push({ code: field.code, label: display(row.label),
      scope: field.type === 'boolean' ? '仅所选资源' : '原整单检查项', before, after: shownValue(row) });
  }
  const captured = formSnapshot(page);
  let revalidated = false, consumed = false;
  const assertCurrent = () => { if (consumed || !current() || !handoff.current() || formSnapshot(page) !== captured) throw Error('检查表单已变化，请重新核对差异'); };
  return { preview,
    async revalidate() { assertCurrent(); await handoff.revalidate(); assertCurrent(); revalidated = true; },
    apply() {
      assertCurrent(); if (!revalidated) throw Error('须先重读原人工值'); consumed = true;
      // Keep asynchronous cover/identifier presentation from the current page.
      // Only the compared fields are carried by the adoption operation.
      return { ...(groups ? { groups: page.data.groups!.map(row => ({ ...row, fields: groups.find(next => next.allocationId === row.allocationId)!.fields })) } : {}),
        ...(allocations ? { allocations: page.data.allocations!.map(row => ({ ...row, fields: allocations.find(next => next.id === row.id)!.fields })) } : {}), sharedFields };
    } };
}
