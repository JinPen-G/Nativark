// Presentation gate only. The API independently defaults closed and enforces permissions.
export const CATEGORY_GOVERNANCE_PREVIEW_ENABLED =
  import.meta.env.DEV && import.meta.env.VITE_RENTAL_CATEGORY_GOVERNANCE_PREVIEW === "true";
