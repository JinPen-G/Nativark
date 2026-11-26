import { languageUrls } from "../lib/seo.js";

export const dynamic = "force-static";

export default function sitemap() {
  return [languageUrls["zh-CN"], languageUrls.en].map((url) => ({
    url,
    alternates: { languages: languageUrls },
  }));
}
