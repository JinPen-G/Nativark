/** Read the existing original opening material under current Task and Core
 * permissions. No model, task creation, configuration save or publish port. */
import { aiTaskReadPolicyQuery, aiOpeningTaskMaterialResponse, AI_SCENE_REQUEST_DRAFT_VERSION, AI_SCENE_REQUEST_HTTP_DRAFT } from '@rental-os/shared';
import type { AiTaskReadPolicyQuery, AiSceneRequestReadDraft, AiSceneTaskMaterialResponseDraft, ApiResult } from '@rental-os/shared';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { validateTaskCenterSnapshot } from '@/features/ai-native/task-center-reader';
import { aiTaskCenterApi } from './aiTaskCenter';
import { http } from './http';

export type OpeningTaskMaterial = Extract<AiSceneTaskMaterialResponseDraft, { original: { sceneCode: 'opening_diagnosis' } }>;

export const aiOpeningDiagnosticsApi = Object.freeze({
  async read(query: AiTaskReadPolicyQuery, original: AiSceneRequestReadDraft, signal: AbortSignal): Promise<OpeningTaskMaterial> {
    const selected = aiTaskReadPolicyQuery.parse(structuredClone(query)), reference = structuredClone(original);
    if (!reference || Object.keys(reference).length !== 2 || reference.draftVersion !== AI_SCENE_REQUEST_DRAFT_VERSION
      || typeof reference.inputRef !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(reference.inputRef)) {
      throw Error('AI_INVALID_INPUT');
    }
    const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
    const auth = useAuthStore.getState(), tenantId = auth.tenant?.tenantId, workspaceId = auth.currentWorkspaceId;
    const check = () => { if (active.aborted || epoch !== currentSessionEpoch() || !tenantId || !workspaceId) throw Error('AI_SCOPE_CHANGED'); };
    const task = async () => {
      check(); const value = validateTaskCenterSnapshot(await aiTaskCenterApi.snapshot(selected.taskId, active), selected.taskId); check();
      if (value.sceneCode !== 'opening_diagnosis') throw Error('AI_RESOURCE_UNAVAILABLE');
    };
    await task();
    const response = await http.post<ApiResult<unknown>>(`/${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/${AI_SCENE_REQUEST_HTTP_DRAFT.material}`,
      reference, { signal: active, timeout: 15000 });
    check();
    if (new TextEncoder().encode(JSON.stringify(response.data.data)).length > 262144) throw Error('AI_RESOURCE_UNAVAILABLE');
    const value = aiOpeningTaskMaterialResponse.parse(response.data.data);
    if (value.original.inputRef !== reference.inputRef || value.original.draftVersion !== reference.draftVersion || value.original.state === 'revoked'
      || value.task.state !== 'observed' || value.task.taskId !== selected.taskId || selected.runId !== undefined && value.task.runId !== selected.runId
      || value.material.scope.tenantId !== tenantId || value.material.scope.workspaceId !== workspaceId || value.material.audience !== 'operator') {
      throw Error('AI_SCOPE_CHANGED');
    }
    const sameScope = (scope: { tenantId: string; workspaceId: string }) => scope.tenantId === tenantId && scope.workspaceId === workspaceId;
    if (value.material.sections.some(row => !sameScope(row.evidence.scope) || row.evidence.resourceId !== row.key
      || row.evidence.version !== value.material.configVersion || 'kind' in row.manual && (!sameScope(row.manual.scope) || row.manual.section !== row.key))
      || Object.values(value.material.configuration).some(section => !sameScope(section.source.scope) || section.source.version !== value.material.configVersion)) {
      throw Error('AI_SCOPE_CHANGED');
    }
    await task(); check();
    return value;
  }
});
