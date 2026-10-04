"use strict";
module.exports = Object.freeze([
  Object.freeze({ id: "synthetic-knowledge-zh", language: "zh-CN", status: "published", aclRevision: 3, chunks: [{ id: "synthetic-chunk-zh-1", ordinal: 0, text: "合成租赁说明" }], table: [["字段", "值"], ["成色", "合成"]], maliciousContent: false }),
  Object.freeze({ id: "synthetic-knowledge-en", language: "en-US", status: "published", aclRevision: 4, chunks: [{ id: "synthetic-chunk-en-1", ordinal: 0, text: "Synthetic rental guidance" }], table: [["field", "value"], ["condition", "synthetic"]], maliciousContent: false }),
  Object.freeze({ id: "synthetic-knowledge-long", language: "zh-CN", status: "withdrawn", aclRevision: 5, chunks: Array.from({ length: 3 }, (_, index) => ({ id: `synthetic-chunk-long-${index}`, ordinal: index, text: "synthetic-long-content" })), table: [], maliciousContent: true }),
  Object.freeze({ id: "synthetic-knowledge-acl", language: "en-US", status: "acl_narrowed", aclRevision: 6, chunks: [{ id: "synthetic-chunk-acl-1", ordinal: 0, text: "synthetic-restricted" }], table: [], maliciousContent: false })
]);
