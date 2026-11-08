import type { ComponentType, ReactNode } from 'react';
export const ReferenceDropdown: ComponentType<{ label: string; icon?: ReactNode; items: { label: string; icon?: ReactNode; disabled?: boolean; destructive?: boolean; separatorBefore?: boolean; onSelect?: () => void }[] }>;
