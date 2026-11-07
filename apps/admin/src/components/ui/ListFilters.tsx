/** One combined search plus one optional high-value facet. Geometry belongs to the shared list toolbar. */
import { useLocale } from "@/app/locale";
import { SearchField } from "./SearchField";
import { Select } from "./Select";
import { Button } from "./Button";

export type ListFiltersProps = {
  filter: { keyword: string; status: string; setKeyword: (value: string) => void; setStatus: (value: string) => void; clear: () => void };
  placeholder: string;
  options?: { value: string; label: string }[];
  statusLabel?: string;
  hasFilters?: boolean;
  onClear?: () => void;
};

/** The toolbar expands this group into slots without mounting a second set of controls. */
export function listFilterElements({ filter, placeholder, options, statusLabel = "全部状态", hasFilters, onClear }: ListFiltersProps, t: (value: string) => string) {
  return [
    <SearchField key="keyword" label={t(placeholder)} placeholder={t(placeholder)} value={filter.keyword} onValueChange={filter.setKeyword} />,
    options ? <Select key="status" allowClear aria-label={t(statusLabel)} value={filter.status} onChange={value => filter.setStatus(value ?? "")}
      options={[{ value: "", label: t(statusLabel) }, ...options.map(option => ({ ...option, label: t(option.label) }))]} /> : null,
    (filter.keyword || filter.status || hasFilters) ? <Button key="clear" data-list-filter-reset type="text" onClick={onClear ?? filter.clear}>{t("清除筛选")}</Button> : null,
  ];
}

export function ListFilters(props: ListFiltersProps) {
  const { t } = useLocale();
  return <>{listFilterElements(props, t)}</>;
}
