/** Slot's import bridge for ordinary CSS module class names; no Tailwind utilities are exposed here. */
export function cn(...classNames: (string | undefined)[]) {
  return classNames.filter(Boolean).join(" ");
}
