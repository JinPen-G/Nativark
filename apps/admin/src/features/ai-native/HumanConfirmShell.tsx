import { useState } from "react";
import { ActionButton, Checkbox } from "@/components/ui";
export interface HumanConfirmShellProps {
  proposalId: string;
  revision: string;
  available?: boolean;
  expired?: boolean;
  submitting?: boolean;
  onConfirm?: (input: {
    proposalId: string;
    revision: string;
  }) => Promise<unknown>;
}
export function HumanConfirmShell({
  proposalId,
  revision,
  available = false,
  expired = false,
  submitting = false,
  onConfirm,
}: HumanConfirmShellProps) {
  const [checked, setChecked] = useState(false);
  const identity = `${proposalId}:${revision}`;
  const [seenIdentity, setSeenIdentity] = useState(identity);
  if (seenIdentity !== identity) {
    setSeenIdentity(identity);
    setChecked(false);
  }
  const disabled =
    !available || expired || submitting || !checked || !onConfirm;
  return (
    <section aria-label="人工确认">
      <p>
        {expired
          ? "提案已过期"
          : available
            ? `当前版本 ${revision}`
            : "当前提案不可确认"}
      </p>
      <label>
        <Checkbox
          checked={checked}
          disabled={!available || expired || submitting}
          onChange={(event) => setChecked(event.target.checked)}
        />
        我已阅读动作、风险和版本
      </label>
      <ActionButton
        key={identity}
        disabled={disabled}
        pending={submitting}
        label="提交人工确认"
        pendingLabel="提交中…"
        onAction={() => onConfirm!({ proposalId, revision })}
      />
    </section>
  );
}
