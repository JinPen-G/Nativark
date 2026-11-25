import type { CSSProperties, ReactNode } from 'react';
import { EmptyState } from '@/registry/components/empty-state/empty-state';
import type { EmptySceneKind } from './empty-scene/frames';
import { EmptySceneArt } from './empty-scene/EmptySceneArt';
import styles from './empty-scene/EmptyScene.module.css';

export type { EmptySceneKind } from './empty-scene/frames';
export interface EmptySceneProps {
  scene?: EmptySceneKind;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Original UIArc illustration and text swap, driven by real host state and actions. */
export function EmptyScene({ scene = 'empty', title, description = '', action, compact = false, className, style }: EmptySceneProps) {
  return <div style={style} className={[styles.root, compact ? styles.compact : '', className].filter(Boolean).join(' ')} data-empty-scene={scene} data-has-description={Boolean(description)}>
    <EmptyState title={title} description={description} icon={<EmptySceneArt scene={scene} />} action={action} />
  </div>;
}
