import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from './SiteIcon';
import { useSite } from '../SiteContext';

export function PageHeading({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return <header className="page-intro"><h1>{title}</h1>{description && <p>{description}</p>}</header>;
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  const { language } = useSite();
  return <nav className="breadcrumb" aria-label={language === 'en' ? 'Breadcrumb' : '当前位置'}><ol>{items.map((item, index) => <li key={`${index}-${item.label}`}>
    {index > 0 && <ChevronRight />}{item.to ? <Link to={item.to}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
  </li>)}</ol></nav>;
}
