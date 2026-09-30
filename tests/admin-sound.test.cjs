const test = require('node:test');
const assert = require('node:assert/strict');
// apps/admin 的 package.json 声明 "type": "module"，ts-node 会按包边界把这些 .ts
// 当成 ESM 拒绝 require()；用 moduleTypes 只把本目录强制按 CJS 加载，不改 admin 包配置。
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022' },
  moduleTypes: { 'apps/admin/src/features/sound/**/*.ts': 'cjs' }
});

function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
const local = storage();
const win = new EventTarget();
win.localStorage = local;
global.window = win;
global.document = { visibilityState: 'visible', hasFocus: () => true };
Object.defineProperty(global, 'navigator', { configurable: true, value: { locks: { request: async (_key, _options, action) => action({}) } } });

class Param {
  constructor() { this.value = 0; this.calls = []; }
  setValueAtTime(...args) { this.calls.push(['set', ...args]); }
  linearRampToValueAtTime(...args) { this.calls.push(['linear', ...args]); }
  exponentialRampToValueAtTime(...args) { this.calls.push(['exponential', ...args]); }
  setTargetAtTime(...args) { this.calls.push(['target', ...args]); }
}
class Node {
  constructor(kind) { this.kind = kind; this.gain = new Param(); this.frequency = new Param(); this.Q = new Param(); this.links = []; }
  connect(node) { this.links.push(node); }
  disconnect() { this.disconnected = true; }
  start(at) { this.startedAt = at; }
  stop(at) { this.stoppedAt = at; }
}
let audio;
class Audio {
  constructor() { audio = this; this.state = 'suspended'; this.currentTime = 10; this.sampleRate = 48000; this.destination = {}; this.nodes = []; }
  node(kind) { const node = new Node(kind); this.nodes.push(node); return node; }
  createGain() { return this.node('gain'); }
  createOscillator() { return this.node('oscillator'); }
  createBufferSource() { return this.node('noise'); }
  createBiquadFilter() { return this.node('filter'); }
  createBuffer(_channels, size) { const data = new Float32Array(size); return { getChannelData: () => data }; }
  async resume() { if (this.fail) throw new Error('denied'); this.state = 'running'; }
}
win.AudioContext = Audio;
const packs = require('../apps/admin/src/features/sound/soundPacks');
const preferences = require('../apps/admin/src/features/sound/soundPreferences');
const engine = require('../apps/admin/src/features/sound/soundEngine');
const service = require('../apps/admin/src/features/sound/soundService');
const { createMutationSoundCallbacks } = require('../apps/admin/src/features/sound/mutationSound');
const sounds = [...packs.INTERACTION_SOUNDS, ...packs.NOTIFICATION_SOUNDS];
const sourceCount = () => audio.nodes.filter(node => node.kind === 'oscillator' || node.kind === 'noise').length;

// No real audio device, server or database is used by these tests.
test('sound-1 has nine voices; future registered packs resolve without trigger changes', () => {
  assert.equal(packs.SOUND_PACKS.length, 1);
  const one = packs.resolveSoundPack('sound-1');
  assert.deepEqual(Object.keys(one.sounds).sort(), [...sounds].sort());
  const second = { ...one, id: 'test-sound-2', label: 'test only' };
  assert.equal(packs.resolveSoundPack(second.id, [one, second]), second);
  assert.equal(packs.resolveSoundPack('unknown'), one);
});

test('old on/off migrates click only; new settings take precedence and invalid data is safe', () => {
  assert.equal(preferences.parseSoundPreferences(null, 'on').interactionEnabled, true);
  assert.equal(preferences.parseSoundPreferences(null, 'on').notificationEnabled, false);
  assert.equal(preferences.parseSoundPreferences(null, 'off').interactionEnabled, false);
  const parsed = preferences.parseSoundPreferences(JSON.stringify({ version: 1, pack: 'missing', interactionEnabled: false, notificationEnabled: true, volume: 99 }), 'on');
  assert.equal(parsed.pack, 'sound-1');
  assert.equal(parsed.volume, 1);
  assert.equal(parsed.interactionEnabled, false);
  assert.equal(parsed.notificationEnabled, true);
  assert.equal(preferences.parseSoundPreferences('{', null).volume, 0.32);
});

test('preferences notify subscribers and synchronize storage events without backend writes', () => {
  const store = storage();
  const target = new EventTarget();
  const state = preferences.createSoundPreferencesStore(() => store, target);
  let changed = 0;
  const off = state.subscribe(() => changed++);
  state.update({ volume: 0.5, interactionEnabled: true });
  assert.equal(state.getSnapshot().volume, 0.5);
  store.setItem(preferences.SOUND_PREFERENCES_KEY, JSON.stringify({ version: 1, volume: 0, notificationEnabled: true }));
  const event = new Event('storage'); event.key = preferences.SOUND_PREFERENCES_KEY;
  target.dispatchEvent(event);
  assert.equal(state.getSnapshot().volume, 0);
  assert.equal(state.getSnapshot().notificationEnabled, true);
  assert.ok(changed >= 2);
  off();
  const bad = preferences.createSoundPreferencesStore(() => { throw new Error('blocked'); });
  assert.doesNotThrow(() => bad.update({ interactionEnabled: true }));
  assert.equal(bad.getSnapshot().interactionEnabled, true);
});

test('engine is lazy and unavailable or rejected Web Audio cannot throw into the page', async () => {
  assert.equal(audio, undefined);
  win.AudioContext = undefined;
  assert.equal(await engine.unlockAudio(), false);
  win.AudioContext = Audio;
  assert.equal(await engine.unlockAudio(), true);
  audio.state = 'suspended'; audio.fail = true;
  assert.equal(await engine.unlockAudio(), false);
  assert.equal(engine.playVoice(packs.resolveSoundPack('sound-1').sounds.press, 0.32), false);
  audio.fail = false;
  assert.equal(await engine.unlockAudio(), true);
});

test('all nine previews schedule their exact layers once, preserve switches, and release nodes', async () => {
  preferences.soundPreferences.update({ interactionEnabled: false, notificationEnabled: false, volume: 0.32 });
  const one = packs.resolveSoundPack('sound-1');
  for (const name of sounds) {
    const previous = sourceCount();
    assert.equal(await service.previewSound(name), true);
    const voice = one.sounds[name];
    assert.equal(sourceCount() - previous, 'layers' in voice ? voice.layers.length : 1, name);
  }
  assert.equal(preferences.soundPreferences.getSnapshot().interactionEnabled, false);
  for (const node of audio.nodes.filter(n => n.kind === 'noise' || n.kind === 'oscillator')) node.onended();
  assert.ok(audio.nodes.filter(n => n.kind !== 'gain' || n !== audio.nodes[0]).every(n => n.disconnected));
  preferences.soundPreferences.update({ volume: 0 });
  const previous = sourceCount();
  assert.equal(await service.previewSound('success'), false);
  assert.equal(sourceCount(), previous);
});

test('automatic notifications require scope, switch and unlocked device; duplicates never replay', async () => {
  const scope = { key: 'automatic-test', epoch: 1 };
  service.setSoundScope(scope);
  preferences.soundPreferences.update({ volume: 0.32, notificationEnabled: false });
  const event = { ...scope, id: 'one', type: 'notification' };
  assert.equal(await service.emitSoundEvent(event), false);
  preferences.soundPreferences.update({ notificationEnabled: true });
  assert.equal(await service.emitSoundEvent(event), false, 'disabled event must not replay after enabling');
  assert.equal(await service.emitSoundEvent({ ...event, id: 'wrong', key: 'other-user' }), false);
  audio.state = 'suspended';
  assert.equal(await service.emitSoundEvent({ ...event, id: 'before-unlock' }), false);
  await engine.unlockAudio();
  assert.equal(await service.emitSoundEvent({ ...event, id: 'before-unlock' }), false);
  assert.equal(await service.emitSoundEvent({ ...event, id: 'new' }), true);
  assert.equal(await service.emitSoundEvent({ ...event, id: 'new' }), false);
  assert.equal(await service.emitSoundEvent({ ...event, id: 'burst' }), false, 'burst is rate-limited');
});

test('independent page state uses shared notification claims; fallback is focused-only', async () => {
  const scope = { key: 'shared-test', epoch: 1 };
  const event = { ...scope, id: 'shared-event', type: 'attention' };
  service.setSoundScope(scope);
  assert.equal(await service.emitSoundEvent(event), true);
  service.setSoundScope(null);
  service.setSoundScope({ ...scope });
  assert.equal(await service.emitSoundEvent(event), false, 'shared claim survives a page state reset');
  const locks = navigator.locks;
  navigator.locks = undefined;
  document.visibilityState = 'hidden';
  assert.equal(await service.emitSoundEvent({ ...event, id: 'hidden-fallback' }), false);
  document.visibilityState = 'visible'; navigator.locks = locks;
});

test('explicit mutation feedback reflects actual results, not queries or cancellation', async () => {
  let epoch = 1;
  const events = [];
  const scope = { key: 'result-scope', epoch: 1 };
  const callbacks = createMutationSoundCallbacks(() => epoch, () => scope, async event => { events.push(event); return true; });
  const opted = () => ({ options: { meta: { soundFeedback: true } } });
  const good = opted(); callbacks.onMutate({}, good); callbacks.onSuccess({}, {}, undefined, good);
  const bad = opted(); callbacks.onMutate({}, bad); callbacks.onError(new Error('save failed'), {}, undefined, bad);
  const businessFailure = opted(); callbacks.onMutate({}, businessFailure); callbacks.onSuccess({ ok: false }, {}, undefined, businessFailure);
  const cancelled = opted(); callbacks.onMutate({}, cancelled); callbacks.onError({ code: 'ERR_CANCELED' }, {}, undefined, cancelled);
  const stale = opted(); callbacks.onMutate({}, stale); epoch++;
  callbacks.onSuccess({}, {}, undefined, stale);
  const silent = { options: {} }; callbacks.onMutate({}, silent); callbacks.onSuccess({}, {}, undefined, silent);
  callbacks.onSuccess({}, {}, undefined, good);
  assert.deepEqual(events.map(e => e.type), ['success', 'error', 'error']);
  assert.equal(new Set(events.map(e => e.id)).size, 3);
});
