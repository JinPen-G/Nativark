import { Bot, Globe } from 'lucide-react';
import marks from './reference-marks.json';

// Bundled public-reference vectors, never caller-provided SVG markup.
export function BrandMark({ brand, size = 15, className = '' }: { brand?: string; size?: number; className?: string }) {
  const mark = brand && Object.hasOwn(marks, brand) ? marks[brand as keyof typeof marks] : undefined;
  if (!mark) { const Icon = brand === 'web' ? Globe : Bot; return <Icon size={size} className={className} aria-hidden="true" />; }
  const color = brand === 'anthropic' ? '#d97757' : brand === 'postgresql' ? '#4169e1' : brand === 'linear' ? '#6469de' : brand === 'gmail' ? '#ea4335' : mark.color || undefined;
  return <svg width={size} height={size} viewBox={mark.viewBox!} fill={mark.fill} className={className} style={{ color }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: mark.body }} />;
}
