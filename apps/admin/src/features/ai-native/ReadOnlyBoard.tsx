import { TaskList } from "./TaskList";
import { TaskTimeline } from "./TaskTimeline";
import { ModelText } from "./ModelText";
import { ProposalPreview, type ProposalPreviewProps } from "./ProposalPreview";
import { MissingFieldsPanel, type MissingField } from "./MissingFieldsPanel";
import { AiServiceSummary, type AiServiceSummaryProps } from "./AiServiceSummary";
import { CapabilityStatus, type CapabilityStatusProps } from "./CapabilityStatus";
import { KnowledgeSources, type KnowledgeSource } from "./KnowledgeSources";
import { MemoryPreferences, type MemoryPreference } from "./MemoryPreferences";
import { OrderFactsCard } from "./OrderFactsCard";
import { toUsageDisplay, type UsageDisplayInput } from "./usage-display";
export interface ReadOnlyBoardProps {
  tasks?: readonly unknown[];
  taskId: string;
  steps?: readonly unknown[];
  modelText: string;
  proposal?: ProposalPreviewProps["proposal"];
  fields?: readonly MissingField[];
  draft?: Record<string, string>;
  summary?: AiServiceSummaryProps["summary"];
  assessments?: CapabilityStatusProps["assessments"];
  usage?: UsageDisplayInput;
  sources?: readonly KnowledgeSource[];
  memories?: readonly MemoryPreference[];
  orderFacts?: unknown;
}
/** Offline host composition only. It owns no transport, authorization or mutation. */
export function ReadOnlyBoard({
  tasks,
  taskId,
  steps,
  modelText,
  proposal,
  fields,
  draft = {},
  summary,
  assessments,
  usage,
  sources,
  memories,
  orderFacts,
}: ReadOnlyBoardProps) {
  return (
    <section aria-label="AI 只读工作台">
      <TaskList tasks={tasks} page={1} />
      <TaskTimeline taskId={taskId} steps={steps} />
      <ModelText text={modelText} />
      <ProposalPreview proposal={proposal} />
      <MissingFieldsPanel fields={fields} draft={draft} />
      <AiServiceSummary summary={summary} />
      <CapabilityStatus assessments={assessments} />
      {usage && (() => {
        const display = toUsageDisplay(usage);
        return <p aria-label="AI 用量">{display.label}：{display.value}</p>;
      })()}
      <KnowledgeSources sources={sources} />
      <MemoryPreferences items={memories} />
      {orderFacts !== undefined && <OrderFactsCard facts={orderFacts} />}
    </section>
  );
}
