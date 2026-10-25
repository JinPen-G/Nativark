/** Fit a prefix of criteria in one row. Keyword width may shrink to its token
 * minimum; only a preferred first field may also compress the category rail. */
export function planListFilters(input: {
  available: number; category: number; categoryMin: number; search: number; searchMin: number;
  fieldWidths: number[]; preferFirst: boolean; actions: number[]; resets: number[];
  gap: number; moreWidth: number; collapsedCategory: boolean;
}) {
  let category = input.category, search = input.search;
  const primaryCount = Number(category > 0) + Number(search > 0) + input.actions.length;
  const fixed = input.actions.reduce((sum, width) => sum + width, 0);
  const total = (count: number, more: boolean, resets: boolean) => category + search + fixed +
    input.fieldWidths.slice(0, count).reduce((sum, width) => sum + width, 0) +
    (more ? input.moreWidth : 0) + (resets ? input.resets.reduce((sum, width) => sum + width, 0) : 0) +
    Math.max(0, primaryCount + count + Number(more) + (resets ? input.resets.length : 0) - 1) * input.gap;
  if (!input.collapsedCategory && total(input.fieldWidths.length, false, true) <= input.available)
    return { count: input.fieldWidths.length, category, search, more: false };
  const compress = (deficit: number, allowCategory = true) => {
    const fromSearch = Math.min(deficit, Math.max(0, search - input.searchMin));
    search -= fromSearch; deficit -= fromSearch;
    if (allowCategory) category -= Math.min(deficit, Math.max(0, category - input.categoryMin));
  };
  if (!input.collapsedCategory) {
    const preferred = { category, search };
    compress(Math.max(0, total(input.fieldWidths.length, false, true) - input.available), false);
    if (total(input.fieldWidths.length, false, true) <= input.available)
      return { count: input.fieldWidths.length, category, search, more: false };
    category = preferred.category; search = preferred.search;
  }
  let count = 0;
  for (let next = 1; next <= input.fieldWidths.length; next++) {
    const previous = { category, search };
    compress(Math.max(0, total(next, true, false) - input.available), next === 1 && input.preferFirst);
    if (total(next, true, false) > input.available) { category = previous.category; search = previous.search; break; }
    count = next;
  }
  compress(Math.max(0, total(count, true, false) - input.available));
  return { count, category, search, more: true };
}
