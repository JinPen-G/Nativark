export type ProposalPreviewData = {
  title: string;
  risk: string;
  expiresAt?: string;
  evidence?: string;
  changes: readonly { label: string; before: string; after: string }[];
};
export interface ProposalPreviewProps {
  proposal?: ProposalPreviewData | null;
}
export function ProposalPreview({ proposal }: ProposalPreviewProps) {
  if (!proposal) return <p role="status">提案不可用</p>;
  return (
    <section aria-label="提案预览">
      <h3>{proposal.title}</h3>
      <p>风险：{proposal.risk}</p>
      <p>
        {proposal.expiresAt
          ? `有效期至：${proposal.expiresAt}`
          : "有效期未提供"}
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
