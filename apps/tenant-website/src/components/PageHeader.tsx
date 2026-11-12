import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

export function Breadcrumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  return <nav className="breadcrumbs" aria-label="Breadcrumb">{items.map((item, index) => <span key={index}>{index > 0 && <ChevronRight aria-hidden="true" />}{item.to ? <Link to={item.to}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}</span>)}</nav>;
}
export function PageHeading({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <div className="page-heading"><h1>{title}</h1>{description && <p>{description}</p>}{children}</div>;
}
