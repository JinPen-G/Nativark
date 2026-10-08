import { useState } from "react";
import { Input, Select } from "@/components/ui";
export type MissingField = {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "select";
  required: boolean;
  options?: readonly string[];
  error?: string;
};
export interface MissingFieldsPanelProps {
  fields?: readonly MissingField[];
  draft: Record<string, string>;
  onDraftChange?: (name: string, value: string) => void;
  taskId?: string;
  inputRevision?: string | number;
  readOnly?: boolean;
  disabled?: boolean;
  submitting?: boolean;
  error?: string | null;
}
export function MissingFieldsPanel({
  fields,
  draft,
  onDraftChange,
  taskId = "",
  inputRevision = "",
  readOnly = false,
  disabled = false,
  submitting = false,
  error,
}: MissingFieldsPanelProps) {
  const identity = `${taskId}:${String(inputRevision)}`;
  const [seenIdentity, setSeenIdentity] = useState(identity);
  if (seenIdentity !== identity) setSeenIdentity(identity);
  const canEdit = Boolean(onDraftChange) && !readOnly && !disabled && !submitting;
  const visibleDraft = seenIdentity === identity ? draft : {};
  if (!fields) return <p role="status">补充输入定义不可用</p>;
  if (!fields.length) return <p role="status">没有待补充字段</p>;
  return (
    <fieldset disabled={!canEdit} aria-busy={submitting}>
      <legend>需要补充的信息</legend>
      {error && <p role="alert">补充信息提交失败：{error}</p>}
      {submitting && <p role="status" aria-live="polite">正在提交补充信息…</p>}
      {fields.map((field) => (
        <label key={field.name} htmlFor={`missing-${identity}-${field.name}`}>
          {field.label}
          {field.required ? "（必填）" : ""}
          {field.type === "select" ? (
            <Select
              id={`missing-${identity}-${field.name}`}
              aria-label={field.label}
              options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
              value={visibleDraft[field.name] ?? undefined}
              onChange={(value) => onDraftChange?.(field.name, String(value ?? ""))}
              disabled={!canEdit}
            />
          ) : (
            <Input
              id={`missing-${identity}-${field.name}`}
              type={field.type === "number" || field.type === "date" ? field.type : "text"}
              value={visibleDraft[field.name] ?? ""}
              aria-invalid={Boolean(field.error)}
              aria-describedby={field.error ? `missing-error-${identity}-${field.name}` : undefined}
              onChange={(event) => onDraftChange?.(field.name, event.currentTarget.value)}
              disabled={!canEdit}
            />
          )}
          {field.error && <small id={`missing-error-${identity}-${field.name}`} role="alert">{field.error}</small>}
        </label>
      ))}
    </fieldset>
  );
}
