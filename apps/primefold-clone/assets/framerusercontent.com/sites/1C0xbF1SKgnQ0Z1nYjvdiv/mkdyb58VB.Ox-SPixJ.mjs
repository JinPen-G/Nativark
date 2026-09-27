import{n as e,t}from"./rolldown-runtime.Dh6celcD.mjs";import{F as n,M as r,_ as i,j as a,k as o,l as s,s as c,u as ee,w as l,y as te}from"./react.DwKF3UUh.mjs";import{T as u,i as ne,o as d,t as f}from"./motion.CHs8nAca.mjs";import{A as p,D as re,Ft as m,It as h,N as g,P as _,R as v,Tt as ie,Y as y,_t as b,k as ae,nt as x,q as S,s as C,v as oe,z as se}from"./framer.DnRup4B8.mjs";import{i as w,n as T,r as E,t as D}from"./C9QVuNHI_.D3eIQwsu.mjs";import{i as O,n as k,r as A,t as j}from"./HFjN2pmoM.Cg76QeRw.mjs";var M,N,P,F,I=t((()=>{c(),x(),l(),M=`url('data:image/svg+xml,<svg display="block" id="2551611524" role="presentation" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M 5.854 5.854 L 0.854 10.854 C 0.808 10.9 0.752 10.937 0.692 10.962 C 0.631 10.988 0.566 11.001 0.5 11.001 C 0.435 11.001 0.37 10.988 0.309 10.962 C 0.248 10.937 0.193 10.9 0.147 10.854 C 0.1 10.808 0.063 10.752 0.038 10.692 C 0.013 10.631 0 10.566 0 10.5 C 0 10.435 0.013 10.369 0.038 10.309 C 0.063 10.248 0.1 10.193 0.147 10.146 L 4.793 5.5 L 0.147 0.854 C 0.053 0.76 0 0.633 0 0.5 C 0 0.368 0.053 0.24 0.147 0.147 C 0.24 0.053 0.368 0 0.5 0 C 0.633 0 0.76 0.053 0.854 0.147 L 5.854 5.147 C 5.901 5.193 5.937 5.248 5.963 5.309 C 5.988 5.37 6.001 5.435 6.001 5.5 C 6.001 5.566 5.988 5.631 5.963 5.692 C 5.937 5.752 5.901 5.808 5.854 5.854 Z" fill="var(--1tfqbvp, rgb(255,255,255))" height="11.000589999999999px" id="AXOuKORsf" transform="translate(5.5 2.5)" width="6.000640000000001px"/></svg>') alpha no-repeat center / auto var(--framer-icon-mask-mode, add), var(--framer-icon-mask, none)`,N=i((e,t)=>{let{animated:n,layoutId:r,children:i,...a}=e;return n?s(u.div,{...a,layoutId:r,ref:t}):s(`div`,{...a,ref:t})}),P=({fill:e,height:t,id:n,width:r,...i})=>({...i,EUQVL75L6:e??i.EUQVL75L6??`rgb(255, 255, 255)`}),F=h(i(function(e,t){let{style:n,className:r,layoutId:i,variant:a,EUQVL75L6:o,...c}=P(e);return s(N,{...c,className:v(`framer-WiLD9`,r),layoutId:i,ref:t,style:{"--1tfqbvp":o,...n}})}),[`.framer-WiLD9 { -webkit-mask: ${M}; aspect-ratio: 1; background-color: var(--1tfqbvp); mask: ${M}; width: 16px; }`],`framer-WiLD9`),F.displayName=`CaretRight`,_(F,{EUQVL75L6:{defaultValue:`rgb(255, 255, 255)`,hidden:!1,title:`Fill`,type:C.Color}})})),L,R=t((()=>{x(),L=se({title:`Rings`,fragment:`
const int SAMPLES = 8;
const float EPHEMERAL_DRIP = 1.0;

// === PCG hash - https://www.jcgt.org/published/0009/03/02/
uvec3 hash3(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    return v;
}

uvec3 seed;
vec3 random3f() {
    seed = hash3(seed);
    return vec3(seed) / float(-1u);
}

vec3 seedRandom(float seedVal) {
    uvec3 s = uvec3(
        floatBitsToUint(seedVal),
        floatBitsToUint(seedVal * 1.5 + 7.31),
        floatBitsToUint(seedVal * 2.7 + 13.37)
    );
    s = hash3(s);
    return vec3(s) / float(0xFFFFFFFFu);
}

// === PALETTE SAMPLING ===
vec3 getColor(int idx) {
    if (u_colors_length < 1) return vec3(0.0);
    int safeIdx = clamp(idx, 0, u_colors_length - 1);
    return u_colors[safeIdx].rgb;
}

vec3 paletteN(float t, int count) {
    if (count < 1) return vec3(0.0);
    if (count < 2) return getColor(0);
    t = clamp(t, 0.0, 1.0) * float(count - 1);
    int idx = min(int(floor(t)), count - 2);
    float localT = fract(t);
    localT = localT * localT * (3.0 - 2.0 * localT);
    return mix(getColor(idx), getColor(idx + 1), localT);
}

// === Gradient Flow ===
float getGradientT(vec2 uv, float t, vec2 dir1, vec2 dir2, vec3 freqs, vec2 dir3) {
    vec2 suv = uv * 1.;
    
    float flow = dot(suv, dir1) + sin(dot(suv, dir2) * freqs.x + t) * 0.3 + t * 0.2;
    float flow2 = dot(suv, dir2.yx) + cos(dot(suv, dir1.yx) * freqs.y - t * 0.8) * 0.25;
    
    float gradT = sin(flow * 1.5) * 0.5 + 0.5;
    gradT += cos(flow2 * 1.2) * 1.3;
    gradT += sin(dot(suv, dir3) * freqs.z + t * 3.5) * 1.2;
    
    return smoothstep(0.0, 4.12, gradT);
}

// === RING LENS ===
void applyRingLens(vec2 pp, vec2 fragCoord, vec2 r, float iorOffset, out vec2 warpedUV, out float edgeFactor) {
    float radiusSq = u_ringRadius * u_ringRadius;
    
    vec2 lensUV = (fragCoord - vec2(r.x * 0.5, 0.0)) / r.y * u_lensScale;
    float dist = length(lensUV);
    
    float fw = fwidth(dist / u_ringSpacing) * u_ringSpacing;
    
    float ringDist = mod(dist, u_ringSpacing) / u_ringSpacing;
    float ringShifted = ringDist - 0.5;
    float localR = ringShifted * 2.0;
    
    float sp = radiusSq - localR * localR;
    
    float edgeSdf = abs(localR) - u_ringRadius;
    float edgeAA = smoothstep(fw, -fw, edgeSdf);
    
    float lensAmount = smoothstep(0., 0.3, sp);
    edgeFactor = (1.0 - smoothstep(0.0, radiusSq, sp)) * lensAmount * edgeAA;
    
    vec2 dir = lensUV / max(dist, 0.001);
    
    warpedUV = pp;
    if (sp > 0.0) {
        float lens = sqrt(sp) / max(u_ringRadius, 0.001);
        float baseWarp = mix(1.0, u_ringWarpStrength, lens);
        float warpAmount = baseWarp * (1.0 + iorOffset);
        float ringCenter = (floor(dist / u_ringSpacing) + 0.5) * u_ringSpacing;
        vec2 offset = pp - dir * ringCenter;
        warpedUV = dir * ringCenter + offset * warpAmount;
    }
}

void main() {
    vec2 fragCoord = v_uv * u_resolution;
    seed = uvec3(uvec2(fragCoord), uint(fract(u_time) * 1000.0));
    
    vec2 r = u_resolution;
    vec2 p = (fragCoord * 2.0 - r) / r.y;
    float t = u_time * u_speed;
    
    int colorCount = u_colors_length;
    
    // Early out: no colors -> black
    if (colorCount < 1) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    
    // Seed-based flow directions (precomputed once)
    vec3 seedOff1 = seedRandom(u_seed);
    vec3 seedOff2 = seedRandom(u_seed + 100.0);
    
    float angle1 = seedOff1.x * 6.28;
    float angle2 = seedOff1.y * 6.28;
    vec2 dir1 = vec2(cos(angle1), sin(angle1));
    vec2 dir2 = vec2(cos(angle2), sin(angle2));
    vec2 dir3 = dir1 + dir2;
    vec3 freqs = vec3(
        1.0 + seedOff1.z * 2.0,
        1.0 + seedOff2.x * 1.5,
        1.5 + seedOff2.y * 2.0
    );
    
    float dice = random3f().x;
    
    vec3 ringIorOffsets = vec3(-1.0, 0.0, 1.0) * u_ringDispersion;
    
    vec3 col = vec3(0.0);
    
    for (int i = 0; i < SAMPLES; i++) {
        float ephemeral = (float(i) + dice) / float(SAMPLES);
        float sqEph = ephemeral * ephemeral;
        
        vec2 pt = p;
        pt.x += u_ephemeralAmp * sqEph * sin(p.y * 2.0 + t);
        pt.y += u_ephemeralAmp * sqEph * cos(p.x * 1.5 - t) * 0.5;
        pt.y -= (1.0 - exp(-EPHEMERAL_DRIP * sqEph)) * abs(pt.y) * sign(pt.y) * 0.3;
        
        vec3 tint = smoothstep(1.0, 0.0, abs(3.0 * ephemeral - vec3(1.0, 1.5, 2.0)));
        
        vec3 gradTs = vec3(0.0);
        vec3 edgeFactors = vec3(0.0);
        
        for (int c = 0; c < 3; c++) {
            vec2 pp = pt * u_lensScale;
            vec2 warpedUV;
            float edgeFactor;
            applyRingLens(pp, fragCoord, r, ringIorOffsets[c], warpedUV, edgeFactor);
            
            vec2 gradUV = warpedUV / u_lensScale;
            gradTs[c] = getGradientT(gradUV, t * 0.8, dir1, dir2, freqs, dir3);
            edgeFactors[c] = edgeFactor;
        }
        
        vec3 convergentColor = paletteN(gradTs.g, colorCount);
        float edgeMix = max(max(edgeFactors.r, edgeFactors.g), edgeFactors.b);
        
        vec3 dispersedColor = vec3(
            paletteN(gradTs.r, colorCount).r,
            convergentColor.g,
            paletteN(gradTs.b, colorCount).b
        );
        
        vec3 finalColor = mix(convergentColor, dispersedColor, edgeMix * 2.0);
        
        vec3 rainbow = (gradTs - gradTs.g) * 3.0;
        finalColor += rainbow * edgeMix * u_edgeDisp;
        
        col += tint * finalColor * (3.0 / float(SAMPLES));
    }
    
    fragColor = vec4(col, 1.0);
}
`,propertyControls:{colors:{type:C.Array,title:`Colors`,control:{type:C.Color},maxCount:8,defaultValue:[`#91FFCC`,`#FFB938`,`#FF4242`]},seed:{type:C.Number,title:`Seed`,defaultValue:47,min:0,max:1e3,step:1},speed:{type:C.Number,title:`Speed`,defaultValue:.5,min:0,max:2,step:.01},ephemeralAmp:{type:C.Number,title:`Ephemeral`,defaultValue:.12,min:0,max:.5,step:.01},lensScale:{type:C.Number,title:`Scale`,defaultValue:10,min:.1,max:10,step:.1},ringSpacing:{type:C.Number,title:`Spacing`,defaultValue:1.5,min:.1,max:5,step:.1},ringRadius:{type:C.Number,title:`Radius`,defaultValue:1,min:.1,max:2,step:.01},ringWarpStrength:{type:C.Number,title:`Warp`,defaultValue:4,min:0,max:5,step:.1},ringDispersion:{type:C.Number,title:`Dispersion`,defaultValue:.4,min:0,max:1,step:.01},edgeDisp:{type:C.Number,title:`Edges`,defaultValue:1.3,min:0,max:5,step:.1}}})})),z=e({__FramerMetadata__:()=>$,default:()=>Q});function B(e,...t){let n={};return t?.forEach(t=>t&&Object.assign(n,e[t])),n}var V,H,U,W,G,K,q,J,Y,X,Z,Q,$,ce=t((()=>{c(),x(),f(),l(),R(),w(),O(),I(),V=S(F),H={Ct3r5dYJN:{hover:!0},IkwlDgSNE:{hover:!0},LfzaEHgnz:{hover:!0},Smt45cZ9q:{hover:!0},sNkGrbKPE:{hover:!0},U5F4dWewS:{hover:!0},X9Y402saa:{hover:!0}},U=[`LfzaEHgnz`,`X9Y402saa`,`IkwlDgSNE`,`Smt45cZ9q`,`Ct3r5dYJN`,`U5F4dWewS`,`sNkGrbKPE`],W=`framer-2exiX`,G={Ct3r5dYJN:`framer-v-1vrga11`,IkwlDgSNE:`framer-v-2px5z8`,LfzaEHgnz:`framer-v-1l5mbgl`,Smt45cZ9q:`framer-v-vlwxoc`,sNkGrbKPE:`framer-v-1bsx1g7`,U5F4dWewS:`framer-v-16ih6bm`,X9Y402saa:`framer-v-163li6x`},K={delay:0,duration:.3,ease:[0,0,1,1],type:`tween`},q=({value:e,children:t})=>{let n=a(d),i=e??n.transition,o=r(()=>({...n,transition:i}),[JSON.stringify(i)]);return s(d.Provider,{value:o,children:t})},J={"Transparent (Arrow Icon)":`Smt45cZ9q`,"Transparent Mini":`U5F4dWewS`,"Transparent White Text":`sNkGrbKPE`,"White Mini":`Ct3r5dYJN`,Black:`LfzaEHgnz`,Transparent:`IkwlDgSNE`,White:`X9Y402saa`},Y=u.create(n),X=({height:e,id:t,label:n,link:r,width:i,...a})=>({...a,AsKz8VEWU:n??a.AsKz8VEWU??`Book a call`,jDbiQ7JsS:r??a.jDbiQ7JsS,variant:J[a.variant]??a.variant??`LfzaEHgnz`}),Z=(e,t)=>e.layoutDependency?t.join(`-`)+e.layoutDependency:t.join(`-`),Q=h(i(function(e,t){let r=o(null),i=t??r,a=te(),{activeLocale:c,setLocale:l}=ie();b();let{style:d,className:f,layoutId:h,variant:g,jDbiQ7JsS:_,AsKz8VEWU:y,...x}=X(e),{baseVariant:S,classNames:C,clearLoadingGesture:se,gestureHandlers:w,gestureVariant:T,isLoading:E,setGestureState:O,setVariant:k,variants:A}=m({cycleOrder:U,defaultVariant:`LfzaEHgnz`,enabledGestures:H,ref:i,variant:g,variantClassNames:G}),M=Z(e,A),N=v(W,D,j),P=()=>T===`Smt45cZ9q-hover`||S===`Smt45cZ9q`;return s(ne,{id:h??a,children:s(Y,{animate:A,initial:!1,children:s(q,{...B({Ct3r5dYJN:{value:K},U5F4dWewS:{value:K},X9Y402saa:{value:K}},S,T),children:s(oe,{href:_,motionChild:!0,nodeId:`LfzaEHgnz`,openInNewTab:!1,scopeId:`mkdyb58VB`,children:ee(u.a,{...x,...w,className:`${v(N,`framer-1l5mbgl`,f,C)} framer-dbox6c`,"data-framer-name":`Black`,layoutDependency:M,layoutId:`LfzaEHgnz`,ref:i,style:{borderBottomLeftRadius:999,borderBottomRightRadius:999,borderTopLeftRadius:999,borderTopRightRadius:999,boxShadow:`0px 0px 0px 1px rgba(38, 57, 90, 0.16), 0px 1px 1px 0px rgba(38, 57, 91, 0.1)`,...d},...B({"Ct3r5dYJN-hover":{"data-framer-name":void 0},"IkwlDgSNE-hover":{"data-framer-name":void 0},"LfzaEHgnz-hover":{"data-framer-name":void 0},"Smt45cZ9q-hover":{"data-framer-name":void 0},"sNkGrbKPE-hover":{"data-framer-name":void 0},"U5F4dWewS-hover":{"data-framer-name":void 0},"X9Y402saa-hover":{"data-framer-name":void 0},Ct3r5dYJN:{"data-framer-name":`White Mini`},IkwlDgSNE:{"data-framer-name":`Transparent`},Smt45cZ9q:{"data-framer-name":`Transparent (Arrow Icon)`},sNkGrbKPE:{"data-framer-name":`Transparent White Text`},U5F4dWewS:{"data-framer-name":`Transparent Mini`},X9Y402saa:{"data-framer-name":`White`}},S,T),children:[s(u.div,{className:`framer-swbxuu`,"data-framer-name":`Glow`,layoutDependency:M,layoutId:`PeCHocGh_`,style:{borderBottomLeftRadius:44,borderBottomRightRadius:44,borderTopLeftRadius:44,borderTopRightRadius:44,opacity:0},variants:{"Ct3r5dYJN-hover":{opacity:.7},"IkwlDgSNE-hover":{opacity:.3},"LfzaEHgnz-hover":{opacity:.7},"Smt45cZ9q-hover":{opacity:.3},"sNkGrbKPE-hover":{opacity:.3},"U5F4dWewS-hover":{opacity:.3},"X9Y402saa-hover":{opacity:.6}},children:s(p,{className:`framer-12yb0d7-container`,layoutDependency:M,layoutId:`uu8EXHobl-container`,rendersWithMotion:!0,style:{borderBottomLeftRadius:1e3,borderBottomRightRadius:1e3,borderTopLeftRadius:1e3,borderTopRightRadius:1e3,filter:`blur(5px)`,WebkitFilter:`blur(5px)`},children:s(ae,{__fromCanvasComponent:!0,animated:L.animated,buffers:L.buffers,fallbackImage:`http://localhost:8137/assets/framerusercontent.com/images/5Ckt2QR4YEmQXqkie4amifMhcg__qe6835e85.png`,fragmentShader:L.fragment,height:`100%`,heightmapSource:L.heightmapSource,mode:`progressive`,mouse:L.mouse&&{enabled:L.mouse===`enabledByDefault`},resolutionScale:L.resolutionScale,skipInitialFallback:!0,uniforms:{u_colors:{type:`array`,value:[`rgb(22, 255, 222)`,`rgb(22, 255, 222)`,`rgb(249, 157, 114)`,`rgb(249, 157, 114)`,`rgb(249, 157, 114)`]},u_edgeDisp:{type:`number`,value:5},u_ephemeralAmp:{type:`number`,value:.5},u_lensScale:{type:`number`,value:.1},u_ringDispersion:{type:`number`,value:0},u_ringRadius:{type:`number`,value:.1},u_ringSpacing:{type:`number`,value:.1},u_ringWarpStrength:{type:`number`,value:5},u_seed:{type:`number`,value:206},u_speed:{type:`number`,value:.5}},vertexShader:L.vertex,width:`100%`,...B({"Ct3r5dYJN-hover":{fallbackImage:`http://localhost:8137/assets/framerusercontent.com/images/VrNfp5TpzlmUPOYdDwAEUbaUCn0__q5387af73.png`},"LfzaEHgnz-hover":{uniforms:{u_colors:{type:`array`,value:[`rgb(22, 255, 222)`,`rgb(22, 255, 222)`,`rgb(249, 157, 114)`,`rgb(249, 157, 114)`,`rgb(249, 157, 114)`]},u_edgeDisp:{type:`number`,value:5},u_ephemeralAmp:{type:`number`,value:.5},u_lensScale:{type:`number`,value:.1},u_ringDispersion:{type:`number`,value:0},u_ringRadius:{type:`number`,value:.1},u_ringSpacing:{type:`number`,value:.1},u_ringWarpStrength:{type:`number`,value:5},u_seed:{type:`number`,value:206},u_speed:{type:`number`,value:0}}},"Smt45cZ9q-hover":{fallbackImage:`http://localhost:8137/assets/framerusercontent.com/images/gblK5QxyjG4IlarMlhUbDvhss__qe83e90c5.png`},"sNkGrbKPE-hover":{fallbackImage:`http://localhost:8137/assets/framerusercontent.com/images/Zp2jQZs3oE9LyfPqhb9BMlYzc2M__qe6835e81.png`},"U5F4dWewS-hover":{fallbackImage:`http://localhost:8137/assets/framerusercontent.com/images/VrNfp5TpzlmUPOYdDwAEUbaUCn0__q5387af73.png`},Ct3r5dYJN:{fallbackImage:`http://localhost:8137/assets/framerusercontent.com/images/dquQ16WH5goiY0iR4H883w5aMI__q10b7d832.png`},Smt45cZ9q:{fallbackImage:`http://localhost:8137/assets/framerusercontent.com/images/fMC6yM5PTPfly3IfYCBIb5mD8__q7f415885.png`},U5F4dWewS:{fallbackImage:`http://localhost:8137/assets/framerusercontent.com/images/Y8t1cUqsUVbFkkbKdgt01RGzzY__q5387af10.png`}},S,T)})})}),s(u.div,{className:`framer-cgbxue`,"data-framer-name":`BG`,layoutDependency:M,layoutId:`CVB0bhHwa`,style:{backdropFilter:`none`,backgroundColor:`var(--token-e74bddf3-bb42-4096-a361-48bbdc0282c9, rgb(26, 24, 20))`,borderBottomLeftRadius:999,borderBottomRightRadius:999,borderTopLeftRadius:999,borderTopRightRadius:999,boxShadow:`0px 0px 0px 1px rgba(38, 57, 90, 0.16), 0px 1px 1px 0px rgba(38, 57, 91, 0.1)`,WebkitBackdropFilter:`none`},variants:{"Ct3r5dYJN-hover":{backdropFilter:`none`,WebkitBackdropFilter:`none`},"IkwlDgSNE-hover":{backdropFilter:`none`,backgroundColor:`rgba(255, 255, 255, 0.8)`,boxShadow:`0px 0px 0px 1px rgba(38, 57, 90, 0.16), 0px 5px 5px 0px rgba(38, 57, 91, 0.15)`,WebkitBackdropFilter:`none`},"LfzaEHgnz-hover":{backdropFilter:`none`,boxShadow:`0px 0px 0px 1px rgba(38, 57, 90, 0.16), 0px 5px 5px 0px rgba(38, 57, 91, 0.15)`,WebkitBackdropFilter:`none`},"Smt45cZ9q-hover":{backdropFilter:`none`,backgroundColor:`rgba(255, 255, 255, 0.4)`,WebkitBackdropFilter:`none`},"sNkGrbKPE-hover":{backgroundColor:`rgba(255, 255, 255, 0.4)`},"U5F4dWewS-hover":{backgroundColor:`rgba(255, 255, 255, 0.4)`},"X9Y402saa-hover":{backdropFilter:`none`,boxShadow:`0px 0px 0px 1px rgba(38, 57, 90, 0.16), 0px 5px 5px 0px rgba(38, 57, 91, 0.15)`,WebkitBackdropFilter:`none`},Ct3r5dYJN:{backgroundColor:`rgb(255, 255, 255)`},IkwlDgSNE:{backgroundColor:`rgba(255, 255, 255, 0.12)`},Smt45cZ9q:{backgroundColor:`rgba(255, 255, 255, 0.2)`,boxShadow:`0px 0px 0px 1px rgba(38, 57, 90, 0.16)`},sNkGrbKPE:{backdropFilter:`blur(10px)`,backgroundColor:`rgba(255, 255, 255, 0.12)`,WebkitBackdropFilter:`blur(10px)`},U5F4dWewS:{backdropFilter:`blur(10px)`,backgroundColor:`rgba(255, 255, 255, 0.12)`,WebkitBackdropFilter:`blur(10px)`},X9Y402saa:{backgroundColor:`rgb(255, 255, 255)`}}}),s(re,{__fromCanvasComponent:!0,children:s(n,{children:s(u.p,{className:`framer-styles-preset-9hd9gv`,"data-styles-preset":`C9QVuNHI_`,dir:`auto`,style:{"--framer-text-color":`var(--extracted-r6o4lv, var(--token-0718e719-2f2c-45f0-b9f0-f84834bc4dae, rgb(254, 250, 243)))`},children:`Book a call`})}),className:`framer-rsqokw`,"data-framer-name":`Request Demo Text`,draggable:`false`,fonts:[`Inter`],layoutDependency:M,layoutId:`WEQynoPWm`,style:{"--extracted-r6o4lv":`var(--token-0718e719-2f2c-45f0-b9f0-f84834bc4dae, rgb(254, 250, 243))`,"--framer-paragraph-spacing":`0px`},text:y,variants:{Ct3r5dYJN:{"--extracted-r6o4lv":`var(--token-e74bddf3-bb42-4096-a361-48bbdc0282c9, rgb(26, 24, 20))`},IkwlDgSNE:{"--extracted-r6o4lv":`var(--token-e74bddf3-bb42-4096-a361-48bbdc0282c9, rgb(26, 24, 20))`},Smt45cZ9q:{"--extracted-r6o4lv":`var(--token-e9be535d-6f70-4886-acdd-908c9afdb72f, rgb(255, 255, 255))`},sNkGrbKPE:{"--extracted-r6o4lv":`var(--token-e9be535d-6f70-4886-acdd-908c9afdb72f, rgb(255, 255, 255))`},U5F4dWewS:{"--extracted-r6o4lv":`var(--token-e9be535d-6f70-4886-acdd-908c9afdb72f, rgb(255, 255, 255))`},X9Y402saa:{"--extracted-r6o4lv":`var(--token-e74bddf3-bb42-4096-a361-48bbdc0282c9, rgb(26, 24, 20))`}},verticalAlignment:`top`,withExternalLayout:!0,...B({Ct3r5dYJN:{children:s(n,{children:s(u.p,{className:`framer-styles-preset-1rksn60`,"data-styles-preset":`HFjN2pmoM`,dir:`auto`,style:{"--framer-text-color":`var(--extracted-r6o4lv, var(--token-e74bddf3-bb42-4096-a361-48bbdc0282c9, rgb(26, 24, 20)))`},children:`Book a call`})})},IkwlDgSNE:{children:s(n,{children:s(u.p,{className:`framer-styles-preset-9hd9gv`,"data-styles-preset":`C9QVuNHI_`,dir:`auto`,style:{"--framer-text-color":`var(--extracted-r6o4lv, var(--token-e74bddf3-bb42-4096-a361-48bbdc0282c9, rgb(26, 24, 20)))`},children:`Book a call`})})},Smt45cZ9q:{children:s(n,{children:s(u.p,{className:`framer-styles-preset-1rksn60`,"data-styles-preset":`HFjN2pmoM`,dir:`auto`,style:{"--framer-text-color":`var(--extracted-r6o4lv, var(--token-e9be535d-6f70-4886-acdd-908c9afdb72f, rgb(255, 255, 255)))`},children:`Book a call`})})},sNkGrbKPE:{children:s(n,{children:s(u.p,{className:`framer-styles-preset-9hd9gv`,"data-styles-preset":`C9QVuNHI_`,dir:`auto`,style:{"--framer-text-color":`var(--extracted-r6o4lv, var(--token-e9be535d-6f70-4886-acdd-908c9afdb72f, rgb(255, 255, 255)))`},children:`Book a call`})})},U5F4dWewS:{children:s(n,{children:s(u.p,{className:`framer-styles-preset-1rksn60`,"data-styles-preset":`HFjN2pmoM`,dir:`auto`,style:{"--framer-text-color":`var(--extracted-r6o4lv, var(--token-e9be535d-6f70-4886-acdd-908c9afdb72f, rgb(255, 255, 255)))`},children:`Book a call`})})},X9Y402saa:{children:s(n,{children:s(u.p,{className:`framer-styles-preset-9hd9gv`,"data-styles-preset":`C9QVuNHI_`,dir:`auto`,style:{"--framer-text-color":`var(--extracted-r6o4lv, var(--token-e74bddf3-bb42-4096-a361-48bbdc0282c9, rgb(26, 24, 20)))`},children:`Book a call`})})}},S,T)}),P()&&s(F,{animated:!0,className:`framer-jkbr7x`,draggable:`false`,layoutDependency:M,layoutId:`u5OlnmMP6`,style:{"--1tfqbvp":`rgb(255, 255, 255)`}})]})})})})})}),[`.framer-2exiX.framer-dbox6c, .framer-2exiX .framer-dbox6c { display: block; }`,`.framer-2exiX.framer-1l5mbgl { align-content: center; align-items: center; cursor: pointer; display: flex; flex-direction: row; flex-wrap: nowrap; gap: 8px; height: min-content; justify-content: center; overflow: visible; padding: 8px 14px 8px 14px; position: relative; text-decoration: none; width: min-content; }`,`.framer-2exiX .framer-swbxuu { flex: none; height: 36px; position: absolute; right: 6px; top: 4px; width: 94%; }`,`.framer-2exiX .framer-12yb0d7-container { bottom: 0px; flex: none; left: 0px; position: absolute; right: 0px; top: 0px; }`,`.framer-2exiX .framer-cgbxue { align-content: center; align-items: center; bottom: 0px; display: flex; flex: none; flex-direction: row; flex-wrap: nowrap; gap: 8px; justify-content: center; left: 0px; overflow: var(--overflow-clip-fallback, clip); padding: 8px 14px 8px 14px; position: absolute; right: 0px; top: 0px; will-change: var(--framer-will-change-override, transform); }`,`.framer-2exiX .framer-rsqokw { -webkit-user-select: none; flex: none; height: auto; position: relative; user-select: none; white-space: pre; width: auto; }`,`.framer-2exiX .framer-jkbr7x { flex: none; height: auto; position: relative; width: 16px; }`,`.framer-2exiX.framer-v-vlwxoc .framer-swbxuu { height: 30px; width: 94%; }`,`.framer-2exiX.framer-v-vlwxoc .framer-cgbxue { padding: 8px 8px 8px 12px; }`,`.framer-2exiX.framer-v-1vrga11 .framer-swbxuu { height: 30px; width: 93%; }`,`.framer-2exiX.framer-v-1vrga11 .framer-cgbxue { padding: 8px 12px 8px 12px; }`,`.framer-2exiX.framer-v-1l5mbgl.hover .framer-swbxuu, .framer-2exiX.framer-v-2px5z8.hover .framer-swbxuu, .framer-2exiX.framer-v-163li6x.hover .framer-swbxuu { right: 10px; top: 10px; width: 94%; }`,`.framer-2exiX.framer-v-vlwxoc.hover .framer-swbxuu, .framer-2exiX.framer-v-1vrga11.hover .framer-swbxuu { right: 8px; top: 8px; width: 94%; }`,`.framer-2exiX.framer-v-16ih6bm.hover .framer-swbxuu { height: 30px; right: 8px; top: 8px; width: 94%; }`,`.framer-2exiX.framer-v-1bsx1g7.hover .framer-swbxuu { height: 38px; right: 10px; top: 10px; width: 94%; }`,...T,...k],`framer-2exiX`),Q.displayName=`Button`,Q.defaultProps={height:40,width:110.5},_(Q,{variant:{options:[`LfzaEHgnz`,`X9Y402saa`,`IkwlDgSNE`,`Smt45cZ9q`,`Ct3r5dYJN`,`U5F4dWewS`,`sNkGrbKPE`],optionTitles:[`Black`,`White`,`Transparent`,`Transparent (Arrow Icon)`,`White Mini`,`Transparent Mini`,`Transparent White Text`],title:`Variant`,type:C.Enum},jDbiQ7JsS:{title:`Link`,type:C.Link},AsKz8VEWU:{defaultValue:`Book a call`,displayTextArea:!1,title:`Label`,type:C.String},onAsKz8VEWUChange:{changes:`AsKz8VEWU`,type:C.ChangeHandler}}),g(Q,[{explicitInter:!0,fonts:[{cssFamilyName:`Inter`,source:`framer`,style:`normal`,uiFamilyName:`Inter`,unicodeRange:`U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F`,url:`http://localhost:8137/assets/framerusercontent.com/assets/5vvr9Vy74if2I6bQbJvbw7SY1pQ.woff2`,weight:`400`},{cssFamilyName:`Inter`,source:`framer`,style:`normal`,uiFamilyName:`Inter`,unicodeRange:`U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116`,url:`http://localhost:8137/assets/framerusercontent.com/assets/EOr0mi4hNtlgWNn9if640EZzXCo.woff2`,weight:`400`},{cssFamilyName:`Inter`,source:`framer`,style:`normal`,uiFamilyName:`Inter`,unicodeRange:`U+1F00-1FFF`,url:`http://localhost:8137/assets/framerusercontent.com/assets/Y9k9QrlZAqio88Klkmbd8VoMQc.woff2`,weight:`400`},{cssFamilyName:`Inter`,source:`framer`,style:`normal`,uiFamilyName:`Inter`,unicodeRange:`U+0370-03FF`,url:`http://localhost:8137/assets/framerusercontent.com/assets/OYrD2tBIBPvoJXiIHnLoOXnY9M.woff2`,weight:`400`},{cssFamilyName:`Inter`,source:`framer`,style:`normal`,uiFamilyName:`Inter`,unicodeRange:`U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF`,url:`http://localhost:8137/assets/framerusercontent.com/assets/JeYwfuaPfZHQhEG8U5gtPDZ7WQ.woff2`,weight:`400`},{cssFamilyName:`Inter`,source:`framer`,style:`normal`,uiFamilyName:`Inter`,unicodeRange:`U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2070, U+2074-207E, U+2080-208E, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD`,url:`http://localhost:8137/assets/framerusercontent.com/assets/GrgcKwrN6d3Uz8EwcLHZxwEfC4.woff2`,weight:`400`},{cssFamilyName:`Inter`,source:`framer`,style:`normal`,uiFamilyName:`Inter`,unicodeRange:`U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+1EA0-1EF9, U+20AB`,url:`http://localhost:8137/assets/framerusercontent.com/assets/b6Y37FthZeALduNqHicBT6FutY.woff2`,weight:`400`}]},...V,...y(E),...y(A)],{supportsExplicitInterCodegen:!0}),$={exports:{Props:{type:`tsType`,annotations:{framerContractVersion:`1`}},default:{type:`reactComponent`,name:`Framermkdyb58VB`,slots:[],annotations:{framerCanvasComponentVariantDetails:`{"propertyName":"variant","data":{"default":{"layout":["auto","auto"]},"X9Y402saa":{"layout":["auto","auto"]},"IkwlDgSNE":{"layout":["auto","auto"]},"Smt45cZ9q":{"layout":["auto","auto"]},"Ct3r5dYJN":{"layout":["auto","auto"]},"U5F4dWewS":{"layout":["auto","auto"]},"sNkGrbKPE":{"layout":["auto","auto"]},"REZpc6UE6":{"layout":["auto","auto"]},"rMoO26bSu":{"layout":["auto","auto"]},"gzLfS2qlE":{"layout":["auto","auto"]},"A9Mb4bY7o":{"layout":["auto","auto"]},"lTdsC744Y":{"layout":["auto","auto"]},"bP9YuHPfo":{"layout":["auto","auto"]},"TDVGngtxd":{"layout":["auto","auto"]}}}`,framerIntrinsicWidth:`110.5`,framerAutoSizeImages:`true`,framerImmutableVariables:`true`,framerIntrinsicHeight:`40`,framerContractVersion:`1`,framerComponentViewportWidth:`true`,framerDisplayContentsDiv:`false`,framerVariables:`{"jDbiQ7JsS":"link","AsKz8VEWU":"label"}`,framerColorSyntax:`true`}},__FramerMetadata__:{type:`variable`}}}}));export{R as a,L as i,ce as n,F as o,z as r,I as s,Q as t};
//# sourceMappingURL=mkdyb58VB.Ox-SPixJ.mjs.map