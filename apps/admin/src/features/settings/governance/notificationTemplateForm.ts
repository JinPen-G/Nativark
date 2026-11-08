import type { RentalNotificationTemplateV1 } from "@rental-os/shared";

type VariableSchema = RentalNotificationTemplateV1["variableSchema"];
export type NotificationVariableRow = { name: string; definition: VariableSchema[string] };

/** The form edits named rows; the original API still receives the exact schema object. */
export function notificationVariableRows(schema: VariableSchema): NotificationVariableRow[] {
  return Object.entries(schema).map(([name, definition]) => ({ name, definition: { ...definition } }));
}

export function notificationVariableSchema(rows: NotificationVariableRow[]): VariableSchema {
  const names = new Set<string>();
  return Object.fromEntries(rows.map(({ name, definition }) => {
    if (!name?.trim()) throw new Error("请填写变量名");
    if (names.has(name)) throw new Error("变量名不能重复");
    names.add(name);
    return [name, definition];
  }));
}
