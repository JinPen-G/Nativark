const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const theme = read("apps/admin/src/app/theme.tsx");
const switcher = read("apps/admin/src/components/AppearanceSwitcher.tsx");

assert.match(theme, /DEFAULT_APPEARANCE_TRANSITION: AppearanceTransition = "reveal"/);
assert.match(theme, /transition === "eclipse"/);
assert.match(theme, /transition === "rise"/);
assert.match(theme, /clip-path: inset\(0 100% 0 0\)/);
assert.match(theme, /clip-path: inset\(100% 0 0\)/);
assert.match(theme, /rental-theme-wipe 380ms cubic-bezier\(\.22,1,\.36,1\)/);
assert.match(theme, /rental-theme-rise 360ms cubic-bezier\(\.22,1,\.36,1\)/);
assert.match(theme, /旧圆形揭示保留为 legacy-reveal/);
assert.match(theme, /prefers-reduced-motion: reduce/);
assert.match(theme, /document\.startViewTransition/);
assert.match(theme, /transition\.ready\.catch\(\(\) => undefined\)/);
assert.match(theme, /transition\.finished\.then\(finish, finish\)/);
assert.match(switcher, /transition === "legacy-reveal" \? "reveal" : transition/);
assert.match(switcher, /\{ element, transition \}/);

console.log("admin-theme-switch-motion: original straight reveal/rise CSS, reveal default and legacy circle retained (static guards)");
