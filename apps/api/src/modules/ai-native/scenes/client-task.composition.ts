import { randomUUID } from 'node:crypto';
import { AiTaskCreationRepository } from '../ai-task-creation.repository';
import { AiTaskEventRepository } from '../ai-task-event.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import { AiClientTaskAuthority, clientTaskSceneSchema, type AiAuthorizedClientMaterial, type AiClientTaskDependencies } from './client-task.authority';
import { AiClientTaskUnknownError, PrismaClientTaskInputRepository, clientTaskCommandSchema,
  clientTaskCreationKey, clientTaskInputHash, type AiClientTaskInput } from './prisma-client-task-input.repository';
import { aiClientTaskEventsReadRequestSchema } from '@rental-os/shared';

export const clientTaskEventsCommandSchema = aiClientTaskEventsReadRequestSchema;

export function composeClientMaterialTasks(dependencies: AiClientTaskDependencies,
  loadMaterial: (materialRef: string) => Promise<AiAuthorizedClientMaterial>, clock: () => Date) {
  const scene = freezeOriginalInput(clientTaskSceneSchema.parse({ sceneCode: dependencies.sceneCode, sceneVersion: dependencies.sceneVersion }));
  const inputs = new PrismaClientTaskInputRepository(dependencies.db);
  const authority = new AiClientTaskAuthority(dependencies, scene, loadMaterial, randomUUID(), clock);
  const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
  const assertCommand = (row: AiClientTaskInput, command: { creationKey: string; materialRef: string }) => {
    if (row.creationKey !== command.creationKey || row.materialRef !== command.materialRef
      || row.sceneCode !== scene.sceneCode || row.sceneVersion !== scene.sceneVersion) throw conflict();
  };
  const grant = async (row: AiClientTaskInput, operation: 'create' | 'read') => {
    const current = await authority.authorize(row.materialRef, operation), material = current.material;
    const stored = await inputs.findCreation(material, row.creationKey);
    if (!stored || stored.inputHash !== row.inputHash || stored.id !== row.id || row.expiresAt <= clock()
      || row.bindingHash !== material.bindingHash || row.principalHash !== material.principalHash || row.principalKind !== material.principalKind
      || row.materialInputHash !== material.inputHash || row.materialHash !== material.materialHash || row.materialRevision !== material.revision
      || row.tenantId !== material.tenantId || row.workspaceId !== material.workspaceId || row.channel !== material.channel
      || row.policyId !== current.policy.id || row.sceneCode !== scene.sceneCode || row.sceneVersion !== scene.sceneVersion
      || (operation === 'create' && (row.policyRevision !== current.policy.revision || row.policyHash !== current.policyHash))) throw conflict();
    return { context: current.context, creationAllowed: true as const, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion,
      inputRef: row.id, inputRevision: row.revision, inputHash: row.inputHash };
  };
  const repository = (row: AiClientTaskInput, operation: 'create' | 'read') => new AiTaskCreationRepository(dependencies.db, {
    resolve: async (sceneCode, inputRef) => {
      if (sceneCode !== row.sceneCode || inputRef !== row.id) throw conflict();
      return grant(row, operation);
    }
  }, clock);
  const originalCommand = (row: AiClientTaskInput) => ({ creationKey: clientTaskCreationKey(row), sceneCode: row.sceneCode, inputRef: row.id });
  const read = async (row: AiClientTaskInput) => {
    // The legacy readCreation grant shape is shared; this read-only instance never calls create.
    const result = await repository(row, 'read').readCreation(originalCommand(row));
    return { state: result.state === 'observed' ? 'observed' as const : 'unknown' as const,
      inputRef: row.id, inputHash: row.inputHash, task: result.task, retryable: false as const, nextAction: 'readTaskCreation' as const };
  };
  const parse = (value: unknown) => {
    const parsed = clientTaskCommandSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return freezeOriginalInput(parsed.data);
  };
  // Only the original command may select a task. This authority exposes timeline
  // metadata, not results/worker tokens and never grants execution or takeover.
  const eventReader = async (command: { creationKey: string; materialRef: string }) => {
    const current = await authority.authorize(command.materialRef, 'read');
    const row = await inputs.findCreation(current.material, command.creationKey);
    if (!row) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    assertCommand(row, command);
    const original = await read(row);
    if (!original.task) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const taskId = original.task.taskId;
    const events = new AiTaskEventRepository(dependencies.db, {
      resolve: async (requestedId, operation) => {
        if (requestedId !== taskId || !['read_metadata', 'read_events', 'read_step_terminal'].includes(operation)) {
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        }
        const access = await grant(row, 'read');
        const latest = await read(row);
        if (latest.task?.taskId !== taskId || latest.inputRef !== original.inputRef || latest.inputHash !== original.inputHash) throw conflict();
        return access.context;
      }
    }, clock);
    return { events, taskId };
  };
  const projection = { model: 'unavailable_client_execution_contract_missing' as const, automaticExecution: false as const };
  return Object.freeze({
    async readSnapshot(value: unknown) {
      const { events, taskId } = await eventReader(parse(value));
      return freezeOriginalInput(await events.readSnapshot({ taskId }));
    },
    async readEvents(value: unknown) {
      const parsed = clientTaskEventsCommandSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const { after, limit, ...command } = freezeOriginalInput(parsed.data);
      const { events, taskId } = await eventReader(command);
      return freezeOriginalInput(await events.readPage({ taskId, after, limit }));
    },
    async create(value: unknown) {
      const command = parse(value), material = await loadMaterial(command.materialRef);
      const existing = await inputs.findCreation(material.row, command.creationKey);
      if (existing) { assertCommand(existing, command); return freezeOriginalInput({ ...command, ...await read(existing), ...projection }); }
      const authorized = await authority.authorize(command.materialRef, 'create');
      if (!authorized.policyHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const source = authorized.material, createdAt = clock();
      const input = { id: randomUUID(), tenantId: source.tenantId, workspaceId: source.workspaceId, channel: source.channel,
        principalKind: source.principalKind, principalHash: source.principalHash, ...command,
        materialInputHash: source.inputHash, materialHash: source.materialHash, materialRevision: source.revision,
        bindingHash: source.bindingHash, policyId: authorized.policy.id, policyRevision: authorized.policy.revision, policyHash: authorized.policyHash,
        ...scene, revision: 1 as const, dispatchState: 'UNKNOWN' as const, createdAt,
        expiresAt: new Date(Math.min(source.expiresAt.getTime(), authorized.policy.expiresAt.getTime())) };
      const claimed = await inputs.claim({ ...input, inputHash: clientTaskInputHash(input) });
      if (!claimed.claimed) { assertCommand(claimed.row, command); return freezeOriginalInput({ ...command, ...await read(claimed.row), ...projection }); }
      try {
        const task = await repository(claimed.row, 'create').create(originalCommand(claimed.row));
        await grant(claimed.row, 'create');
        return freezeOriginalInput({ ...command, state: 'observed' as const, inputRef: claimed.row.id, inputHash: claimed.row.inputHash,
          task, retryable: false as const, nextAction: 'readTaskCreation' as const, ...projection });
      } catch { throw new AiClientTaskUnknownError(); }
    },
    async readCreation(value: unknown) {
      const command = parse(value), current = await authority.authorize(command.materialRef, 'read');
      const row = await inputs.findCreation(current.material, command.creationKey);
      if (!row) return freezeOriginalInput({ ...command, state: 'unknown' as const, task: null,
        retryable: false as const, nextAction: 'readTaskCreation' as const, ...projection });
      assertCommand(row, command);
      return freezeOriginalInput({ ...command, ...await read(row), ...projection });
    }
  });
}
