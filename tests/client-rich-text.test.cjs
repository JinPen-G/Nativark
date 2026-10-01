const assert = require('node:assert/strict');
const { CLIENT_RICH_TEXT_PREFIX: prefix, parseClientRichText: parse, safeDocumentHref } = require('../packages/shared/dist');
const encode = (nodes) => prefix + JSON.stringify(nodes);
const text = { type: 'text', text: 'Policy & <content>' };
assert.equal(parse('Existing plain text'), null);
assert.equal(parse(prefix + '{broken'), null);
assert.deepEqual(parse(encode([text])), [text]);
const malicious = [
  { type: 'node', name: 'script', children: [text] },
  { type: 'node', name: 'p', attrs: { onclick: 'evil()', style: 'evil' }, children: [text] },
  { type: 'node', name: 'a', attrs: { href: 'javascript:alert(1)' }, children: [text] },
  { type: 'node', name: 'a', attrs: { href: 'https://example.com/policy', target: '_blank' }, children: [text] },
];
const result = parse(encode(malicious));
assert.equal(result.length, 3);
assert.equal(result[0].attrs, undefined);
assert.equal(result[1].attrs, undefined);
assert.deepEqual(result[2].attrs, { href: 'https://example.com/policy' });
for (const url of ['javascript:x', 'data:text/html,x', '//evil.test', '/\\evil.test', 'https://x\n.test', 'https:\\evil.test']) assert.equal(safeDocumentHref(url), false, url);
for (const url of ['https://example.com', 'http://example.com', '/policy', '#terms', 'mailto:help@example.com', 'tel:123']) assert.equal(safeDocumentHref(url), true, url);
assert.equal(parse(encode(Array.from({ length: 2001 }, () => text))), null);
let deep = [text];
for (let i = 0; i < 22; i++) deep = [{ type: 'node', name: 'p', children: deep }];
assert.equal(parse(encode(deep)), null);
assert.equal(parse(encode([{ type: 'text', text: 'x'.repeat(20000) }])), null);
assert.equal(parse(encode([{ type: 'node', name: 'p', children: 'bad' }])), null);
console.log('client-rich-text: plain text, whitelist, safe URLs, limits and malformed payloads passed');
