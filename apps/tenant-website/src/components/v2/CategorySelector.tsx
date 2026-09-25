import { useSite } from '../../SiteContext';
import { CategoryIcon } from '../HomeSections';
import type { Category } from '../../types';

// 多品类芯片：点选切换背景视频、更新搜索上下文与 Hero 文案。单品类（≤1）不渲染。
export function CategorySelector({ categories, activeId, onSelect }: {
  categories: Category[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useSite();
  if (categories.length <= 1) return null;
  return (
    <div className="v2-cat-selector" role="tablist" aria-label={t('searchCategory')}>
      {categories.map(category => (
        <button
          key={category.id}
          type="button"
          role="tab"
          aria-selected={activeId === category.id}
          className={`v2-cat-chip${activeId === category.id ? ' is-active' : ''}`}
          onClick={() => onSelect(category.id)}
        >
          <span className="v2-cat-chip-icon" aria-hidden="true"><CategoryIcon name={category.icon} /></span>
          <span>{category.shortName || category.name}</span>
        </button>
      ))}
    </div>
  );
}
