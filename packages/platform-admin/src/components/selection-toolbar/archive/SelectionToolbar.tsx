import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Archive, Trash2, X } from 'lucide-react';
import './original.css';
import './integration.css';

export type SelectionAction = {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

export type SelectionToolbarProps = {
  count: number;
  actions: SelectionAction[];
  onClear: () => void;
  noun?: string;
  countPrefix?: string;
  toolbarLabel?: string;
  clearLabel?: string;
  busy?: boolean;
  clearDisabled?: boolean;
  reducedMotion?: boolean;
};

export function SelectionToolbar({ count, actions, onClear, noun = 'item', countPrefix, toolbarLabel = 'Selection actions', clearLabel = 'Clear selection', busy = false, clearDisabled = false, reducedMotion = false }: SelectionToolbarProps) {
  const [present, setPresent] = useState(count > 0);
  const [shown, setShown] = useState(count > 0);
  const previousCount = useRef(count);
  const direction = count >= previousCount.current ? 'up' : 'down';

  useEffect(() => {
    previousCount.current = count;
    if (count > 0) {
      setPresent(true);
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = window.setTimeout(() => setPresent(false), reducedMotion ? 0 : 180);
    return () => window.clearTimeout(timer);
  }, [count, reducedMotion]);

  if (!present) return null;
  const suffix = countPrefix === undefined ? ` ${noun}${count === 1 ? '' : 's'} selected` : '';
  const label = `${countPrefix ?? ''}${count}${suffix}`;
  return (
    <div className="selection-toolbar_bar__NMMXy selection-local" role="toolbar" aria-label={toolbarLabel} aria-busy={busy || undefined} data-shown={shown} inert={!shown || undefined} aria-hidden={!shown || undefined}>
      <span className="selection-toolbar_srOnly__x5yKs" aria-live="polite">{label}</span>
      <span className="selection-toolbar_count__Z_E84" aria-hidden="true">
        {countPrefix}<span key={count} className="selection-digit" data-direction={direction}>{count}</span>{suffix}
      </span>
      <span className="selection-toolbar_divider___yp_5" />
      <div className="selection-toolbar_actions__DVZ9S">
        {actions.map(action => (
          <button key={action.label} type="button" className={action.destructive ? 'selection-toolbar_destructive__FT8QL' : undefined} onClick={action.onClick} disabled={busy || action.disabled}>
            {action.icon}{action.label}
          </button>
        ))}
      </div>
      <button type="button" className="selection-toolbar_clear__kCdJs" aria-label={clearLabel} disabled={clearDisabled} onClick={onClear}><X size={15} /></button>
    </div>
  );
}

const projects = [
  ['Atlas redesign', 'Updated 2 hours ago'],
  ['Spring launch site', 'Updated yesterday'],
  ['Billing migration', 'Updated 3 days ago'],
  ['Onboarding emails', 'Updated last week'],
];

export default function SelectionToolbarDemo() {
  const [selected, setSelected] = useState([0, 1]);
  const [status, setStatus] = useState('');
  const first = useRef<HTMLInputElement>(null);
  const clear = () => {
    setSelected([]);
    requestAnimationFrame(() => first.current?.focus());
  };
  const runAction = (action: string) => {
    setStatus(`${selected.length} project${selected.length === 1 ? '' : 's'} ${action}`);
    clear();
  };
  return (
    <div className="selection-demo">
      <ul aria-label="Projects">
        {projects.map(([name, updated], index) => (
          <li key={name}>
            <label>
              <input ref={index === 0 ? first : undefined} type="checkbox" checked={selected.includes(index)} aria-label={`Select ${name}`}
                onChange={() => {
                  setStatus('');
                  setSelected(current => current.includes(index) ? current.filter(item => item !== index) : [...current, index]);
                }} />
              <span><b>{name}</b><small>{updated}</small></span>
            </label>
          </li>
        ))}
      </ul>
      <div className="selection-demo-toolbar">
        <SelectionToolbar count={selected.length} noun="project" onClear={clear} actions={[
          { label: 'Archive', icon: <Archive size={15} />, onClick: () => runAction('archived') },
          { label: 'Delete', icon: <Trash2 size={15} />, destructive: true, onClick: () => runAction('deleted') },
        ]} />
        <span role="status" className="selection-status">{status}</span>
      </div>
    </div>
  );
}
