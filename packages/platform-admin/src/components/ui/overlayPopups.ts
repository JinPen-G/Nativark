/** Radix sees Escape before Ant popups; let the child close without discarding its enclosing form. */
export function hasOpenFormPopup(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const overlay = target.closest("[data-rental-arc-drawer], [data-rental-arc-modal]");
  if (!overlay) return false;
  return Array.from(overlay.querySelectorAll<HTMLElement>(
    "[aria-haspopup][aria-expanded='true'], [role='combobox'][aria-expanded='true'], .ant-select-dropdown:not(.ant-select-dropdown-hidden), .ant-picker-dropdown:not(.ant-picker-dropdown-hidden)"
  )).some(popup => popup.getClientRects().length > 0 && getComputedStyle(popup).visibility !== "hidden");
}
