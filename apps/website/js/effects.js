/**
 * The template's original Wave Gradient fragment shader is kept as wave.frag.
 * This file supplies a small, readable WebGL2 host instead of Framer's renderer.
 */
(() => {
  "use strict";
  const canvas = document.querySelector(".wave-canvas");
  if (!canvas) return;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
  if (!gl) return; // CSS provides a quiet fallback when WebGL is unavailable.

  const vertexSource = `#version 300 es
    in vec2 a_position;
    out vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }`;
  const fragmentHeader = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    out vec4 fragColor;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_seed;
    uniform float u_waveSpeed;
    uniform float u_waveFreqX;
    uniform float u_waveFreqY;
    uniform float u_waveAngle;
    uniform float u_waveAmplitude;
    uniform float u_maskSoftness;
    uniform float u_blendAmount;
    uniform int u_colors_length;
    uniform vec4 u_colors[4];
  `;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  async function start() {
    const response = await fetch("assets/animations/wave.frag");
    if (!response.ok) return;
    const fragment = await response.text();
    const vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compile(
      gl.FRAGMENT_SHADER,
      fragmentHeader + fragment,
    );
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    // Preserve the original wave motion; only the color palette is branded.
    const parameters = {
      u_seed: 32,
      u_waveSpeed: 0.55,
      u_waveFreqX: 0.9,
      u_waveFreqY: 6,
      u_waveAngle: 105,
      u_waveAmplitude: 2.1,
      u_maskSoftness: 0.74,
      u_blendAmount: 0.54,
    };
    Object.entries(parameters).forEach(([name, value]) =>
      gl.uniform1f(gl.getUniformLocation(program, name), value),
    );
    gl.uniform1i(gl.getUniformLocation(program, "u_colors_length"), 4);
    // Rental OS logo gradient: violet → blue → cyan, anchored by deep navy
    // so the white CTA copy stays legible as the waves move.
    const palette = ["#050A27", "#0645F4", "#149CFF", "#6854FF"];
    gl.uniform4fv(
      gl.getUniformLocation(program, "u_colors[0]"),
      new Float32Array(
        palette.flatMap((hex) => [
          parseInt(hex.slice(1, 3), 16) / 255,
          parseInt(hex.slice(3, 5), 16) / 255,
          parseInt(hex.slice(5, 7), 16) / 255,
          1,
        ]),
      ),
    );
    const resolution = gl.getUniformLocation(program, "u_resolution");
    const timeUniform = gl.getUniformLocation(program, "u_time");
    let visible = false;
    let lost = false;
    let elapsed = 0;
    let lastTime = performance.now();

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(rect.width * scale));
      canvas.height = Math.max(1, Math.round(rect.height * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolution, canvas.width, canvas.height);
    }
    new ResizeObserver(resize).observe(canvas);
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
    }).observe(canvas);
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      lost = true;
    });
    canvas.addEventListener("webglcontextrestored", () => location.reload());
    resize();

    function render(now) {
      if (visible && !document.hidden && !lost) {
        if (!reducedMotion.matches)
          elapsed += Math.min(now - lastTime, 50) / 1000;
        gl.uniform1f(timeUniform, reducedMotion.matches ? 4 : elapsed);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      lastTime = now;
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
  }
  start().catch(() => {
    canvas.hidden = true;
  });
})();
