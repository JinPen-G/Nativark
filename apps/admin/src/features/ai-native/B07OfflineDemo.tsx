import { ReadOnlyBoard, type ReadOnlyBoardProps } from "./ReadOnlyBoard";

/**
 * Feature-local B07 showcase. The host supplies all data and callbacks; this
 * component deliberately has no route, transport, persistence, or effects.
 */
export interface B07OfflineDemoProps extends Partial<ReadOnlyBoardProps> {
  taskId?: string;
}

const syntheticDefaults: ReadOnlyBoardProps = {
  taskId: "synthetic-b07-task",
  modelText: "Synthetic preview only. This text is untrusted data.",
  tasks: [],
  steps: [],
  fields: [],
  summary: { draftVersion: "ain-c07-draft-2", tenantId: "synthetic-tenant", configId: "synthetic-config", configRevision: 1, enabled: true, connectionState: "not_tested", mode: "platform_managed", serviceName: "Rental OS AI", routing: "automatic", availability: "not_verified" },
  assessments: [],
  sources: [],
  memories: [],
};

export function B07OfflineDemo({ taskId, ...overrides }: B07OfflineDemoProps) {
  return <ReadOnlyBoard {...syntheticDefaults} {...overrides} taskId={taskId ?? syntheticDefaults.taskId} />;
}
