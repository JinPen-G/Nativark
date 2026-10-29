import { useEffect, useRef, type ReactNode } from 'react';
import { useCopilot, type CopilotConfigBinding, type CopilotConfigField } from './CopilotProvider';

/** Explicit whole configuration section. Only caller-projected fields enter context.
 * Optional fill callback changes the original form draft, never saves or submits it. */
export function CopilotSection({ id, title, fields, onFill, children }: {
  id: string; title: string; fields: CopilotConfigField[];
  onFill?: (values: Record<string, string>) => void; children: ReactNode;
}) {
  const copilot = useCopilot(), current = useRef({ fields, onFill }); current.current = { fields, onFill };
  const register = copilot?.registerConfiguration;
  const revision = JSON.stringify(fields);
  useEffect(() => {
    const binding: CopilotConfigBinding = { read: () => current.current.fields, fill: values => current.current.onFill?.(values), editable: () => Boolean(current.current.onFill) };
    return register?.(id, binding);
  }, [id, register, revision]);
  return <section data-copilot-anchor={id} data-copilot-record={`configuration:${id}`} data-copilot-config={id} data-copilot-label={title} aria-label={title}>
    {children}
  </section>;
}
