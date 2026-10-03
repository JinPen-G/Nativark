"use strict";
module.exports = Object.freeze([
  Object.freeze({ id: "synthetic-memory-confirmed", state: "confirmed", revision: 2, contentHash: "synthetic-hash-a", expiresAt: "2026-12-01T00:00:00Z", actor: "human", automation: false }),
  Object.freeze({ id: "synthetic-memory-race", state: "proposed", revision: 3, expectedRevision: 2, contentHash: "synthetic-hash-b", expiresAt: "2026-11-01T00:00:00Z", actor: "human", automation: false }),
  Object.freeze({ id: "synthetic-memory-hash-change", state: "expired", revision: 4, contentHash: "synthetic-hash-c", expiresAt: "2026-10-01T00:00:00Z", actor: "human", automation: false }),
  Object.freeze({ id: "synthetic-memory-automation", state: "revoked", revision: 5, contentHash: "synthetic-hash-d", expiresAt: "2026-12-01T00:00:00Z", actor: "automation", automation: true })
]);
