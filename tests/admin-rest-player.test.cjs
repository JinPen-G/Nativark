const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

// Exercise the real timer and media adapters without a browser, network, app
// startup or environment files. Real provider playback is checked separately.
const folder = path.resolve(__dirname, "../apps/admin/src/features/rest");
function load(file, imports = {}) {
  const filename = path.join(folder, file);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded.require = name => Object.hasOwn(imports, name) ? imports[name] : require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
  return loaded.exports;
}
const session = load("restSession.ts");

test("10/30-minute deadlines survive delayed callbacks and never use song position", () => {
  const ten = session.createRestSession(1, 10, 100_000);
  const thirty = session.createRestSession(2, 30, 100_000);
  assert.equal(session.restSecondsRemaining(ten, 100_000), 600);
  assert.equal(session.restSecondsRemaining(ten, 650_000), 50);
  assert.equal(session.restSecondsRemaining(thirty, 650_000), 1250);
  assert.equal(session.restSecondsRemaining(ten, 700_000), 0);
  assert.equal(session.restSecondsRemaining(ten, 9_999_999), 0);
  assert.equal(session.restSecondsRemaining(ten, 0), 600);
  assert.throws(() => session.createRestSession(3, 20, 0));
  assert.throws(() => session.createRestSession(3, 10, NaN));
  assert.equal(session.formatMediaTime(613), "10:13");
});

function harness({ canPlay = () => true, loop = () => false, apiReady = true } = {}) {
  const slots = [], effects = [], cleanups = [], timers = new Map(), instances = [];
  let index = 0, timerId = 0, result, enabled = true;
  const events = new Map();
  const createNode = tag => ({ tag, children: [], attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(child) { child.parent = this; this.children.push(child); },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; },
  });
  const root = createNode("div"), host = { current: root };
  const schedule = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
  const listen = (name, fn) => events.set(name, fn);
  const unlisten = (name, fn) => { if (events.get(name) === fn) events.delete(name); };
  class Player {
    constructor(frame, { events: listeners }) {
      this.frame = frame; this.events = listeners;
      this.time = 0; this.duration = 613; this.volume = 100;
      this.calls = []; instances.push(this);
    }
    playVideo() { this.calls.push("play"); }
    pauseVideo() { this.calls.push("pause"); }
    stopVideo() { this.calls.push("stop"); }
    seekTo(value) { this.calls.push(["seek", value]); this.time = value; }
    setVolume(value) { this.volume = value; }
    getVolume() { return this.volume; }
    getDuration() { return this.duration; }
    getCurrentTime() { return this.time; }
    isMuted() { return false; }
    unMute() {}
    destroy() { this.calls.push("destroy"); this.frame.remove(); }
    emit(name, data = 0) { this.events[name]({ target: this, data }); }
  }
  const oldWindow = global.window, oldDocument = global.document;
  global.window = { location: { origin: "http://127.0.0.1:5175" }, YT: apiReady ? { Player } : undefined,
    setTimeout: schedule, setInterval: schedule, clearInterval: id => timers.delete(id), clearTimeout: id => timers.delete(id),
    addEventListener: listen, removeEventListener: unlisten };
  global.document = { createElement: createNode, head: createNode("head"), addEventListener: listen, removeEventListener: unlisten };
  const hooks = {
    useRef(initial) { return slots[index++] ??= { current: initial }; },
    useState(initial) {
      const at = index++;
      if (!(at in slots)) slots[at] = typeof initial === "function" ? initial() : initial;
      return [slots[at], value => { slots[at] = typeof value === "function" ? value(slots[at]) : value; }];
    },
    useEffect(fn, deps) {
      const at = index++, previous = slots[at];
      if (!previous || deps.some((value, n) => !Object.is(value, previous[n]))) {
        effects.push(() => { cleanups[at]?.(); cleanups[at] = fn(); }); slots[at] = deps;
      }
    },
    useCallback(fn) { return fn; },
  };
  const { useYouTubePlayer } = load("youtubePlayer.ts", { react: hooks, "./restSession": session });
  const render = () => { index = 0; result = useYouTubePlayer(host, canPlay, loop, enabled); effects.splice(0).forEach(fn => fn()); return result; };
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); return render(); };
  const dispose = () => {
    cleanups.splice(0).forEach(fn => fn?.());
    if (oldWindow === undefined) delete global.window; else global.window = oldWindow;
    if (oldDocument === undefined) delete global.document; else global.document = oldDocument;
  };
  render();
  return { root, instances, timers, render, flush, dispose,
    expire: () => { enabled = false; return render(); },
    tick: delay => { [...timers.values()].filter(timer => timer.delay === delay).forEach(timer => timer.callback()); return render(); },
  };
}

test("play state and position come from provider events; a rejected autoplay stays actionable", async () => {
  const h = harness();
  try {
    await h.flush();
    const player = h.instances[0];
    player.emit("onReady");
    assert.equal(h.render().status, "ready");
    assert.equal(player.volume, 40);
    player.emit("onAutoplayBlocked");
    assert.equal(h.render().autoplayBlocked, true);
    h.render().play();
    assert.equal(h.render().status, "ready");
    player.emit("onStateChange", 1);
    player.time = 42.5;
    const playing = h.tick(500);
    assert.equal(playing.status, "playing");
    assert.equal(playing.currentTime, 42.5);
    assert.equal(playing.duration, 613);
    assert.equal(playing.autoplayBlocked, false);
    playing.seek(9999);
    assert.deepEqual(player.calls.at(-1), ["seek", 613]);
    playing.setVolume(64);
    assert.equal(player.volume, 64);
    player.emit("onStateChange", 2);
    assert.equal(h.render().status, "paused");
  } finally { h.dispose(); }
});

test("30-minute repetition uses the same player and cannot restart after the break deadline", async () => {
  let permitted = true;
  const h = harness({ canPlay: () => permitted, loop: () => true });
  try {
    await h.flush(); const player = h.instances[0]; player.emit("onReady");
    const originalFrame = h.root.children[0];
    player.emit("onStateChange", 0);
    assert.deepEqual(player.calls.slice(-2), [["seek", 0], "play"]);
    assert.equal(h.root.children[0], originalFrame);
    permitted = false;
    const calls = player.calls.length;
    player.emit("onStateChange", 0);
    h.render().play(); h.render().seek(1); h.tick(500);
    assert.ok(player.calls.slice(calls).every(call => call === "pause"));
  } finally { h.dispose(); }
});

test("10-minute mode does not silently loop a finished or manually seeked track", async () => {
  const h = harness();
  try {
    await h.flush(); const player = h.instances[0]; player.emit("onReady");
    const calls = player.calls.length;
    player.emit("onStateChange", 0);
    assert.equal(h.render().status, "ended");
    assert.equal(player.calls.length, calls);
  } finally { h.dispose(); }
});

test("retry replaces only the failed media instance; close destroys it and ignores late events", async () => {
  const h = harness();
  try {
    await h.flush(); const first = h.instances[0]; first.emit("onReady"); first.emit("onError", 150);
    assert.equal(h.render().error, "embed");
    h.render().retry(); h.render(); await h.flush();
    assert.equal(first.calls.at(-1), "destroy");
    assert.equal(h.instances.length, 2);
    assert.equal(h.root.children.length, 1);
    const second = h.instances[1];
    second.emit("onReady");
    h.dispose();
    assert.equal(h.root.children.length, 0);
    assert.equal(second.calls.at(-1), "destroy");
    const count = second.calls.length;
    second.emit("onStateChange", 0); second.emit("onReady");
    assert.equal(second.calls.length, count);
    assert.equal(h.timers.size, 0);
  } finally { h.dispose(); }
});

test("slow provider initialization after expiry never starts playback", async () => {
  const h = harness({ canPlay: () => false });
  try {
    await h.flush(); const player = h.instances[0];
    h.tick(15_000);
    assert.equal(h.render().error, "network");
    player.emit("onReady");
    assert.ok(!player.calls.includes("play"));
  } finally { h.dispose(); }
});

test("expiry destroys the iframe even while the completion panel remains mounted", async () => {
  const h = harness({ loop: () => true });
  try {
    await h.flush(); const player = h.instances[0]; player.emit("onReady");
    h.expire();
    assert.equal(player.calls.at(-1), "destroy");
    assert.equal(h.root.children.length, 0);
    const count = player.calls.length;
    player.emit("onStateChange", 0); h.render().play();
    assert.equal(player.calls.length, count);
    assert.equal(h.timers.size, 0);
  } finally { h.dispose(); }
});

function nativeHarness({ canPlay = () => true, loop = () => false } = {}) {
  const slots = [], effects = [], cleanups = [], handlers = new Map(), windowHandlers = new Map();
  let index = 0, source = `/${session.REST_TRACK.audio}`, enabled = true, disposed = false;
  let playResult = () => Promise.resolve();
  const audio = { src: "", currentTime: 0, duration: NaN, volume: 1, muted: false, paused: true, calls: [],
    addEventListener(name, handler) { handlers.set(name, handler); },
    removeEventListener(name, handler) { if (handlers.get(name) === handler) handlers.delete(name); },
    emit(name) { handlers.get(name)?.(); },
    load() { this.calls.push("load"); },
    play() { this.calls.push("play"); return playResult(); },
    pause() { this.calls.push("pause"); if (!this.paused) { this.paused = true; this.emit("pause"); } },
    removeAttribute(name) { if (name === "src") this.src = ""; },
  };
  const oldWindow = global.window;
  global.window = {
    addEventListener: (name, handler) => windowHandlers.set(name, handler),
    removeEventListener: (name, handler) => { if (windowHandlers.get(name) === handler) windowHandlers.delete(name); },
  };
  const hooks = {
    useRef(initial) { return slots[index++] ??= { current: initial }; },
    useState(initial) {
      const at = index++;
      if (!(at in slots)) slots[at] = typeof initial === "function" ? initial() : initial;
      return [slots[at], value => { slots[at] = typeof value === "function" ? value(slots[at]) : value; }];
    },
    useEffect(fn, deps) {
      const at = index++, previous = slots[at];
      if (!previous || deps.some((value, n) => !Object.is(value, previous[n]))) {
        effects.push(() => { cleanups[at]?.(); cleanups[at] = fn(); }); slots[at] = deps;
      }
    },
    useCallback(fn) { return fn; },
  };
  const { useLocalAudioPlayer } = load("localAudioPlayer.ts", { react: hooks });
  const ref = { current: audio };
  const render = () => {
    index = 0;
    const result = useLocalAudioPlayer(ref, source, canPlay, loop, enabled);
    effects.splice(0).forEach(fn => fn());
    return result;
  };
  render();
  return { audio, handlers, windowHandlers, render,
    ready: () => { audio.duration = 613; audio.emit("loadedmetadata"); return render(); },
    playing: () => { audio.paused = false; audio.emit("playing"); return render(); },
    changeSource: next => { source = next; render(); return render(); },
    expire: () => { enabled = false; return render(); },
    setPlayResult: callback => { playResult = callback; },
    flush: async () => { await Promise.resolve(); await Promise.resolve(); return render(); },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cleanups.splice(0).forEach(fn => fn?.());
      if (oldWindow === undefined) delete global.window; else global.window = oldWindow;
    },
  };
}

test("native default audio reads the actual clock, preserves one instance and releases its source on expiry", () => {
  const h = nativeHarness();
  try {
    assert.equal(h.audio.src, `/${session.REST_TRACK.audio}`);
    h.ready();
    assert.equal(h.audio.volume, 0.4);
    assert.equal(h.playing().status, "playing");
    h.audio.currentTime = 127.5; h.audio.emit("timeupdate");
    assert.equal(h.render().currentTime, 127.5);
    assert.equal(h.render().duration, 613);
    h.render(); h.render();
    assert.equal(h.audio.calls.filter(call => call === "load").length, 1);
    h.render().seek(10000);
    assert.equal(h.audio.currentTime, 613);
    h.expire();
    assert.equal(h.audio.paused, true);
    assert.equal(h.audio.src, "");
    assert.equal(h.handlers.size, 0);
    assert.equal(h.windowHandlers.size, 0);
  } finally { h.dispose(); }
});

test("native audio loops only for thirty minutes and never restarts beyond the deadline", () => {
  for (const loop of [false, true]) {
    let permitted = true;
    const h = nativeHarness({ canPlay: () => permitted, loop: () => loop });
    try {
      h.ready(); h.playing();
      const plays = () => h.audio.calls.filter(call => call === "play").length;
      const firstCount = plays();
      h.audio.currentTime = 613; h.audio.emit("ended");
      assert.equal(plays(), firstCount + Number(loop));
      assert.equal(h.audio.currentTime, loop ? 0 : 613);
      permitted = false;
      const expiredCount = plays();
      h.audio.emit("ended"); h.render().play(); h.render().seek(10);
      assert.equal(plays(), expiredCount);
      assert.equal(h.audio.paused, true);
    } finally { h.dispose(); }
  }
});

test("native autoplay rejection remains recoverable and a superseded rejection cannot replace pause or a new source", async () => {
  const h = nativeHarness();
  try {
    h.setPlayResult(() => Promise.reject(new DOMException("Gesture required", "NotAllowedError")));
    h.ready();
    assert.equal((await h.flush()).autoplayBlocked, true);
    assert.equal(h.render().status, "ready");
    let rejectPending;
    h.setPlayResult(() => new Promise((_, reject) => { rejectPending = reject; }));
    h.render().play();
    h.playing(); h.render().pause();
    rejectPending(new Error("Late play rejection"));
    assert.equal((await h.flush()).status, "paused");
    h.render().play();
    const rejectOldSource = rejectPending;
    h.changeSource("blob:replacement-audio");
    h.ready(); h.playing();
    rejectOldSource(new Error("Previous source failed late"));
    assert.equal((await h.flush()).status, "playing");
    assert.equal(h.render().error, null);
  } finally { h.dispose(); }
});

test("native retry and switching back to the default recording preserve mute and close ignores pending playback", async () => {
  const h = nativeHarness();
  try {
    h.ready(); h.render().setVolume(0);
    h.audio.emit("error");
    assert.equal(h.render().status, "error");
    h.render().retry(); h.render(); h.ready();
    assert.equal(h.audio.volume, 0);
    h.changeSource("blob:user-selection"); h.ready();
    assert.equal(h.audio.volume, 0);
    h.changeSource(`/${session.REST_TRACK.audio}`); h.ready();
    assert.equal(h.audio.volume, 0);
    let rejectPending;
    h.setPlayResult(() => new Promise((_, reject) => { rejectPending = reject; }));
    h.render().play(); h.dispose();
    const callsAtClose = h.audio.calls.length;
    rejectPending(new Error("Closed while starting"));
    await h.flush();
    assert.equal(h.audio.src, "");
    assert.equal(h.audio.calls.length, callsAtClose);
    assert.equal(h.handlers.size, 0);
    assert.equal(h.windowHandlers.size, 0);
  } finally { h.dispose(); }
});

test("a started break survives same-owner verification, rejects new starts while unverified and cleans up on logout", () => {
  const slots = [], effects = [], cleanups = [], timers = new Map();
  let index = 0, timerId = 0;
  const auth = { token: "original-session", sessionVerified: true, user: { isSaasAdmin: false }, tenant: {} };
  const oldWindow = global.window, oldDocument = global.document;
  const schedule = callback => { timers.set(++timerId, callback); return timerId; };
  global.window = { setInterval: schedule, setTimeout: schedule, clearInterval: id => timers.delete(id), clearTimeout: id => timers.delete(id),
    addEventListener() {}, removeEventListener() {} };
  global.document = { addEventListener() {}, removeEventListener() {} };
  const hooks = {
    useRef(initial) { return slots[index++] ??= { current: initial }; },
    useState(initial) {
      const at = index++;
      if (!(at in slots)) slots[at] = typeof initial === "function" ? initial() : initial;
      return [slots[at], value => { slots[at] = typeof value === "function" ? value(slots[at]) : value; }];
    },
    useEffect(fn, deps) {
      const at = index++, previous = slots[at];
      if (!previous || deps.some((value, n) => !Object.is(value, previous[n]))) {
        effects.push(() => { cleanups[at]?.(); cleanups[at] = fn(); }); slots[at] = deps;
      }
    },
    useCallback(fn, deps) {
      const at = index++, previous = slots[at];
      if (!previous || deps.some((value, n) => !Object.is(value, previous.deps[n]))) slots[at] = { fn, deps };
      return slots[at].fn;
    },
  };
  try {
    const { RestProvider } = load("RestProvider.tsx", { react: hooks,
      "@/features/auth/authStore": { useAuthStore: selector => selector(auth) },
      "@/features/agent-desktop/desktop-host": { rentalDesktopHost: () => false },
      "./RestContext": { RestContext: { Provider: "rest-context" } },
      "./RestExperience": { RestExperience: "rest-experience" }, "./restSession": session });
    const render = () => { index = 0; const element = RestProvider({ children: "workspace" }); effects.splice(0).forEach(fn => fn()); return element; };
    let view = render();
    view.props.value.start(10);
    view = render();
    const original = view.props.value.session;
    const media = view.props.children[1];
    assert.equal(original.minutes, 10);
    assert.equal(timers.size, 2);
    view.props.value.minimize();
    auth.token = "rotated-session"; auth.sessionVerified = false;
    view = render();
    assert.equal(view.props.value.available, false);
    assert.equal(view.props.value.session, original);
    assert.equal(view.props.value.expanded, false);
    assert.equal(view.props.children[1].key, media.key);
    view.props.value.start(30);
    view = render();
    assert.equal(view.props.value.session, original);
    auth.sessionVerified = true;
    view = render();
    assert.equal(view.props.value.available, true);
    assert.equal(view.props.value.session.endsAt, original.endsAt);
    auth.token = undefined; auth.user = undefined; auth.tenant = undefined; auth.sessionVerified = false;
    render(); view = render();
    assert.equal(view.props.value.session, null);
    assert.equal(view.props.children[1], false);
    assert.equal(timers.size, 0);
  } finally {
    cleanups.forEach(fn => fn?.());
    if (oldWindow === undefined) delete global.window; else global.window = oldWindow;
    if (oldDocument === undefined) delete global.document; else global.document = oldDocument;
  }
});
