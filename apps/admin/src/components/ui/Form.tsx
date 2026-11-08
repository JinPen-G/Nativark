import { Form as AntForm, type FormItemProps } from "antd";
import { FormItemInputContext } from "antd/es/form/context";
import { createContext, forwardRef, useContext, useId, type HTMLAttributes, type ReactNode } from "react";

export const NativeFieldFeedbackContext = createContext(false);

/** Controls also appear outside forms (filters/search). Read the same Ant field
 * context without useStatus's form-only warning; real errors and warnings stay intact. */
export function useFormFeedback() {
  const { status, errors = [], warnings = [] } = useContext(FormItemInputContext);
  return { status, errors, warnings };
}

/** Keep the complete Ant form store, ref and static APIs. Only presentation changes. */
const BaseForm = forwardRef(function ArcForm(props: Parameters<typeof AntForm>[0], ref: Parameters<typeof AntForm>[0]["ref"]) {
  return <AntForm {...props} ref={ref} className={["arc-form", props.className].filter(Boolean).join(" ")} />;
});

export function FormField(props: FormItemProps) {
  return <NativeFieldFeedbackContext.Provider value={!props.noStyle && props.help === undefined && props.validateStatus === undefined}>
    <AntForm.Item {...props} className={props.noStyle ? props.className : ["arc-form-item", props.className].filter(Boolean).join(" ")} />
  </NativeFieldFeedbackContext.Provider>;
}

// Do not replace noStyle/render-prop children: Ant must inject value/id/events itself.
const Item = Object.assign(FormField, { useStatus: AntForm.Item.useStatus });
export const Form = Object.assign(BaseForm, {
  Item, List: AntForm.List, ErrorList: AntForm.ErrorList, Provider: AntForm.Provider,
  useForm: AntForm.useForm, useFormInstance: AntForm.useFormInstance, useWatch: AntForm.useWatch
}) as typeof AntForm;

export function FormSection({ title, description, children, className, ...props }:
  Omit<HTMLAttributes<HTMLElement>, "title"> & { title: ReactNode; description?: ReactNode }) {
  const id = useId();
  return <section {...props} className={["arc-form-section", className].filter(Boolean).join(" ")} aria-labelledby={id}>
    <header className="arc-form-section-heading"><h3 id={id}>{title}</h3>{description && <p>{description}</p>}</header>
    <div className="arc-form-section-fields">{children}</div>
  </section>;
}
