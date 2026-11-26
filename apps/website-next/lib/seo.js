// Public, build-time search metadata for the two stable language URLs.
// Keep these facts aligned with the visible site and the linked source repository.
import { siteIcons, siteLinks } from "./site.js";

export const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://jinpen-g.github.io/Zelo-website"
).replace(/\/$/, "");

export const languageUrls = {
  "zh-CN": `${siteUrl}/harness/`,
  en: `${siteUrl}/en/harness/`,
  "x-default": `${siteUrl}/`,
};

const descriptions = {
  zh: "Zelo 是基于 TypeScript、NestJS、React、Prisma 和 MySQL 的开源多租户 SaaS 底座，提供认证、权限、订阅和公共后台，支持独立业务 Core 与可选 AI Native / MCP。查看源码、工单示例与接入指南。",
  en: "Zelo is an open-source multi-tenant SaaS foundation built with TypeScript, NestJS, React, Prisma and MySQL. Explore auth, RBAC, subscriptions, a shared admin, pluggable business Cores and optional AI Native / MCP.",
};

export function siteMetadata(locale) {
  const title = locale === "en"
    ? "Zelo | Open-source NestJS and React multi-tenant SaaS foundation"
    : "Zelo | NestJS 与 React 开源多租户 SaaS 底座";
  const url = languageUrls[locale === "en" ? "en" : "zh-CN"];
  return {
    metadataBase: new URL(`${siteUrl}/`),
    icons: siteIcons,
    title,
    description: descriptions[locale],
    verification: { google: "AZ63OefU7l2vMjMZopaHwwJ1alKRaJ8ldtdRdBd27NY" },
    alternates: { canonical: url, languages: languageUrls },
    openGraph: {
      type: "website",
      siteName: "Zelo",
      title,
      description: descriptions[locale],
      url,
      locale: locale === "en" ? "en_US" : "zh_CN",
      alternateLocale: locale === "en" ? "zh_CN" : "en_US",
    },
    twitter: { card: "summary", title, description: descriptions[locale] },
  };
}

export function siteStructuredData(locale) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        name: "Zelo",
        url: `${siteUrl}/`,
        inLanguage: ["zh-CN", "en"],
      },
      {
        "@type": "SoftwareSourceCode",
        "@id": `${siteUrl}/#source`,
        name: "Zelo",
        description: descriptions[locale],
        codeRepository: siteLinks.repository,
        url: languageUrls[locale === "en" ? "en" : "zh-CN"],
        programmingLanguage: "TypeScript",
        runtimePlatform: "Node.js",
        license: `${siteLinks.repository}/blob/main/LICENSE`,
        isPartOf: { "@id": `${siteUrl}/#website` },
      },
    ],
  };
}
