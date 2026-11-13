import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';

export function PageState({ title, description, icon, error = false, heading = 'h2', children }: { title: string; description?: string; icon?: ReactNode; error?: boolean; heading?: 'h1' | 'h2'; children?: ReactNode }) {
  const Heading = heading;
  return <div className="page-state" role={error ? 'alert' : undefined}>{(icon || error) && <div className="page-state-icon" aria-hidden="true">{icon || <CircleAlert />}</div>}<Heading>{title}</Heading>{description && <p>{description}</p>}{children && <div className="page-state-actions">{children}</div>}</div>;
}
export function LoadingState({ label }: { label: string }) {
  return <div className="loading-state" role="status">{label}</div>;
}
