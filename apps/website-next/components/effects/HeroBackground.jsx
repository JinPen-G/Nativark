'use client';
// Migrated component logic; edit this source directly. No captured runtime is loaded.
import * as React from 'react';
export function hexToRgb(e) {
  let s = e.replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16) / 255,
    parseInt(s.slice(2, 4), 16) / 255,
    parseInt(s.slice(4, 6), 16) / 255,
  ];
}
export function HeroBackground(e) {
  let { params: s } = e,
    n = React.useRef(null),
    a = React.useRef(0),
    i = React.useRef(0),
    o = React.useRef(true),
    l = React.useRef(s);
  l.current = s;
  React.useEffect(() => {
    let e = n.current;
    if (!e) return;
    let s = e.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: 'low-power',
    });
    if (!s) return;
    let r = (e, n) => {
        let r = s.createShader(e);
        return (s.shaderSource(r, n),
        s.compileShader(r),
        s.getShaderParameter(r, s.COMPILE_STATUS))
          ? r
          : (console.error('Shader:', s.getShaderInfoLog(r)), null);
      },
      t = (e) => {
        let n = r(
            s.VERTEX_SHADER,
            '#version 300 es\nin vec4 a_position;\nout vec2 vUv;\nvoid main() {\n  vUv = a_position.xy * 0.5 + 0.5;\n  gl_Position = a_position;\n}\n',
          ),
          t = r(s.FRAGMENT_SHADER, e);
        if (!t) return null;
        let a = s.createProgram();
        return (s.attachShader(a, n),
        s.attachShader(a, t),
        s.linkProgram(a),
        s.getProgramParameter(a, s.LINK_STATUS))
          ? a
          : (console.error('Link:', s.getProgramInfoLog(a)), null);
      },
      c = t(
        '#version 300 es\nprecision mediump float;\nin vec2 vUv;\nuniform float u_time;\nuniform float u_pixelRatio;\nuniform vec2 u_resolution;\nuniform float u_scale;\nuniform float u_rotation;\nuniform vec4 u_color1, u_color2, u_color3, u_color4, u_color5;\nuniform float u_colorCount;\nuniform float u_proportion;\nuniform float u_softness;\nuniform float u_shape;\nuniform float u_shapeScale;\nuniform float u_distortion;\nuniform float u_swirl;\nuniform float u_swirlIterations;\nuniform vec2 u_offset;\nuniform sampler2D u_flowmap;\nuniform float u_distortBoost;\nuniform float u_noiseBoost;\nuniform float u_swirlBoost;\nuniform float u_glowIntensity;\nuniform vec3 u_glowColor1;\nuniform vec3 u_glowColor2;\nuniform vec3 u_glowColor3;\nout vec4 fragColor;\n\n#define TWO_PI 6.28318530718\n#define PI 3.14159265358979323846\n\nvec2 rotate(vec2 uv, float th) { return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv; }\nfloat random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123); }\nfloat noise(vec2 st) {\n  vec2 i = floor(st); vec2 f = fract(st);\n  float a = random(i), b = random(i + vec2(1,0)), c = random(i + vec2(0,1)), d = random(i + vec2(1,1));\n  vec2 u = f*f*(3.0-2.0*f);\n  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);\n}\n\nvec3 blend_multi(float mixer, float softness) {\n  float edge = 1.0 - softness;\n  float n = u_colorCount;\n  vec3 col = u_color1.rgb;\n  if (n > 1.5) { col = mix(col, u_color2.rgb, smoothstep(0.0 + 0.2*edge, 1.0/(n-0.5) - 0.2*edge, mixer)); }\n  if (n > 2.5) { col = mix(col, u_color3.rgb, smoothstep(1.0/(n-0.5) + 0.1*edge, 2.0/(n-0.5) - 0.1*edge, mixer)); }\n  if (n > 3.5) { col = mix(col, u_color4.rgb, smoothstep(2.0/(n-0.5) + 0.1*edge, 3.0/(n-0.5) - 0.1*edge, mixer)); }\n  if (n > 4.5) { col = mix(col, u_color5.rgb, smoothstep(3.0/(n-0.5) + 0.1*edge, 4.0/(n-0.5) - 0.1*edge, mixer)); }\n  return col;\n}\n\nvoid main() {\n  vec2 uv = gl_FragCoord.xy / u_resolution.xy;\n  float t = .5 * u_time;\n  float ns = .0005 + .006 * u_scale;\n  uv -= .5; uv *= (ns * u_resolution); uv = rotate(uv, u_rotation * .5 * PI);\n  uv /= u_pixelRatio; uv += .5; uv += u_offset;\n\n  vec2 fragUV = gl_FragCoord.xy / u_resolution.xy;\n  vec4 flow = texture(u_flowmap, fragUV);\n  float influence = flow.r;\n  vec2 flowDir = (flow.gb - 0.5) * 2.0;\n\n  float n1 = noise(uv + t), n2 = noise(uv*2. - t);\n  float angle = n1 * TWO_PI;\n\n  float totalDistortion = u_distortion + influence * u_distortBoost;\n  uv.x += 4. * totalDistortion * n2 * cos(angle);\n  uv.y += 4. * totalDistortion * n2 * sin(angle);\n\n  uv += flowDir * influence * 0.15;\n\n  if (influence > 0.001) {\n    float localNoise = noise(uv * 2.0 + t * 1.5);\n    uv += influence * u_noiseBoost * vec2(cos(localNoise * TWO_PI), sin(localNoise * TWO_PI));\n  }\n\n  float iters = ceil(clamp(u_swirlIterations, 1., 30.));\n  float swirlAmt = clamp(u_swirl, 0., 2.) + influence * u_swirlBoost;\n  for (float i = 1.; i <= 30.0; i++) {\n    if (i > iters) break;\n    uv.x += swirlAmt / i * cos(t + i*1.5*uv.y);\n    uv.y += swirlAmt / i * cos(t + i*1.*uv.x);\n  }\n\n  float proportion = clamp(u_proportion, 0., 1.);\n  vec2 cuv = uv * (.5 + 3.5 * u_shapeScale);\n  float shape = .5 + .5 * sin(cuv.x) * cos(cuv.y);\n  float mixer = shape + .48 * sign(proportion - .5) * pow(abs(proportion - .5), .5);\n  vec3 col = blend_multi(mixer, clamp(u_softness, 0., 1.));\n\n  // Mouse proximity color shift: 3-color glow\n  float glow = smoothstep(0.0, 0.8, influence);\n  float glowNoise = noise(uv * 3.0 + u_time * 0.1) ;\n  float glowDist = smoothstep(0.0, 1.0, influence);\n  vec3 glowMix = mix(u_glowColor3, u_glowColor2, glowDist);\n  glowMix = mix(glowMix, u_glowColor1, glowDist * glowNoise);\n  col = mix(col, glowMix, glow * u_glowIntensity);\n\n  fragColor = vec4(col, 1.0);\n}\n',
      ),
      d = t(
        '#version 300 es\nprecision mediump float;\nin vec2 vUv;\nuniform float u_time;\nuniform vec2 u_resolution;\nuniform vec3 u_c1, u_c2, u_c3, u_c4, u_c5;\nuniform float u_scale;\nuniform vec2 u_offset;\nuniform float u_grain;\nuniform float u_speed;\nuniform sampler2D u_flowmap;\nuniform float u_distortBoost;\nuniform float u_swirlBoost;\nuniform float u_glowIntensity;\nuniform vec3 u_glowColor1;\nuniform vec3 u_glowColor2;\nuniform vec3 u_glowColor3;\nuniform vec2 u_lightPos;\nuniform float u_lightCore;\nuniform float u_lightHalo;\nuniform float u_vignette;\nuniform float u_bloomThreshold;\nuniform float u_bloomRange;\nuniform float u_bloomStrength;\nout vec4 fragColor;\n\nvec3 mod289v3(vec3 x){return x-floor(x*(1./289.))*289.;}\nvec4 mod289v4(vec4 x){return x-floor(x*(1./289.))*289.;}\nvec4 permute(vec4 x){return mod289v4(((x*34.)+1.)*x);}\nvec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}\n\nfloat snoise(vec3 v){\n  const vec2 C=vec2(1./6.,1./3.);\n  const vec4 D=vec4(0.,.5,1.,2.);\n  vec3 i=floor(v+dot(v,C.yyy));\n  vec3 x0=v-i+dot(i,C.xxx);\n  vec3 g=step(x0.yzx,x0.xyz);\n  vec3 l=1.-g;\n  vec3 i1=min(g.xyz,l.zxy);\n  vec3 i2=max(g.xyz,l.zxy);\n  vec3 x1=x0-i1+C.xxx;\n  vec3 x2=x0-i2+C.yyy;\n  vec3 x3=x0-D.yyy;\n  i=mod289v3(i);\n  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));\n  float n_=.142857142857;\n  vec3 ns=n_*D.wyz-D.xzx;\n  vec4 j=p-49.*floor(p*ns.z*ns.z);\n  vec4 x_=floor(j*ns.z);\n  vec4 y_=floor(j-7.*x_);\n  vec4 x=x_*ns.x+ns.yyyy;\n  vec4 y=y_*ns.x+ns.yyyy;\n  vec4 h=1.-abs(x)-abs(y);\n  vec4 b0=vec4(x.xy,y.xy);\n  vec4 b1=vec4(x.zw,y.zw);\n  vec4 s0=floor(b0)*2.+1.;\n  vec4 s1=floor(b1)*2.+1.;\n  vec4 sh=-step(h,vec4(0.));\n  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;\n  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;\n  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);\n  vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);\n  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));\n  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;\n  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);\n  m=m*m;\n  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));\n}\n\nfloat hash(vec2 p){\n  vec3 p3=fract(vec3(p.xyx)*.1031);\n  p3+=dot(p3,p3.yzx+33.33);\n  return fract((p3.x+p3.y)*p3.z);\n}\n\nfloat fbm(vec3 p){\n  float v=0.,amp=.6;vec3 shift=vec3(100.);\n  for(int i=0;i<1;i++){v+=amp*snoise(p);p=p*2.+shift;amp*=.4;}\n  return v;\n}\n\nfloat fluidNoise(vec2 uv,float t){\n  float n1=fbm(vec3(uv*.6,t*.06));\n  float n2=fbm(vec3(uv*.6+5.2,t*.06+1.3));\n  vec2 w1=vec2(n1,n2)*.6;\n  float n3=fbm(vec3((uv+w1)*.7+1.7,t*.05+3.1));\n  float n4=fbm(vec3((uv+w1)*.7+9.2,t*.05+5.7));\n  vec2 w2=vec2(n3,n4)*.5;\n  return fbm(vec3((uv+w1+w2)*.5,t*.04));\n}\n\nvec2 curlish(vec2 uv,float t){\n  float eps=.02;\n  float n=snoise(vec3(uv*.8,t));\n  float nx=snoise(vec3((uv+vec2(eps,0.))*.8,t));\n  float ny=snoise(vec3((uv+vec2(0.,eps))*.8,t));\n  return vec2(-(ny-n)/eps,(nx-n)/eps)*.003;\n}\n\nvoid main(){\n  float aspect=u_resolution.x/u_resolution.y;\n  vec2 uv=gl_FragCoord.xy/u_resolution;\n  vec2 suv=vec2(uv.x*aspect, uv.y) * u_scale + u_offset;\n  float t=u_time;\n\n  // Mouse interaction via flowmap\n  vec4 flow = texture(u_flowmap, uv);\n  float influence = flow.r;\n  vec2 flowDir = (flow.gb - 0.5) * 2.0;\n\n  // Apply mouse distortion to UV\n  suv += flowDir * influence * u_distortBoost * 0.8;\n  // Apply mouse swirl\n  float swirlAngle = influence * u_swirlBoost * 2.5;\n  float cs = cos(swirlAngle), sn = sin(swirlAngle);\n  vec2 delta = suv - vec2(uv.x * aspect, uv.y) * u_scale;\n  suv += (mat2(cs, sn, -sn, cs) * delta - delta) * influence;\n\n  vec2 curl=curlish(suv,t*.04);\n  vec2 uvD=suv+curl*12.;\n  float f=fluidNoise(uvD,t);\n  float swirl=snoise(vec3(uvD*.8+f*1.5,t*.035))*.5+.5;\n  float n=f*.5+.5;\n  vec3 col=mix(u_c1,u_c2,smoothstep(.2,.5,n));\n  col=mix(col,u_c3,smoothstep(.35,.65,n+swirl*.25));\n  col=mix(col,u_c4,smoothstep(.6,.85,swirl)*.55);\n  col=mix(col,u_c5,smoothstep(.5,.8,n*swirl)*.35);\n\n  // Mouse proximity color shift: 3-color glow blended by distance + noise\n  float glow = smoothstep(0.0, 0.8, influence);\n  float glowNoise = snoise(vec3(uvD * 1.5, t * 0.08)) * 0.5 + 0.5;\n  float glowDist = smoothstep(0.0, 1.0, influence);\n  vec3 glowMix = mix(u_glowColor3, u_glowColor2, glowDist);\n  glowMix = mix(glowMix, u_glowColor1, glowDist * glowNoise);\n  col = mix(col, glowMix, glow * u_glowIntensity);\n\n  if(u_grain>0.0){\n    vec2 flowOffset = (uvD - suv) * u_resolution.y;\n    vec2 gp = floor((gl_FragCoord.xy + flowOffset) / 5.0);\n    float gr=hash(gp)*2.-1.;\n    col+=gr*u_grain;\n  }\n\n  // Self-luminance bloom: bright fluid regions become their own light spots,\n  // so glow follows the flow and mouse disturbance instead of a fixed point\n  float luma=dot(col,vec3(.299,.587,.114));\n  float bloom=smoothstep(u_bloomThreshold-u_bloomRange,u_bloomThreshold+u_bloomRange,luma);\n  col+=(col*.85+vec3(.15,.145,.13))*bloom*u_bloomStrength;\n\n  // Virtual light source: soft warm core (same side as helm lighting)\n  float ld=length((uv-u_lightPos)*vec2(aspect,1.));\n  float core=exp(-ld*ld*4.5);\n  float halo=exp(-ld*1.8);\n  col+=vec3(1.,.97,.9)*core*u_lightCore+vec3(.72,.8,1.)*halo*u_lightHalo;\n\n  float vig=1.-smoothstep(.35,.75,length(uv-.5));\n  col=mix(col*(1.-u_vignette),col,vig);\n  fragColor=vec4(col,1.);\n}\n',
      );
    if (!c || !d) return;
    let u = {
        time: s.getUniformLocation(c, 'u_time'),
        pixelRatio: s.getUniformLocation(c, 'u_pixelRatio'),
        resolution: s.getUniformLocation(c, 'u_resolution'),
        scale: s.getUniformLocation(c, 'u_scale'),
        rotation: s.getUniformLocation(c, 'u_rotation'),
        offset: s.getUniformLocation(c, 'u_offset'),
        color1: s.getUniformLocation(c, 'u_color1'),
        color2: s.getUniformLocation(c, 'u_color2'),
        color3: s.getUniformLocation(c, 'u_color3'),
        color4: s.getUniformLocation(c, 'u_color4'),
        color5: s.getUniformLocation(c, 'u_color5'),
        colorCount: s.getUniformLocation(c, 'u_colorCount'),
        proportion: s.getUniformLocation(c, 'u_proportion'),
        softness: s.getUniformLocation(c, 'u_softness'),
        shape: s.getUniformLocation(c, 'u_shape'),
        shapeScale: s.getUniformLocation(c, 'u_shapeScale'),
        distortion: s.getUniformLocation(c, 'u_distortion'),
        swirl: s.getUniformLocation(c, 'u_swirl'),
        swirlIterations: s.getUniformLocation(c, 'u_swirlIterations'),
        flowmap: s.getUniformLocation(c, 'u_flowmap'),
        distortBoost: s.getUniformLocation(c, 'u_distortBoost'),
        noiseBoost: s.getUniformLocation(c, 'u_noiseBoost'),
        swirlBoost: s.getUniformLocation(c, 'u_swirlBoost'),
        glowIntensity: s.getUniformLocation(c, 'u_glowIntensity'),
        glowColor1: s.getUniformLocation(c, 'u_glowColor1'),
        glowColor2: s.getUniformLocation(c, 'u_glowColor2'),
        glowColor3: s.getUniformLocation(c, 'u_glowColor3'),
      },
      m = {
        time: s.getUniformLocation(d, 'u_time'),
        resolution: s.getUniformLocation(d, 'u_resolution'),
        scale: s.getUniformLocation(d, 'u_scale'),
        offset: s.getUniformLocation(d, 'u_offset'),
        grain: s.getUniformLocation(d, 'u_grain'),
        speed: s.getUniformLocation(d, 'u_speed'),
        flowmap: s.getUniformLocation(d, 'u_flowmap'),
        distortBoost: s.getUniformLocation(d, 'u_distortBoost'),
        swirlBoost: s.getUniformLocation(d, 'u_swirlBoost'),
        glowIntensity: s.getUniformLocation(d, 'u_glowIntensity'),
        glowColor1: s.getUniformLocation(d, 'u_glowColor1'),
        glowColor2: s.getUniformLocation(d, 'u_glowColor2'),
        glowColor3: s.getUniformLocation(d, 'u_glowColor3'),
        c1: s.getUniformLocation(d, 'u_c1'),
        c2: s.getUniformLocation(d, 'u_c2'),
        c3: s.getUniformLocation(d, 'u_c3'),
        c4: s.getUniformLocation(d, 'u_c4'),
        c5: s.getUniformLocation(d, 'u_c5'),
        lightPos: s.getUniformLocation(d, 'u_lightPos'),
        lightCore: s.getUniformLocation(d, 'u_lightCore'),
        lightHalo: s.getUniformLocation(d, 'u_lightHalo'),
        vignette: s.getUniformLocation(d, 'u_vignette'),
        bloomThreshold: s.getUniformLocation(d, 'u_bloomThreshold'),
        bloomRange: s.getUniformLocation(d, 'u_bloomRange'),
        bloomStrength: s.getUniformLocation(d, 'u_bloomStrength'),
      },
      p = s.createBuffer();
    (s.bindBuffer(s.ARRAY_BUFFER, p),
      s.bufferData(
        s.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        s.STATIC_DRAW,
      ));
    let f = (e) => {
        let n = s.getAttribLocation(e, 'a_position');
        (s.bindBuffer(s.ARRAY_BUFFER, p),
          s.enableVertexAttribArray(n),
          s.vertexAttribPointer(n, 2, s.FLOAT, false, 0, 0));
      },
      x = s.createTexture();
    (s.bindTexture(s.TEXTURE_2D, x),
      s.texImage2D(
        s.TEXTURE_2D,
        0,
        s.RGBA,
        1,
        1,
        0,
        s.RGBA,
        s.UNSIGNED_BYTE,
        new Uint8Array([0, 128, 128, 255]),
      ),
      s.texParameteri(s.TEXTURE_2D, s.TEXTURE_MIN_FILTER, s.LINEAR),
      s.texParameteri(s.TEXTURE_2D, s.TEXTURE_MAG_FILTER, s.LINEAR),
      s.texParameteri(s.TEXTURE_2D, s.TEXTURE_WRAP_S, s.CLAMP_TO_EDGE),
      s.texParameteri(s.TEXTURE_2D, s.TEXTURE_WRAP_T, s.CLAMP_TO_EDGE));
    let _ = Math.min(window.devicePixelRatio || 1, 1.5),
      v = Math.round(e.clientWidth * _),
      w = Math.round(e.clientHeight * _);
    ((e.width = v), (e.height = w));
    let g = window.matchMedia('(hover: none), (pointer: coarse)').matches;
    i.current = performance.now();
    let C = 0,
      j = 1e3 / 30,
      y = (n) => {
        if (((a.current = requestAnimationFrame(y)), !o.current || n - C < j))
          return;
        C = n - ((n - C) % j);
        let r = Math.min(window.devicePixelRatio || 1, 1.5),
          t = Math.round(e.clientWidth * r),
          p = Math.round(e.clientHeight * r);
        (t !== v || p !== w) &&
          ((v = t), (w = p), (e.width = v), (e.height = w));
        let _ = l.current;
        (s.bindFramebuffer(s.FRAMEBUFFER, null), s.viewport(0, 0, v, w));
        let k = (performance.now() - i.current) * 0.001 * (_.speed / 100),
          H = _.colors || ['#2E58A4', '#D2E2EE', '#FFFFFF'];
        if ('fluid' === _.type) {
          var b, P, N, L, T, M, D, V;
          (s.useProgram(d),
            f(d),
            s.activeTexture(s.TEXTURE0),
            s.bindTexture(s.TEXTURE_2D, x),
            s.uniform1i(m.flowmap, 0),
            s.uniform1f(m.time, k),
            s.uniform2f(m.resolution, v, w),
            s.uniform1f(m.scale, _.scale),
            s.uniform2f(m.offset, _.offsetX / 100, _.offsetY / 100),
            s.uniform1f(m.grain, _.grain),
            s.uniform1f(m.distortBoost, _.distortBoost),
            s.uniform1f(m.swirlBoost, _.swirlBoost));
          let e = null !== (b = _.lightX) && undefined !== b ? b : 0.89;
          (s.uniform2f(
            m.lightPos,
            e,
            null !== (P = _.lightY) && undefined !== P ? P : 0.46,
          ),
            s.uniform1f(
              m.lightCore,
              g ? 0 : null !== (N = _.lightCore) && undefined !== N ? N : 0.14,
            ),
            s.uniform1f(
              m.lightHalo,
              g ? 0 : null !== (L = _.lightHalo) && undefined !== L ? L : 0.2,
            ),
            s.uniform1f(
              m.vignette,
              null !== (T = _.vignette) && undefined !== T ? T : 0.38,
            ),
            s.uniform1f(
              m.bloomThreshold,
              null !== (M = _.bloomThreshold) && undefined !== M ? M : 0.61,
            ),
            s.uniform1f(
              m.bloomRange,
              null !== (D = _.bloomRange) && undefined !== D ? D : 0.18,
            ),
            s.uniform1f(
              m.bloomStrength,
              null !== (V = _.bloomStrength) && undefined !== V ? V : 0.4,
            ),
            s.uniform1f(m.glowIntensity, _.glowIntensity));
          let n = hexToRgb(_.glowColors[0] || '#ffffff'),
            r = hexToRgb(_.glowColors[1] || _.glowColors[0] || '#ffffff'),
            t = hexToRgb(_.glowColors[2] || _.glowColors[0] || '#ffffff');
          (s.uniform3f(m.glowColor1, n[0], n[1], n[2]),
            s.uniform3f(m.glowColor2, r[0], r[1], r[2]),
            s.uniform3f(m.glowColor3, t[0], t[1], t[2]));
          let a = [m.c1, m.c2, m.c3, m.c4, m.c5];
          for (let e = 0; e < 5; e++) {
            let n = hexToRgb(H[e] || H[H.length - 1] || '#000000');
            s.uniform3f(a[e], n[0], n[1], n[2]);
          }
        } else {
          (s.useProgram(c),
            f(c),
            s.activeTexture(s.TEXTURE0),
            s.bindTexture(s.TEXTURE_2D, x),
            s.uniform1i(u.flowmap, 0),
            s.uniform1f(u.time, k),
            s.uniform1f(u.pixelRatio, window.devicePixelRatio || 1),
            s.uniform2f(u.resolution, v, w),
            s.uniform1f(u.scale, _.scale),
            s.uniform1f(u.rotation, _.rotation / 90),
            s.uniform2f(u.offset, _.offsetX / 100, _.offsetY / 100));
          let e = [u.color1, u.color2, u.color3, u.color4, u.color5];
          for (let n = 0; n < 5; n++) {
            let r = hexToRgb(H[n] || H[H.length - 1] || '#000000');
            s.uniform4f(e[n], r[0], r[1], r[2], 1);
          }
          (s.uniform1f(u.colorCount, H.length),
            s.uniform1f(u.proportion, _.proportion / 100),
            s.uniform1f(u.softness, _.softness / 100),
            s.uniform1f(u.shape, 0),
            s.uniform1f(u.shapeScale, _.shapeScale / 100),
            s.uniform1f(u.distortion, _.distortion / 100),
            s.uniform1f(u.swirl, _.swirl / 50),
            s.uniform1f(u.swirlIterations, _.swirlIterations),
            s.uniform1f(u.distortBoost, _.distortBoost),
            s.uniform1f(u.noiseBoost, _.noiseBoost),
            s.uniform1f(u.swirlBoost, _.swirlBoost),
            s.uniform1f(u.glowIntensity, _.glowIntensity));
          let n = hexToRgb(_.glowColors[0] || '#ffffff'),
            r = hexToRgb(_.glowColors[1] || _.glowColors[0] || '#ffffff'),
            t = hexToRgb(_.glowColors[2] || _.glowColors[0] || '#ffffff');
          (s.uniform3f(u.glowColor1, n[0], n[1], n[2]),
            s.uniform3f(u.glowColor2, r[0], r[1], r[2]),
            s.uniform3f(u.glowColor3, t[0], t[1], t[2]));
        }
        s.drawArrays(s.TRIANGLE_STRIP, 0, 4);
      };
    a.current = requestAnimationFrame(y);
    let k = new IntersectionObserver(
      (e) => {
        let [s] = e;
        o.current = s.isIntersecting;
      },
      {
        threshold: 0,
      },
    );
    k.observe(e);
    return () => {
      (cancelAnimationFrame(a.current),
        s.deleteTexture(x),
        s.deleteBuffer(p),
        s.deleteProgram(c),
        s.deleteProgram(d),
        k.disconnect());
    };
  }, []);
  return (
    <canvas
      ref={n}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
      }}
    />
  );
}
export let HERO_BACKGROUND_PARAMS = {
  type: 'fluid',
  distortBoost: 2.2,
  noiseBoost: 0.3,
  swirlBoost: 0.8,
  glowIntensity: 0.13,
  glowColors: ['#fff7d1', '#538dca', '#2d448b'],
  speed: 17,
  distortion: 18,
  swirl: 20,
  swirlIterations: 12,
  scale: 1.19,
  rotation: 15,
  proportion: 60,
  softness: 80,
  shapeScale: 0,
  offsetX: -124,
  offsetY: -48,
  grain: 0.005,
  colors: ['#000000', '#000000', '#204a7e', '#cec8bb', '#000000'],
  lightX: 0.89,
  lightY: 0.46,
  lightCore: 0.14,
  lightHalo: 0.2,
  vignette: 0.38,
  bloomThreshold: 0.61,
  bloomRange: 0.18,
  bloomStrength: 0.4,
};
