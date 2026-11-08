import { createElement, type SVGProps } from 'react';
import nodes from './icon-nodes.json';
type Props = SVGProps<SVGSVGElement> & { size?: number };
function Icon({ name, size = 24, className = '', strokeWidth = 2, ...props }: Props & { name: keyof typeof nodes }) {
  const icon = nodes[name];
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-${icon.name} ${className}`} {...props}>{icon.node.map(([tag, attributes], index) => createElement(tag as string, { ...(attributes as Record<string, string>), key: index }))}</svg>;
}
export const Calendar = (props: Props) => <Icon {...props} name="calendar-days" />;
export const ListChecks = (props: Props) => <Icon {...props} name="list-checks" />;
export const Warning = (props: Props) => <Icon {...props} name="triangle-alert" />;
export const Plus = (props: Props) => <Icon {...props} name="plus" />;
export const Close = (props: Props) => <Icon {...props} name="x" />;
export const Chevron = (props: Props) => <Icon {...props} name="chevron-down" />;
