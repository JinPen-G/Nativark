import type { ReactNode } from 'react';
import { Loader } from './SiteIcon';

export function PageState({ icon, title, description, children, error = false, heading = 'h2' }: { icon?: ReactNode; title: string; description?: string; children?: ReactNode; error?: boolean; heading?: 'h1' | 'h2' }) {
  const Heading = heading;
  return <div className={`page-state${error ? ' page-state-error' : ''}`} role={error ? 'alert' : undefined}>
    {icon && <div className="page-state-symbol">{icon}</div>}<Heading>{title}</Heading>{description && <p>{description}</p>}{children && <div className="page-state-actions">{children}</div>}
  </div>;
}
export function LoadingState({ label }: { label: string }) {
  return <div className="content-loading" role="status"><Loader /><span>{label}</span></div>;
}
