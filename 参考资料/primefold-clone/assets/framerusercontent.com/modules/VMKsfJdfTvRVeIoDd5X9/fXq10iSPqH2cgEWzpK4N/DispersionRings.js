// Dispersion Rings
import{defineShader,ControlType}from"framer";export default defineShader({title:"Rings",fragment:`
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
`,propertyControls:{colors:{type:ControlType.Array,title:"Colors",control:{type:ControlType.Color},maxCount:8,defaultValue:["#91FFCC","#FFB938","#FF4242"]},seed:{type:ControlType.Number,title:"Seed",defaultValue:47,min:0,max:1e3,step:1},speed:{type:ControlType.Number,title:"Speed",defaultValue:.5,min:0,max:2,step:.01},ephemeralAmp:{type:ControlType.Number,title:"Ephemeral",defaultValue:.12,min:0,max:.5,step:.01},lensScale:{type:ControlType.Number,title:"Scale",defaultValue:10,min:.1,max:10,step:.1},ringSpacing:{type:ControlType.Number,title:"Spacing",defaultValue:1.5,min:.1,max:5,step:.1},ringRadius:{type:ControlType.Number,title:"Radius",defaultValue:1,min:.1,max:2,step:.01},ringWarpStrength:{type:ControlType.Number,title:"Warp",defaultValue:4,min:0,max:5,step:.1},ringDispersion:{type:ControlType.Number,title:"Dispersion",defaultValue:.4,min:0,max:1,step:.01},edgeDisp:{type:ControlType.Number,title:"Edges",defaultValue:1.3,min:0,max:5,step:.1}}});
export const __FramerMetadata__ = {"exports":{"default":{"type":"shader","name":null,"annotations":{"framerContractVersion":"1"}},"__FramerMetadata__":{"type":"variable"}}}
//# sourceMappingURL=./DispersionRings.map