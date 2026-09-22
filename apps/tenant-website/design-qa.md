# Tenant website design QA

- final result: passed
- Scope: shared tenant-site header behavior and page-width grid.
- Source reference: `apps/website/index.html` header styles and scroll handler.
- Top state: the original document-flow header stays above the Hero; its surface remains the normal white page header with a transparent pseudo-element.
- Scrolled state: `rgba(255, 255, 255, 0.6)` background, `blur(4px)`, `rgba(0, 0, 0, 0.16)` border, 18px radius, no shadow, and the source transition curve.
- Browser check: verified at the local tenant preview that Hero starts below the 82px desktop header at the top, then the sticky header changes from `site-header` to `site-header is-scrolled`; computed glass values match the source after scrolling.
- Typography check: platform system font stack is used; navigation is 400, card titles are 500, and buttons are 600, with heavier weight reserved for hero and page titles.
- Homepage alignment check: single-category subcategories and double/multiple scene grids share the Hero outer edges; the multiple-category quick navigation block is removed.
- Hero rhythm check: desktop and responsive Hero heights were reduced to keep the first screen from being dominated by the banner while preserving its copy and service strip.
- Mobile spacing check: homepage shell sections restore 24px padding at tablet width and 16px side margins below 768px, so the Hero and the sections below share the same safe edges; the top header remains a normal page-flow surface until scrolling.
- Language structure check: `SiteContext` stores the tenant-site language in `rental-os-tenant-language`; the header switcher and footer picker share the same state, and all tenant-facing routes use the shared translation and localization layer for Chinese and English.
- Color mode structure check: `index.html` applies the platform theme before React renders, `SiteContext` persists `light`/`dark` to `rental-os-theme`, and the header sun/moon control switches the shared CSS variables and dark surface overrides.
- Build check: `npm run build:tenant-website` passed.
