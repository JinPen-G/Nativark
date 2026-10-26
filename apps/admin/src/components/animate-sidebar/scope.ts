import { useAppearance } from "@/app/theme";
/** Portals keep the reference palette/utilities without changing the admin page. */
export function useNativeSidebarScope(classes = "") {
  const { mode } = useAppearance();
  return `rental-animate-scope rental-sidebar-colors${mode === "dark" ? " dark" : ""} ${classes}`;
}
