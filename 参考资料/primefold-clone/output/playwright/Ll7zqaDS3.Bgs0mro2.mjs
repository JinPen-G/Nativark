import { t as e } from "./rolldown-runtime.Dh6celcD.mjs";
import {
  B as t,
  F as n,
  I as r,
  M as i,
  P as a,
  R as o,
  _ as s,
  c,
  d as l,
  j as u,
  k as d,
  l as f,
  p,
  s as m,
  u as h,
  v as g,
  w as _,
  y as v,
} from "./react.DwKF3UUh.mjs";
import { T as y, V as b, i as x, o as S, t as C } from "./motion.CHs8nAca.mjs";
import {
  A as ee,
  B as te,
  Ct as ne,
  D as w,
  Ft as re,
  It as ie,
  N as ae,
  P as T,
  R as oe,
  S as se,
  Tt as ce,
  Ut as E,
  V as le,
  X as ue,
  Y as D,
  _ as de,
  _t as fe,
  a as pe,
  h as me,
  kt as O,
  n as he,
  nt as k,
  q as ge,
  r as _e,
  s as A,
  t as j,
  ut as ve,
  v as ye,
  w as be,
} from "./framer.DnRup4B8.mjs";
import { i as xe, n as Se, r as Ce, t as we } from "./C9QVuNHI_.D3eIQwsu.mjs";
import { i as Te, n as Ee, r as De, t as Oe } from "./QVrDLad_P.HzparQqa.mjs";
import { n as ke, t as Ae } from "./mkdyb58VB.Ox-SPixJ.mjs";
import { i as je, n as Me, r as Ne, t as Pe } from "./Jj3fhNusN.DdzgEdJ4.mjs";
function Fe(e) {
  let {
      content: t = `TEXT`,
      repeatCount: n = 8,
      animationTime: i = 2,
      characterDelay: o = 0.1,
      startDelay: s = 0,
      blurStrength: c = 8,
      autoStart: l = !0,
      bgColor: u = `#000000`,
      fontColor: p = `#FFFFFF`,
      typography: m,
      rollPattern: h = `sequential`,
    } = e,
    [_, v] = r(!1),
    y = d(null),
    x = b(y, { once: !0 }),
    S = ne();
  a(() => {
    if (l && x && !S) {
      let e = setTimeout(
        () => {
          g(() => v(!0));
        },
        s * 1e3 + 100,
      );
      return () => {
        clearTimeout(e);
      };
    }
  }, [l, x, S, s]);
  let C = () => {
      g(() => {
        (v(!1),
          setTimeout(() => {
            g(() => v(!0));
          }, 50));
      });
    },
    ee = t.split(``);
  return f(`div`, {
    ref: y,
    style: {
      ...e.style,
      position: `relative`,
      width: `100%`,
      height: `100%`,
      backgroundColor: u,
      display: `flex`,
      alignItems: `center`,
      justifyContent: `center`,
      overflow: `hidden`,
      cursor: `pointer`,
      userSelect: `none`,
    },
    onClick: S ? void 0 : C,
    children: f(`div`, {
      style: {
        display: `flex`,
        alignItems: `center`,
        justifyContent: `center`,
        gap: `0.05em`,
        ...m,
      },
      children: ee.map((e, t) =>
        f(
          Ie,
          {
            character: e,
            repeatCount: n,
            animationTime: i,
            delay: t * o,
            blurStrength: c,
            isAnimating: _,
            fontColor: p,
            typography: m,
            isStatic: S,
            rollPattern: h,
            characterIndex: t,
          },
          `${e}-${t}`,
        ),
      ),
    }),
  });
}
function Ie({
  character: e,
  repeatCount: t,
  animationTime: n,
  delay: r,
  blurStrength: i,
  isAnimating: a,
  fontColor: o,
  typography: s,
  isStatic: c,
  rollPattern: l,
  characterIndex: u,
}) {
  let d = e === ` `,
    p = Array(t).fill(e),
    m = parseFloat(s?.lineHeight || `1em`),
    h = parseFloat(s?.fontSize || `60px`) * m,
    g = h * (t - 1),
    _ = u % 2 == 0,
    v = l === `alternating` && !_,
    b = v ? -g : 0,
    x = v ? 0 : -g;
  return c
    ? f(`div`, {
        style: {
          position: `relative`,
          height: `${h}px`,
          overflow: `hidden`,
          display: `flex`,
          alignItems: `center`,
          justifyContent: `center`,
          width: d ? `0.25em` : `auto`,
          minWidth: d ? `0.25em` : `auto`,
        },
        children: f(`span`, {
          style: {
            color: o,
            ...s,
            lineHeight: s?.lineHeight || `1em`,
            visibility: d ? `hidden` : `visible`,
          },
          children: e,
        }),
      })
    : f(`div`, {
        style: {
          position: `relative`,
          height: `${h}px`,
          overflow: `hidden`,
          display: `flex`,
          alignItems: `flex-start`,
          justifyContent: `center`,
          width: d ? `0.25em` : `auto`,
          minWidth: d ? `0.25em` : `auto`,
        },
        children: f(y.div, {
          style: {
            display: `flex`,
            flexDirection: `column`,
            alignItems: `center`,
          },
          initial: { y: b, opacity: 0 },
          animate: a ? { y: x, opacity: 1 } : { y: b, opacity: 0 },
          transition: {
            y: {
              duration: n,
              delay: r,
              ease: [0.25, 0.46, 0.45, 0.94],
              type: `tween`,
            },
            opacity: { duration: 0.001, delay: r },
          },
          children: p.map((t, c) =>
            f(
              y.span,
              {
                style: {
                  color: o,
                  height: `${h}px`,
                  display: `flex`,
                  alignItems: `center`,
                  justifyContent: `center`,
                  ...s,
                  lineHeight: s?.lineHeight || `1em`,
                  visibility: d ? `hidden` : `visible`,
                },
                initial: { filter: `blur(0px)` },
                animate: a
                  ? {
                      filter: [
                        `blur(0px)`,
                        `blur(${i}px)`,
                        `blur(${i}px)`,
                        `blur(0px)`,
                      ],
                    }
                  : { filter: `blur(0px)` },
                transition: {
                  duration: n,
                  delay: r,
                  times: [0, 0.2, 0.8, 1],
                  ease: `easeOut`,
                },
                children: e,
              },
              c,
            ),
          ),
        }),
      });
}
var Le = e(() => {
  (m(),
    _(),
    k(),
    C(),
    T(Fe, {
      content: { type: A.String, title: `Content`, defaultValue: `TEXT` },
      rollPattern: {
        type: A.Enum,
        title: `Roll Pattern`,
        options: [`sequential`, `alternating`],
        optionTitles: [`Sequential`, `Alternating`],
        defaultValue: `sequential`,
        displaySegmentedControl: !0,
      },
      typography: {
        type: A.Font,
        title: `Typography`,
        defaultValue: {
          fontSize: `60px`,
          variant: `Bold`,
          letterSpacing: `-0.02em`,
          lineHeight: `1em`,
        },
        controls: `extended`,
        defaultFontType: `sans-serif`,
      },
      fontColor: {
        type: A.Color,
        title: `Font Color`,
        defaultValue: `#FFFFFF`,
      },
      repeatCount: {
        type: A.Number,
        title: `Repeat Count`,
        defaultValue: 8,
        min: 2,
        max: 20,
        step: 1,
      },
      animationTime: {
        type: A.Number,
        title: `Animation Time`,
        defaultValue: 2,
        min: 0.5,
        max: 5,
        step: 0.1,
        unit: `s`,
      },
      characterDelay: {
        type: A.Number,
        title: `Character Delay`,
        defaultValue: 0.1,
        min: 0,
        max: 0.5,
        step: 0.01,
        unit: `s`,
      },
      startDelay: {
        type: A.Number,
        title: `Start Delay`,
        defaultValue: 0,
        min: 0,
        max: 5,
        step: 0.1,
        unit: `s`,
      },
      blurStrength: {
        type: A.Number,
        title: `Blur Strength`,
        defaultValue: 8,
        min: 0,
        max: 20,
        step: 1,
        unit: `px`,
      },
      autoStart: {
        type: A.Boolean,
        title: `Auto Start`,
        defaultValue: !0,
        enabledTitle: `On`,
        disabledTitle: `Off`,
      },
      bgColor: { type: A.Color, title: `Background`, defaultValue: `#000000` },
    }));
});
function M(e, t, n) {
  return (
    t in e
      ? Object.defineProperty(e, t, {
          value: n,
          enumerable: !0,
          configurable: !0,
          writable: !0,
        })
      : (e[t] = n),
    e
  );
}
function N(e) {
  return typeof e == `function` ? e() : e;
}
function Re(e, t) {
  return Gt[e] > Gt[t];
}
function ze(e) {
  let t;
  for (let n of e) {
    let e = N(n);
    if (((t === void 0 || Re(e, t)) && (t = e), t === `user-blocking`)) break;
  }
  return t;
}
function Be(e) {
  return new DataView(e.buffer, e.byteOffset, e.byteLength);
}
function P(e, ...t) {
  if (!e)
    throw Error(`Assertion Error` + (t.length > 0 ? `: ` + t.join(` `) : ``));
}
function F(e) {
  throw Error(`Unexpected value: ${e}`);
}
function I(e, t, n, r) {
  (P(e >= t, e, `outside lower bound for`, r),
    P(e <= n, e, `outside upper bound for`, r));
}
function Ve(e) {
  return typeof e == `string`;
}
function L(e) {
  return Number.isFinite(e);
}
function R(e) {
  return e === null;
}
function He(e) {
  if (R(e)) return 0;
  switch (e.type) {
    case A.Array:
      return 1;
    case A.Boolean:
      return 2;
    case A.Color:
      return 3;
    case A.Date:
      return 4;
    case A.Enum:
      return 5;
    case A.File:
      return 6;
    case A.ResponsiveImage:
      return 10;
    case A.Link:
      return 7;
    case A.Number:
      return 8;
    case A.Object:
      return 9;
    case A.RichText:
      return 11;
    case A.String:
      return 12;
    case A.VectorSetItem:
      return 13;
    default:
      F(e);
  }
}
function Ue(e) {
  let t = e.readUint16(),
    n = [];
  for (let r = 0; r < t; r++) {
    let t = z.read(e);
    n.push(t);
  }
  return { type: A.Array, value: n };
}
function We(e, t) {
  for (let n of (e.writeUint16(t.value.length), t.value)) z.write(e, n);
}
function Ge(e, t, n) {
  let r = e.value.length,
    i = t.value.length;
  if (r < i) return -1;
  if (r > i) return 1;
  for (let i = 0; i < r; i++) {
    let r = e.value[i],
      a = t.value[i],
      o = z.compare(r, a, n);
    if (o !== 0) return o;
  }
  return 0;
}
function Ke(e) {
  return { type: A.Boolean, value: e.readUint8() !== 0 };
}
function qe(e, t) {
  e.writeUint8(+!!t.value);
}
function Je(e, t) {
  return e.value < t.value ? -1 : +(e.value > t.value);
}
function Ye(e) {
  return { type: A.Color, value: e.readString() };
}
function Xe(e, t) {
  e.writeString(t.value);
}
function Ze(e, t) {
  return e.value < t.value ? -1 : +(e.value > t.value);
}
function Qe(e) {
  let t = e.readInt64(),
    n = new Date(t);
  return { type: A.Date, value: n.toISOString() };
}
function $e(e, t) {
  let n = new Date(t.value).getTime();
  e.writeInt64(n);
}
function et(e, t) {
  let n = new Date(e.value),
    r = new Date(t.value);
  return n < r ? -1 : +(n > r);
}
function tt(e) {
  return { type: A.Enum, value: e.readString() };
}
function nt(e, t) {
  e.writeString(t.value);
}
function rt(e, t) {
  return e.value < t.value ? -1 : +(e.value > t.value);
}
function it(e) {
  return { type: A.File, value: e.readString() };
}
function at(e, t) {
  e.writeString(t.value);
}
function ot(e, t) {
  return e.value < t.value ? -1 : +(e.value > t.value);
}
function st(e) {
  return { type: A.Link, value: e.readJson() };
}
function ct(e, t) {
  e.writeJson(t.value);
}
function lt(e, t) {
  let n = JSON.stringify(e.value),
    r = JSON.stringify(t.value);
  return n < r ? -1 : +(n > r);
}
function ut(e) {
  return { type: A.Number, value: e.readFloat64() };
}
function dt(e, t) {
  e.writeFloat64(t.value);
}
function ft(e, t) {
  return e.value < t.value ? -1 : +(e.value > t.value);
}
function pt(e) {
  let t = e.readUint16(),
    n = {};
  for (let r = 0; r < t; r++) {
    let t = e.readString();
    n[t] = z.read(e);
  }
  return { type: A.Object, value: n };
}
function mt(e, t) {
  let n = Object.entries(t.value);
  for (let [t, r] of (e.writeUint16(n.length), n))
    (e.writeString(t), z.write(e, r));
}
function ht(e, t, n) {
  let r = Object.keys(e.value).sort(),
    i = Object.keys(t.value).sort();
  if (r.length < i.length) return -1;
  if (r.length > i.length) return 1;
  for (let a = 0; a < r.length; a++) {
    let o = r[a],
      s = i[a];
    if (o < s) return -1;
    if (o > s) return 1;
    let c = e.value[o] ?? null,
      l = t.value[s] ?? null,
      u = z.compare(c, l, n);
    if (u !== 0) return u;
  }
  return 0;
}
function gt(e) {
  return { type: A.ResponsiveImage, value: e.readJson() };
}
function _t(e, t) {
  e.writeJson(t.value);
}
function vt(e, t) {
  let n = JSON.stringify(e.value),
    r = JSON.stringify(t.value);
  return n < r ? -1 : +(n > r);
}
function yt(e) {
  let t = e.readInt8();
  if (t === 0) return { type: A.RichText, value: e.readUint32() };
  if (t === 1) return { type: A.RichText, value: e.readString() };
  throw Error(`Invalid rich text pointer`);
}
function bt(e, t) {
  if (L(t.value)) {
    (e.writeInt8(0), e.writeUint32(t.value));
    return;
  }
  if (Ve(t.value)) {
    (e.writeInt8(1), e.writeString(t.value));
    return;
  }
  throw Error(`Invalid rich text pointer`);
}
function xt(e, t) {
  let n = e.value,
    r = t.value;
  if ((L(n) && L(r)) || (Ve(n) && Ve(r))) return n < r ? -1 : +(n > r);
  throw Error(`Invalid rich text pointer`);
}
function St(e) {
  return { type: A.String, value: e.readString() };
}
function Ct(e, t) {
  e.writeString(t.value);
}
function wt(e, t, n) {
  let r = e.value,
    i = t.value;
  return (
    n.type === 0 && ((r = e.value.toLowerCase()), (i = t.value.toLowerCase())),
    r < i ? -1 : +(r > i)
  );
}
function Tt(e) {
  return { type: A.VectorSetItem, value: e.readUint32() };
}
function Et(e, t) {
  e.writeUint32(t.value);
}
function Dt(e, t) {
  let n = e.value,
    r = t.value;
  return n < r ? -1 : +(n > r);
}
async function Ot(e) {
  let t = Math.floor(Zt * (Math.random() + 1) * 2 ** (e - 1));
  await new Promise((e) => {
    setTimeout(e, t);
  });
}
async function kt(e, t) {
  let n = jt(t),
    r = [],
    i = 0;
  for (let e of n) (r.push(`${e.from}-${e.to - 1}`), (i += e.to - e.from));
  let a = new URL(e),
    o = r.join(`,`);
  a.searchParams.set(`range`, o);
  let s = await $t(a);
  if (s.status !== 200)
    throw Error(`Request failed: ${s.status} ${s.statusText}`);
  let c = await s.arrayBuffer(),
    l = new Uint8Array(c);
  if (l.length !== i) throw Error(`Request failed: Unexpected response length`);
  let u = new en(),
    d = 0;
  for (let e of n) {
    let t = e.to - e.from,
      n = d + t,
      r = l.subarray(d, n);
    (u.write(e.from, r), (d = n));
  }
  return t.map((e) => u.read(e.from, e.to - e.from));
}
function At(e, t) {
  let n = e.length + t.length,
    r = new Uint8Array(n);
  return (r.set(e, 0), r.set(t, e.length), r);
}
function jt(e) {
  P(e.length > 0, `Must have at least one range`);
  let t = [...e].sort((e, t) => e.from - t.from),
    n = [];
  for (let e of t) {
    let t = n.length - 1,
      r = n[t];
    r && e.from <= r.to
      ? (n[t] = { from: r.from, to: Math.max(r.to, e.to) })
      : n.push(e);
  }
  return n;
}
function Mt(e) {
  let t = {},
    n = e.readUint16();
  for (let r = 0; r < n; r++) {
    let n = e.readString();
    t[n] = z.read(e);
  }
  return t;
}
function* Nt(e) {
  for (let t of e) yield* t.prioritySources;
}
var Pt,
  z,
  Ft,
  It,
  Lt,
  Rt,
  zt,
  Bt,
  Vt,
  Ht,
  Ut,
  Wt,
  Gt,
  B,
  V,
  Kt,
  qt,
  H,
  U,
  W,
  G,
  K,
  Jt,
  q,
  Yt,
  Xt,
  Zt,
  Qt,
  $t,
  en,
  J,
  tn,
  nn,
  rn = e(() => {
    (o(),
      k(),
      (Ft = Object.create),
      (It = Object.defineProperty),
      (Lt = Object.getOwnPropertyDescriptor),
      (Rt = Object.getOwnPropertyNames),
      (zt = Object.getPrototypeOf),
      (Bt = Object.prototype.hasOwnProperty),
      (Vt = (e, t) =>
        function () {
          try {
            return (
              t || (0, e[Rt(e)[0]])((t = { exports: {} }).exports, t),
              t.exports
            );
          } catch (e) {
            throw ((t = 0), e);
          }
        }),
      (Ht = (e, t, n, r) => {
        if ((t && typeof t == `object`) || typeof t == `function`)
          for (let i of Rt(t))
            Bt.call(e, i) ||
              i === n ||
              It(e, i, {
                get: () => t[i],
                enumerable: !(r = Lt(t, i)) || r.enumerable,
              });
        return e;
      }),
      (Ut = (e, t, n) => (
        (n = e == null ? {} : Ft(zt(e))),
        Ht(
          !t && e && e.__esModule
            ? n
            : It(n, `default`, { value: e, enumerable: !0 }),
          e,
        )
      )),
      (Wt = Ut(
        Vt({
          "../../../node_modules/dataloader/index.js"(e, t) {
            var n,
              r = (function () {
                function e(e, t) {
                  if (typeof e != `function`)
                    throw TypeError(
                      `DataLoader must be constructed with a function which accepts Array<key> and returns Promise<Array<value>>, but got: ` +
                        e +
                        `.`,
                    );
                  ((this._batchLoadFn = e),
                    (this._maxBatchSize = (function (e) {
                      if (!(!e || !1 !== e.batch)) return 1;
                      var t = e && e.maxBatchSize;
                      if (t === void 0) return 1 / 0;
                      if (typeof t != `number` || t < 1)
                        throw TypeError(
                          `maxBatchSize must be a positive number: ` + t,
                        );
                      return t;
                    })(t)),
                    (this._batchScheduleFn = (function (e) {
                      var t = e && e.batchScheduleFn;
                      if (t === void 0) return i;
                      if (typeof t != `function`)
                        throw TypeError(
                          `batchScheduleFn must be a function: ` + t,
                        );
                      return t;
                    })(t)),
                    (this._cacheKeyFn = (function (e) {
                      var t = e && e.cacheKeyFn;
                      if (t === void 0)
                        return function (e) {
                          return e;
                        };
                      if (typeof t != `function`)
                        throw TypeError(`cacheKeyFn must be a function: ` + t);
                      return t;
                    })(t)),
                    (this._cacheMap = (function (e) {
                      if (!(!e || !1 !== e.cache)) return null;
                      var t = e && e.cacheMap;
                      if (t === void 0) return new Map();
                      if (t !== null) {
                        var n = [`get`, `set`, `delete`, `clear`].filter(
                          function (e) {
                            return t && typeof t[e] != `function`;
                          },
                        );
                        if (n.length !== 0)
                          throw TypeError(
                            `Custom cacheMap missing methods: ` + n.join(`, `),
                          );
                      }
                      return t;
                    })(t)),
                    (this._batch = null),
                    (this.name = t && t.name ? t.name : null));
                }
                var t = e.prototype;
                return (
                  (t.load = function (e) {
                    if (e == null)
                      throw TypeError(
                        `The loader.load() function must be called with a value, but got: ` +
                          String(e) +
                          `.`,
                      );
                    var t = (function (e) {
                        var t = e._batch;
                        if (
                          t !== null &&
                          !t.hasDispatched &&
                          t.keys.length < e._maxBatchSize
                        )
                          return t;
                        var n = { hasDispatched: !1, keys: [], callbacks: [] };
                        return (
                          (e._batch = n),
                          e._batchScheduleFn(function () {
                            (function (e, t) {
                              var n;
                              if (
                                ((t.hasDispatched = !0), t.keys.length === 0)
                              ) {
                                o(t);
                                return;
                              }
                              try {
                                n = e._batchLoadFn(t.keys);
                              } catch (n) {
                                return a(
                                  e,
                                  t,
                                  TypeError(
                                    `DataLoader must be constructed with a function which accepts Array<key> and returns Promise<Array<value>>, but the function errored synchronously: ` +
                                      String(n) +
                                      `.`,
                                  ),
                                );
                              }
                              if (!n || typeof n.then != `function`)
                                return a(
                                  e,
                                  t,
                                  TypeError(
                                    `DataLoader must be constructed with a function which accepts Array<key> and returns Promise<Array<value>>, but the function did not return a Promise: ` +
                                      String(n) +
                                      `.`,
                                  ),
                                );
                              n.then(function (e) {
                                if (!s(e))
                                  throw TypeError(
                                    `DataLoader must be constructed with a function which accepts Array<key> and returns Promise<Array<value>>, but the function did not return a Promise of an Array: ` +
                                      String(e) +
                                      `.`,
                                  );
                                if (e.length !== t.keys.length)
                                  throw TypeError(
                                    `DataLoader must be constructed with a function which accepts Array<key> and returns Promise<Array<value>>, but the function did not return a Promise of an Array of the same length as the Array of keys.

Keys:
` +
                                      String(t.keys) +
                                      `

Values:
` +
                                      String(e),
                                  );
                                o(t);
                                for (var n = 0; n < t.callbacks.length; n++) {
                                  var r = e[n];
                                  r instanceof Error
                                    ? t.callbacks[n].reject(r)
                                    : t.callbacks[n].resolve(r);
                                }
                              }).catch(function (n) {
                                a(e, t, n);
                              });
                            })(e, n);
                          }),
                          n
                        );
                      })(this),
                      n = this._cacheMap,
                      r = this._cacheKeyFn(e);
                    if (n) {
                      var i = n.get(r);
                      if (i) {
                        var c = (t.cacheHits ||= []);
                        return new Promise(function (e) {
                          c.push(function () {
                            e(i);
                          });
                        });
                      }
                    }
                    t.keys.push(e);
                    var l = new Promise(function (e, n) {
                      t.callbacks.push({ resolve: e, reject: n });
                    });
                    return (n && n.set(r, l), l);
                  }),
                  (t.loadMany = function (e) {
                    if (!s(e))
                      throw TypeError(
                        `The loader.loadMany() function must be called with Array<key> but got: ` +
                          e +
                          `.`,
                      );
                    for (var t = [], n = 0; n < e.length; n++)
                      t.push(
                        this.load(e[n]).catch(function (e) {
                          return e;
                        }),
                      );
                    return Promise.all(t);
                  }),
                  (t.clear = function (e) {
                    var t = this._cacheMap;
                    if (t) {
                      var n = this._cacheKeyFn(e);
                      t.delete(n);
                    }
                    return this;
                  }),
                  (t.clearAll = function () {
                    var e = this._cacheMap;
                    return (e && e.clear(), this);
                  }),
                  (t.prime = function (e, t) {
                    var n = this._cacheMap;
                    if (n) {
                      var r,
                        i = this._cacheKeyFn(e);
                      n.get(i) === void 0 &&
                        (t instanceof Error
                          ? (r = Promise.reject(t)).catch(function () {})
                          : (r = Promise.resolve(t)),
                        n.set(i, r));
                    }
                    return this;
                  }),
                  e
                );
              })(),
              i =
                typeof process == `object` &&
                typeof process.nextTick == `function`
                  ? function (e) {
                      ((n ||= Promise.resolve()),
                        n.then(function () {
                          process.nextTick(e);
                        }));
                    }
                  : typeof setImmediate == `function`
                    ? function (e) {
                        setImmediate(e);
                      }
                    : function (e) {
                        setTimeout(e);
                      };
            function a(e, t, n) {
              o(t);
              for (var r = 0; r < t.keys.length; r++)
                (e.clear(t.keys[r]), t.callbacks[r].reject(n));
            }
            function o(e) {
              if (e.cacheHits)
                for (var t = 0; t < e.cacheHits.length; t++) e.cacheHits[t]();
            }
            function s(e) {
              return (
                typeof e == `object` &&
                !!e &&
                typeof e.length == `number` &&
                (e.length === 0 ||
                  (e.length > 0 &&
                    Object.prototype.hasOwnProperty.call(e, e.length - 1)))
              );
            }
            t.exports = r;
          },
        })(),
        1,
      )),
      (Gt = { background: 0, "user-visible": 1, "user-blocking": 2 }),
      (B = {
        Uint8: 1,
        Uint16: 2,
        Uint32: 4,
        BigUint64: 8,
        Int8: 1,
        Int16: 2,
        Int32: 4,
        BigInt64: 8,
        Float32: 4,
        Float64: 8,
      }),
      (V =
        ((Pt = class e {
          getOffset() {
            return this.offset;
          }
          ensureLength(e) {
            let t = this.bytes.length;
            if (!(this.offset + e <= t)) throw Error(`Reading out of bounds`);
          }
          readUint8() {
            let e = B.Uint8;
            this.ensureLength(e);
            let t = this.view.getUint8(this.offset);
            return ((this.offset += e), t);
          }
          readUint16() {
            let e = B.Uint16;
            this.ensureLength(e);
            let t = this.view.getUint16(this.offset);
            return ((this.offset += e), t);
          }
          readUint32() {
            let e = B.Uint32;
            this.ensureLength(e);
            let t = this.view.getUint32(this.offset);
            return ((this.offset += e), t);
          }
          readUint64() {
            let e = this.readBigUint64();
            return Number(e);
          }
          readBigUint64() {
            let e = B.BigUint64;
            this.ensureLength(e);
            let t = this.view.getBigUint64(this.offset);
            return ((this.offset += e), t);
          }
          readInt8() {
            let e = B.Int8;
            this.ensureLength(e);
            let t = this.view.getInt8(this.offset);
            return ((this.offset += e), t);
          }
          readInt16() {
            let e = B.Int16;
            this.ensureLength(e);
            let t = this.view.getInt16(this.offset);
            return ((this.offset += e), t);
          }
          readInt32() {
            let e = B.Int32;
            this.ensureLength(e);
            let t = this.view.getInt32(this.offset);
            return ((this.offset += e), t);
          }
          readInt64() {
            let e = this.readBigInt64();
            return Number(e);
          }
          readBigInt64() {
            let e = B.BigInt64;
            this.ensureLength(e);
            let t = this.view.getBigInt64(this.offset);
            return ((this.offset += e), t);
          }
          readFloat32() {
            let e = B.Float32;
            this.ensureLength(e);
            let t = this.view.getFloat32(this.offset);
            return ((this.offset += e), t);
          }
          readFloat64() {
            let e = B.Float64;
            this.ensureLength(e);
            let t = this.view.getFloat64(this.offset);
            return ((this.offset += e), t);
          }
          readBytes(e) {
            let t = this.offset,
              n = t + e,
              r = this.bytes.subarray(t, n);
            return ((this.offset = n), r);
          }
          readString() {
            let t = this.readUint32(),
              n = this.readBytes(t);
            return e.textDecoder.decode(n);
          }
          readJson() {
            let e = this.readString();
            return JSON.parse(e);
          }
          constructor(e) {
            (M(this, `bytes`, void 0),
              M(this, `offset`, 0),
              M(this, `view`, void 0),
              (this.bytes = e),
              (this.view = Be(this.bytes)));
          }
        }),
        M(Pt, `textDecoder`, new TextDecoder()),
        Pt)),
      t !== void 0 && t.requestIdleCallback,
      (Kt = 1024),
      (qt = 1.5),
      (H = (e) => 2 ** e - 1),
      (U = (e) => -(2 ** (e - 1))),
      (W = (e) => 2 ** (e - 1) - 1),
      (G = {
        Uint8: 0,
        Uint16: 0,
        Uint32: 0,
        Uint64: 0,
        BigUint64: 0,
        Int8: U(8),
        Int16: U(16),
        Int32: U(32),
        Int64: -(2 ** 53 - 1),
        BigInt64: -(BigInt(2) ** BigInt(63)),
      }),
      (K = {
        Uint8: H(8),
        Uint16: H(16),
        Uint32: H(32),
        Uint64: 2 ** 53 - 1,
        BigUint64: BigInt(2) ** BigInt(64) - BigInt(1),
        Int8: W(8),
        Int16: W(16),
        Int32: W(32),
        Int64: 2 ** 53 - 1,
        BigInt64: BigInt(2) ** BigInt(63) - BigInt(1),
      }),
      (Jt = class {
        getOffset() {
          return this.offset;
        }
        slice(e = 0, t = this.offset) {
          return this.bytes.slice(e, t);
        }
        subarray(e = 0, t = this.offset) {
          return this.bytes.subarray(e, t);
        }
        ensureLength(e) {
          let t = this.bytes.length;
          if (this.offset + e <= t) return;
          let n = new Uint8Array(Math.ceil(t * qt) + e);
          (n.set(this.bytes), (this.bytes = n), (this.view = Be(n)));
        }
        writeUint8(e) {
          I(e, G.Uint8, K.Uint8, `Uint8`);
          let t = B.Uint8;
          (this.ensureLength(t),
            this.view.setUint8(this.offset, e),
            (this.offset += t));
        }
        writeUint16(e) {
          I(e, G.Uint16, K.Uint16, `Uint16`);
          let t = B.Uint16;
          (this.ensureLength(t),
            this.view.setUint16(this.offset, e),
            (this.offset += t));
        }
        writeUint32(e) {
          I(e, G.Uint32, K.Uint32, `Uint32`);
          let t = B.Uint32;
          (this.ensureLength(t),
            this.view.setUint32(this.offset, e),
            (this.offset += t));
        }
        writeUint64(e) {
          I(e, G.Uint64, K.Uint64, `Uint64`);
          let t = BigInt(e);
          this.writeBigUint64(t);
        }
        writeBigUint64(e) {
          I(e, G.BigUint64, K.BigUint64, `BigUint64`);
          let t = B.BigUint64;
          (this.ensureLength(t),
            this.view.setBigUint64(this.offset, e),
            (this.offset += t));
        }
        writeInt8(e) {
          I(e, G.Int8, K.Int8, `Int8`);
          let t = B.Int8;
          (this.ensureLength(t),
            this.view.setInt8(this.offset, e),
            (this.offset += t));
        }
        writeInt16(e) {
          I(e, G.Int16, K.Int16, `Int16`);
          let t = B.Int16;
          (this.ensureLength(t),
            this.view.setInt16(this.offset, e),
            (this.offset += t));
        }
        writeInt32(e) {
          I(e, G.Int32, K.Int32, `Int32`);
          let t = B.Int32;
          (this.ensureLength(t),
            this.view.setInt32(this.offset, e),
            (this.offset += t));
        }
        writeInt64(e) {
          I(e, G.Int64, K.Int64, `Int64`);
          let t = BigInt(e);
          this.writeBigInt64(t);
        }
        writeBigInt64(e) {
          I(e, G.BigInt64, K.BigInt64, `BigInt64`);
          let t = B.BigInt64;
          (this.ensureLength(t),
            this.view.setBigInt64(this.offset, e),
            (this.offset += t));
        }
        writeFloat32(e) {
          let t = B.Float32;
          (this.ensureLength(t),
            this.view.setFloat32(this.offset, e),
            (this.offset += t));
        }
        writeFloat64(e) {
          let t = B.Float64;
          (this.ensureLength(t),
            this.view.setFloat64(this.offset, e),
            (this.offset += t));
        }
        writeBytes(e) {
          let t = e.length;
          (this.ensureLength(t),
            this.bytes.set(e, this.offset),
            (this.offset += t));
        }
        encodeString(e) {
          let t = this.encodedStrings.get(e);
          if (t) return t;
          let n = this.encoder.encode(e);
          return (this.encodedStrings.set(e, n), n);
        }
        writeString(e) {
          let t = this.encodeString(e),
            n = t.length;
          (this.writeUint32(n), this.writeBytes(t));
        }
        writeJson(e) {
          let t = JSON.stringify(e);
          this.writeString(t);
        }
        constructor() {
          (M(this, `offset`, 0),
            M(this, `bytes`, new Uint8Array(Kt)),
            M(this, `view`, Be(this.bytes)),
            M(this, `encoder`, new TextEncoder()),
            M(this, `encodedStrings`, new Map()));
        }
      }),
      (q = class e {
        static fromString(t) {
          let [n, r, i] = t.split(`/`).map(Number);
          return (
            P(L(n), `Invalid chunkId`),
            P(L(r), `Invalid offset`),
            P(L(i), `Invalid length`),
            new e(n, r, i)
          );
        }
        toString() {
          return `${this.chunkId}/${this.offset}/${this.length}`;
        }
        static read(t) {
          let n = t.readUint16(),
            r = t.readUint32(),
            i = t.readUint32();
          return new e(n, r, i);
        }
        write(e) {
          (e.writeUint16(this.chunkId),
            e.writeUint32(this.offset),
            e.writeUint32(this.length));
        }
        compare(e) {
          return this.chunkId < e.chunkId
            ? -1
            : this.chunkId > e.chunkId
              ? 1
              : this.offset < e.offset
                ? -1
                : this.offset > e.offset
                  ? 1
                  : (P(this.length === e.length), 0);
        }
        constructor(e, t, n) {
          (M(this, `chunkId`, void 0),
            M(this, `offset`, void 0),
            M(this, `length`, void 0),
            (this.chunkId = e),
            (this.offset = t),
            (this.length = n));
        }
      }),
      ((e) => {
        ((e.read = function (e) {
          let t = e.readUint8();
          switch (t) {
            case 0:
              return null;
            case 1:
              return Ue(e);
            case 2:
              return Ke(e);
            case 3:
              return Ye(e);
            case 4:
              return Qe(e);
            case 5:
              return tt(e);
            case 6:
              return it(e);
            case 7:
              return st(e);
            case 8:
              return ut(e);
            case 9:
              return pt(e);
            case 10:
              return gt(e);
            case 11:
              return yt(e);
            case 12:
              return St(e);
            case 13:
              return Tt(e);
            default:
              F(t);
          }
        }),
          (e.write = function (e, t) {
            let n = He(t);
            if ((e.writeUint8(n), !R(t)))
              switch (t.type) {
                case A.Array:
                  return We(e, t);
                case A.Boolean:
                  return qe(e, t);
                case A.Color:
                  return Xe(e, t);
                case A.Date:
                  return $e(e, t);
                case A.Enum:
                  return nt(e, t);
                case A.File:
                  return at(e, t);
                case A.Link:
                  return ct(e, t);
                case A.Number:
                  return dt(e, t);
                case A.Object:
                  return mt(e, t);
                case A.ResponsiveImage:
                  return _t(e, t);
                case A.RichText:
                  return bt(e, t);
                case A.VectorSetItem:
                  return Et(e, t);
                case A.String:
                  return Ct(e, t);
                default:
                  F(t);
              }
          }),
          (e.compare = function (e, t, n) {
            let r = He(e),
              i = He(t);
            if (r < i) return -1;
            if (r > i) return 1;
            if (R(e) || R(t)) return 0;
            switch (e.type) {
              case A.Array:
                return (P(t.type === A.Array), Ge(e, t, n));
              case A.Boolean:
                return (P(t.type === A.Boolean), Je(e, t));
              case A.Color:
                return (P(t.type === A.Color), Ze(e, t));
              case A.Date:
                return (P(t.type === A.Date), et(e, t));
              case A.Enum:
                return (P(t.type === A.Enum), rt(e, t));
              case A.File:
                return (P(t.type === A.File), ot(e, t));
              case A.Link:
                return (P(t.type === A.Link), lt(e, t));
              case A.Number:
                return (P(t.type === A.Number), ft(e, t));
              case A.Object:
                return (P(t.type === A.Object), ht(e, t, n));
              case A.ResponsiveImage:
                return (P(t.type === A.ResponsiveImage), vt(e, t));
              case A.RichText:
                return (P(t.type === A.RichText), xt(e, t));
              case A.VectorSetItem:
                return (P(t.type === A.VectorSetItem), Dt(e, t));
              case A.String:
                return (P(t.type === A.String), wt(e, t, n));
              default:
                F(e);
            }
          }));
      })((z ||= {})),
      (Yt = class e {
        sortEntries() {
          this.entries.sort((e, t) => {
            for (let n = 0; n < this.fieldNames.length; n++) {
              let r = e.values[n],
                i = t.values[n],
                a = z.compare(r, i, this.options.collation);
              if (a !== 0) return a;
            }
            return e.pointer.compare(t.pointer);
          });
        }
        static async deserialize(t, n) {
          let r = new V(t),
            i = r.readJson(),
            a = r.readUint8(),
            o = [];
          for (let e = 0; e < a; e++) {
            let e = r.readString();
            o.push(e);
          }
          let s = new e(o, { collation: i }),
            c = r.readUint32(),
            l = () => {
              let e = [];
              for (let t = 0; t < a; t++) {
                let t = z.read(r);
                e.push(t);
              }
              let t = q.read(r);
              s.entries.push({ values: e, pointer: t });
            };
          for (let e = 0; e < c; e++) {
            let e = n?.();
            (e && (await e), l());
          }
          return s;
        }
        serialize() {
          let e = new Jt();
          for (let t of (e.writeJson(this.options.collation),
          e.writeUint8(this.fieldNames.length),
          this.fieldNames))
            e.writeString(t);
          for (let t of (this.sortEntries(),
          e.writeUint32(this.entries.length),
          this.entries)) {
            let { values: n, pointer: r } = t;
            for (let t of n) z.write(e, t);
            r.write(e);
          }
          return e.subarray();
        }
        addItem(e, t) {
          let n = this.fieldNames.map((t) => e.getField(t) ?? null);
          this.entries.push({ values: n, pointer: t });
        }
        constructor(e, t) {
          (M(this, `fieldNames`, void 0),
            M(this, `options`, void 0),
            M(this, `entries`, []),
            (this.fieldNames = e),
            (this.options = t));
        }
      }),
      (Xt = 3),
      (Zt = 250),
      (Qt = [408, 429, 500, 502, 503, 504]),
      ($t = async (e, t) => {
        let n = 0;
        for (;;) {
          try {
            let r = await fetch(e, t);
            if (!Qt.includes(r.status) || ++n > Xt) return r;
          } catch (e) {
            if (t?.signal?.aborted || ++n > Xt) throw e;
          }
          await Ot(n);
        }
      }),
      (en = class {
        read(e, t) {
          for (let n of this.chunks) {
            if (e < n.start) break;
            if (e > n.end) continue;
            if (e + t > n.end) break;
            let r = e - n.start,
              i = r + t;
            return n.data.slice(r, i);
          }
          throw Error(`Missing data`);
        }
        write(e, t) {
          let n = e,
            r = n + t.length,
            i = 0,
            a = this.chunks.length;
          for (; i < a; i++) {
            let e = this.chunks[i];
            if ((P(e, `Missing chunk`), !(n > e.end))) {
              if (n > e.start) {
                let r = n - e.start;
                ((t = At(e.data.subarray(0, r), t)), (n = e.start));
              }
              break;
            }
          }
          for (; a > i; a--) {
            let e = this.chunks[a - 1];
            if ((P(e, `Missing chunk`), !(r < e.start))) {
              if (r < e.end) {
                let n = r - e.start,
                  i = e.data.subarray(n);
                ((t = At(t, i)), (r = e.end));
              }
              break;
            }
          }
          let o = { start: n, end: r, data: t },
            s = a - i;
          this.chunks.splice(i, s, o);
        }
        constructor() {
          M(this, `chunks`, []);
        }
      }),
      (J = class {
        async loadModel() {
          let [e] = await kt(this.options.url, [this.options.range]);
          return (
            P(e, `Failed to load model`),
            Yt.deserialize(e, () => {
              let e = ze(this.modelPrioritySources);
              return e ? E({ batch: !0, priority: e }) : void 0;
            })
          );
        }
        async getModel(e) {
          return (
            this.model ||
              (e && this.modelPrioritySources.add(e),
              (this.modelPromise ??= this.loadModel().finally(() => {
                this.modelPrioritySources.clear();
              })),
              (this.model ??= await this.modelPromise)),
            this.model
          );
        }
        async lookupItems(e, t) {
          P(e.length === this.fields.length, `Invalid query length`);
          let n = [(await this.getModel(t)).entries];
          for (let [r, i] of e.entries()) {
            let e = [];
            for (let a of n) {
              let n,
                o = t ? E({ batch: !0, priority: N(t) }) : void 0;
              switch ((o && (await o), i.type)) {
                case `All`:
                  n = [a];
                  break;
                case `Equals`:
                  n = this.queryEquals(a, i, r);
                  break;
                case `NotEquals`:
                  n = this.queryNotEquals(a, i, r);
                  break;
                case `LessThan`:
                  n = this.queryLessThan(a, i, r);
                  break;
                case `GreaterThan`:
                  n = this.queryGreaterThan(a, i, r);
                  break;
                case `Contains`:
                  n = await this.queryContains(a, i, r, t);
                  break;
                case `StartsWith`:
                  n = await this.queryStartsWith(a, i, r, t);
                  break;
                case `EndsWith`:
                  n = await this.queryEndsWith(a, i, r, t);
                  break;
                default:
                  F(i);
              }
              e.push(...n);
            }
            n = e;
          }
          let r = [];
          for (let e of n)
            for (let n of e) {
              let e = t ? E({ batch: !0, priority: N(t) }) : void 0;
              e && (await e);
              let i = {};
              for (let e = 0; e < this.options.fieldNames.length; e++) {
                let t = this.options.fieldNames[e];
                i[t] = n.values[e];
              }
              r.push({ pointer: n.pointer.toString(), data: i });
            }
          return r;
        }
        queryEquals(e, t, n) {
          let r = this.getLeftMost(e, n, t.value),
            i = this.getRightMost(e, n, t.value),
            a = e.slice(r, i + 1);
          return a.length > 0 ? [a] : [];
        }
        queryNotEquals(e, t, n) {
          let r = this.getLeftMost(e, n, t.value),
            i = this.getRightMost(e, n, t.value),
            a = [],
            o = e.slice(0, r);
          o.length > 0 && a.push(o);
          let s = e.slice(i + 1);
          return (s.length > 0 && a.push(s), a);
        }
        queryLessThan(e, t, n) {
          let r = this.getRightMost(e, n, null);
          if (((e = e.slice(r + 1)), t.inclusive)) {
            let r = this.getRightMost(e, n, t.value),
              i = e.slice(0, r + 1);
            return i.length > 0 ? [i] : [];
          }
          let i = this.getLeftMost(e, n, t.value),
            a = e.slice(0, i);
          return a.length > 0 ? [a] : [];
        }
        queryGreaterThan(e, t, n) {
          let r = this.getRightMost(e, n, null);
          if (((e = e.slice(r + 1)), t.inclusive)) {
            let r = this.getLeftMost(e, n, t.value),
              i = e.slice(r);
            return i.length > 0 ? [i] : [];
          }
          let i = this.getRightMost(e, n, t.value),
            a = e.slice(i + 1);
          return a.length > 0 ? [a] : [];
        }
        queryContains(e, t, n, r) {
          return this.findItems(e, n, r, (e) => {
            if (e?.type !== A.String || t.value?.type !== A.String) return !1;
            let n = e.value,
              r = t.value.value;
            return (
              this.collation.type === 0 &&
                ((n = n.toLowerCase()), (r = r.toLowerCase())),
              n.includes(r)
            );
          });
        }
        queryStartsWith(e, t, n, r) {
          return this.findItems(e, n, r, (e) => {
            if (e?.type !== A.String || t.value?.type !== A.String) return !1;
            let n = e.value,
              r = t.value.value;
            return (
              this.collation.type === 0 &&
                ((n = n.toLowerCase()), (r = r.toLowerCase())),
              n.startsWith(r)
            );
          });
        }
        queryEndsWith(e, t, n, r) {
          return this.findItems(e, n, r, (e) => {
            if (e?.type !== A.String || t.value?.type !== A.String) return !1;
            let n = e.value,
              r = t.value.value;
            return (
              this.collation.type === 0 &&
                ((n = n.toLowerCase()), (r = r.toLowerCase())),
              n.endsWith(r)
            );
          });
        }
        getLeftMost(e, t, n) {
          let r = 0,
            i = e.length;
          for (; r < i; ) {
            let a = (r + i) >> 1,
              o = e[a].values[t];
            0 > z.compare(o, n, this.collation) ? (r = a + 1) : (i = a);
          }
          return r;
        }
        getRightMost(e, t, n) {
          let r = 0,
            i = e.length;
          for (; r < i; ) {
            let a = (r + i) >> 1,
              o = e[a].values[t];
            z.compare(o, n, this.collation) > 0 ? (i = a) : (r = a + 1);
          }
          return i - 1;
        }
        async findItems(e, t, n, r) {
          let i = [],
            a = 0;
          for (let o = 0; o < e.length; o++) {
            let s = n ? E({ batch: !0, priority: N(n) }) : void 0;
            s && (await s);
            let c = e[o].values[t];
            if (!r(c)) {
              if (a < o) {
                let t = e.slice(a, o);
                i.push(t);
              }
              a = o + 1;
            }
          }
          if (a < e.length) {
            let t = e.slice(a);
            i.push(t);
          }
          return i;
        }
        constructor(e) {
          (M(this, `options`, void 0),
            M(this, `schema`, void 0),
            M(this, `fields`, void 0),
            M(this, `supportedLookupTypes`, [
              `All`,
              `Equals`,
              `NotEquals`,
              `LessThan`,
              `GreaterThan`,
              `Contains`,
              `StartsWith`,
              `EndsWith`,
            ]),
            M(this, `modelPromise`, void 0),
            M(this, `model`, void 0),
            M(this, `modelPrioritySources`, new Set()),
            M(this, `collation`, void 0),
            (this.options = e));
          let t = {},
            n = [];
          for (let e of this.options.fieldNames) {
            let r = this.options.collectionSchema[e];
            (P(r, `Missing definition for field`, e),
              (t[e] = r),
              n.push({ type: `Identifier`, name: e }));
          }
          ((this.schema = t),
            (this.fields = n),
            (this.collation = this.options.collation));
        }
      }),
      (tn = class {
        scanItems(e) {
          return (
            this.itemsPromise
              ? this.isScanning && e && this.scanPrioritySources.add(e)
              : ((this.isScanning = !0),
                e && this.scanPrioritySources.add(e),
                (this.itemsPromise = $t(this.url)
                  .then(async (e) => {
                    if (!e.ok)
                      throw Error(
                        `Request failed: ${e.status} ${e.statusText}`,
                      );
                    let t = await e.arrayBuffer(),
                      n = new V(new Uint8Array(t)),
                      r = [],
                      i = n.readUint32();
                    for (let e = 0; e < i; e++) {
                      let e = ze(this.scanPrioritySources),
                        t = e ? E({ batch: !0, priority: e }) : void 0;
                      t && (await t);
                      let i = n.getOffset(),
                        a = Mt(n),
                        o = n.getOffset() - i,
                        s = new q(this.id, i, o).toString(),
                        c = { pointer: s, data: a };
                      (this.itemLoader.prime(
                        { pointer: s, prioritySources: new Set() },
                        c,
                      ),
                        r.push(c));
                    }
                    return r;
                  })
                  .finally(() => {
                    ((this.isScanning = !1), this.scanPrioritySources.clear());
                  }))),
            this.itemsPromise
          );
        }
        resolveItem(e, t) {
          let n = this.itemPrioritySources.get(e);
          (n || ((n = new Set()), this.itemPrioritySources.set(e, n)),
            t && n.add(t));
          let r = this.itemLoader.load({ pointer: e, prioritySources: n }),
            i = () => this.itemPrioritySources.delete(e);
          return (r.then(i, i), r);
        }
        constructor(e, t) {
          (M(this, `id`, void 0),
            M(this, `url`, void 0),
            M(this, `itemsPromise`, void 0),
            M(this, `isScanning`, !1),
            M(this, `scanPrioritySources`, new Set()),
            M(this, `itemPrioritySources`, new Map()),
            M(
              this,
              `itemLoader`,
              new Wt.default(
                async (e) => {
                  let t = e.map(({ pointer: e }) => {
                      let t = q.fromString(e);
                      return { from: t.offset, to: t.offset + t.length };
                    }),
                    n = await kt(this.url, t),
                    r = [];
                  for (let t = 0; t < n.length; t++) {
                    let i = ze(Nt(e)),
                      a = i ? E({ batch: !0, priority: i }) : void 0;
                    a && (await a);
                    let o = n[t];
                    P(o, `Missing range bytes`);
                    let s = Mt(new V(o)),
                      c = e[t]?.pointer;
                    (P(c, `Missing pointer`), r.push({ pointer: c, data: s }));
                  }
                  return r;
                },
                { maxBatchSize: 250, cacheKeyFn: (e) => e.pointer },
              ),
            ),
            (this.id = e),
            (this.url = t));
        }
      }),
      (nn = class {
        async scanItems(e) {
          return (
            await Promise.all(this.chunks.map(async (t) => t.scanItems(e)))
          ).flat();
        }
        resolveItems(e, t) {
          return Promise.all(
            e.map((e) => {
              let n = q.fromString(e),
                r = this.chunks[n.chunkId];
              return (P(r, `Missing chunk`), r.resolveItem(e, t));
            }),
          );
        }
        compareItems(e, t) {
          let n = q.fromString(e.pointer),
            r = q.fromString(t.pointer);
          return n.compare(r);
        }
        compareValues(e, t, n) {
          return z.compare(e, t, n);
        }
        constructor(e) {
          (M(this, `options`, void 0),
            M(this, `id`, void 0),
            M(this, `schema`, void 0),
            M(this, `indexes`, void 0),
            M(this, `resolveRichText`, void 0),
            M(this, `resolveVectorSetItem`, void 0),
            M(this, `chunks`, void 0),
            (this.options = e),
            (this.chunks = this.options.chunks.map((e, t) => new tn(t, e))),
            (this.schema = e.schema),
            (this.indexes = e.indexes),
            (this.resolveRichText = e.resolveRichText),
            (this.resolveVectorSetItem = e.resolveVectorSetItem),
            (this.id = e.id));
        }
      }));
  });
function an(e) {
  return typeof e == `object` && !!e && !p(e) && cn in e;
}
function on(e, ...t) {
  if (!e)
    throw Error(`Assertion Error` + (t.length > 0 ? `: ` + t.join(` `) : ``));
}
function sn(e) {
  let t = new Map();
  return (r) => {
    let i = t.get(r);
    if (i) return i;
    let a = (function t(r) {
      switch (r[0]) {
        case 1: {
          let [, ...e] = r;
          return l(n, void 0, ...e.map(t));
        }
        case 2: {
          let [, e, ...n] = r;
          return l(ye, e, ...n.map(t));
        }
        case 3: {
          let [, n, i, a, o] = r;
          for (let e of a) {
            let n = i[e];
            n && (i[e] = t(n));
          }
          for (let t of o) {
            let n = i[t];
            if (typeof n != `string`) continue;
            let r = e[n];
            r && (an(r) && r.preload(), (i[t] = r));
          }
          let s = e[n];
          return (
            on(s, `Module not found`),
            an(s) && s.preload(),
            f(_e, {
              componentIdentifier: n,
              children: (e) => f(j, { component: s, props: { ...e, ...i } }),
            })
          );
        }
        case 4: {
          let [, e, n, ...i] = r,
            a = i.map(t);
          return l(e === `a` ? y.a : e, n, ...a);
        }
        case 5: {
          let [, e] = r;
          return e;
        }
      }
    })(JSON.parse(r));
    return (t.set(r, a), a);
  };
}
var Y,
  cn,
  ln,
  un = e(() => {
    (o(),
      m(),
      k(),
      _(),
      t !== void 0 && t.requestIdleCallback,
      (cn = `preload`),
      (ln =
        (((Y = ln || {})[(Y.Fragment = 1)] = `Fragment`),
        (Y[(Y.Link = 2)] = `Link`),
        (Y[(Y.Module = 3)] = `Module`),
        (Y[(Y.Tag = 4)] = `Tag`),
        (Y[(Y.Text = 5)] = `Text`),
        Y)));
  }),
  X,
  dn,
  Z,
  fn,
  pn,
  mn,
  hn,
  Q,
  gn,
  _n,
  vn,
  yn,
  bn,
  xn,
  Sn,
  Cn,
  wn,
  Tn,
  En,
  Dn,
  On,
  kn = e(() => {
    (k(),
      rn(),
      un(),
      (X = {
        bdZigAYKb: { isNullable: !0, type: A.Link },
        cdFVTx7jf: { isNullable: !0, type: A.String },
        createdAt: { isNullable: !0, type: A.Date },
        FoXBSKIDn: { isNullable: !0, type: A.String },
        gfbvmGqOZ: { isNullable: !0, type: A.String },
        HzlFyeKXO: {
          definition: { isNullable: !0, type: A.String },
          isNullable: !0,
          type: A.Array,
        },
        id: { isNullable: !1, type: A.String },
        J7n0yrAyS: { isNullable: !0, type: A.String },
        nextItemId: { isNullable: !0, type: A.String },
        previousItemId: { isNullable: !0, type: A.String },
        R140nkU9M: { isNullable: !0, type: A.String },
        updatedAt: { isNullable: !0, type: A.Date },
        Ux4DnKxmC: { isNullable: !0, type: A.Boolean },
        Xhx7P2pOw: { isNullable: !0, type: A.ResponsiveImage },
      }),
      (dn = [`id`]),
      (Z = { type: 1 }),
      (fn = [`previousItemId`]),
      (pn = [`nextItemId`]),
      (mn = [`id`, `gfbvmGqOZ`]),
      (hn = [`gfbvmGqOZ`, `id`]),
      (Q = { type: 0 }),
      (gn = [`R140nkU9M`]),
      (_n = [`HzlFyeKXO`]),
      (vn = [`Xhx7P2pOw`]),
      (yn = [`Ux4DnKxmC`]),
      (bn = [`gfbvmGqOZ`]),
      (xn = [`cdFVTx7jf`]),
      (Sn = [`FoXBSKIDn`]),
      (Cn = [`J7n0yrAyS`]),
      (wn = [`bdZigAYKb`]),
      (Tn = []),
      (En = (e) => {
        let t = Tn[e];
        if (t) return t().then((e) => e.default);
      }),
      (Dn = sn({})),
      new be(),
      (On = {
        collectionByLocaleId: {
          default: new nn({
            chunks: [
              new URL(
                `./hlx25L0cq-chunk-default-0.framercms`,
                `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
              ).href.replace(`/modules/`, `/cms/`),
            ],
            id: `41a4cfd1-397d-47a5-8150-7bc6a4e410a9default`,
            indexes: [
              new J({
                collation: Z,
                collectionSchema: X,
                fieldNames: dn,
                range: { from: 0, to: 385 },
                url: new URL(
                  `./hlx25L0cq-indexes-default-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Z,
                collectionSchema: X,
                fieldNames: fn,
                range: { from: 385, to: 769 },
                url: new URL(
                  `./hlx25L0cq-indexes-default-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Z,
                collectionSchema: X,
                fieldNames: pn,
                range: { from: 769, to: 1149 },
                url: new URL(
                  `./hlx25L0cq-indexes-default-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Z,
                collectionSchema: X,
                fieldNames: mn,
                range: { from: 1149, to: 1727 },
                url: new URL(
                  `./hlx25L0cq-indexes-default-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: hn,
                range: { from: 1727, to: 2305 },
                url: new URL(
                  `./hlx25L0cq-indexes-default-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: gn,
                range: { from: 2305, to: 2667 },
                url: new URL(
                  `./hlx25L0cq-indexes-default-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: _n,
                range: { from: 2667, to: 3084 },
                url: new URL(
                  `./hlx25L0cq-indexes-default-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: vn,
                range: { from: 3084, to: 8332 },
                url: new URL(
                  `./hlx25L0cq-indexes-default-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: yn,
                range: { from: 8332, to: 8544 },
                url: new URL(
                  `./hlx25L0cq-indexes-default-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: bn,
                range: { from: 8544, to: 8906 },
                url: new URL(
                  `./hlx25L0cq-indexes-default-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: xn,
                range: { from: 8906, to: 9205 },
                url: new URL(
                  `./hlx25L0cq-indexes-default-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: Sn,
                range: { from: 9205, to: 9479 },
                url: new URL(
                  `./hlx25L0cq-indexes-default-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: Cn,
                range: { from: 9479, to: 9807 },
                url: new URL(
                  `./hlx25L0cq-indexes-default-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: wn,
                range: { from: 9807, to: 10160 },
                url: new URL(
                  `./hlx25L0cq-indexes-default-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
            ],
            resolveRichText: Dn,
            resolveVectorSetItem: En,
            schema: X,
          }),
          i8jJ5DBja: new nn({
            chunks: [
              new URL(
                `./hlx25L0cq-chunk-i8jJ5DBja-0.framercms`,
                `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
              ).href.replace(`/modules/`, `/cms/`),
            ],
            id: `41a4cfd1-397d-47a5-8150-7bc6a4e410a9i8jJ5DBja`,
            indexes: [
              new J({
                collation: Z,
                collectionSchema: X,
                fieldNames: dn,
                range: { from: 0, to: 385 },
                url: new URL(
                  `./hlx25L0cq-indexes-i8jJ5DBja-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Z,
                collectionSchema: X,
                fieldNames: fn,
                range: { from: 385, to: 769 },
                url: new URL(
                  `./hlx25L0cq-indexes-i8jJ5DBja-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Z,
                collectionSchema: X,
                fieldNames: pn,
                range: { from: 769, to: 1149 },
                url: new URL(
                  `./hlx25L0cq-indexes-i8jJ5DBja-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Z,
                collectionSchema: X,
                fieldNames: mn,
                range: { from: 1149, to: 1727 },
                url: new URL(
                  `./hlx25L0cq-indexes-i8jJ5DBja-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: hn,
                range: { from: 1727, to: 2305 },
                url: new URL(
                  `./hlx25L0cq-indexes-i8jJ5DBja-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: gn,
                range: { from: 2305, to: 2667 },
                url: new URL(
                  `./hlx25L0cq-indexes-i8jJ5DBja-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: _n,
                range: { from: 2667, to: 3084 },
                url: new URL(
                  `./hlx25L0cq-indexes-i8jJ5DBja-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: vn,
                range: { from: 3084, to: 8332 },
                url: new URL(
                  `./hlx25L0cq-indexes-i8jJ5DBja-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: yn,
                range: { from: 8332, to: 8544 },
                url: new URL(
                  `./hlx25L0cq-indexes-i8jJ5DBja-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: bn,
                range: { from: 8544, to: 8906 },
                url: new URL(
                  `./hlx25L0cq-indexes-i8jJ5DBja-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: xn,
                range: { from: 8906, to: 9205 },
                url: new URL(
                  `./hlx25L0cq-indexes-i8jJ5DBja-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: Sn,
                range: { from: 9205, to: 9479 },
                url: new URL(
                  `./hlx25L0cq-indexes-i8jJ5DBja-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: Cn,
                range: { from: 9479, to: 9807 },
                url: new URL(
                  `./hlx25L0cq-indexes-i8jJ5DBja-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
              new J({
                collation: Q,
                collectionSchema: X,
                fieldNames: wn,
                range: { from: 9807, to: 10160 },
                url: new URL(
                  `./hlx25L0cq-indexes-i8jJ5DBja-0.framercms`,
                  `http://localhost:8137/assets/framerusercontent.com/modules/UhgO8mRy1zw3DAizA2vT/Yb1bZoVIFQyVsjbRI7J6/hlx25L0cq.js`,
                ).href.replace(`/modules/`, `/cms/`),
              }),
            ],
            resolveRichText: Dn,
            resolveVectorSetItem: En,
            schema: X,
          }),
        },
        displayName: `Veine Customers`,
        id: `41a4cfd1-397d-47a5-8150-7bc6a4e410a9`,
      }),
      T(On, {
        R140nkU9M: { defaultValue: ``, title: `Title`, type: A.String },
        HzlFyeKXO: {
          dataIdentifier: `local-module:collection/XKtIB7oXW:default`,
          title: `Products`,
          type: A.MultiCollectionReference,
        },
        Xhx7P2pOw: { title: `Logo`, type: A.ResponsiveImage },
        Ux4DnKxmC: {
          defaultValue: !1,
          title: `Logo Shape Wide?`,
          type: A.Boolean,
        },
        gfbvmGqOZ: { preventLocalization: !1, title: `Slug`, type: A.String },
        cdFVTx7jf: { defaultValue: ``, title: `Revenue`, type: A.String },
        FoXBSKIDn: { defaultValue: ``, title: `Employee`, type: A.String },
        J7n0yrAyS: { defaultValue: ``, title: `Industry`, type: A.String },
        bdZigAYKb: { title: `Customer Website`, type: A.Link },
        createdAt: { title: `Created`, type: A.Date },
        updatedAt: { title: `Updated`, type: A.Date },
        previousItemId: {
          dataIdentifier: `local-module:collection/hlx25L0cq:default`,
          title: `Previous`,
          type: A.CollectionReference,
        },
        nextItemId: {
          dataIdentifier: `local-module:collection/hlx25L0cq:default`,
          title: `Next`,
          type: A.CollectionReference,
        },
      }));
  }),
  An,
  jn,
  Mn,
  Nn = e(() => {
    (k(),
      te.loadFonts([
        `GF;Stack Sans Headline-regular`,
        `Inter-Black`,
        `Inter-BlackItalic`,
        `Inter-BoldItalic`,
      ]),
      (An = [
        {
          explicitInter: !0,
          fonts: [
            {
              cssFamilyName: `Stack Sans Headline`,
              openType: !0,
              source: `google`,
              style: `normal`,
              uiFamilyName: `Stack Sans Headline`,
              url: `http://localhost:8137/assets/fonts.gstatic.com/s/stacksansheadline/v1/1PtFg9jZXvmMnkLnuURbaukKZJTyrDV326uH6mSinjBIwc5tIgFCqgUA3ZCX.woff2`,
              weight: `400`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `normal`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/mkY5Sgyq51ik0AMrSBwhm9DJg.woff2`,
              weight: `900`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `normal`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/X5hj6qzcHUYv7h1390c8Rhm6550.woff2`,
              weight: `900`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `normal`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+1F00-1FFF`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/gQhNpS3tN86g8RcVKYUUaKt2oMQ.woff2`,
              weight: `900`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `normal`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0370-03FF`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/cugnVhSraaRyANCaUtI5FV17wk.woff2`,
              weight: `900`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `normal`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/5HcVoGak8k5agFJSaKa4floXVu0.woff2`,
              weight: `900`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `normal`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2070, U+2074-207E, U+2080-208E, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/rZ5DdENNqIdFTIyQQiP5isO7M.woff2`,
              weight: `900`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `normal`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+1EA0-1EF9, U+20AB`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/P2Bw01CtL0b9wqygO0sSVogWbo.woff2`,
              weight: `900`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `italic`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/05KsVHGDmqXSBXM4yRZ65P8i0s.woff2`,
              weight: `900`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `italic`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/ky8ovPukK4dJ1Pxq74qGhOqCYI.woff2`,
              weight: `900`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `italic`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+1F00-1FFF`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/vvNSqIj42qeQ2bvCRBIWKHscrc.woff2`,
              weight: `900`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `italic`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0370-03FF`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/3ZmXbBKToJifDV9gwcifVd1tEY.woff2`,
              weight: `900`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `italic`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/FNfhX3dt4ChuLJq2PwdlxHO7PU.woff2`,
              weight: `900`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `italic`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2070, U+2074-207E, U+2080-208E, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/gcnfba68tfm7qAyrWRCf9r34jg.woff2`,
              weight: `900`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `italic`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+1EA0-1EF9, U+20AB`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/efTfQcBJ53kM2pB1hezSZ3RDUFs.woff2`,
              weight: `900`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `italic`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/H89BbHkbHDzlxZzxi8uPzTsp90.woff2`,
              weight: `700`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `italic`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/u6gJwDuwB143kpNK1T1MDKDWkMc.woff2`,
              weight: `700`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `italic`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+1F00-1FFF`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/43sJ6MfOPh1LCJt46OvyDuSbA6o.woff2`,
              weight: `700`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `italic`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0370-03FF`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/wccHG0r4gBDAIRhfHiOlq6oEkqw.woff2`,
              weight: `700`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `italic`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/WZ367JPwf9bRW6LdTHN8rXgSjw.woff2`,
              weight: `700`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `italic`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2070, U+2074-207E, U+2080-208E, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/ia3uin3hQWqDrVloC1zEtYHWw.woff2`,
              weight: `700`,
            },
            {
              cssFamilyName: `Inter`,
              source: `framer`,
              style: `italic`,
              uiFamilyName: `Inter`,
              unicodeRange: `U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+1EA0-1EF9, U+20AB`,
              url: `http://localhost:8137/assets/framerusercontent.com/assets/2A4Xx7CngadFGlVV4xrO06OBHY.woff2`,
              weight: `700`,
            },
          ],
        },
      ]),
      (jn = [
        `.framer-YnZBx .framer-styles-preset-prv244:not(.rich-text-wrapper), .framer-YnZBx .framer-styles-preset-prv244.rich-text-wrapper h3 { --framer-font-family: "Stack Sans Headline", "Stack Sans Headline Placeholder", sans-serif; --framer-font-family-bold: "Inter", "Inter Placeholder", sans-serif; --framer-font-family-bold-italic: "Inter", "Inter Placeholder", sans-serif; --framer-font-family-italic: "Inter", "Inter Placeholder", sans-serif; --framer-font-open-type-features: 'ss04' on, 'ss11' on; --framer-font-size: 30px; --framer-font-style: normal; --framer-font-style-bold: normal; --framer-font-style-bold-italic: italic; --framer-font-style-italic: italic; --framer-font-variation-axes: normal; --framer-font-weight: 400; --framer-font-weight-bold: 900; --framer-font-weight-bold-italic: 900; --framer-font-weight-italic: 700; --framer-letter-spacing: 0em; --framer-line-height: 38px; --framer-paragraph-spacing: 30px; --framer-text-alignment: start; --framer-text-color: var(--token-e74bddf3-bb42-4096-a361-48bbdc0282c9, #1a1814); --framer-text-decoration: none; --framer-text-stroke-color: initial; --framer-text-stroke-width: initial; --framer-text-transform: none; }`,
        `@media (max-width: 1199px) and (min-width: 810px) { .framer-YnZBx .framer-styles-preset-prv244:not(.rich-text-wrapper), .framer-YnZBx .framer-styles-preset-prv244.rich-text-wrapper h3 { --framer-font-family: "Stack Sans Headline", "Stack Sans Headline Placeholder", sans-serif; --framer-font-family-bold: "Inter", "Inter Placeholder", sans-serif; --framer-font-family-bold-italic: "Inter", "Inter Placeholder", sans-serif; --framer-font-family-italic: "Inter", "Inter Placeholder", sans-serif; --framer-font-open-type-features: 'ss04' on, 'ss11' on; --framer-font-size: 26px; --framer-font-style: normal; --framer-font-style-bold: normal; --framer-font-style-bold-italic: italic; --framer-font-style-italic: italic; --framer-font-variation-axes: normal; --framer-font-weight: 400; --framer-font-weight-bold: 900; --framer-font-weight-bold-italic: 900; --framer-font-weight-italic: 700; --framer-letter-spacing: 0em; --framer-line-height: 30px; --framer-paragraph-spacing: 28px; --framer-text-alignment: start; --framer-text-color: var(--token-e74bddf3-bb42-4096-a361-48bbdc0282c9, #1a1814); --framer-text-decoration: none; --framer-text-stroke-color: initial; --framer-text-stroke-width: initial; --framer-text-transform: none; } }`,
        `@media (max-width: 809px) and (min-width: 0px) { .framer-YnZBx .framer-styles-preset-prv244:not(.rich-text-wrapper), .framer-YnZBx .framer-styles-preset-prv244.rich-text-wrapper h3 { --framer-font-family: "Stack Sans Headline", "Stack Sans Headline Placeholder", sans-serif; --framer-font-family-bold: "Inter", "Inter Placeholder", sans-serif; --framer-font-family-bold-italic: "Inter", "Inter Placeholder", sans-serif; --framer-font-family-italic: "Inter", "Inter Placeholder", sans-serif; --framer-font-open-type-features: 'ss04' on, 'ss11' on; --framer-font-size: 24px; --framer-font-style: normal; --framer-font-style-bold: normal; --framer-font-style-bold-italic: italic; --framer-font-style-italic: italic; --framer-font-variation-axes: normal; --framer-font-weight: 400; --framer-font-weight-bold: 900; --framer-font-weight-bold-italic: 900; --framer-font-weight-italic: 700; --framer-letter-spacing: 0em; --framer-line-height: 28px; --framer-paragraph-spacing: 26px; --framer-text-alignment: start; --framer-text-color: var(--token-e74bddf3-bb42-4096-a361-48bbdc0282c9, #1a1814); --framer-text-decoration: none; --framer-text-stroke-color: initial; --framer-text-stroke-width: initial; --framer-text-transform: none; } }`,
      ]),
      (Mn = `framer-YnZBx`));
  });
function Pn(e, t) {
  for (; t; ) {
    let n = Ln[t.id];
    if (n && n.status === `fulfilled`) {
      let t = n.read()[e];
      if (t) return t;
    }
    t = t.fallback;
  }
}
function Fn(e) {
  let t = [];
  for (; e; ) {
    let n = Ln[e.id];
    if (n) {
      let e = n.preload();
      e && t.push(e);
    }
    e = e.fallback;
  }
  if (t.length > 0) return Promise.all(t);
}
function In(e) {
  let t = Fn(e);
  if (t) throw t;
}
var Ln,
  Rn = e(() => {
    (k(),
      (Ln = { i8jJ5DBja: new de(() => import(`./Ll7zqaDS3-0.D9IanTk0.mjs`)) }));
  });
function zn(e, ...t) {
  let n = {};
  return (t?.forEach((t) => t && Object.assign(n, e[t])), n);
}
var Bn,
  Vn,
  Hn,
  Un,
  Wn,
  Gn,
  Kn,
  qn,
  Jn,
  Yn,
  Xn,
  Zn,
  Qn,
  $n,
  er,
  tr,
  nr,
  rr,
  $,
  ir = e(() => {
    (m(),
      k(),
      C(),
      _(),
      Le(),
      kn(),
      xe(),
      je(),
      Nn(),
      Te(),
      Rn(),
      ke(),
      (Bn = ge(Fe)),
      (Vn = ge(Ae)),
      (Hn = [`TEPMElblM`, `yFktZvadT`]),
      (Un = `framer-aXbP6`),
      (Wn = { TEPMElblM: `framer-v-13xtbob`, yFktZvadT: `framer-v-15qwt3n` }),
      (Gn = (e) => {
        if (typeof e != `number`) return e;
        if (Number.isFinite(e)) return Math.max(0, e) + `px`;
      }),
      (Kn = { bounce: 0.2, delay: 0, duration: 0.4, type: `spring` }),
      (qn = (e) =>
        typeof e == `object` && e && typeof e.src == `string`
          ? e
          : typeof e == `string`
            ? { src: e }
            : void 0),
      (Jn = (e) => !e),
      (Yn = (e, t) =>
        typeof e == `string` && typeof t == `string`
          ? e.toLowerCase() === t.toLowerCase()
          : e === t),
      (Xn = (e) => ({
        from: { alias: `wP7CTAOpv`, data: On, type: `Collection` },
        limit: { type: `LiteralValue`, value: 1 },
        select: [
          { collection: `wP7CTAOpv`, name: `Ux4DnKxmC`, type: `Identifier` },
          { collection: `wP7CTAOpv`, name: `Xhx7P2pOw`, type: `Identifier` },
          { collection: `wP7CTAOpv`, name: `gfbvmGqOZ`, type: `Identifier` },
          { collection: `wP7CTAOpv`, name: `id`, type: `Identifier` },
        ],
        where: {
          left: { collection: `wP7CTAOpv`, name: `id`, type: `Identifier` },
          operator: `==`,
          right: { type: `LiteralValue`, value: e },
          type: `BinaryOperation`,
        },
      })),
      (Zn = ({ query: e, pageSize: t, children: n }) => n(O(e))),
      (Qn = (...e) => {
        for (let t of e) if (t && typeof t == `string`) return t;
      }),
      ($n = ({ value: e, children: t }) => {
        let n = u(S),
          r = e ?? n.transition,
          a = i(() => ({ ...n, transition: r }), [JSON.stringify(r)]);
        return f(S.Provider, { value: a, children: t });
      }),
      (er = { "Case Study": `yFktZvadT`, Desktop: `TEPMElblM` }),
      (tr = y.create(n)),
      (nr = ({
        authorName: e,
        authorTitle: t,
        bGImage: n,
        bigText: r,
        height: i,
        id: a,
        link: o,
        padding: s,
        selectCompany: c,
        text: l,
        width: u,
        ...d
      }) => ({
        ...d,
        dvjYla65d: n ??
          d.dvjYla65d ?? {
            alt: ``,
            pixelHeight: 600,
            pixelWidth: 1146,
            src: `http://localhost:8137/assets/framerusercontent.com/images/LY1UxMQYpS7cBLOkNwCW2j1RFmk__qf8c98091.png`,
            srcSet: `http://localhost:8137/assets/framerusercontent.com/images/LY1UxMQYpS7cBLOkNwCW2j1RFmk__qa1cb472d.png 512w,http://localhost:8137/assets/framerusercontent.com/images/LY1UxMQYpS7cBLOkNwCW2j1RFmk__qf658139c.png 1024w,http://localhost:8137/assets/framerusercontent.com/images/LY1UxMQYpS7cBLOkNwCW2j1RFmk__qf8c98091.png 1146w`,
          },
        kswcavPsI:
          l ??
          d.kswcavPsI ??
          `"Seven touchpoints, one picture of the market . This clarity is what got us from zero to 150 customers."`,
        MUQ_8gRel: t ?? d.MUQ_8gRel ?? `Co-Founder at Gainback`,
        nDf9Ho4Rh: s ?? d.nDf9Ho4Rh ?? `40px`,
        PtzrDOzDp: c ?? d.PtzrDOzDp ?? `Qdj2aZL47`,
        variant: er[d.variant] ?? d.variant ?? `TEPMElblM`,
        xWvEJUYkK: o ?? d.xWvEJUYkK,
        zdcOUHZu4: r ?? d.zdcOUHZu4 ?? `8x`,
        zzaL0af_O: e ?? d.zzaL0af_O ?? `Talan Aminoff`,
      })),
      (rr = (e, t) =>
        e.layoutDependency ? t.join(`-`) + e.layoutDependency : t.join(`-`)),
      ($ = ie(
        s(function (e, t) {
          let r = d(null),
            i = t ?? r,
            a = v(),
            { activeLocale: o, setLocale: s } = ce(),
            l = fe(),
            {
              style: u,
              className: p,
              layoutId: m,
              variant: g,
              zdcOUHZu4: _,
              kswcavPsI: b,
              zzaL0af_O: S,
              MUQ_8gRel: C,
              dvjYla65d: te,
              nDf9Ho4Rh: ne,
              xWvEJUYkK: ie,
              PtzrDOzDp: ae,
              ...T
            } = nr(e),
            {
              baseVariant: E,
              classNames: le,
              clearLoadingGesture: D,
              gestureHandlers: de,
              gestureVariant: O,
              isLoading: k,
              setGestureState: ge,
              setVariant: _e,
              variants: A,
            } = re({
              cycleOrder: Hn,
              defaultVariant: `TEPMElblM`,
              ref: i,
              variant: g,
              variantClassNames: Wn,
            }),
            j = rr(e, A),
            ve = oe(Un, Pe, Mn, we, Oe);
          In(o);
          let ye = () => E !== `yFktZvadT`,
            be = () => E === `yFktZvadT`;
          return f(x, {
            id: m ?? a,
            children: f(tr, {
              animate: A,
              initial: !1,
              children: f($n, {
                value: Kn,
                children: h(y.div, {
                  ...T,
                  ...de,
                  className: oe(ve, `framer-13xtbob`, p, le),
                  "data-framer-name": `Desktop`,
                  layoutDependency: j,
                  layoutId: `TEPMElblM`,
                  ref: i,
                  style: {
                    "--432e23": Gn(ne),
                    backgroundColor: `rgb(255, 255, 255)`,
                    borderBottomLeftRadius: 16,
                    borderBottomRightRadius: 16,
                    borderTopLeftRadius: 16,
                    borderTopRightRadius: 16,
                    boxShadow: `0px 0px 0px 1px rgba(0, 0, 0, 0.08), 0px 1px 2px 0px rgba(36, 36, 36, 0.04)`,
                    ...u,
                  },
                  ...zn(
                    { yFktZvadT: { "data-framer-name": `Case Study` } },
                    E,
                    O,
                  ),
                  children: [
                    f(me, {
                      background: {
                        alt: ``,
                        fit: `fill`,
                        loading: ue((l?.y || 0) + 0),
                        pixelHeight: 600,
                        pixelWidth: 1146,
                        sizes: l?.width || `100vw`,
                        ...qn(te),
                      },
                      className: `framer-10yl4gz`,
                      "data-framer-name": `image 20`,
                      layoutDependency: j,
                      layoutId: `uIoG4PYmJ`,
                    }),
                    f(y.div, {
                      className: `framer-1o7j30v`,
                      "data-framer-name": `Wrapper`,
                      layoutDependency: j,
                      layoutId: `lrIB4dQem`,
                      style: {
                        background: `linear-gradient(180deg, rgba(26, 24, 20, 0.24) 0%, rgb(26, 24, 20) 100%)`,
                      },
                    }),
                    h(y.div, {
                      className: `framer-9tf5e6`,
                      layoutDependency: j,
                      layoutId: `vQcqixLVW`,
                      children: [
                        f(y.div, {
                          className: `framer-4m342c`,
                          layoutDependency: j,
                          layoutId: `wP7CTAOpv`,
                          children: f(he, {
                            children: f(Zn, {
                              query: Xn(ae),
                              children: (e, t, r) => {
                                let i = e?.length ?? 0,
                                  a = Yn(i, 0);
                                return h(c, {
                                  children: [
                                    e?.map(
                                      (
                                        {
                                          gfbvmGqOZ: e,
                                          id: t,
                                          Ux4DnKxmC: n,
                                          Xhx7P2pOw: r,
                                        },
                                        i,
                                      ) => {
                                        ((n ??= !0), (e ??= ``));
                                        let a = Jn(n);
                                        return f(
                                          x,
                                          {
                                            id: `wP7CTAOpv-${t}`,
                                            children: f(se.Provider, {
                                              value: { gfbvmGqOZ: e },
                                              children: h(y.div, {
                                                className: `framer-5ms081`,
                                                layoutDependency: j,
                                                layoutId: `WvJJersOq`,
                                                children: [
                                                  a !== !1 &&
                                                    f(me, {
                                                      background: {
                                                        alt: ``,
                                                        fit: `fill`,
                                                        sizes: `288px`,
                                                        ...qn(r),
                                                      },
                                                      className: `framer-uewkiv`,
                                                      fitImageDimension: `width`,
                                                      layoutDependency: j,
                                                      layoutId: `XWiunC5JF`,
                                                    }),
                                                  n !== !1 &&
                                                    f(me, {
                                                      background: {
                                                        alt: ``,
                                                        fit: `fill`,
                                                        sizes: `288px`,
                                                        ...qn(r),
                                                      },
                                                      className: `framer-a7gv32`,
                                                      fitImageDimension: `width`,
                                                      layoutDependency: j,
                                                      layoutId: `PMLBmmQzo`,
                                                    }),
                                                ],
                                              }),
                                            }),
                                          },
                                          t,
                                        );
                                      },
                                    ),
                                    a !== !1 &&
                                      f(y.div, {
                                        className: `framer-1g0jtka`,
                                        "data-border": !0,
                                        "data-framer-name": `Empty State`,
                                        layoutDependency: j,
                                        layoutId: `DEqFJFq7q`,
                                        style: {
                                          "--border-bottom-width": `1px`,
                                          "--border-color": `rgba(136, 136, 136, 0.2)`,
                                          "--border-left-width": `1px`,
                                          "--border-right-width": `1px`,
                                          "--border-style": `dashed`,
                                          "--border-top-width": `1px`,
                                          backgroundColor: `rgba(204, 204, 204, 0.2)`,
                                          borderBottomLeftRadius: 20,
                                          borderBottomRightRadius: 20,
                                          borderTopLeftRadius: 20,
                                          borderTopRightRadius: 20,
                                        },
                                        children: f(w, {
                                          __fromCanvasComponent: !0,
                                          children:
                                            Pn(`v0`, o) ??
                                            f(n, {
                                              children: f(y.p, {
                                                dir: `auto`,
                                                style: {
                                                  "--framer-text-color": `var(--extracted-r6o4lv, rgb(153, 153, 153))`,
                                                },
                                                children: `No items`,
                                              }),
                                            }),
                                          className: `framer-1l8mj5u`,
                                          fonts: [`Inter`],
                                          layoutDependency: j,
                                          layoutId: `isO7GpVqc`,
                                          style: {
                                            "--extracted-r6o4lv": `rgb(153, 153, 153)`,
                                          },
                                          verticalAlignment: `top`,
                                          withExternalLayout: !0,
                                        }),
                                      }),
                                  ],
                                });
                              },
                            }),
                          }),
                        }),
                        ye() &&
                          f(pe, {
                            children: f(ee, {
                              className: `framer-mh7fv2-container`,
                              isAuthoredByUser: !0,
                              layoutDependency: j,
                              layoutId: `EB2RW5Hr_-container`,
                              nodeId: `EB2RW5Hr_`,
                              rendersWithMotion: !0,
                              scopeId: `Ll7zqaDS3`,
                              children: f(Fe, {
                                animationTime: 0.5,
                                autoStart: !0,
                                bgColor: `rgba(0, 0, 0, 0)`,
                                blurStrength: 2,
                                characterDelay: 0.1,
                                content: _,
                                fontColor: `var(--token-e9be535d-6f70-4886-acdd-908c9afdb72f, rgb(255, 255, 255))`,
                                height: `100%`,
                                id: `EB2RW5Hr_`,
                                layoutId: `EB2RW5Hr_`,
                                repeatCount: 4,
                                rollPattern: `sequential`,
                                startDelay: 0,
                                typography: {
                                  fontFamily: `"ABC Favorit Trial Book", "ABC Favorit Trial Book Placeholder", sans-serif`,
                                  fontFeatureSettings: `'ss11' on`,
                                  fontSize: `80px`,
                                  fontStyle: `normal`,
                                  fontWeight: 350,
                                  letterSpacing: `-0.03em`,
                                  lineHeight: `1.1%`,
                                },
                                width: `100%`,
                              }),
                            }),
                          }),
                      ],
                    }),
                    h(y.div, {
                      className: `framer-1otsgct`,
                      layoutDependency: j,
                      layoutId: `uHpPnqgPV`,
                      children: [
                        f(w, {
                          __fromCanvasComponent: !0,
                          children: f(n, {
                            children: f(y.h3, {
                              className: `framer-styles-preset-qrrgmu`,
                              "data-styles-preset": `Jj3fhNusN`,
                              dir: `auto`,
                              style: {
                                "--framer-text-color": `var(--extracted-a0htzi, var(--token-e9be535d-6f70-4886-acdd-908c9afdb72f, rgb(255, 255, 255)))`,
                              },
                              children: `“Less time from raw responses to prioritized action.”`,
                            }),
                          }),
                          className: `framer-1fg0nj`,
                          "data-framer-name": `“Less time from raw responses to prioritized action.”`,
                          fonts: [`Inter`],
                          layoutDependency: j,
                          layoutId: `t6Yk80CKO`,
                          style: {
                            "--extracted-a0htzi": `var(--token-e9be535d-6f70-4886-acdd-908c9afdb72f, rgb(255, 255, 255))`,
                            "--framer-paragraph-spacing": `0px`,
                          },
                          text: b,
                          verticalAlignment: `top`,
                          withExternalLayout: !0,
                          ...zn(
                            {
                              yFktZvadT: {
                                children: f(n, {
                                  children: f(y.h3, {
                                    className: `framer-styles-preset-prv244`,
                                    "data-styles-preset": `MjNG3Hkg4`,
                                    dir: `auto`,
                                    style: {
                                      "--framer-text-color": `var(--extracted-a0htzi, var(--token-e9be535d-6f70-4886-acdd-908c9afdb72f, rgb(255, 255, 255)))`,
                                    },
                                    children: `"Seven touchpoints, one picture of the market . This clarity is what got us from zero to 150 customers."`,
                                  }),
                                }),
                              },
                            },
                            E,
                            O,
                          ),
                        }),
                        be() &&
                          f(pe, {
                            ...zn({ yFktZvadT: { height: 40 } }, E, O),
                            children: f(ee, {
                              className: `framer-1wcecyc-container`,
                              layoutDependency: j,
                              layoutId: `Ecrq86SSf-container`,
                              nodeId: `Ecrq86SSf`,
                              rendersWithMotion: !0,
                              scopeId: `Ll7zqaDS3`,
                              children: f(Ae, {
                                AsKz8VEWU: Pn(`v1`, o) ?? `Visit Website`,
                                height: `100%`,
                                id: `Ecrq86SSf`,
                                jDbiQ7JsS: ie,
                                layoutId: `Ecrq86SSf`,
                                variant: Qn(`Smt45cZ9q`),
                                width: `100%`,
                              }),
                            }),
                          }),
                        ye() &&
                          f(y.div, {
                            className: `framer-1752rym`,
                            "data-framer-name": `Row`,
                            layoutDependency: j,
                            layoutId: `j86nI3mVX`,
                            children: h(y.div, {
                              className: `framer-dzhe85`,
                              "data-framer-name": `Column`,
                              layoutDependency: j,
                              layoutId: `SInr8vSWs`,
                              children: [
                                f(w, {
                                  __fromCanvasComponent: !0,
                                  children: f(n, {
                                    children: f(y.p, {
                                      className: `framer-styles-preset-9hd9gv`,
                                      "data-styles-preset": `C9QVuNHI_`,
                                      dir: `auto`,
                                      style: {
                                        "--framer-text-color": `var(--extracted-r6o4lv, var(--token-e9be535d-6f70-4886-acdd-908c9afdb72f, rgb(255, 255, 255)))`,
                                      },
                                      children: `Talan Aminoff`,
                                    }),
                                  }),
                                  className: `framer-1ir264s`,
                                  "data-framer-name": `Talan Aminoff`,
                                  fonts: [`Inter`],
                                  layoutDependency: j,
                                  layoutId: `BoGkrL6bI`,
                                  style: {
                                    "--extracted-r6o4lv": `var(--token-e9be535d-6f70-4886-acdd-908c9afdb72f, rgb(255, 255, 255))`,
                                    "--framer-paragraph-spacing": `0px`,
                                  },
                                  text: S,
                                  verticalAlignment: `top`,
                                  withExternalLayout: !0,
                                }),
                                f(w, {
                                  __fromCanvasComponent: !0,
                                  children: f(n, {
                                    children: f(y.p, {
                                      className: `framer-styles-preset-13rs7ts`,
                                      "data-styles-preset": `QVrDLad_P`,
                                      dir: `auto`,
                                      style: {
                                        "--framer-text-color": `var(--extracted-r6o4lv, var(--token-e9be535d-6f70-4886-acdd-908c9afdb72f, rgb(255, 255, 255)))`,
                                      },
                                      children: `CTO at Sportifive`,
                                    }),
                                  }),
                                  className: `framer-osbqyb`,
                                  "data-framer-name": `CTO at Sportifive`,
                                  fonts: [`Inter`],
                                  layoutDependency: j,
                                  layoutId: `tZQs_eDhq`,
                                  style: {
                                    "--extracted-r6o4lv": `var(--token-e9be535d-6f70-4886-acdd-908c9afdb72f, rgb(255, 255, 255))`,
                                    "--framer-paragraph-spacing": `0px`,
                                    opacity: 0.5,
                                  },
                                  text: C,
                                  verticalAlignment: `top`,
                                  withExternalLayout: !0,
                                }),
                              ],
                            }),
                          }),
                      ],
                    }),
                  ],
                }),
              }),
            }),
          });
        }),
        [
          `.framer-aXbP6.framer-qw59u, .framer-aXbP6 .framer-qw59u { display: block; }`,
          `.framer-aXbP6.framer-13xtbob { align-content: flex-start; align-items: flex-start; display: flex; flex-direction: column; flex-wrap: nowrap; height: 492px; justify-content: space-between; overflow: var(--overflow-clip-fallback, clip); padding: var(--432e23); position: relative; width: 500px; will-change: var(--framer-will-change-override, transform); }`,
          `.framer-aXbP6 .framer-10yl4gz, .framer-aXbP6 .framer-1o7j30v { bottom: 0px; flex: none; left: 0px; position: absolute; right: 0px; top: 0px; }`,
          `.framer-aXbP6 .framer-9tf5e6 { align-content: flex-start; align-items: flex-start; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 32px; height: min-content; justify-content: center; overflow: visible; padding: 0px; position: relative; width: 100%; }`,
          `.framer-aXbP6 .framer-4m342c { align-content: flex-start; align-items: flex-start; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 20px; height: min-content; justify-content: center; padding: 0px; position: relative; width: min-content; }`,
          `.framer-aXbP6 .framer-5ms081 { align-content: center; align-items: center; display: flex; flex: none; flex-direction: row; flex-wrap: nowrap; gap: 10px; height: min-content; justify-content: flex-start; padding: 0px; position: relative; width: min-content; }`,
          `.framer-aXbP6 .framer-uewkiv { flex: none; height: 22px; position: relative; width: auto; }`,
          `.framer-aXbP6 .framer-a7gv32 { flex: none; height: 40px; position: relative; width: auto; }`,
          `.framer-aXbP6 .framer-1g0jtka { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 10px; height: 100px; justify-content: center; min-height: 100%; min-width: 100%; padding: 10px; position: relative; width: min-content; }`,
          `.framer-aXbP6 .framer-1l8mj5u { flex: none; height: auto; position: relative; white-space: pre; width: auto; }`,
          `.framer-aXbP6 .framer-mh7fv2-container, .framer-aXbP6 .framer-1wcecyc-container { flex: none; height: auto; position: relative; width: auto; }`,
          `.framer-aXbP6 .framer-1otsgct { align-content: center; align-items: center; display: flex; flex: none; flex-direction: column; flex-wrap: nowrap; gap: 32px; height: min-content; justify-content: center; max-width: 454px; overflow: var(--overflow-clip-fallback, clip); padding: 0px; position: relative; width: 100%; }`,
          `.framer-aXbP6 .framer-1fg0nj, .framer-aXbP6 .framer-1ir264s, .framer-aXbP6 .framer-osbqyb { flex: none; height: auto; position: relative; white-space: pre-wrap; width: 100%; word-break: break-word; word-wrap: break-word; }`,
          `.framer-aXbP6 .framer-1752rym { align-content: center; align-items: center; display: flex; flex: none; flex-direction: row; flex-wrap: nowrap; gap: 8px; height: min-content; justify-content: flex-start; overflow: visible; padding: 0px; position: relative; width: 100%; }`,
          `.framer-aXbP6 .framer-dzhe85 { align-content: flex-start; align-items: flex-start; display: flex; flex: 1 0 0px; flex-direction: column; flex-wrap: nowrap; gap: 2px; height: min-content; justify-content: center; overflow: visible; padding: 0px; position: relative; width: 1px; }`,
          `.framer-aXbP6.framer-v-15qwt3n .framer-1otsgct { align-content: flex-start; align-items: flex-start; }`,
          ...Me,
          ...jn,
          ...Se,
          ...Ee,
          `.framer-aXbP6[data-border="true"]::after, .framer-aXbP6 [data-border="true"]::after { content: ""; border-width: var(--border-top-width, 0) var(--border-right-width, 0) var(--border-bottom-width, 0) var(--border-left-width, 0); border-color: var(--border-color, none); border-style: var(--border-style, none); width: 100%; height: 100%; position: absolute; box-sizing: border-box; left: 0; top: 0; border-radius: inherit; corner-shape: inherit; pointer-events: none; }`,
        ],
        `framer-aXbP6`,
      )),
      ($.displayName = `Outcomes Card`),
      ($.defaultProps = { height: 492, width: 500 }),
      T($, {
        variant: {
          options: [`TEPMElblM`, `yFktZvadT`],
          optionTitles: [`Desktop`, `Case Study`],
          title: `Variant`,
          type: A.Enum,
        },
        zdcOUHZu4: { defaultValue: `8x`, title: `Big Text`, type: A.String },
        onzdcOUHZu4Change: { changes: `zdcOUHZu4`, type: A.ChangeHandler },
        kswcavPsI: {
          defaultValue: `"Seven touchpoints, one picture of the market . This clarity is what got us from zero to 150 customers."`,
          displayTextArea: !1,
          title: `Text`,
          type: A.String,
        },
        onkswcavPsIChange: { changes: `kswcavPsI`, type: A.ChangeHandler },
        zzaL0af_O: {
          defaultValue: `Talan Aminoff`,
          displayTextArea: !1,
          title: `Author Name`,
          type: A.String,
        },
        onzzaL0af_OChange: { changes: `zzaL0af_O`, type: A.ChangeHandler },
        MUQ_8gRel: {
          defaultValue: `Co-Founder at Gainback`,
          displayTextArea: !1,
          title: `Author Title`,
          type: A.String,
        },
        onMUQ_8gRelChange: { changes: `MUQ_8gRel`, type: A.ChangeHandler },
        dvjYla65d: {
          __defaultAssetReference: `data:framer/asset-reference,LY1UxMQYpS7cBLOkNwCW2j1RFmk.png?width=1146&height=600`,
          __vekterDefault: {
            alt: ``,
            assetReference: `data:framer/asset-reference,LY1UxMQYpS7cBLOkNwCW2j1RFmk.png?width=1146&height=600`,
          },
          title: `BG Image`,
          type: A.ResponsiveImage,
        },
        nDf9Ho4Rh: { defaultValue: `40px`, title: `Padding`, type: A.Padding },
        xWvEJUYkK: { title: `Link`, type: A.Link },
        PtzrDOzDp: {
          dataIdentifier: `local-module:collection/hlx25L0cq:default`,
          defaultValue: `Qdj2aZL47`,
          title: `Select Company`,
          type: A.CollectionReference,
        },
        onPtzrDOzDpChange: { changes: `PtzrDOzDp`, type: A.ChangeHandler },
      }),
      ae(
        $,
        [
          {
            explicitInter: !0,
            fonts: [
              {
                cssFamilyName: `Inter`,
                source: `framer`,
                style: `normal`,
                uiFamilyName: `Inter`,
                unicodeRange: `U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F`,
                url: `http://localhost:8137/assets/framerusercontent.com/assets/5vvr9Vy74if2I6bQbJvbw7SY1pQ.woff2`,
                weight: `400`,
              },
              {
                cssFamilyName: `Inter`,
                source: `framer`,
                style: `normal`,
                uiFamilyName: `Inter`,
                unicodeRange: `U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116`,
                url: `http://localhost:8137/assets/framerusercontent.com/assets/EOr0mi4hNtlgWNn9if640EZzXCo.woff2`,
                weight: `400`,
              },
              {
                cssFamilyName: `Inter`,
                source: `framer`,
                style: `normal`,
                uiFamilyName: `Inter`,
                unicodeRange: `U+1F00-1FFF`,
                url: `http://localhost:8137/assets/framerusercontent.com/assets/Y9k9QrlZAqio88Klkmbd8VoMQc.woff2`,
                weight: `400`,
              },
              {
                cssFamilyName: `Inter`,
                source: `framer`,
                style: `normal`,
                uiFamilyName: `Inter`,
                unicodeRange: `U+0370-03FF`,
                url: `http://localhost:8137/assets/framerusercontent.com/assets/OYrD2tBIBPvoJXiIHnLoOXnY9M.woff2`,
                weight: `400`,
              },
              {
                cssFamilyName: `Inter`,
                source: `framer`,
                style: `normal`,
                uiFamilyName: `Inter`,
                unicodeRange: `U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF`,
                url: `http://localhost:8137/assets/framerusercontent.com/assets/JeYwfuaPfZHQhEG8U5gtPDZ7WQ.woff2`,
                weight: `400`,
              },
              {
                cssFamilyName: `Inter`,
                source: `framer`,
                style: `normal`,
                uiFamilyName: `Inter`,
                unicodeRange: `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2070, U+2074-207E, U+2080-208E, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD`,
                url: `http://localhost:8137/assets/framerusercontent.com/assets/GrgcKwrN6d3Uz8EwcLHZxwEfC4.woff2`,
                weight: `400`,
              },
              {
                cssFamilyName: `Inter`,
                source: `framer`,
                style: `normal`,
                uiFamilyName: `Inter`,
                unicodeRange: `U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+1EA0-1EF9, U+20AB`,
                url: `http://localhost:8137/assets/framerusercontent.com/assets/b6Y37FthZeALduNqHicBT6FutY.woff2`,
                weight: `400`,
              },
              {
                cssFamilyName: `ABC Favorit Trial Book`,
                source: `custom`,
                style: `normal`,
                uiFamilyName: `ABC Favorit Trial`,
                url: `http://localhost:8137/assets/framerusercontent.com/assets/qCEgiWGkpIG20HX3RVaK1BnHZ30.woff2`,
                weight: `350`,
              },
            ],
          },
          ...Bn,
          ...Vn,
          ...D(Ne),
          ...D(An),
          ...D(Ce),
          ...D(De),
        ],
        { supportsExplicitInterCodegen: !0 },
      ),
      ($.loader = { load: (e, t) => ve([() => le(Ae, {}, t)], t) }));
  });
export { kn as i, ir as n, On as r, $ as t };
//# sourceMappingURL=Ll7zqaDS3.Bgs0mro2.mjs.map
