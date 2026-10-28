'use client';
// Migrated component logic; edit this source directly. No captured runtime is loaded.
import { useThree } from '@react-three/fiber';
import * as React from 'react';
import * as Three from 'three';
import { useFrame } from '@react-three/fiber';
import { Canvas } from '@react-three/fiber';
export function ParticleFrameLimiter(e) {
  let { fps: t, active: n = true } = e,
    r = useThree((e) => e.advance),
    o = React.useRef(null);
  React.useEffect(() => {
    if (!n) return;
    let e = 0,
      a = 0,
      i = 1e3 / t,
      u = (t) => {
        ((e = requestAnimationFrame(u)),
          null === o.current && (o.current = t),
          t - a < i || ((a = t - ((t - a) % i)), r((t - o.current) / 1e3)));
      };
    e = requestAnimationFrame(u);
    return () => cancelAnimationFrame(e);
  }, [r, t, n]);
  return null;
}
export let particlePixels = [
  [12, 0, 0.204],
  [11, 1, 0.188],
  [12, 1, 0.306],
  [11, 2, 0.161],
  [12, 2, 0.224],
  [4, 3, 0.239],
  [11, 3, 0.325],
  [12, 3, 0.322],
  [19, 3, 0.216],
  [20, 3, 0.2],
  [3, 4, 0.192],
  [8, 4, 0.216],
  [9, 4, 0.153],
  [10, 4, 0.188],
  [11, 4, 0.188],
  [13, 4, 0.231],
  [14, 4, 0.275],
  [19, 4, 0.2],
  [20, 4, 0.294],
  [5, 5, 0.263],
  [6, 5, 0.161],
  [7, 5, 0.216],
  [8, 5, 0.153],
  [11, 5, 0.204],
  [12, 5, 0.216],
  [13, 5, 0.161],
  [14, 5, 0.173],
  [15, 5, 0.188],
  [16, 5, 0.267],
  [17, 5, 0.22],
  [18, 5, 0.208],
  [19, 5, 0.184],
  [5, 6, 0.365],
  [6, 6, 0.263],
  [8, 6, 0.157],
  [9, 6, 0.196],
  [10, 6, 0.192],
  [11, 6, 0.22],
  [12, 6, 0.263],
  [13, 6, 0.176],
  [17, 6, 0.353],
  [18, 6, 0.208],
  [5, 7, 0.18],
  [7, 7, 0.208],
  [8, 7, 0.306],
  [11, 7, 0.196],
  [12, 7, 0.169],
  [15, 7, 0.294],
  [16, 7, 0.365],
  [17, 7, 0.176],
  [18, 7, 0.373],
  [8, 8, 0.169],
  [11, 8, 0.18],
  [12, 8, 0.224],
  [16, 8, 0.255],
  [17, 8, 0.173],
  [18, 8, 0.2],
  [19, 8, 0.278],
  [4, 9, 0.204],
  [5, 9, 0.196],
  [6, 9, 0.294],
  [8, 9, 0.196],
  [9, 9, 0.216],
  [10, 9, 0.224],
  [11, 9, 0.188],
  [12, 9, 0.231],
  [13, 9, 0.184],
  [14, 9, 0.322],
  [15, 9, 0.216],
  [17, 9, 0.318],
  [18, 9, 0.176],
  [19, 9, 0.337],
  [4, 10, 0.318],
  [5, 10, 0.259],
  [6, 10, 0.227],
  [10, 10, 0.243],
  [11, 10, 0.247],
  [12, 10, 0.286],
  [13, 10, 0.333],
  [14, 10, 0.247],
  [17, 10, 0.173],
  [18, 10, 0.243],
  [19, 10, 0.314],
  [2, 11, 0.173],
  [3, 11, 0.275],
  [5, 11, 0.204],
  [6, 11, 0.286],
  [8, 11, 0.2],
  [10, 11, 0.212],
  [12, 11, 0.208],
  [13, 11, 0.322],
  [14, 11, 0.173],
  [15, 11, 0.196],
  [17, 11, 0.161],
  [18, 11, 0.341],
  [19, 11, 0.247],
  [20, 11, 0.329],
  [21, 11, 0.22],
  [1, 12, 0.294],
  [2, 12, 0.188],
  [3, 12, 0.259],
  [4, 12, 0.208],
  [5, 12, 0.278],
  [6, 12, 0.294],
  [7, 12, 0.169],
  [8, 12, 0.2],
  [10, 12, 0.2],
  [11, 12, 0.157],
  [12, 12, 0.216],
  [13, 12, 0.271],
  [14, 12, 0.188],
  [15, 12, 0.302],
  [16, 12, 0.173],
  [17, 12, 0.31],
  [18, 12, 0.361],
  [19, 12, 0.263],
  [20, 12, 0.424],
  [21, 12, 0.247],
  [22, 12, 0.306],
  [4, 13, 0.255],
  [6, 13, 0.184],
  [10, 13, 0.153],
  [11, 13, 0.275],
  [12, 13, 0.278],
  [13, 13, 0.318],
  [14, 13, 0.227],
  [17, 13, 0.165],
  [18, 13, 0.29],
  [19, 13, 0.329],
  [4, 14, 0.247],
  [6, 14, 0.224],
  [9, 14, 0.165],
  [11, 14, 0.212],
  [12, 14, 0.376],
  [13, 14, 0.176],
  [14, 14, 0.192],
  [17, 14, 0.314],
  [18, 14, 0.169],
  [19, 14, 0.349],
  [6, 15, 0.176],
  [7, 15, 0.188],
  [8, 15, 0.153],
  [11, 15, 0.169],
  [12, 15, 0.227],
  [16, 15, 0.282],
  [17, 15, 0.153],
  [19, 15, 0.176],
  [5, 16, 0.271],
  [7, 16, 0.365],
  [8, 16, 0.345],
  [11, 16, 0.204],
  [12, 16, 0.271],
  [15, 16, 0.271],
  [16, 16, 0.329],
  [18, 16, 0.384],
  [5, 17, 0.259],
  [6, 17, 0.349],
  [8, 17, 0.259],
  [9, 17, 0.184],
  [11, 17, 0.278],
  [12, 17, 0.337],
  [14, 17, 0.176],
  [15, 17, 0.333],
  [17, 17, 0.341],
  [18, 17, 0.212],
  [4, 18, 0.157],
  [5, 18, 0.29],
  [6, 18, 0.243],
  [7, 18, 0.231],
  [10, 18, 0.212],
  [11, 18, 0.263],
  [12, 18, 0.263],
  [13, 18, 0.224],
  [14, 18, 0.173],
  [15, 18, 0.157],
  [16, 18, 0.18],
  [18, 18, 0.208],
  [4, 19, 0.173],
  [5, 19, 0.2],
  [8, 19, 0.196],
  [9, 19, 0.157],
  [15, 19, 0.176],
  [3, 20, 0.224],
  [4, 20, 0.157],
  [10, 20, 0.192],
  [11, 20, 0.353],
  [12, 20, 0.392],
  [13, 20, 0.196],
  [19, 20, 0.173],
  [20, 20, 0.165],
  [11, 21, 0.267],
  [12, 21, 0.251],
  [11, 22, 0.282],
  [12, 22, 0.255],
  [11, 23, 0.216],
  [12, 23, 0.212],
];
export function ParticleMesh(e) {
  let { pixelData: t, scrollProgress: n } = e,
    o = React.useRef(null),
    s = React.useRef(null),
    l = React.useRef(null),
    c = React.useRef(0),
    f = React.useRef(0),
    d = React.useRef(0),
    h = React.useMemo(() => new Three.Object3D(), []),
    m = React.useMemo(() => {
      let e = new Float32Array(t.count);
      for (let n = 0; n < t.count; n++) e[n] = n;
      return e;
    }, [t.count]);
  (React.useEffect(() => {
    let e = o.current;
    if (e) {
      for (let n = 0; n < t.count; n++) {
        let r = t.scatteredPositions[3 * n],
          a = t.scatteredPositions[3 * n + 1],
          i = t.scatteredPositions[3 * n + 2];
        h.position.set(r, a, i);
        let o = 0.5 + 1 * Math.random();
        (h.scale.set(o, o, o), h.updateMatrix(), e.setMatrixAt(n, h.matrix));
      }
      e.instanceMatrix.needsUpdate = true;
    }
  }, [t, h]),
    useFrame((e, t) => {
      var r;
      let { clock: a } = e;
      if (!l.current || !s.current) return;
      let i = a.getElapsedTime();
      ((l.current.uniforms.uTime.value = i),
        (f.current = Math.min(1, f.current + 0.7 * t)),
        (l.current.uniforms.uFadeIn.value = f.current));
      let o = null !== (r = n.current) && undefined !== r ? r : 0;
      ((c.current += (o - c.current) * Math.min(1, 2.5 * t)),
        (l.current.uniforms.uGather.value = c.current));
      let u = 0.06 * (1 - 0.5 * c.current);
      ((d.current += u * t),
        (s.current.rotation.z = d.current),
        (s.current.rotation.x = 0.03 * Math.sin(0.15 * i)),
        (s.current.rotation.y = 0.05 * Math.sin(0.2 * i)),
        (s.current.position.y = 0.1 * Math.sin(0.3 * i)));
    }));
  let p = React.useMemo(() => {
      let e = new Three.BoxGeometry(0.05, 0.05, 0.015);
      e.setAttribute(
        'aOpacity',
        new Three.InstancedBufferAttribute(t.opacities, 1),
      );
      e.setAttribute('aIndex', new Three.InstancedBufferAttribute(m, 1));
      e.setAttribute(
        'aTarget',
        new Three.InstancedBufferAttribute(t.positions, 3),
      );
      e.setAttribute(
        'aScattered',
        new Three.InstancedBufferAttribute(t.scatteredPositions, 3),
      );
      return e;
    }, [t.opacities, t.positions, t.scatteredPositions, m]),
    v = React.useMemo(() => {
      let e = new Three.ShaderMaterial({
        vertexShader:
          '\n  attribute float aOpacity;\n  attribute float aIndex;\n  attribute vec3 aTarget;\n  attribute vec3 aScattered;\n\n  uniform float uTime;\n  uniform float uGather;\n\n  varying float vOpacity;\n  varying float vGather;\n\n  void main() {\n    vOpacity = aOpacity;\n    vGather = uGather;\n\n    // Lerp between scattered and gathered (target) positions\n    float gather = smoothstep(0.0, 1.0, uGather);\n    vec3 center = mix(aScattered, aTarget, gather);\n\n    vec3 localOffset = (instanceMatrix * vec4(position, 1.0)).xyz - (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;\n    vec3 pos = center + localOffset;\n\n    // Floating motion (stronger when scattered, subtle when gathered)\n    float floatStrength = mix(0.2, 0.06, gather);\n    pos.x += sin(uTime * 0.5 + aIndex * 0.1) * floatStrength;\n    pos.y += cos(uTime * 0.4 + aIndex * 0.07) * floatStrength;\n    pos.z += sin(uTime * 0.3 + aIndex * 0.13) * floatStrength * 0.7;\n\n    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);\n    gl_Position = projectionMatrix * mvPosition;\n  }\n',
        fragmentShader:
          '\n  varying float vOpacity;\n  varying float vGather;\n\n  uniform vec3 uColor;\n  uniform float uTime;\n  uniform float uFadeIn;\n\n  void main() {\n    float shimmer = sin(uTime * 1.2 + vOpacity * 10.0) * 0.1 + 0.9;\n    float alpha = vOpacity * shimmer;\n    // Brighten slightly when gathered\n    alpha *= mix(0.8, 1.2, vGather);\n    gl_FragColor = vec4(uColor, alpha * uFadeIn);\n  }\n',
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: {
            value: 0,
          },
          uColor: {
            value: new Three.Color(0.55, 0.6, 0.75),
          },
          uGather: {
            value: 0,
          },
          uFadeIn: {
            value: 0,
          },
        },
      });
      l.current = e;
      return e;
    }, []);
  return (
    <group ref={s}>
      {<instancedMesh ref={o} args={[p, v, t.count]} frustumCulled={false} />}
    </group>
  );
}
export function ParticleField(e) {
  let { className: t } = e,
    n = React.useMemo(
      () =>
        (function () {
          let e = [],
            t = [],
            n = [];
          for (let [r, a, i] of particlePixels) {
            (e.push((r - 12) * 0.18, (12 - a) * 0.18, 0),
              n.push(0.25 + 0.55 * i));
            let o = Math.random() * Math.PI * 2,
              u = Math.acos(2 * Math.random() - 1),
              s = 5 * (0.5 + 0.5 * Math.random());
            t.push(
              Math.sin(u) * Math.cos(o) * s,
              Math.sin(u) * Math.sin(o) * s,
              Math.cos(u) * s * 0.4,
            );
          }
          return {
            positions: new Float32Array(e),
            scatteredPositions: new Float32Array(t),
            opacities: new Float32Array(n),
            count: e.length / 3,
          };
        })(),
      [],
    ),
    [i, u] = React.useState(false),
    [f, d] = React.useState(false),
    h = React.useRef(null),
    m = React.useRef(0);
  React.useEffect(() => {
    let e = h.current;
    if (!e) return;
    let t = new IntersectionObserver(
      (e) => {
        let [t] = e;
        return u(t.isIntersecting);
      },
      {
        rootMargin: '600px',
      },
    );
    t.observe(e);
    return () => t.disconnect();
  }, []);
  React.useEffect(() => {
    if ('function' == typeof window.requestIdleCallback) {
      let e = window.requestIdleCallback(() => d(true), {
        timeout: 3e3,
      });
      return () => window.cancelIdleCallback(e);
    }
    let e = window.setTimeout(() => d(true), 1500);
    return () => window.clearTimeout(e);
  }, []);
  React.useEffect(() => {
    let e = () => {
      let e = h.current;
      if (!e) return;
      let t = e.getBoundingClientRect(),
        n = window.innerHeight,
        r = Math.min(1, Math.max(0, 1 - (t.top + 0.5 * t.height) / n));
      m.current = r;
    };
    window.addEventListener('scroll', e, {
      passive: true,
    });
    e();
    return () => window.removeEventListener('scroll', e);
  }, []);
  return (
    <div
      ref={h}
      className={t}
      style={{
        width: '100%',
        height: '100%',
      }}
    >
      {f && (
        <Canvas
          camera={{
            position: [0, 0, 22],
            fov: 50,
          }}
          gl={{
            alpha: true,
            antialias: false,
            powerPreference: 'low-power',
          }}
          dpr={[1, 1.5]}
          frameloop="never"
          style={{
            background: 'transparent',
          }}
          onCreated={(e) => {
            let { gl: t, scene: n, camera: r } = e;
            t.compile(n, r);
          }}
        >
          {<ParticleFrameLimiter fps={30} active={i} />}
          {<ParticleMesh pixelData={n} scrollProgress={m} />}
        </Canvas>
      )}
    </div>
  );
}
