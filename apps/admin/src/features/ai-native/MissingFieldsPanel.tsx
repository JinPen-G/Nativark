import { Input } from "@/components/ui";
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
}
export function MissingFieldsPanel({
  fields,
  draft,
  onDraftChange,
}: MissingFieldsPanelProps) {
  if (!fields) return <p role="status">补充输入定义不可用</p>;
  if (!fields.length) return <p role="status">没有待补充字段</p>;
  return (
    <fieldset>
      <legend>需要补充的信息</legend>
      {fields.map((field) => (
        <label key={field.name}>
          {field.label}
          {field.required ? "（必填）" : ""}
          <Input
            type={
              field.type === "number"
                ? "number"
                : field.type === "date"
                  ? "date"
                  : "text"
            }
            value={draft[field.name] ?? ""}
            aria-invalid={Boolean(field.error)}
            onChange={(event) =>
              onDraftChange?.(field.name, event.currentTarget.value)
            }
            disabled={!onDraftChange}
          />
          {field.error && <small role="alert">{field.error}</small>}
        </label>
      ))}
    </fieldset>
  );
}
