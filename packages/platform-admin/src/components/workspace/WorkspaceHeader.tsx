/** Portals move page-level presentation while keeping the original React/form context.
 * The shell owns targets; routes own actions, validation and permission checks. */
import { Children, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { WorkspaceHeaderContext as Slots, WorkspaceHeaderActiveContext as Active, WorkspaceActionFormContext as FormOwner } from "./WorkspaceHeaderContext";

export function WorkspaceHeaderProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const [title, setTitle] = useState<HTMLSpanElement | null>(null);
  const value = useMemo(() => ({ actions, title, setActions, setTitle }), [actions, title]);
  return <Slots.Provider value={value}>{children}</Slots.Provider>;
}
export function useWorkspaceHeader() { return useContext(Slots); }
export function useWorkspaceActionForm() { return useContext(FormOwner); }

/** Current crumb consumes the shared shell title target without importing a host. */
export function WorkspaceBreadcrumbCurrent({ children }: { children?: ReactNode }) {
  const slots = useWorkspaceHeader();
  return <span className="workspace-breadcrumb-current"><span className="workspace-breadcrumb-fallback">{children}</span>
    <span className="workspace-breadcrumb-title" ref={slots?.setTitle} /></span>;
}

/** Retained tab forms stay mounted, but only the visible tab contributes header actions. */
export function WorkspaceHeaderScope({ active, children }: { active: boolean; children: ReactNode }) {
  const parent = useContext(Active);
  return <Active.Provider value={parent && active}>{children}</Active.Provider>;
}

export function WorkspacePageTitle({ children }: { children: ReactNode }) {
  const slots = useWorkspaceHeader(), active = useContext(Active);
  return slots?.title ? createPortal(<span data-workspace-page-title="" hidden={!active}>{children}</span>, slots.title) : null;
}

export function WorkspacePageActions({ children, label }: { children: ReactNode; label?: string }) {
  const slots = useWorkspaceHeader(), active = useContext(Active);
  const source = useRef<HTMLSpanElement>(null), generatedId = useId();
  const [formId, setFormId] = useState<string>();
  const hasChildren = Children.toArray(children).length > 0;
  useLayoutEffect(() => {
    const form = slots?.actions && hasChildren ? source.current?.closest("form") : null;
    if (!form) { setFormId(undefined); return; }
    // Native form association preserves Enter submission after a SaveButton is portaled.
    // The generated ID belongs to the form for its remaining mounted lifetime.
    if (!form.id) form.id = `workspace-action-form-${generatedId}`;
    setFormId(form.id);
  }, [slots?.actions, generatedId, hasChildren]);
  if (!hasChildren) return null;
  const content = <FormOwner.Provider value={formId}><div className="workspace-page-action-group" data-workspace-page-actions="" role="group" aria-label={label} hidden={!active} inert={!active || undefined}>{children}</div></FormOwner.Provider>;
  return slots?.actions ? <><span ref={source} hidden data-workspace-action-source="" />{createPortal(content, slots.actions)}</> : content;
}
