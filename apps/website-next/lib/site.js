// Public marketing-site configuration, not business authorization or AI tools.
export const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");
export const sitePath = (pathname) => basePath + pathname;
// Shared by both language roots; the browser selects the matching tab theme.
export const siteIcons = {
  icon: [
    {
      url: sitePath("/harness/icons/rentalos-icon-black.svg"),
      type: "image/svg+xml",
      sizes: "any",
      media: "(prefers-color-scheme: light)",
    },
    {
      url: sitePath("/harness/icons/rentalos-icon-white.svg"),
      type: "image/svg+xml",
      sizes: "any",
      media: "(prefers-color-scheme: dark)",
    },
  ],
};
export const siteLinks = {
  repository: "https://github.com/JinPenG-AI",
  docs: {
    zh: "https://deepseek-harness.github.io/deepseek-harness/guide/quickstart",
    en: "https://deepseek-harness.github.io/deepseek-harness/en/guide/quickstart",
  },
  plugins: "https://github.com/topics/dsh-plugin",
  paper: "https://arxiv.org/abs/2608.25512",
};
export const downloadOptions = [
  {
    platform: "macOS",
    href: "#",
    labelKey: "harnessHeroDownloadMac",
    noteKey: "harnessHeroDownloadMacNote",
  },
  {
    platform: "Windows",
    href: "#",
    labelKey: "harnessHeroDownloadWindows",
    noteKey: "harnessHeroDownloadWindowsNote",
  },
];
export const assetPath = (value) => sitePath("/harness" + value);
export function trackInteraction(id) {
  if (typeof document !== "undefined")
    document.dispatchEvent(
      new CustomEvent("rentalos:interaction", { detail: { id } }),
    );
}
export function useRegionSnapshot() {
  return { isLoading: false, countryCode: null, isMainland: false };
}
export function requestDemo(trigger, topic) {
  document.dispatchEvent(
    new CustomEvent("rentalos:request-demo", { detail: { trigger, topic } }),
  );
}
