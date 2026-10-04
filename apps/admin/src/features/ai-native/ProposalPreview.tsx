import { proposalDisplayState } from "./proposal-preview-state";

export type ProposalPreviewData = {
  title: string;
  risk: string;
  expiresAt?: string;
  evidence?: string;
  changes: readonly { label: string; before: string; after: string }[];
};
export interface ProposalPreviewProps {
  proposal?: ProposalPreviewData | null;
  nowIso?: string;
  stale?: boolean;
}
export function ProposalPreview({ proposal, nowIso, stale = false }: ProposalPreviewProps) {
  if (!proposal) return <p role="status">提案不可用</p>;
  const state = proposalDisplayState({ expiresAt: proposal.expiresAt, nowIso, stale });
  return (
    <section aria-label="提案预览">
      <h3>{proposal.title}</h3>
      <p>风险：{proposal.risk}</p>
      <p>
        {state === "expired" ? "提案已过期，不能作为确认依据" : state === "stale" ? "提案版本已变化，请重新读取" : state === "unavailable" ? "有效期依据不可用" : `有效期至：${proposal.expiresAt}`}
      </p>
      <p>
        {proposal.evidence
          ? `依据：${proposal.evidence}`
          : "依据缺失，尚不能视为已批准"}
      </p>
      <table>
        <thead>
          <tr>
            <th>字段</th>
            <th>变更前</th>
            <th>变更后</th>
          </tr>
        </thead>
        <tbody>
          {proposal.changes.slice(0, 200).map((change) => (
            <tr key={change.label}>
              <td>{change.label}</td>
              <td>{change.before}</td>
              <td>{change.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {proposal.changes.length > 200 && <p role="status">变更列表超过展示上限，已截断。</p>}
    </section>
  );
}
