'use strict';
/** 原企业消费者的有界 Hook fixture，公共交互与业务用例共用；不模拟服务端授权。 */
const assert = require('node:assert/strict');
function reactHost() {
  let slots = [], index = 0, effects = [], dirty = false, disposed = true, renderBody, value;
  const jsx = (type, props) => ({ type, props: props || {} });
  const runtime = {
    useRef(initial) { const n = index++; if (!slots[n]) slots[n] = { current: initial }; return slots[n]; },
    useLayoutEffect(effect, deps) { return runtime.useEffect(effect, deps); },
    useMemo(create, deps) {
      const n = index++, old = slots[n];
      if (!old || deps.some((value, at) => !Object.is(value, old.deps[at]))) slots[n] = { deps, value: create() };
      return slots[n].value;
    },
    useCallback(callback, deps) { return runtime.useMemo(() => callback, deps); },
    useState(initial) {
      const n = index++;
      if (!slots[n]) slots[n] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[n].value, next => {
        const result = typeof next === 'function' ? next(slots[n].value) : next;
        if (!Object.is(slots[n].value, result)) { slots[n].value = result; dirty = true; }
      }];
    },
    useEffect(effect, deps) {
      const n = index++, old = slots[n];
      if (!old || !deps || !old.deps || deps.some((d, i) => !Object.is(d, old.deps[i]))) {
        slots[n] = { deps, cleanup: old?.cleanup };
        effects.push(() => { slots[n].cleanup?.(); slots[n].cleanup = effect(); });
      }
    },
  };
  const host = {
    runtime, jsx: { jsx, jsxs: jsx, Fragment: Symbol('Fragment') },
    mount(body) { slots = []; effects = []; disposed = false; renderBody = body; dirty = true; host.flush(); },
    flush() {
      if (disposed) return;
      for (let n = 0; dirty; n++) {
        assert.ok(n < 30, 'bounded hook rerender'); dirty = false; index = 0; effects = [];
        value = renderBody(); const pending = effects; effects = []; for (const effect of pending) effect();
      }
    },
    get value() { host.flush(); return value; },
    rerender() { dirty = true; host.flush(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); disposed = true; },
    async settle() { for (let n = 0; n < 24; n++) { await Promise.resolve(); host.flush(); } },
    async act(action) { action(); host.flush(); await host.settle(); },
  };
  return host;
}
module.exports = { reactHost };
