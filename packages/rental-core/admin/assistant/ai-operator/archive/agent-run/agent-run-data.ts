import type { ChangedFile, ProposedChange, RunResult, RunScript, ScriptStep } from './agent-run-state';

export const REQUEST = 'Add rate limiting to the public API';
const limiter = [
  'import type { RequestHandler } from "express";', 'import { redis } from "../lib/redis";', '', 'const WINDOW = 60; // seconds', 'const LIMIT = 60;', '',
  'export const rateLimit: RequestHandler = async (req, res, next) => {', '  const key = `rate:${req.apiKey ?? req.ip}`;', '  const count = await redis.incr(key);', '  if (count === 1) await redis.expire(key, WINDOW);', '  res.set("RateLimit-Remaining", String(Math.max(0, LIMIT - count)));', '  if (count <= LIMIT) return next();', '  res.set("Retry-After", String(WINDOW));', '  res.status(429).json({ error: "Too many requests" });', '};',
];
const revisedLimiter = [...limiter]; revisedLimiter[4] = 'const LIMIT = Number(process.env.RATE_LIMIT ?? 120);'; revisedLimiter.splice(7, 0, '  if (req.path === "/health") return next();');
const routes: ChangedFile = { path: 'src/api/routes.ts', status: 'modified', lines: [
  { type: 'ctx', old: 1, new: 1, text: 'import { Router } from "express";' }, { type: 'ctx', old: 2, new: 2, text: 'import { requireApiKey } from "../middleware/auth";' },
  { type: 'add', new: 3, text: 'import { rateLimit } from "../middleware/rate-limit";' }, { type: 'ctx', old: 3, new: 4, text: 'import { orders } from "./orders";' }, { type: 'ctx', old: 4, new: 5, text: 'import { products } from "./products";' }, { type: 'ctx', old: 5, new: 6, text: '' }, { type: 'ctx', old: 6, new: 7, text: 'export const api = Router();' }, { type: 'ctx', old: 7, new: 8, text: '' },
  { type: 'del', old: 8, text: 'api.use(requireApiKey);' }, { type: 'add', new: 9, text: 'api.use(requireApiKey, rateLimit);' }, { type: 'ctx', old: 9, new: 10, text: 'api.use("/orders", orders);' }, { type: 'ctx', old: 10, new: 11, text: 'api.use("/products", products);' },
] };
export const CHANGE: ProposedChange = { id: 'rate-limit-change', summary: 'Add a Redis rate limiter, 60 requests a minute per API key, and put it in front of every API route.', files: [ { path: 'src/middleware/rate-limit.ts', status: 'added', lines: limiter.map((text, i) => ({ type: 'add', new: i + 1, text })) }, routes ] };
export const REVISED_CHANGE: ProposedChange = { id: 'rate-limit-revised', summary: 'Read the limit from RATE_LIMIT with a default of 120 a minute, and let health checks through.', files: [ { path: 'src/middleware/rate-limit.ts', status: 'added', lines: revisedLimiter.map((text, i) => ({ type: 'add', new: i + 1, text })) }, routes ] };
const tail: ScriptStep[] = [
  { id: 'write', mark: 'edit', verb: 'Writing', doneVerb: 'Wrote', target: 'src/middleware/rate-limit.ts', durationMs: 900, io: { input: 'write_file src/middleware/rate-limit.ts', output: ['Created the file'] } },
  { id: 'edit', mark: 'edit', verb: 'Editing', doneVerb: 'Edited', target: 'src/api/routes.ts', durationMs: 700, io: { input: 'edit_file src/api/routes.ts', output: ['Applied 1 hunk, +2 −1'] } },
  { id: 'types', mark: 'typescript', verb: 'Checking types', doneVerb: 'Checked types', doneTarget: 'no errors', durationMs: 1100, io: { input: '$ npx tsc --noEmit', output: ['Found 0 errors.'] } },
  { id: 'tests', mark: 'npm', verb: 'Running tests', doneVerb: 'Ran tests', doneTarget: '12 passed', durationMs: 2600, progress: { value: 0, total: 12 }, io: { input: '$ npm test -- src/api', output: ['✓ orders › lists orders for the key\'s account', '✓ products › paginates with a cursor', '✓ rate-limit › allows requests under the limit', '✓ rate-limit › returns 429 with Retry-After', 'Tests  12 passed (12)'] } },
  { id: 'summary', mark: 'think', verb: 'Writing the summary', doneVerb: 'Wrote the summary', durationMs: 700, text: 'The limiter is in, types check and the API suite passes, including two new rate limit tests.' },
];
const result = (revised: boolean): RunResult => ({
  summary: revised ? 'Every /api route except /health now goes through a Redis rate limiter: 120 requests a minute per API key by default, set with RATE_LIMIT. Responses carry RateLimit-Remaining, and a client over the limit gets a 429 with Retry-After. Types check and all 12 API tests pass.' : 'Every /api route now goes through a Redis rate limiter: 60 requests a minute per API key, falling back to the IP. Responses carry RateLimit-Remaining, and a client over the limit gets a 429 with Retry-After. Types check and all 12 API tests pass.',
  files: [ { path: 'src/middleware/rate-limit.ts', additions: revised ? 16 : 15, deletions: 0 }, { path: 'src/api/routes.ts', additions: 2, deletions: 1 } ], tests: { passed: 12, total: 12 }, checks: ['No type errors'],
});
export const sampleScript: RunScript = { steps: [
  { id: 'plan', mark: 'think', verb: 'Planning the change', doneVerb: 'Planned the change', durationMs: 1200, text: 'The public API has no rate limiting yet. I\'ll check how the routes are mounted, look for existing middleware, and see whether Redis is available so a limit holds across every instance.' },
  { id: 'read-routes', mark: 'read', verb: 'Reading', doneVerb: 'Read', target: 'src/api/routes.ts', durationMs: 900, io: { input: 'read_file src/api/routes.ts', output: ['import { Router } from "express";', '…', 'export const api = Router();', 'api.use(requireApiKey);', 'api.use("/orders", orders);'] } },
  { id: 'search-rate', mark: 'search', verb: 'Searching for', doneVerb: 'Searched for', target: 'rate limit middleware', durationMs: 1000, io: { input: 'grep -rni "rate.\\?limit" src', output: ['No matches'] } },
  { id: 'read-package', mark: 'read', verb: 'Reading', doneVerb: 'Read', target: 'package.json', durationMs: 700, io: { input: 'read_file package.json', output: ['"express": "^5.1.0",', '"ioredis": "^5.4.1",', '"zod": "^4.1.5"'] } },
  { id: 'read-redis', mark: 'read', verb: 'Reading', doneVerb: 'Read', target: 'src/lib/redis.ts', durationMs: 700, io: { input: 'read_file src/lib/redis.ts', output: ['import Redis from "ioredis";', 'export const redis = new Redis(process.env.REDIS_URL!);'] } },
  { id: 'search-key', mark: 'search', verb: 'Searching for', doneVerb: 'Searched for', target: 'the API key on requests', durationMs: 900, io: { input: 'grep -rn "req.apiKey" src', output: ['src/middleware/auth.ts:14:  req.apiKey = key.id;', 'src/types/express.d.ts:6:    apiKey?: string;'] } },
  { id: 'review', mark: 'review', verb: 'Preparing', doneVerb: 'Approved', doneTarget: 'changes to 2 files', durationMs: 700, change: CHANGE }, ...tail,
], result: result(false), revise: { steps: [
  { id: 'revise', mark: 'think', verb: 'Revising the change', doneVerb: 'Revised the change', durationMs: 1300, text: 'Taking the note on board: the limit should be easy to change per environment, and load balancer health checks should never be limited.' },
  { id: 'review-revised', mark: 'review', verb: 'Preparing', doneVerb: 'Approved', doneTarget: 'revised changes to 2 files', durationMs: 700, change: REVISED_CHANGE }, ...tail,
], result: result(true) } };
