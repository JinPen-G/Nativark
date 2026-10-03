'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const css = fs.readFileSync('apps/admin/src/features/ai-native/responsive.css', 'utf8');
test('responsive layer has narrow layout, visible focus and reduced-motion rules', () => { assert.ok(css.includes('@media (max-width: 720px)')); assert.ok(css.includes(':focus-visible')); assert.ok(css.includes('prefers-reduced-motion')); assert.ok(css.includes('aria-live')); });
test('responsive panel stays feature-local and does not register a route', () => { const source = fs.readFileSync('apps/admin/src/features/ai-native/ResponsiveAiPanel.tsx', 'utf8'); assert.ok(source.includes('ai-native-panel')); assert.equal(source.includes('fetch('), false); assert.equal(source.includes('localStorage'), false); });
