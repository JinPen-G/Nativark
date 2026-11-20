/** The existing explicit start consumes the original creation/change receipt
 * before its first read policy is required. This only issues bounded policies;
 * the original settings host still owns publication, leases and execution. */
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskRunnerError, callAiTaskRunnerDependency } from '../runner/ai-task-runner.service';
import type { ApprovedSettingsApplicationDependencies } from './approved-settings-task.authority';
import { composeSettingsStartAdmission, type SettingsStartAdmissionDependencies } from './settings-start-admission.application';

export type OriginalSettingsStartAdmissionConfiguration = Pick<SettingsStartAdmissionDependencies,
  'db' | 'currentRuntimeEnabled' | 'maximumAdmissionMs'>;

export async function prepareOriginalSettingsStartAdmission(dependencies: ApprovedSettingsApplicationDependencies,
  original: { creationKey: string; changeKey: string }, configuration: OriginalSettingsStartAdmissionConfiguration,
  signal?: AbortSignal): Promise<void> {
  if (!Object.is(dependencies.db, configuration.db) || typeof configuration.currentRuntimeEnabled !== 'function'
    || signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  let attempted = false;
  try {
    await callAiTaskRunnerDependency(async () => {
      const application = composeSettingsStartAdmission({ ...dependencies,
        currentRuntimeEnabled: configuration.currentRuntimeEnabled,
        maximumAdmissionMs: configuration.maximumAdmissionMs });
      const intent = 'explicit_settings_start' as const;
      const prepared = await application.prepare({ original, intent }, signal);
      if (prepared.admission !== 'existing_policies_available') {
        attempted = true;
        const result = await application.issue({ reference: prepared.reference, intent }, signal);
        if (result.phase !== 'settings_initial_policy_admission_recorded'
          || result.admission !== 'current_creation_change_category_publication_and_role_revalidated'
          || result.reference.intentHash !== prepared.reference.intentHash || !result.receipt.completeRecorded)
          throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      }
      if (signal?.aborted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
    }, 15000, 'original_settings_start_admission', signal);
  } catch (error) {
    if (attempted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
    if (error instanceof AiTaskRunnerError && ['AI_RUN_LIMIT', 'AI_RESULT_UNKNOWN'].includes(error.code))
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    throw error;
  }
}
