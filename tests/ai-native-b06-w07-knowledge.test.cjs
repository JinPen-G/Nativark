'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const data = require('./fixtures/ai-native/scenarios/knowledge.cjs');
test('knowledge fixtures cover publication, ACL, expiry and withdrawal lifecycle', () => { assert.equal(data.document.draftVersion, 'ain-c06-draft-1'); assert.equal(data.chunk.trust, 'untrusted_data'); assert.deepEqual(new Set(data.scenarios.map(item => item.expected)), new Set(['published', 'withdrawn', 'acl_narrowed', 'expired'])); });
