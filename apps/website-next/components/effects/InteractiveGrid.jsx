'use client';
// Migrated component logic; edit this source directly. No captured runtime is loaded.
import * as React from 'react';
export function InteractiveGrid() {
  let {
      lineColor: e = 'rgba(60, 100, 160,',
      dotColor: s = 'rgba(60, 100, 160,',
      lineOpacity: n = 0.1,
      dotOpacity: a = 0.2,
    } = arguments.length > 0 && undefined !== arguments[0] ? arguments[0] : {},
    i = React.useRef(null),
    o = React.useRef(0),
    l = React.useRef(true);
  React.useEffect(() => {
    let r = i.current;
    if (!r) return;
    let t = window.matchMedia('(hover: none), (pointer: coarse)').matches;
    if (t) return;
    let c = r.getContext('2d');
    if (!c) return;
    let d = Math.min(window.devicePixelRatio || 1, 2),
      u = [],
      m = 0,
      p = 0,
      h = 0,
      f = 0,
      x = false,
      _ = () => {
        ((m = Math.ceil(h / 90) + 1), (p = Math.ceil(f / 90) + 1));
        let e = (h - (m - 1) * 90) / 2,
          s = (f - (p - 1) * 90) / 2;
        u = [];
        for (let n = 0; n < p; n++)
          for (let r = 0; r < m; r++) {
            let t = e + 90 * r,
              a = s + 90 * n;
            u.push({
              x: t,
              y: a,
            });
          }
      },
      v = null;
    ((h = r.clientWidth),
      (f = r.clientHeight),
      (r.width = h * d),
      (r.height = f * d),
      c.setTransform(d, 0, 0, d, 0, 0),
      _());
    let w = () => {
        x && ((x = false), (o.current = requestAnimationFrame(j)));
      },
      g = 0,
      C = 1e3 / 30,
      j = (t) => {
        if (!l.current || t - g < C) {
          o.current = requestAnimationFrame(j);
          return;
        }
        g = t - ((t - g) % C);
        let i = r.clientWidth,
          w = r.clientHeight;
        ((i !== h || w !== f) &&
          ((h = i),
          (f = w),
          (r.width = h * d),
          (r.height = f * d),
          c.setTransform(d, 0, 0, d, 0, 0),
          v && clearTimeout(v),
          (v = setTimeout(_, 150))),
          c.clearRect(0, 0, h, f),
          (c.strokeStyle = ''.concat(e, ' ').concat(n, ')')),
          (c.lineWidth = 0.5));
        for (let e = 0; e < p; e++)
          for (let s = 0; s < m - 1; s++) {
            let n = u[e * m + s],
              r = u[e * m + s + 1],
              t = r.x - n.x,
              a = r.y - n.y,
              i = Math.sqrt(t * t + a * a);
            if (i < 20) continue;
            let o = t / i,
              l = a / i;
            (c.beginPath(),
              c.moveTo(n.x + 10 * o, n.y + 10 * l),
              c.lineTo(r.x - 10 * o, r.y - 10 * l),
              c.stroke());
          }
        for (let e = 0; e < m; e++)
          for (let s = 0; s < p - 1; s++) {
            let n = u[s * m + e],
              r = u[(s + 1) * m + e],
              t = r.x - n.x,
              a = r.y - n.y,
              i = Math.sqrt(t * t + a * a);
            if (i < 20) continue;
            let o = t / i,
              l = a / i;
            (c.beginPath(),
              c.moveTo(n.x + 10 * o, n.y + 10 * l),
              c.lineTo(r.x - 10 * o, r.y - 10 * l),
              c.stroke());
          }
        c.fillStyle = ''.concat(s, ' ').concat(a, ')');
        for (let e = 0; e < u.length; e++) {
          let s = u[e];
          ((c.globalAlpha = a), c.fillRect(s.x - 1.8, s.y - 1.8, 3.6, 3.6));
        }
        ((c.globalAlpha = 1), (x = true));
      };
    o.current = requestAnimationFrame(j);
    let y = new IntersectionObserver(
      (e) => {
        let [s] = e;
        ((l.current = s.isIntersecting), s.isIntersecting && w());
      },
      {
        threshold: 0,
      },
    );
    y.observe(r);
    return () => {
      (cancelAnimationFrame(o.current), v && clearTimeout(v), y.disconnect());
    };
  }, []);
  return (
    <canvas
      ref={i}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'transparent',
      }}
    />
  );
}
