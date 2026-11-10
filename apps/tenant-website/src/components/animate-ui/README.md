# Storefront icon motion

Source: [Animate UI animated Lucide registry](https://animate-ui.com/docs/icons/get-started), retrieved 2026-11-01 from `https://animate-ui.com/r/icons-lucide-{name}.json`.

24 icon files preserve registry drawings and animations, with the site's existing 1.75 stroke. 16 objects not supplied by the registry preserve the exact installed Lucide 1.49.0 drawing and use Animate UI's icon core for their own object-specific movement. Registry files and authored files are local source; the browser never fetches icons from the registry. The included license notices cover both sources.

`SiteIcon` keeps existing layout and decorative accessibility semantics. Its interaction hook follows the nearest existing button, link, label or disclosure, for fine-pointer hover, keyboard focus and touch press. Labels include their native field. Static explanatory icons never autoplay. Decorative separators, ratings and loading retain their original roles. No idle loops or page-load icon choreography.

The core supplies reduced motion, interruption and rest recovery. Menu open/close is a real state rather than a hover gesture: `MenuToggleIcon` morphs line endpoints and still shows the final open state with reduced motion. Expanded disclosures rotate their chevron in CSS without moving labels.

Icon amplitudes/timings live in each file per the Animate UI icon recipe. Normal playback is at speed 1; the accepted page layout, tenant colors and business actions remain owned by their existing components.
