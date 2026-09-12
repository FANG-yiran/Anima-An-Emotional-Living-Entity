// ============ 六态 GPU 生命体：统一粒子系统（WebGL2 + GLSL300 + GPGPU） ============
// - 所有形态共用同一粒子缓冲区（位置+速度 FBO 乒乓），参数池控制行为
// - liquid-Ether 流体模拟作为底层速度场，粒子按 fluidMix 权重采样
// - 六种依恋状态：dormant / secure / anxious / avoidant / fearful / fusion
// - 状态切换：参数插值（easeInOut）+ 位置贝塞尔形态过渡（morphFactor 1.5-3s）
import * as THREE from "three";
import type { EngineSnapshot } from "./types";

// ==================== 类型与状态参数池 ====================
export type AttachmentState =
  | "dormant" // 休眠/混沌：散落星尘
  | "secure" // 安全型：轨道呼吸
  | "anxious" // 焦虑型：以太流体，分裂包裹光标
  | "avoidant" // 回避型：迁移路径，远离光标
  | "fearful" // 恐惧/混乱：多涡旋撕裂 + 蝴蝶效应
  | "fusion"; // 融合/共生：灵魂丝线 + 沙人

export const STATE_ORDER: AttachmentState[] = [
  "dormant", "secure", "anxious", "avoidant", "fearful", "fusion",
];

/** 间奏异象：涟漪水面（同一状态驻留过久时浮现） */
export type InterludeType = "ripple" | null;

/** 同一状态驻留满 15s 触发间奏；间奏持续 4s，结束后随机切换到另一状态 */
const INTERLUDE_TRIGGER_MS = 15000;
const INTERLUDE_DURATION_MS = 4000;
const INTERLUDE_FADE_IN_MS = 700;
const INTERLUDE_FADE_OUT_MS = 800;

export interface StateParams {
  cohesion: number; // 凝聚力
  cursorForce: number; // 光标力
  vortex: number; // 涡旋（切向力）
  connect: number; // 连接（丝线）
  turbulence: number; // 湍流
  fluidMix: number; // 流体速度场采样权重
  orbit: number; // 轨道运动（安全态呼吸环）
  migration: number; // 迁移路径强度
  sandPull: number; // 人形吸引
  repel: number; // 1 = 光标力反向（回避）
  split: number; // 涡旋轴反转比例（恐惧态 arousal>0.75 时 0.5）
  size: number; // 粒子尺寸
  colorTemp: number; // 色温 0-1
}

export const STATE_PARAMS: Record<AttachmentState, StateParams> = {
  dormant:  { cohesion: 0.05, cursorForce: 0.1, vortex: 0,   connect: 0,   turbulence: 0.02, fluidMix: 0,    orbit: 0,   migration: 0,  sandPull: 0,  repel: 0, split: 0, size: 1.0,  colorTemp: 0.2  },
  secure:   { cohesion: 0.55, cursorForce: 0.4, vortex: 0.1, connect: 0.2, turbulence: 0.05, fluidMix: 0.1,  orbit: 1,   migration: 0,  sandPull: 0.3, repel: 0, split: 0, size: 1.15, colorTemp: 0.5  },
  anxious:  { cohesion: 0.75, cursorForce: 0.9, vortex: 0.3, connect: 0.4, turbulence: 0.25, fluidMix: 1,    orbit: 0,   migration: 0,  sandPull: 0,  repel: 0, split: 0, size: 1.4,  colorTemp: 0.7  },
  avoidant: { cohesion: 0.28, cursorForce: 0.38, vortex: 0,  connect: 0.05, turbulence: 0.08, fluidMix: 0.05, orbit: 0,  migration: 1,  sandPull: 0,  repel: 1, split: 0, size: 0.9,  colorTemp: 0.4  },
  fearful:  { cohesion: 0.45, cursorForce: 0.65, vortex: 0.55, connect: 0.15, turbulence: 0.26, fluidMix: 0.2,  orbit: 0,  migration: 0,  sandPull: 0,  repel: 0, split: 0.35, size: 1.2, colorTemp: 0.6  },
  fusion:   { cohesion: 0.7,  cursorForce: 0.5, vortex: 0.05, connect: 0.9, turbulence: 0.03, fluidMix: 0.3,  orbit: 0.4, migration: 0,  sandPull: 0.5, repel: 0, split: 0, size: 1.3,  colorTemp: 0.85 },
};

// 状态对过渡速度（未列出的对默认 1.0）
const TRANSITION_SPEED: Record<string, number> = {
  "dormant->secure": 0.5,
  "secure->anxious": 1.8,
  "anxious->avoidant": 2.2,
  "avoidant->fearful": 2.5,
  "fearful->secure": 0.4,
  "secure->fusion": 0.35,
  "fusion->dormant": 0.3,
};

function transitionSpeed(a: AttachmentState, b: AttachmentState): number {
  const k = `${a}->${b}`;
  const rk = `${b}->${a}`;
  return TRANSITION_SPEED[k] ?? TRANSITION_SPEED[rk] ?? 1.0;
}

/** 六态判定：三轴 + 历史累积 + 相对上一态的粘滞（减少形态抖动） */
export function detectAttachmentState(
  s: {
    axis_approach: number;
    axis_safety: number;
    axis_arousal: number;
    axis_manifest: number;
  },
  history: { approachCount: number; totalEvents: number; anxiousSeen?: boolean },
  prev: AttachmentState
): AttachmentState {
  const ap = s.axis_approach;
  const sa = s.axis_safety;
  const ar = s.axis_arousal;
  const m = s.axis_manifest;

  // 休眠：未成形（观众尚未激活它）
  if (m < 0.12) return "dormant";

  // 融合：历史累积解锁 + 三轴同时高涨（最高凝聚态）
  const fusionUnlocked =
    history.approachCount >= 6 && history.totalEvents >= 18;
  if (
    fusionUnlocked &&
    ap > 0.5 && sa > 0.5 && ar > 0.5
  ) {
    return "fusion";
  }

  // 候选态：边界清晰，但 avoidant 略放宽以便「退开/疏离」能进入螺旋
  let candidate: AttachmentState | null = null;
  if (sa < 0.44 && ar > 0.55) candidate = "fearful";
  else if (ap > 0.58 && sa < 0.46 && ar > 0.52) candidate = "anxious";
  else if (ap < 0.50 && ar < 0.62 && sa < 0.58) candidate = "avoidant";
  else if (sa > 0.62 && ap >= 0.42) candidate = "secure";

  // 焦虑型已出现过一次后，其再次触发改判为恐惧型
  if (candidate === "anxious" && history.anxiousSeen) candidate = "fearful";

  if (!candidate) return prev;
  if (candidate === prev) return prev;

  // 粘滞：换态需比维持上一态「更成立」——用余量二次确认
  const margin = 0.05;
  const holds = (st: AttachmentState): boolean => {
    switch (st) {
      case "fearful": return sa < 0.44 + margin && ar > 0.55 - margin;
      case "anxious": return ap > 0.58 - margin && sa < 0.46 + margin && ar > 0.52 - margin;
      case "avoidant": return ap < 0.50 + margin && ar < 0.62 + margin && sa < 0.58 + margin;
      case "secure": return sa > 0.62 - margin && ap >= 0.42 - margin;
      case "fusion": return fusionUnlocked && ap > 0.45 && sa > 0.45 && ar > 0.45;
      case "dormant": return m < 0.18;
      default: return false;
    }
  };
  // 仅当当前态条件已不成立、候选态明确成立时才切换
  if (holds(prev) && prev !== "dormant") return prev;
  return candidate;
}

// ==================== 工具 ====================
function smooth01(t: number): number {
  return t * t * (3 - 2 * t);
}
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** 色温渐变调色板（DataTexture，1×N） */
function makePaletteTexture(stops: string[]): THREE.DataTexture {
  const w = stops.length;
  const data = new Uint8Array(w * 4);
  for (let i = 0; i < w; i++) {
    const c = new THREE.Color(stops[i]);
    data[i * 4 + 0] = Math.round(c.r * 255);
    data[i * 4 + 1] = Math.round(c.g * 255);
    data[i * 4 + 2] = Math.round(c.b * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, w, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** 人形轮廓点阵（沙人目标），0-1 坐标，1×SIL_POINTS 纹理 */
function makeSilhouetteTexture(count: number): THREE.DataTexture {
  const data = new Float32Array(count * 4);
  const parts = [
    { cx: 0, cy: 0.66, rx: 0.045, ry: 0.06, w: 0.12 }, // 头
    { cx: 0, cy: 0.4, rx: 0.06, ry: 0.2, w: 0.3 }, // 躯干
    { cx: -0.14, cy: 0.52, rx: 0.07, ry: 0.12, w: 0.16 }, // 左臂
    { cx: 0.14, cy: 0.52, rx: 0.07, ry: 0.12, w: 0.16 }, // 右臂
    { cx: -0.045, cy: 0.14, rx: 0.035, ry: 0.16, w: 0.18 }, // 左腿
    { cx: 0.045, cy: 0.14, rx: 0.035, ry: 0.16, w: 0.18 }, // 右腿
  ];
  const cum: number[] = [];
  let sum = 0;
  for (const p of parts) {
    sum += p.w;
    cum.push(sum);
  }
  for (let i = 0; i < count; i++) {
    let r = Math.random() * sum;
    let part = parts[parts.length - 1];
    for (let j = 0; j < cum.length; j++) {
      if (r < cum[j]) {
        part = parts[j];
        break;
      }
    }
    // 椭圆内采样
    let x = 0;
    let y = 0;
    let inside = false;
    while (!inside) {
      x = (Math.random() - 0.5) * 2;
      y = (Math.random() - 0.5) * 2;
      inside = (x * x) / (part.rx * part.rx) + (y * y) / (part.ry * part.ry) <= 1;
    }
    data[i * 4 + 0] = 0.5 + part.cx + x * part.rx;
    data[i * 4 + 1] = 0.5 + part.cy + y * part.ry;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 0;
  }
  const tex = new THREE.DataTexture(data, count, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// ==================== 着色器（GLSL 300 es） ====================
const NDC_FUNC = `
uniform vec2 uRes;
vec2 ndc(vec2 p){ return vec2(p.x/uRes.x*2.0-1.0, 1.0-p.y/uRes.y*2.0); }
`;

const HASH_FUNC = `
float hash(float n){ return fract(sin(n)*43758.5453123); }
vec2 hash2(float n){ return vec2(hash(n), hash(n+7.31)); }
`;

// ---- 流体模拟（liquid-Ether 移植，GLSL300） ----
const fluid_face_vert = `
in vec3 position;
uniform vec2 px;
uniform vec2 boundarySpace;
out vec2 vUv;
void main(){
  vec3 pos = position;
  vec2 scale = 1.0 - boundarySpace * 2.0;
  pos.xy = pos.xy * scale;
  vUv = vec2(0.5)+(pos.xy)*0.5;
  gl_Position = vec4(pos, 1.0);
}
`;
const fluid_line_vert = `
in vec3 position;
uniform vec2 px;
out vec2 vUv;
void main(){
  vec3 pos = position;
  vUv = 0.5 + pos.xy * 0.5;
  vec2 n = sign(pos.xy);
  pos.xy = abs(pos.xy) - px * 1.0;
  pos.xy *= n;
  gl_Position = vec4(pos, 1.0);
}
`;
const fluid_mouse_vert = `
in vec3 position;
in vec2 uv;
uniform vec2 center;
uniform vec2 scale;
uniform vec2 px;
out vec2 vUv;
void main(){
  vec2 pos = position.xy * scale * 2.0 * px + center;
  vUv = uv;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;
const fluid_advection_frag = `
precision highp float;
uniform sampler2D velocity;
uniform float dt;
uniform bool isBFECC;
uniform vec2 fboSize;
uniform vec2 px;
in vec2 vUv;
out vec4 fragColor;
void main(){
  vec2 ratio = max(fboSize.x, fboSize.y) / fboSize;
  if(isBFECC == false){
    vec2 vel = texture(velocity, vUv).xy;
    vec2 uv2 = vUv - vel * dt * ratio;
    vec2 newVel = texture(velocity, uv2).xy;
    fragColor = vec4(newVel, 0.0, 0.0);
  } else {
    vec2 spot_new = vUv;
    vec2 vel_old = texture(velocity, vUv).xy;
    vec2 spot_old = spot_new - vel_old * dt * ratio;
    vec2 vel_new1 = texture(velocity, spot_old).xy;
    vec2 spot_new2 = spot_old + vel_new1 * dt * ratio;
    vec2 error = spot_new2 - spot_new;
    vec2 spot_new3 = spot_new - error / 2.0;
    vec2 vel_2 = texture(velocity, spot_new3).xy;
    vec2 spot_old2 = spot_new3 - vel_2 * dt * ratio;
    vec2 newVel2 = texture(velocity, spot_old2).xy;
    fragColor = vec4(newVel2, 0.0, 0.0);
  }
}
`;
const fluid_divergence_frag = `
precision highp float;
uniform sampler2D velocity;
uniform float dt;
uniform vec2 px;
in vec2 vUv;
out vec4 fragColor;
void main(){
  float x0 = texture(velocity, vUv-vec2(px.x, 0.0)).x;
  float x1 = texture(velocity, vUv+vec2(px.x, 0.0)).x;
  float y0 = texture(velocity, vUv-vec2(0.0, px.y)).y;
  float y1 = texture(velocity, vUv+vec2(0.0, px.y)).y;
  float divergence = (x1 - x0 + y1 - y0) / 2.0;
  fragColor = vec4(divergence / dt);
}
`;
const fluid_externalForce_frag = `
precision highp float;
uniform vec2 force;
uniform vec2 center;
uniform vec2 scale;
uniform vec2 px;
in vec2 vUv;
out vec4 fragColor;
void main(){
  vec2 circle = (vUv - 0.5) * 2.0;
  float d = 1.0 - min(length(circle), 1.0);
  d *= d;
  fragColor = vec4(force * d, 0.0, 1.0);
}
`;
const fluid_poisson_frag = `
precision highp float;
uniform sampler2D pressure;
uniform sampler2D divergence;
uniform vec2 px;
in vec2 vUv;
out vec4 fragColor;
void main(){
  float p0 = texture(pressure, vUv + vec2(px.x * 2.0, 0.0)).r;
  float p1 = texture(pressure, vUv - vec2(px.x * 2.0, 0.0)).r;
  float p2 = texture(pressure, vUv + vec2(0.0, px.y * 2.0)).r;
  float p3 = texture(pressure, vUv - vec2(0.0, px.y * 2.0)).r;
  float div = texture(divergence, vUv).r;
  float newP = (p0 + p1 + p2 + p3) / 4.0 - div;
  fragColor = vec4(newP);
}
`;
const fluid_pressure_frag = `
precision highp float;
uniform sampler2D pressure;
uniform sampler2D velocity;
uniform vec2 px;
uniform float dt;
in vec2 vUv;
out vec4 fragColor;
void main(){
  float step = 1.0;
  float p0 = texture(pressure, vUv + vec2(px.x * step, 0.0)).r;
  float p1 = texture(pressure, vUv - vec2(px.x * step, 0.0)).r;
  float p2 = texture(pressure, vUv + vec2(0.0, px.y * step)).r;
  float p3 = texture(pressure, vUv - vec2(0.0, px.y * step)).r;
  vec2 v = texture(velocity, vUv).xy;
  vec2 gradP = vec2(p0 - p1, p2 - p3) * 0.5;
  v = v - gradP * dt;
  fragColor = vec4(v, 0.0, 1.0);
}
`;
const fluid_viscous_frag = `
precision highp float;
uniform sampler2D velocity;
uniform sampler2D velocity_new;
uniform float v;
uniform vec2 px;
uniform float dt;
in vec2 vUv;
out vec4 fragColor;
void main(){
  vec2 old = texture(velocity, vUv).xy;
  vec2 new0 = texture(velocity_new, vUv + vec2(px.x * 2.0, 0.0)).xy;
  vec2 new1 = texture(velocity_new, vUv - vec2(px.x * 2.0, 0.0)).xy;
  vec2 new2 = texture(velocity_new, vUv + vec2(0.0, px.y * 2.0)).xy;
  vec2 new3 = texture(velocity_new, vUv - vec2(0.0, px.y * 2.0)).xy;
  vec2 newv = 4.0 * old + v * dt * (new0 + new1 + new2 + new3);
  newv /= 4.0 * (1.0 + v * dt);
  fragColor = vec4(newv, 0.0, 0.0);
}
`;

// ---- 回避态：动态上升螺线几何（更新 pass / 粒子点 pass 共享） ----
// 螺线仅作「骨架」：粒子沿 5 条上升螺线聚成有厚度的光点簇（而非一维线条）；
// 半径轮廓固定、角度沿 s 流动，投影为持续上升的螺纹；近光标加速并外推避让。
const LINE_GEOM_GLSL = `
#define SH_LINES 5.0
// 壳截面半径（归一化 ×R），s: 0 底水管尖 → 1 螺塔顶
float shellRadius(float s){
  float canal = 0.015 + 0.08 * smoothstep(0.0, 0.14, s);
  float body  = 1.05 * exp(-pow((s - 0.40) / 0.175, 2.0));
  float spire = smoothstep(0.60, 0.72, s)
              * pow(clamp((0.995 - s) / 0.34, 0.0, 1.0), 1.1) * 0.42;
  float suture = 1.0 + 0.04 * sin(s * 23.0) + 0.02 * sin(s * 41.0 + 2.1);
  return (canal + body + spire) * suture;
}
float shellTurns(float s){
  return 0.9 * smoothstep(0.14, 0.58, s) + 2.1 * smoothstep(0.58, 0.99, s);
}
float shellCenter(float s, float time, float R){
  float bias = -0.10 * smoothstep(0.0, 0.35, s) + 0.05 * exp(-pow((s - 0.40) / 0.2, 2.0));
  float sway = 0.016 * sin(s * 5.3 + time * 0.22) + 0.010 * sin(s * 9.7 - time * 0.31 + 1.7);
  return (bias + sway) * R;
}
void shellFrameVars(out vec2 axis, out float H, out float R){
  // 螺线形态锚在交互中心（entityPos），不再是屏幕正中的装饰
  axis = uCore;
  H = min(uResH * 0.58, 520.0);
  R = min(uResW, uResH) * 0.20;
}
void shellLineTraits(float lid, out float phase, out float rScale, out float upSpd){
  phase  = lid / SH_LINES * 6.2831853 + (hash(lid + 3.3) - 0.5) * 0.6;
  rScale = lid < 0.5 ? 1.0 : (0.93 + 0.11 * hash(lid + 13.7));
  upSpd  = 0.045 + 0.060 * hash(lid + 5.9);
}
void shellPoint(float lid, float s, float time, vec2 cursor, float hasCursor,
                out vec2 p, out float depthZ, out float sEffOut, out float repAmt, out float upSpdOut){
  vec2 axis; float H, R;
  shellFrameVars(axis, H, R);
  float phase, rScale, upSpd;
  shellLineTraits(lid, phase, rScale, upSpd);

  vec2 dcBase = vec2(axis.x + shellCenter(s, time, R), axis.y + (0.5 - s) * H) - cursor;
  float rep = exp(-dot(dcBase, dcBase) / (2.0 * 95.0 * 95.0)) * hasCursor;
  // 近光标时螺纹略加速上升（幅度收敛，避免「被神秘力向上冲走」）
  upSpd = upSpd * (1.0 + 0.7 * rep);

  float se = fract(s + time * upSpd);
  float th = shellTurns(se) * 6.2831853 + 0.22 * sin(se * 6.2831853 + hash(lid + 9.1) * 6.28318);
  float ang = th + phase;
  float push = 1.0 + rep * 0.18;
  float rad = shellRadius(s) * R * rScale * push;
  p = vec2(axis.x + shellCenter(s, time, R) + rad * cos(ang),
           axis.y + (0.5 - s) * H);
  depthZ = 0.5 + 0.5 * sin(ang);
  sEffOut = se;
  repAmt = rep;
  upSpdOut = upSpd;
}
void shellFrame(float lid, float s, float time, vec2 cursor, float hasCursor,
                out vec2 p, out vec2 nrm, out vec2 tanDir, out float depthZ,
                out float sEffOut, out float repAmt, out float upSpdOut){
  float ds = 0.003;
  vec2 pa, pb; float z0, z1, z2, se0, se1, se2, r0, r1, r2, u0, u1, u2;
  shellPoint(lid, s, time, cursor, hasCursor, p, z0, se0, r0, u0);
  shellPoint(lid, clamp(s + ds, 0.0, 1.0), time, cursor, hasCursor, pa, z1, se1, r1, u1);
  shellPoint(lid, clamp(s - ds, 0.0, 1.0), time, cursor, hasCursor, pb, z2, se2, r2, u2);
  tanDir = normalize(pa - pb + vec2(1e-4, 0.0));
  nrm = vec2(-tanDir.y, tanDir.x);
  depthZ = z0; sEffOut = se0; repAmt = r0; upSpdOut = u0;
}
// 粒子迁移锚点：沿 5 条上升螺线聚成有厚度的光点簇（与其它态同一粒子语言）
// - 78%：螺纹附近的软管状体（法向/切向抖动随壳半径放大，形成体积而非细线）
// - 22%：壳体外缘稀薄尘雾，保持「半透明有机体」气质
void lineInfo(float i, float t, vec2 cursor, float hasCursor,
              out vec2 lp, out float depth, out float sel, out float up, out vec2 lvel){
  float dust = step(0.78, hash(i + 201.0));
  sel = 1.0; // 全员可见；尘雾靠厚度与亮度区分，不再硬筛成线
  float lid = hash(i + 91.0) < 0.28 ? 0.0 : floor(1.0 + hash(i + 92.0) * (SH_LINES - 1.0));
  float tt = hash(i + 203.0);
  vec2 p, nrm, td; float z, se, rep, usp;
  shellFrame(lid, tt, t, cursor, hasCursor, p, nrm, td, z, se, rep, usp);

  // 体厚度：螺层半径越大，光点云越厚（不再是 2–4px 的细线抖动）
  vec2 axis; float H, R;
  shellFrameVars(axis, H, R);
  float localR = shellRadius(tt) * R;
  float thick = (10.0 + localR * 0.38) * (1.0 + dust * 2.4);
  float jN = (hash(i + 307.0) - 0.5) * 2.0 * thick;
  float jT = (hash(i + 311.0) - 0.5) * (16.0 + dust * 40.0);
  // 径向疏密：中心密、外缘疏（高斯近似）
  float g = dust > 0.5 ? (0.55 + 0.45 * hash(i + 401.0)) : (0.25 + 0.75 * abs(hash(i + 401.0) - 0.5) * 2.0);
  float jR = jN * (0.55 + 0.9 * g);
  lp = p + td * jT + nrm * jR;
  // 尘雾再向外缘轻推，避免全部贴在同一条螺纹上
  if (dust > 0.5) {
    lp += nrm * (hash(i + 407.0) - 0.5) * 22.0;
  }
  depth = mix(0.35, 1.0, z);
  // 尘雾略减深度对比，看起来更「雾」而非「脊线」
  depth = mix(depth, 0.55 + 0.25 * z, dust * 0.55);
  up = se;
  vec2 p2, n2, t2; float z2, se2, r2, u2;
  shellFrame(lid, tt, t + 0.06, cursor, hasCursor, p2, n2, t2, z2, se2, r2, u2);
  lvel = (p2 - p) / 0.06;
  float lv = dot(lvel, lvel);
  if(lv > 40000.0) lvel *= 200.0 / sqrt(lv);
  // 尘雾速度更松，不被螺纹拖成硬轨迹
  lvel *= mix(1.0, 0.35, dust);
}
`;

// 螺线样式：过渡期极淡骨架提示用（不再承担稳态视觉）
const SHELL_STYLE_GLSL = `
float shWidth(float lid){ return lid < 0.5 ? 4.0 : 2.4; }
float shBaseA(float lid){ return lid < 0.5 ? 0.35 : 0.22; }
`;

// ---- 恐惧态：元球（metaball）几何（更新 pass 共享） ----
// 参考 cos-design metaballPool：若干圆球中心受光标排斥、彼此软互斥，
// 粒子填充球体体积，片元着色器（全屏四边形）逐像素求 Σ r²/d² 阈值场 → 浅蓝柔边球。
const FEARFUL_BLOB_GEOM_GLSL = `
uniform float uBlobMode; // 恐惧态元球形态权重（0..1 平滑）
#define BLB_COUNT 6.0
uniform vec2 uBlob[6];
uniform vec2 uBlobV[6];
uniform float uBlobR[6];

// 粒子 → 所属元球内部填充锚点（随球心整体移动；球心运动由 CPU 模拟）
void blobInfo(float i, float t, vec2 cursor, float hasCursor,
              out vec2 lp, out float depth, out float sel, out float up, out vec2 lvel){
  float bid = floor(hash(i + 17.0) * BLB_COUNT);
  int b = int(bid);
  float r = uBlobR[b];
  // 球内均匀填充（sqrt 保证面密度均匀）；半径放 1.22 倍给边缘辉光留覆盖
  float ang = hash(i + 23.0) * 6.2831853;
  float rr = sqrt(hash(i + 29.0)) * r * 1.22;
  // 每球轻微椭圆变形 + 每粒子小抖动 → 有机而非正圆
  float squash = 0.82 + 0.36 * hash(i + 31.0);
  vec2 off = vec2(cos(ang), sin(ang) * squash) * rr;
  lp = uBlob[b] + off;
  depth = clamp(rr / (r * 1.22), 0.0, 1.0);
  sel = 1.0;
  up = 0.5;
  lvel = uBlobV[b];
}
`;

// ---- 粒子更新（GPGPU：位置+速度 FBO 乒乓） ----
const particle_update_frag = `
precision highp float;
uniform sampler2D uPosTex;
uniform sampler2D uFluidTex;
uniform sampler2D uSilhouette;
uniform vec2 uGridSize;
uniform float uGridW;
uniform float uTime;
uniform float uDt;
uniform float uResW;
uniform float uResH;
uniform vec2 uCore;
uniform vec2 uCursor;
uniform float uHasCursor;

uniform float uCohesion;
uniform float uCursorForce;
uniform float uVortex;
uniform float uTurbulence;
uniform float uFluidMix;
uniform float uOrbit;
uniform float uMigration;
uniform float uSandPull;
uniform float uRepel;
uniform float uSplit;
uniform float uMorph;
uniform float uHomePrev;
uniform float uHomeCur;
uniform float uBurst;
uniform float uBreath; // 呼吸同步（hold）

out vec4 fragColor;

${HASH_FUNC}
${LINE_GEOM_GLSL}
${FEARFUL_BLOB_GEOM_GLSL}

vec2 uvFromIndex(float i){
  return (vec2(mod(i, uGridW), floor(i / uGridW)) + 0.5) / uGridSize;
}

// 各形态「家」位置：统一用有体积的光点簇分布（与 VISUAL_CATALOG 气质对齐）
vec2 homePos(float i, float stateId){
  float r1 = hash(i), r2 = hash(i+3.7), r3 = hash(i+11.9), r4 = hash(i+19.3);
  if (stateId < 0.5) { // dormant：散落星尘（全空间微光）
    return vec2(r1, r2) * vec2(uResW, uResH);
  } else if (stateId < 1.5) { // secure：柔和轨道环 + 厚度（低频呼吸的可停留体）
    float ang = r1 * 6.28318;
    // 主环 + 次级薄环，形成「柔软山丘/双层肌理」
    float ring = step(r4, 0.72);
    float rad = mix(70.0 + r2 * 55.0, 110.0 + r2 * 120.0, ring);
    float ySquash = 0.72 + 0.2 * r3; // 轻微透视压扁
    vec2 p = uCore + vec2(cos(ang), sin(ang) * ySquash) * rad;
    // 环厚度方向噪声
    p += vec2(cos(ang), sin(ang)) * (r3 - 0.5) * 22.0;
    return p;
  } else if (stateId < 2.5) { // anxious：同心波纹团块（感知过载的颗粒云）
    // 三环 + 中心密核 + 外溢噪点
    float band = floor(r3 * 3.0);
    float rad0 = mix(18.0, 48.0, band) + r2 * mix(40.0, 110.0, band / 2.0);
    // 高频波纹：半径随角度起伏
    rad0 *= 1.0 + 0.12 * sin(r1 * 12.0 * 6.28318 + band);
    float ang = r1 * 6.28318;
    vec2 p = uCore + vec2(cos(ang), sin(ang)) * rad0 * r2;
    // 12% 粒子外溢，形成「高频外溢」
    if (r4 > 0.88) {
      p += (vec2(hash(i+29.1), hash(i+31.7)) - 0.5) * vec2(uResW, uResH) * 0.35;
    }
    return p;
  } else if (stateId < 3.5) { // avoidant：沿上升螺线的有厚度光点簇（见 lineInfo）
    vec2 lp2; float ld2; float ls2; float lu2; vec2 lv2;
    lineInfo(i, uTime, uCursor, uHasCursor, lp2, ld2, ls2, lu2, lv2);
    return lp2;
  } else if (stateId < 4.5) { // fearful：元球软球（粒子填充，片元渲球）
    vec2 lp2; float ld2; float ls2; float lu2; vec2 lv2;
    blobInfo(i, uTime, uCursor, uHasCursor, lp2, ld2, ls2, lu2, lv2);
    return lp2;
  } else { // fusion：紧密包裹核心 + 外围缠绕丝带（连接/共生）
    float ang = r1 * 6.28318;
    float inner = step(r4, 0.55);
    float rad = mix(28.0 + r2 * 55.0, 70.0 + r2 * 100.0, inner);
    // 外围粒子沿椭圆缠绕，模拟丝带包覆
    float wrapAng = ang + r3 * 1.2;
    float rx = rad * (1.0 + 0.15 * sin(wrapAng * 2.0));
    float ry = rad * 0.78;
    return uCore + vec2(cos(wrapAng) * rx, sin(wrapAng) * ry);
  }
}

// 贝塞尔位置过渡
vec2 bezierHome(vec2 p0, vec2 p1, float t, float i){
  vec2 d = p1 - p0;
  vec2 perp = vec2(-d.y, d.x);
  perp = perp / (length(perp) + 1e-4);
  float amp = (hash(i + 9.1) - 0.5) * min(uResW, uResH) * 0.12;
  vec2 c0 = p0 + perp * amp;
  vec2 c1 = p1 + perp * amp;
  float it = 1.0 - t;
  return it*it*it*p0 + 3.0*it*it*t*c0 + 3.0*it*t*t*c1 + t*t*t*p1;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uGridSize;
  vec4 pv = texture(uPosTex, uv);
  vec2 pos = pv.xy;
  vec2 vel = pv.zw;
  float i = gl_FragCoord.x + gl_FragCoord.y * uGridW;
  float r1 = hash(i), r2 = hash(i + 3.7), r3 = hash(i + 11.9);

  // 目标"家"与贝塞尔过渡
  vec2 home = bezierHome(homePos(i, uHomePrev), homePos(i, uHomeCur), uMorph, i);

  vec2 f = vec2(0.0);

  // 凝聚力：向"家"靠拢
  vec2 toHome = home - pos;
  float dHome = length(toHome) + 1e-4;
  f += toHome / dHome * min(1.0, dHome / 260.0) * uCohesion * 90.0;

  // 轨道呼吸（secure）
  vec2 dC = pos - uCore;
  float dC2 = length(dC) + 1e-4;
  vec2 tang = vec2(-dC.y, dC.x) / dC2;
  float breathe = 1.0 + 0.2 * sin(uTime * 0.9 + r1 * 6.28318);
  breathe *= 1.0 + uBreath * 0.35 * sin(uTime * 3.1);
  f += tang * uOrbit * 55.0 * breathe;

  // 涡旋：绕轴切向力 = vortex × 距离（恐惧态多核 + 部分轴反转）
  vec2 axis = uCore;
  if (uVortex > 0.6) {
    vec2 k = hash2(floor(i / 700.0) * 13.0 + 1.0);
    axis = vec2(k.x, k.y) * vec2(uResW, uResH);
  }
  vec2 dA = pos - axis;
  float dA2 = length(dA) + 1e-4;
  float sgn = mix(1.0, -1.0, step(r1, uSplit));
  f += vec2(-dA.y, dA.x) / dA2 * uVortex * dA2 * 1.6 * sgn;

  // 光标力（回避态斥力减弱，并按距离衰减，远离时几乎不再「推走」光流）
  if (uHasCursor > 0.5) {
    vec2 toC = uCursor - pos;
    float dC3 = length(toC) + 1e-4;
    float fall = exp(-dC3 / 120.0);
    float mag = uCursorForce * 320.0 * fall;
    // 退开时（光标相对质心已远）进一步削弱，避免整团被甩开
    float coreD = length(uCursor - uCore) + 1e-4;
    float away = smoothstep(180.0, 420.0, coreD);
    mag *= mix(1.0, 0.35, uRepel * away);
    vec2 dir = uRepel > 0.5 ? -toC / dC3 : toC / dC3;
    f += dir * mag;
  }

  // 回避态：螺纹骨架软捕获（保持光点簇呼吸，不锁死成细线）
  vec2 lineAnchor = pos;
  vec2 lineVel = vel;
  if (uMigration > 0.01) {
    vec2 lp; float ld; float ls; float lu; vec2 lv;
    lineInfo(i, uTime, uCursor, uHasCursor, lp, ld, ls, lu, lv);
    lineAnchor = lp;
    lineVel = lv;
  }

  // 恐惧态：元球填充点软捕获（球心随光标回避而移动）
  vec2 blobAnchor = pos;
  vec2 blobVel = vel;
  if (uBlobMode > 0.01) {
    vec2 bp; float bd; float bs; float bu; vec2 bv;
    blobInfo(i, uTime, uCursor, uHasCursor, bp, bd, bs, bu, bv);
    blobAnchor = bp;
    blobVel = bv;
  }

  // 人形吸引（sand people：安全态凝聚力适中 + 低湍流时）
  if (uSandPull > 0.01) {
    vec2 sil = texture(uSilhouette, vec2(r2, 0.5)).xy; // 0..1
    vec2 target = uCore + (sil - 0.5) * vec2(uResW * 0.26, uResH * 0.32);
    vec2 toT = target - pos;
    f += toT / (length(toT) + 1e-4) * uSandPull * uCohesion * 130.0;
  }

  // 湍流 + 蝴蝶效应（微小扰动非线性放大）
  float n1 = sin(uTime * 2.3 + r1 * 40.0 + pos.x * 0.004);
  float n2 = cos(uTime * 1.7 + r2 * 40.0 + pos.y * 0.004);
  vec2 turb = vec2(n1, n2) * 95.0 * uTurbulence;
  turb *= 1.0 + 3.0 * uTurbulence * n1 * n2;
  f += turb;

  // 流体速度场采样（liquid-Ether 底层场）
  if (uFluidMix > 0.001) {
    vec2 fuv = pos / vec2(uResW, uResH);
    vec2 fvel = texture(uFluidTex, fuv).xy; // uv/秒
    vec2 fpx = fvel * vec2(uResW, uResH); // px/秒
    vel = mix(vel, fpx, clamp(uFluidMix * 0.5, 0.0, 0.9));
  }

  // 双击唤醒爆聚脉冲
  if (uBurst > 0.01) {
    vec2 dB = pos - uCore;
    float dB2 = length(dB) + 1e-4;
    f += dB / dB2 * uBurst * 900.0;
  }

  // 积分 + 阻尼
  vel += f * uDt;
  vel *= max(0.0, 1.0 - 1.9 * uDt);
  pos += vel * uDt;

  // 回避态：软弹簧式靠向螺纹骨架（低 k + 不锁速度 → 仍是粒子云，不是描边）
  if (uMigration > 0.01) {
    float k = clamp(uMigration * 0.055, 0.0, 0.75);
    pos = mix(pos, lineAnchor, k);
    vel = mix(vel, lineVel, clamp(k * 0.55, 0.0, 0.55));
    // 极轻的切向漂移，让簇体有「上升呼吸」而非静态描线
    vel += normalize(lineVel + vec2(1e-3)) * uMigration * 18.0 * uDt
         * sin(uTime * 1.4 + r1 * 6.28318);
  }

  // 恐惧态：软弹簧靠向元球填充点 + 恐惧颤抖（球内粒子轻微抖动，不锁死）
  if (uBlobMode > 0.01) {
    float kb = clamp(uBlobMode * 0.06, 0.0, 0.8);
    pos = mix(pos, blobAnchor, kb);
    vel = mix(vel, blobVel, clamp(kb * 0.5, 0.0, 0.5));
    vel += (vec2(hash(i + 51.0), hash(i + 53.0)) - 0.5) * uBlobMode * 26.0 * uDt;
  }

  // 边界软约束
  vec2 mar = vec2(20.0);
  if (pos.x < mar.x) { pos.x = mar.x + (mar.x - pos.x) * 0.3; vel.x = abs(vel.x) * 0.3; }
  if (pos.x > uResW - mar.x) { pos.x = uResW - mar.x - (pos.x - (uResW - mar.x)) * 0.3; vel.x = -abs(vel.x) * 0.3; }
  if (pos.y < mar.y) { pos.y = mar.y + (mar.y - pos.y) * 0.3; vel.y = abs(vel.y) * 0.3; }
  if (pos.y > uResH - mar.y) { pos.y = uResH - mar.y - (pos.y - (uResH - mar.y)) * 0.3; vel.y = -abs(vel.y) * 0.3; }

  fragColor = vec4(pos, vel);
}
`;

// ---- 渲染：粒子点 ----
const points_vert = `
in vec3 position;
in float aIndex;
uniform sampler2D uPosTex;
uniform vec2 uGridSize;
uniform float uGridW;
uniform vec2 uRes;
uniform float uSize;
uniform float uTime;
uniform float uLineMode;
uniform vec2 uCursor;
uniform float uHasCursor;
uniform float uResW;
uniform float uResH;
uniform vec2 uCore;
out float vTwinkle;
out float vSeed;
out float vDepth;
out float vLineA;
${HASH_FUNC}
${LINE_GEOM_GLSL}
void main(){
  float i = aIndex;
  vec2 uv = (vec2(mod(i, uGridW), floor(i / uGridW)) + 0.5) / uGridSize;
  vec4 pv = texture(uPosTex, uv);
  vec2 pos = pv.xy;
  float spd = length(pv.zw);
  vSeed = hash(i);
  vTwinkle = 0.55 + 0.45 * sin(uTime * 2.0 + vSeed * 40.0);
  // 回避态：按螺旋正反面给深度明暗（保留体积感），不再把粒子筛成「线」
  vec2 lp; float ld; float ls; float lu; vec2 lv;
  lineInfo(i, uTime, uCursor, uHasCursor, lp, ld, ls, lu, lv);
  vDepth = mix(1.0, 0.18 + 0.82 * ld, uLineMode);
  vLineA = 1.0;
  vec2 nd = vec2(pos.x / uRes.x * 2.0 - 1.0, 1.0 - pos.y / uRes.y * 2.0);
  gl_Position = vec4(nd, 0.0, 1.0);
  // 与其它态同一量级的点径；螺纹态只略增，避免点叠成实线
  gl_PointSize = uSize * (1.2 + vSeed * 1.1) * (1.0 + min(spd * 0.02, 0.6)) * mix(1.0, 1.15, uLineMode);
}
`;
const points_frag = `
precision highp float;
uniform sampler2D uPalette;
uniform float uColorTemp;
uniform float uResW;
uniform float uResH;
uniform float uLineMode;
uniform float uCurveFade; // 回避态稳态：平滑壳线出现后粒子点隐去
uniform float uBlobMode; // 恐惧态：元球接管后粒子点隐去
uniform float uVeil; // 间奏异象：粒子整体渐隐（0..1）
in float vTwinkle;
in float vSeed;
in float vDepth;
in float vLineA;
out vec4 fragColor;
void main(){
  vec2 pc = gl_PointCoord - 0.5;
  float d = length(pc) * 2.0;
  if (d > 1.0) discard;
  float soft = smoothstep(1.0, 0.0, d);
  vec3 col = texture(uPalette, vec2(uColorTemp + (vSeed - 0.5) * 0.07, 0.5)).rgb;
  // 与其它态同一软粒子语言：保留闪烁；整体压暗，避免光点叠成过亮光斑
  float a = soft * mix(0.2 + 0.8 * vTwinkle, 0.22 + 0.55 * vTwinkle, uLineMode) * 0.42;
  a *= vLineA * mix(1.0, 0.55 + 0.45 * vDepth, uLineMode);
  a *= mix(1.0, 0.0, uLineMode * uCurveFade);
  a *= 1.0 - uBlobMode;
  a *= 1.0 - uVeil * 0.92; // 间奏异象浮现时粒子渐隐，留 8% 残影
  col *= mix(1.0 + 0.25 * (1.0 - vTwinkle), 0.75 + 0.35 * vDepth, uLineMode) * 0.92;
  fragColor = vec4(col, a);
}
`;

// ---- 渲染：回避态平滑壳线（参数曲线三角带，形状与粒子迁移锚点同源） ----
const shell_curve_vert = `
in vec3 position;
in float aLine;
in float aT;
in float aSide;
uniform float uResW;
uniform float uResH;
uniform float uTime;
uniform vec2 uCursor;
uniform float uHasCursor;
uniform vec2 uCore;
out float vSide;
out float vLine;
out float vT;
out float vRep;
out float vDepth;
out float vS;
${HASH_FUNC}
${SHELL_STYLE_GLSL}
${LINE_GEOM_GLSL}
void main(){
  vec2 p, nrm, td; float z, se, rep, usp;
  shellFrame(aLine, aT, uTime, uCursor, uHasCursor, p, nrm, td, z, se, rep, usp);
  float s = clamp(min(uResW, uResH) / 875.0, 0.7, 1.4);
  vec2 c = p + nrm * aSide * shWidth(aLine) * s;
  gl_Position = vec4(c.x / uResW * 2.0 - 1.0, 1.0 - c.y / uResH * 2.0, 0.0, 1.0);
  vSide = aSide; vLine = aLine; vT = aT; vRep = rep; vDepth = z; vS = se;
}
`;
const shell_curve_frag = `
precision highp float;
uniform float uOpacity;
uniform float uTime;
uniform float uVeil;
in float vSide;
in float vLine;
in float vT;
in float vRep;
in float vDepth;
in float vS;
out vec4 fragColor;
${HASH_FUNC}
${SHELL_STYLE_GLSL}
void main(){
  float x = vSide;
  float body = exp(-x * x * 3.0);    // 柔辉
  float core = exp(-x * x * 20.0);   // 亮芯
  float lid = floor(vLine + 0.5);
  // 背面螺纹隐入暗处，塑造绕轴立体感
  float zfade = mix(0.07, 1.0, smoothstep(0.05, 0.55, vDepth));
  float tip = smoothstep(0.0, 0.10, vT) * smoothstep(1.0, 0.86, vT); // 两端消融
  float a = (body * 0.38 + core * 0.8) * shBaseA(vLine)
          * zfade * tip * (1.0 + 0.8 * vRep);
  a *= uOpacity;
  a *= 1.0 - uVeil * 0.92;
  vec3 col = mix(vec3(0.45, 0.54, 0.88), vec3(0.98, 0.97, 1.0), core);
  col *= 0.8 + 0.4 * vDepth;
  col *= 0.85 + 0.35 * vRep;
  fragColor = vec4(col, a);
}
`;

// ---- 渲染：恐惧态元球场（全屏四边形，逐像素 Σ r²/d² → 浅蓝柔边球） ----
const blob_quad_vert = `
in vec3 position;
void main(){
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
const blob_quad_frag = `
precision highp float;
uniform float uTime;
uniform float uBlobMode;
uniform float uVeil;
uniform vec2 uBlob[6];
uniform float uBlobR[6];
out vec4 fragColor;
void main(){
  // gl_FragCoord 以画布像素为单位（绘制缓冲 = CSS 尺寸，无 dpr 缩放）
  vec2 p = gl_FragCoord.xy;
  float sum = 0.0;
  float hi = 0.0;
  for (int i = 0; i < 6; i++) {
    vec2 d = p - uBlob[i];
    float r = uBlobR[i];
    float m = (r * r) / (dot(d, d) + 1.0);
    sum += m;
    // 高光：球心左上偏移亮斑
    vec2 hd = p - (uBlob[i] - vec2(r * 0.30, r * 0.32));
    hi += (r * 0.55) / (dot(hd, hd) + 1.0);
  }
  sum *= 1.0 + 0.05 * sin(uTime * 0.9); // 呼吸
  // 阈值场：core 决定球体主体，glow 负责外缘柔边（模拟 blur(8px)）
  // 阈值基本保持原标定：球半径缩小时等值面（视觉半径）才会真正变小
  float core = smoothstep(0.95, 1.8, sum);
  float glow = smoothstep(0.38, 1.3, sum);
  float a = (core * 0.95 + glow * 0.30) * uBlobMode;
  a *= 1.0 - uVeil * 0.92;
  if (a < 0.004) discard;
  // 浅蓝 #38bdf8（参考 metaballPool），按强度加红增暖；叠加白色高光
  vec3 col = vec3(0.22 + 0.18 * glow, 0.74 + 0.06 * glow, 0.973);
  col += vec3(clamp(hi * 0.16, 0.0, 0.55));
  fragColor = vec4(col, a);
}
`;

// ---- 渲染：灵魂丝线 ----
const threads_vert = `
in vec3 position;
in float aPI;
in float aAnchor; // 0=粒子 1=锚点
in float aUseCursor; // 锚点：0=核心 1=光标
uniform sampler2D uPosTex;
uniform vec2 uGridSize;
uniform float uGridW;
uniform vec2 uRes;
uniform vec2 uCore;
uniform vec2 uCursor;
out float vSeed;
${HASH_FUNC}
void main(){
  vec2 p;
  if (aAnchor < 0.5) {
    float i = aPI;
    vec2 uv = (vec2(mod(i, uGridW), floor(i / uGridW)) + 0.5) / uGridSize;
    p = texture(uPosTex, uv).xy;
    vSeed = hash(i);
  } else {
    p = aUseCursor > 0.5 ? uCursor : uCore;
    vSeed = 0.5;
  }
  vec2 nd = vec2(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0);
  gl_Position = vec4(nd, 0.0, 1.0);
}
`;
const threads_frag = `
precision highp float;
uniform sampler2D uPalette;
uniform float uColorTemp;
uniform float uConnect;
uniform float uVeil;
in float vSeed;
out vec4 fragColor;
void main(){
  float alpha = clamp((uConnect - 0.3) * 0.85, 0.0, 0.38);
  alpha *= 0.45 + 0.35 * vSeed;
  alpha *= 1.0 - uVeil * 0.92;
  if (alpha < 0.004) discard;
  vec3 col = texture(uPalette, vec2(uColorTemp, 0.5)).rgb;
  fragColor = vec4(col, alpha);
}
`;

// ---- 渲染：核心与光标辉光 ----
const glow_vert = `
in vec3 position;
in float aSize;
in float aKind; // 0=核心 1=光标
uniform vec2 uRes;
out float vKind;
void main(){
  vec2 p = position.xy;
  vec2 nd = vec2(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0);
  gl_Position = vec4(nd, 0.0, 1.0);
  gl_PointSize = aSize;
  vKind = aKind;
}
`;
const glow_frag = `
precision highp float;
uniform sampler2D uPalette;
uniform float uColorTemp;
uniform float uManifest;
uniform float uVeil;
in float vKind;
out vec4 fragColor;
void main(){
  vec2 pc = gl_PointCoord - 0.5;
  float d = length(pc) * 2.0;
  if (d > 1.0) discard;
  float soft = smoothstep(1.0, 0.0, d);
  float veil = 1.0 - uVeil * 0.92;
  if (vKind < 0.5) {
    // 核心只作极淡环境光，不再呈现为独立「光球」——交互对象是粒子形态本身
    vec3 col = texture(uPalette, vec2(uColorTemp, 0.5)).rgb;
    float a = soft * (0.03 + 0.05 * uManifest) * veil;
    fragColor = vec4(col * (0.7 + uManifest * 0.4), a);
  } else {
    float a = soft * 0.28 * veil;
    fragColor = vec4(vec3(0.93, 0.96, 1.0), a);
  }
}
`;

// ==================== 流体模拟类（GLSL300 移植） ====================
type SimProps = any;

class FluidPass {
  props: any;
  uniforms: any;
  scene: THREE.Scene | null = null;
  camera: THREE.Camera | null = null;
  material: THREE.RawShaderMaterial | null = null;
  geometry: THREE.BufferGeometry | null = null;
  plane: THREE.Mesh | null = null;
  line: THREE.LineSegments | null = null;

  constructor(props: SimProps) {
    this.props = props || {};
    this.uniforms = this.props.material?.uniforms;
  }
  init(_props?: any) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    if (this.uniforms) {
      this.material = new THREE.RawShaderMaterial(this.props.material);
      this.geometry = new THREE.PlaneGeometry(2.0, 2.0);
      this.plane = new THREE.Mesh(this.geometry, this.material);
      this.scene.add(this.plane);
    }
  }
  update(_args?: any) {
    const r = this.props.renderer as THREE.WebGLRenderer;
    r.setRenderTarget(this.props.output || null);
    r.render(this.scene!, this.camera!);
    r.setRenderTarget(null);
  }
}

class FluidAdvection extends FluidPass {
  constructor(simProps: SimProps) {
    super({
      material: {
        glslVersion: THREE.GLSL3,
        vertexShader: fluid_face_vert,
        fragmentShader: fluid_advection_frag,
        uniforms: {
          boundarySpace: { value: simProps.cellScale },
          px: { value: simProps.cellScale },
          fboSize: { value: simProps.fboSize },
          velocity: { value: simProps.src.texture },
          dt: { value: simProps.dt },
          isBFECC: { value: true },
        },
      },
      output: simProps.dst,
      renderer: simProps.renderer,
    });
    this.uniforms = this.props.material.uniforms;
    this.init();
    this.createBoundary();
  }
  createBoundary() {
    const boundaryG = new THREE.BufferGeometry();
    const verts = new Float32Array([
      -1, -1, 0, -1, 1, 0, -1, 1, 0, 1, 1, 0, 1, 1, 0, 1, -1, 0, 1, -1, 0, -1, -1, 0,
    ]);
    boundaryG.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    const boundaryM = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fluid_line_vert,
      fragmentShader: fluid_advection_frag,
      uniforms: this.uniforms,
    });
    this.line = new THREE.LineSegments(boundaryG, boundaryM);
    this.scene!.add(this.line);
  }
  update(args: { dt: number; isBounce: boolean; BFECC: boolean }) {
    this.uniforms.dt.value = args.dt;
    if (this.line) this.line.visible = args.isBounce;
    this.uniforms.isBFECC.value = args.BFECC;
    super.update();
  }
}

class FluidExternalForce extends FluidPass {
  mouse: THREE.Mesh | null = null;
  constructor(simProps: SimProps) {
    super({ output: simProps.dst, renderer: simProps.renderer });
    this.init(simProps);
  }
  init(simProps: SimProps) {
    super.init();
    const mouseG = new THREE.PlaneGeometry(1, 1);
    const mouseM = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fluid_mouse_vert,
      fragmentShader: fluid_externalForce_frag,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: {
        px: { value: simProps.cellScale },
        force: { value: new THREE.Vector2(0, 0) },
        center: { value: new THREE.Vector2(0, 0) },
        scale: { value: new THREE.Vector2(simProps.cursor_size, simProps.cursor_size) },
      },
    });
    this.mouse = new THREE.Mesh(mouseG, mouseM);
    this.scene!.add(this.mouse);
  }
  update(props: { cursor_size: number; mouse_force: number; cellScale: THREE.Vector2 }) {
    const forceX = (Mouse.diff.x / 2) * props.mouse_force;
    const forceY = (Mouse.diff.y / 2) * props.mouse_force;
    const cursorSizeX = props.cursor_size * props.cellScale.x;
    const cursorSizeY = props.cursor_size * props.cellScale.y;
    const centerX = Math.min(
      Math.max(Mouse.coords.x, -1 + cursorSizeX + props.cellScale.x * 2),
      1 - cursorSizeX - props.cellScale.x * 2
    );
    const centerY = Math.min(
      Math.max(Mouse.coords.y, -1 + cursorSizeY + props.cellScale.y * 2),
      1 - cursorSizeY - props.cellScale.y * 2
    );
    const uniforms = (this.mouse!.material as THREE.RawShaderMaterial).uniforms;
    uniforms.force.value.set(forceX, forceY);
    uniforms.center.value.set(centerX, centerY);
    uniforms.scale.value.set(props.cursor_size, props.cursor_size);
    super.update();
  }
}

class FluidViscous extends FluidPass {
  constructor(simProps: SimProps) {
    super({
      material: {
        glslVersion: THREE.GLSL3,
        vertexShader: fluid_face_vert,
        fragmentShader: fluid_viscous_frag,
        uniforms: {
          boundarySpace: { value: simProps.boundarySpace },
          velocity: { value: simProps.src.texture },
          velocity_new: { value: simProps.dst_.texture },
          v: { value: simProps.viscous },
          px: { value: simProps.cellScale },
          dt: { value: simProps.dt },
        },
      },
      output: simProps.dst,
      output0: simProps.dst_,
      output1: simProps.dst,
      renderer: simProps.renderer,
    });
    this.init();
  }
  update(args: { viscous: number; iterations: number; dt: number }) {
    let fboIn: any, fboOut: any;
    this.uniforms.v.value = args.viscous;
    for (let i = 0; i < args.iterations; i++) {
      if (i % 2 === 0) {
        fboIn = this.props.output0;
        fboOut = this.props.output1;
      } else {
        fboIn = this.props.output1;
        fboOut = this.props.output0;
      }
      this.uniforms.velocity_new.value = fboIn.texture;
      this.props.output = fboOut;
      this.uniforms.dt.value = args.dt;
      super.update();
    }
    return fboOut;
  }
}

class FluidDivergence extends FluidPass {
  constructor(simProps: SimProps) {
    super({
      material: {
        glslVersion: THREE.GLSL3,
        vertexShader: fluid_face_vert,
        fragmentShader: fluid_divergence_frag,
        uniforms: {
          boundarySpace: { value: simProps.boundarySpace },
          velocity: { value: simProps.src.texture },
          px: { value: simProps.cellScale },
          dt: { value: simProps.dt },
        },
      },
      output: simProps.dst,
      renderer: simProps.renderer,
    });
    this.init();
  }
  update(args: { vel: any }) {
    this.uniforms.velocity.value = args.vel.texture;
    super.update();
  }
}

class FluidPoisson extends FluidPass {
  constructor(simProps: SimProps) {
    super({
      material: {
        glslVersion: THREE.GLSL3,
        vertexShader: fluid_face_vert,
        fragmentShader: fluid_poisson_frag,
        uniforms: {
          boundarySpace: { value: simProps.boundarySpace },
          pressure: { value: simProps.dst_.texture },
          divergence: { value: simProps.src.texture },
          px: { value: simProps.cellScale },
        },
      },
      output: simProps.dst,
      output0: simProps.dst_,
      output1: simProps.dst,
      renderer: simProps.renderer,
    });
    this.init();
  }
  update(args: { iterations: number }) {
    let pIn: any, pOut: any;
    for (let i = 0; i < args.iterations; i++) {
      if (i % 2 === 0) {
        pIn = this.props.output0;
        pOut = this.props.output1;
      } else {
        pIn = this.props.output1;
        pOut = this.props.output0;
      }
      this.uniforms.pressure.value = pIn.texture;
      this.props.output = pOut;
      super.update();
    }
    return pOut;
  }
}

class FluidPressure extends FluidPass {
  constructor(simProps: SimProps) {
    super({
      material: {
        glslVersion: THREE.GLSL3,
        vertexShader: fluid_face_vert,
        fragmentShader: fluid_pressure_frag,
        uniforms: {
          boundarySpace: { value: simProps.boundarySpace },
          pressure: { value: simProps.src_p.texture },
          velocity: { value: simProps.src_v.texture },
          px: { value: simProps.cellScale },
          dt: { value: simProps.dt },
        },
      },
      output: simProps.dst,
      renderer: simProps.renderer,
    });
    this.init();
  }
  update(args: { vel: any; pressure: any }) {
    this.uniforms.velocity.value = args.vel.texture;
    this.uniforms.pressure.value = args.pressure.texture;
    super.update();
  }
}

class FluidSim {
  options: any;
  fbos: Record<string, any> = {};
  fboSize = new THREE.Vector2();
  cellScale = new THREE.Vector2();
  boundarySpace = new THREE.Vector2();
  renderer: THREE.WebGLRenderer;
  advection!: FluidAdvection;
  externalForce!: FluidExternalForce;
  viscous!: FluidViscous;
  divergence!: FluidDivergence;
  poisson!: FluidPoisson;
  pressure!: FluidPressure;

  constructor(renderer: THREE.WebGLRenderer, resW: number, resH: number, options: any) {
    this.renderer = renderer;
    this.options = {
      iterations_poisson: 24,
      iterations_viscous: 24,
      mouse_force: 12,
      resolution: 0.25,
      cursor_size: 100,
      viscous: 30,
      isBounce: false,
      dt: 0.014,
      isViscous: false,
      BFECC: true,
      ...options,
    };
    this.fbos = {
      vel_0: null,
      vel_1: null,
      vel_viscous0: null,
      vel_viscous1: null,
      div: null,
      pressure_0: null,
      pressure_1: null,
    };
    this.fboSize.set(Math.max(2, Math.round(resW * this.options.resolution)), Math.max(2, Math.round(resH * this.options.resolution)));
    this.init();
  }
  init() {
    this.calcSize();
    this.createAllFBO();
    this.createShaderPass();
  }
  getFloatType() {
    return THREE.FloatType;
  }
  createAllFBO() {
    const opts = {
      type: this.getFloatType(),
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    };
    for (const key in this.fbos) {
      this.fbos[key] = new THREE.WebGLRenderTarget(this.fboSize.x, this.fboSize.y, opts);
    }
  }
  createShaderPass() {
    this.advection = new FluidAdvection({
      cellScale: this.cellScale,
      fboSize: this.fboSize,
      dt: this.options.dt,
      src: this.fbos.vel_0,
      dst: this.fbos.vel_1,
      renderer: this.renderer,
    });
    this.externalForce = new FluidExternalForce({
      cellScale: this.cellScale,
      cursor_size: this.options.cursor_size,
      dst: this.fbos.vel_1,
      renderer: this.renderer,
    });
    this.viscous = new FluidViscous({
      cellScale: this.cellScale,
      boundarySpace: this.boundarySpace,
      viscous: this.options.viscous,
      src: this.fbos.vel_1,
      dst: this.fbos.vel_viscous1,
      dst_: this.fbos.vel_viscous0,
      dt: this.options.dt,
      renderer: this.renderer,
    });
    this.divergence = new FluidDivergence({
      cellScale: this.cellScale,
      boundarySpace: this.boundarySpace,
      src: this.fbos.vel_viscous0,
      dst: this.fbos.div,
      dt: this.options.dt,
      renderer: this.renderer,
    });
    this.poisson = new FluidPoisson({
      cellScale: this.cellScale,
      boundarySpace: this.boundarySpace,
      src: this.fbos.div,
      dst: this.fbos.pressure_1,
      dst_: this.fbos.pressure_0,
      renderer: this.renderer,
    });
    this.pressure = new FluidPressure({
      cellScale: this.cellScale,
      boundarySpace: this.boundarySpace,
      src_p: this.fbos.pressure_0,
      src_v: this.fbos.vel_viscous0,
      dst: this.fbos.vel_0,
      dt: this.options.dt,
      renderer: this.renderer,
    });
  }
  calcSize() {
    const w = Math.max(2, Math.round(this.options.resolution * Common.width));
    const h = Math.max(2, Math.round(this.options.resolution * Common.height));
    this.fboSize.set(w, h);
    const pxX = 1.0 / w;
    const pxY = 1.0 / h;
    this.cellScale.set(pxX, pxY);
  }
  resize() {
    this.calcSize();
    for (const key in this.fbos) {
      this.fbos[key].setSize(this.fboSize.x, this.fboSize.y);
    }
  }
  /** 返回当前速度场纹理（粒子采样用） */
  get velTexture(): THREE.Texture {
    return this.fbos.vel_0.texture;
  }
  update() {
    this.boundarySpace.copy(this.cellScale);
    this.advection.update({
      dt: this.options.dt,
      isBounce: this.options.isBounce,
      BFECC: this.options.BFECC,
    });
    this.externalForce.update({
      cursor_size: this.options.cursor_size,
      mouse_force: this.options.mouse_force,
      cellScale: this.cellScale,
    });
    let vel = this.fbos.vel_1;
    if (this.options.isViscous) {
      vel = this.viscous.update({
        viscous: this.options.viscous,
        iterations: this.options.iterations_viscous,
        dt: this.options.dt,
      });
    }
    this.divergence.update({ vel });
    const pressure = this.poisson.update({ iterations: this.options.iterations_poisson });
    this.pressure.update({ vel, pressure });
  }
}

// 流体共享状态（与原 liquid-Ether 一致：Common 持有渲染器与尺寸，Mouse 持有光标）
class FluidCommon {
  width = 0;
  height = 0;
  renderer: THREE.WebGLRenderer | null = null;
  init(renderer: THREE.WebGLRenderer, w: number, h: number) {
    this.renderer = renderer;
    this.width = w;
    this.height = h;
  }
  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
}
class FluidMouse {
  coords = new THREE.Vector2(0, 0);
  coords_old = new THREE.Vector2(0, 0);
  diff = new THREE.Vector2(0, 0);
  setNormalized(nx: number, ny: number) {
    this.coords.set(nx, ny);
  }
  update() {
    this.diff.subVectors(this.coords, this.coords_old);
    this.coords_old.copy(this.coords);
    if (this.coords_old.x === 0 && this.coords_old.y === 0) this.diff.set(0, 0);
  }
}
const Common = new FluidCommon();
const Mouse = new FluidMouse();

// ==================== 主类：WebGLLifeform ====================
export interface LifeformOptions {
  particleCount: number;
  resolution: number; // 流体分辨率
}

export class WebGLLifeform {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private opts: LifeformOptions;

  // 粒子 FBO
  private gridW = 512;
  private gridH = 1;
  private posRT: THREE.WebGLRenderTarget[] = [];
  private ping = 0;
  private posTexType: THREE.TextureDataType = THREE.HalfFloatType;

  // 流体
  private fluidSim: FluidSim | null = null;
  private fluidResW = 0;
  private fluidResH = 0;

  // 场景对象
  private updateScene: THREE.Scene;
  private updateCamera: THREE.Camera;
  private updateMaterial: THREE.RawShaderMaterial;
  private points: THREE.Points;
  private pointsMat: THREE.RawShaderMaterial;
  private threads: THREE.LineSegments;
  private threadsMat: THREE.RawShaderMaterial;
  private glow: THREE.Points;
  private glowMat: THREE.RawShaderMaterial;
  private curveMesh: THREE.Mesh;
  private curveMat: THREE.RawShaderMaterial;
  private blobMesh: THREE.Mesh;
  private blobMat: THREE.RawShaderMaterial;
  private paletteTex: THREE.DataTexture;
  private silhouetteTex: THREE.DataTexture;

  // 状态
  private currentState: AttachmentState = "dormant";
  private prevState: AttachmentState = "dormant";
  private targetState: AttachmentState = "dormant";
  private pendingState: AttachmentState = "dormant";
  private pendingFrames = 0;
  private transitionStart = 0;
  private paramDuration = 1;
  private morphStart = 0;
  private morphDuration = 2;
  private morphFrom: StateParams = STATE_PARAMS.dormant;
  private currentParams: StateParams = { ...STATE_PARAMS.dormant };
  private burstUntil = 0;
  private debugOverride: AttachmentState | null = null;
  // 焦虑型是否已出现过：出现一次后，其再次触发改判为恐惧型
  private anxiousSeen = false;

  // ---- 间奏异象：同一状态驻留 15s 后浮现 4s 涟漪水面（public 供 overlay 轮询） ----
  interludeType: InterludeType = null;
  interludeAlpha = 0;
  private interludeStart = 0;
  private stateSince = 0;
  // 间奏结束后的随机新态锁定：让新形态完整呈现，不被实时检测立刻拉回
  private pinnedState: AttachmentState | null = null;
  private pinnedUntil = 0;

  // 回避态壳线：曲线显隐与粒子交接（0..1 平滑）
  private shellAlpha = 0;
  private particleFade = 0;

  // 恐惧态元球（metaballPool 参考）：6 个球心 CPU 模拟，光标排斥 + 软互斥
  private blobs: { x: number; y: number; vx: number; vy: number; r: number }[] = [];
  private blobMode = 0; // 元球形态权重（平滑过渡）

  /** 引擎表面距离判定用：当前目标形态 */
  get visualState(): AttachmentState {
    return this.targetState;
  }

  // 光标
  private lastCursor: { x: number; y: number } | null = null;
  private lastCursorAt = 0;

  // 尺寸
  private width = 0;
  private height = 0;

  private disposed = false;

  constructor(container: HTMLElement, opts?: Partial<LifeformOptions>) {
    this.container = container;
    this.opts = {
      particleCount: 160_000,
      resolution: 0.25,
      ...opts,
    };

    // 粒子网格
    this.gridW = 512;
    this.gridH = Math.ceil(this.opts.particleCount / this.gridW);
    this.particleCount = this.gridW * this.gridH;

    // 渲染器：WebGL2（three r128 默认优先 webgl2）
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    this.container.appendChild(this.renderer.domElement);

    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(rect.width));
    this.height = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(this.width, this.height, false);

    // 恐惧态元球：初始集群（进入恐惧态时再重播种）
    this.seedBlobs();

    // 纹理
    this.paletteTex = makePaletteTexture([
      "#0E1430", "#24356E", "#7FD4FF", "#C13A7A", "#FFB45C", "#FFE9B8", "#FFF6DF",
    ]);
    this.silhouetteTex = makeSilhouetteTexture(420);

    // 粒子初始数据
    const posData = new Float32Array(this.particleCount * 4);
    for (let i = 0; i < this.particleCount; i++) {
      posData[i * 4 + 0] = Math.random() * this.width;
      posData[i * 4 + 1] = Math.random() * this.height;
      posData[i * 4 + 2] = 0;
      posData[i * 4 + 3] = 0;
    }
    const initTex = new THREE.DataTexture(
      posData, this.gridW, this.gridH, THREE.RGBAFormat, this.posTexType
    );
    initTex.minFilter = THREE.NearestFilter;
    initTex.magFilter = THREE.NearestFilter;
    initTex.generateMipmaps = false;
    initTex.needsUpdate = true;

    const rtOpts = {
      type: this.posTexType,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    };
    this.posRT = [
      new THREE.WebGLRenderTarget(this.gridW, this.gridH, rtOpts),
      new THREE.WebGLRenderTarget(this.gridW, this.gridH, rtOpts),
    ];
    this.posRT[0].texture.copy(initTex);
    initTex.dispose();

    // 更新 pass
    this.updateScene = new THREE.Scene();
    this.updateCamera = new THREE.Camera();
    this.updateMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fluid_face_vert,
      fragmentShader: particle_update_frag,
      uniforms: {
        uPosTex: { value: this.posRT[0].texture },
        uFluidTex: { value: null },
        uSilhouette: { value: this.silhouetteTex },
        uGridSize: { value: new THREE.Vector2(this.gridW, this.gridH) },
        uGridW: { value: this.gridW },
        uTime: { value: 0 },
        uDt: { value: 0.016 },
        uResW: { value: this.width },
        uResH: { value: this.height },
        uCore: { value: new THREE.Vector2(this.width / 2, this.height / 2) },
        uCursor: { value: new THREE.Vector2(0, 0) },
        uHasCursor: { value: 0 },
        uCohesion: { value: 0 },
        uCursorForce: { value: 0 },
        uVortex: { value: 0 },
        uTurbulence: { value: 0 },
        uFluidMix: { value: 0 },
        uOrbit: { value: 0 },
        uMigration: { value: 0 },
        uSandPull: { value: 0 },
        uRepel: { value: 0 },
        uSplit: { value: 0 },
        uMorph: { value: 0 },
        uHomePrev: { value: 0 },
        uHomeCur: { value: 0 },
        uBurst: { value: 0 },
        uBreath: { value: 0 },
        uBlobMode: { value: 0 },
        uBlob: { value: Array.from({ length: 6 }, () => new THREE.Vector2(0, 0)) },
        uBlobV: { value: Array.from({ length: 6 }, () => new THREE.Vector2(0, 0)) },
        uBlobR: { value: [0, 0, 0, 0, 0, 0] },
      },
    });
    const updatePlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.updateMaterial);
    this.updateScene.add(updatePlane);

    // 粒子渲染
    const pGeo = new THREE.BufferGeometry();
    const pIdx = new Float32Array(this.particleCount);
    const pPos = new Float32Array(this.particleCount * 3);
    for (let i = 0; i < this.particleCount; i++) {
      pIdx[i] = i;
    }
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute("aIndex", new THREE.BufferAttribute(pIdx, 1));
    this.pointsMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: points_vert,
      fragmentShader: points_frag,
      uniforms: {
        uPosTex: { value: this.posRT[0].texture },
        uGridSize: { value: new THREE.Vector2(this.gridW, this.gridH) },
        uGridW: { value: this.gridW },
        uRes: { value: new THREE.Vector2(this.width, this.height) },
        uSize: { value: 2.6 },
        uTime: { value: 0 },
        uPalette: { value: this.paletteTex },
        uColorTemp: { value: 0.2 },
        uResW: { value: this.width },
        uResH: { value: this.height },
        uLineMode: { value: 0 },
        uCurveFade: { value: 0 },
        uBlobMode: { value: 0 },
        uVeil: { value: 0 },
        uCursor: { value: new THREE.Vector2(0, 0) },
        uHasCursor: { value: 0 },
        uCore: { value: new THREE.Vector2(this.width / 2, this.height / 2) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.points = new THREE.Points(pGeo, this.pointsMat);

    // 丝线（连接 核心/光标 ↔ 粒子）
    const THREADS = 2000;
    const tGeo = new THREE.BufferGeometry();
    const tCount = THREADS * 2;
    const tPos = new Float32Array(tCount * 3);
    const tPI = new Float32Array(tCount);
    const tAnchor = new Float32Array(tCount);
    const tUseCursor = new Float32Array(tCount);
    for (let i = 0; i < THREADS; i++) {
      const pi = (i * 149 + 37) % this.particleCount;
      // 端点0 = 粒子，端点1 = 锚点
      tPI[i * 2] = pi;
      tPI[i * 2 + 1] = pi;
      tAnchor[i * 2] = 0;
      tAnchor[i * 2 + 1] = 1;
      tUseCursor[i * 2] = 0;
      tUseCursor[i * 2 + 1] = i % 2;
    }
    tGeo.setAttribute("position", new THREE.BufferAttribute(tPos, 3));
    tGeo.setAttribute("aPI", new THREE.BufferAttribute(tPI, 1));
    tGeo.setAttribute("aAnchor", new THREE.BufferAttribute(tAnchor, 1));
    tGeo.setAttribute("aUseCursor", new THREE.BufferAttribute(tUseCursor, 1));
    this.threadsMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: threads_vert,
      fragmentShader: threads_frag,
      uniforms: {
        uPosTex: { value: this.posRT[0].texture },
        uGridSize: { value: new THREE.Vector2(this.gridW, this.gridH) },
        uGridW: { value: this.gridW },
        uRes: { value: new THREE.Vector2(this.width, this.height) },
        uCore: { value: new THREE.Vector2(this.width / 2, this.height / 2) },
        uCursor: { value: new THREE.Vector2(0, 0) },
        uPalette: { value: this.paletteTex },
        uColorTemp: { value: 0.5 },
        uConnect: { value: 0 },
        uVeil: { value: 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.threads = new THREE.LineSegments(tGeo, this.threadsMat);

    // 核心 + 光标辉光
    const gGeo = new THREE.BufferGeometry();
    const gPos = new Float32Array(2 * 3);
    const gSize = new Float32Array([48, 12]);
    const gKind = new Float32Array([0, 1]);
    gGeo.setAttribute("position", new THREE.BufferAttribute(gPos, 3));
    gGeo.setAttribute("aSize", new THREE.BufferAttribute(gSize, 1));
    gGeo.setAttribute("aKind", new THREE.BufferAttribute(gKind, 1));
    this.glowMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: glow_vert,
      fragmentShader: glow_frag,
      uniforms: {
        uRes: { value: new THREE.Vector2(this.width, this.height) },
        uPalette: { value: this.paletteTex },
        uColorTemp: { value: 0.2 },
        uManifest: { value: 0 },
        uVeil: { value: 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.glow = new THREE.Points(gGeo, this.glowMat);

    // 回避态壳线：5 条参数螺线，每条 110 段三角带（形状由顶点着色器按时间/光标实时计算）
    const CURVE_LINES = 5;
    const CURVE_SEG = 110;
    const cPos: number[] = [];
    const cLine: number[] = [];
    const cT: number[] = [];
    const cSide: number[] = [];
    const cIdx: number[] = [];
    for (let l = 0; l < CURVE_LINES; l++) {
      for (let s = 0; s < CURVE_SEG; s++) {
        const b = (l * CURVE_SEG + s) * 4;
        const t0 = s / CURVE_SEG;
        const t1 = (s + 1) / CURVE_SEG;
        const verts: Array<[number, number]> = [[t0, -1], [t0, 1], [t1, -1], [t1, 1]];
        for (const [t, sd] of verts) {
          cPos.push(0, 0, 0);
          cLine.push(l);
          cT.push(t);
          cSide.push(sd);
        }
        cIdx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
      }
    }
    const cGeo = new THREE.BufferGeometry();
    cGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(cPos), 3));
    cGeo.setAttribute("aLine", new THREE.BufferAttribute(new Float32Array(cLine), 1));
    cGeo.setAttribute("aT", new THREE.BufferAttribute(new Float32Array(cT), 1));
    cGeo.setAttribute("aSide", new THREE.BufferAttribute(new Float32Array(cSide), 1));
    cGeo.setIndex(cIdx);
    this.curveMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: shell_curve_vert,
      fragmentShader: shell_curve_frag,
      uniforms: {
        uResW: { value: this.width },
        uResH: { value: this.height },
        uTime: { value: 0 },
        uCursor: { value: new THREE.Vector2(0, 0) },
        uHasCursor: { value: 0 },
        uOpacity: { value: 0 },
        uVeil: { value: 0 },
        uCore: { value: new THREE.Vector2(this.width / 2, this.height / 2) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.curveMesh = new THREE.Mesh(cGeo, this.curveMat);
    this.curveMesh.frustumCulled = false;

    // 恐惧态元球：全屏四边形渲元球场（形状由 uBlob/uBlobR 逐像素计算）
    this.blobMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: blob_quad_vert,
      fragmentShader: blob_quad_frag,
      uniforms: {
        uTime: { value: 0 },
        uBlobMode: { value: 0 },
        uVeil: { value: 0 },
        uBlob: { value: Array.from({ length: 6 }, () => new THREE.Vector2(0, 0)) },
        uBlobR: { value: [0, 0, 0, 0, 0, 0] },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.blobMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blobMat);
    this.blobMesh.frustumCulled = false;

    // 流体
    Common.init(this.renderer, this.width, this.height);
    this.fluidSim = new FluidSim(this.renderer, this.width, this.height, {});
    this.fluidResW = this.fluidSim.fboSize.x;
    this.fluidResH = this.fluidSim.fboSize.y;

    // 初始状态时间
    this.transitionStart = performance.now();
    this.morphStart = performance.now();
    this.stateSince = performance.now();
  }

  private particleCount = 0;

  /** 供 InteractionStage 每帧调用：喂快照与时间 */
  tick(snap: EngineSnapshot, now: number, dtSec: number) {
    if (this.disposed) return;

    // ---- 状态检测（三轴 + 历史累积，20 帧稳定过滤） ----
    if (this.debugOverride) {
      // 调试模式：跳过自动检测，强制切换到指定状态
      this.setTarget(this.debugOverride);
    } else if (this.pinnedState && now < this.pinnedUntil) {
      // 间奏结束后的随机新态：锁定 6s，让贝塞尔形态过渡（1.5-3s）完整呈现
      this.setTarget(this.pinnedState);
    } else {
      if (this.pinnedState) this.pinnedState = null;
      const counts = snap.actionCounts;
      const history = {
        approachCount: counts.approach,
        totalEvents: counts.approach + counts.retreat + counts.pause + counts.reach + counts.glide + counts.leave + counts.dblclick + counts.hold + counts.drag + counts.still,
        anxiousSeen: this.anxiousSeen,
      };
      const detected = detectAttachmentState(snap.state, history, this.targetState);
      if (detected === this.pendingState) {
        this.pendingFrames++;
      } else {
        this.pendingState = detected;
        this.pendingFrames = 0;
      }
      if (this.pendingFrames >= 40 && detected !== this.targetState) {
        this.setTarget(detected);
      }
    }

    // ---- 参数插值（easeInOut） ----
    const tp = Math.min(1, Math.max(0, (now - this.transitionStart) / this.paramDuration));
    const tf = smooth01(tp);
    const mp = Math.min(1, Math.max(0, (now - this.morphStart) / this.morphDuration));
    const mf = smooth01(mp);
    const target = STATE_PARAMS[this.targetState];
    const from = this.morphFrom;
    const cur = this.currentParams;
    (Object.keys(target) as (keyof StateParams)[]).forEach((k) => {
      cur[k] = from[k] + (target[k] - from[k]) * tf;
    });

    // ---- 恐惧态元球：推进模拟 + 平滑形态权重 ----
    this.stepBlobs(snap, Math.min(dtSec, 0.05));
    const blobTarget = this.targetState === "fearful" ? 1 : 0;
    this.blobMode += (blobTarget - this.blobMode) * Math.min(1, dtSec * 3.5);

    // ---- 间奏异象：同态驻留 7s 随机浮现 3s，粒子随之渐隐再归位 ----
    this.updateInterlude(now);

    // ---- 更新 uniform ----
    const U = this.updateMaterial.uniforms;
    U.uTime.value = snap.elapsed;
    U.uDt.value = Math.min(dtSec, 0.05);
    U.uResW.value = this.width;
    U.uResH.value = this.height;
    U.uCore.value.set(snap.entityPos.x, snap.entityPos.y);
    if (snap.cursorPos) {
      U.uCursor.value.set(snap.cursorPos.x, snap.cursorPos.y);
      U.uHasCursor.value = 1;
    } else {
      U.uHasCursor.value = 0;
    }
    U.uBlobMode.value = this.blobMode;
    this.writeBlobUniforms(U);
    U.uCohesion.value = cur.cohesion;
    U.uCursorForce.value = cur.cursorForce;
    U.uVortex.value = cur.vortex;
    U.uTurbulence.value = cur.turbulence;
    U.uFluidMix.value = cur.fluidMix;
    U.uOrbit.value = cur.orbit;
    U.uMigration.value = cur.migration;
    U.uSandPull.value = cur.sandPull;
    U.uRepel.value = cur.repel;
    // 恐惧态：arousal > 0.75 时涡旋轴反转生效
    U.uSplit.value = cur.split * (snap.state.axis_arousal > 0.75 ? 1 : 0);
    U.uMorph.value = mf;
    U.uHomePrev.value = STATE_ORDER.indexOf(this.prevState);
    U.uHomeCur.value = STATE_ORDER.indexOf(this.targetState);
    U.uBurst.value = now < this.burstUntil ? Math.max(0, 1 - (this.burstUntil - now) / 700) : 0;
    U.uBreath.value = snap.interactionMode === "hold" ? 1 : 0;

    // 渲染 uniform
    const PM = this.pointsMat.uniforms;
    PM.uTime.value = snap.elapsed;
    PM.uSize.value = 1.55 * cur.size * Math.max(0.55, Math.min(1.25, this.width / 1200));
    PM.uColorTemp.value = cur.colorTemp;
    PM.uLineMode.value = cur.migration;
    PM.uBlobMode.value = this.blobMode;
    PM.uVeil.value = this.interludeAlpha;
    PM.uCore.value.set(snap.entityPos.x, snap.entityPos.y);
    if (snap.cursorPos) {
      PM.uCursor.value.set(snap.cursorPos.x, snap.cursorPos.y);
      PM.uHasCursor.value = 1;
    } else {
      PM.uHasCursor.value = 0;
    }

    // 回避态：不再用连续壳线接管视觉（那会把光点簇画成描边线条）。
    // 仅在进入过渡期保留极淡骨架提示，稳态始终由粒子簇呈现。
    const ss01 = (e0: number, e1: number, x: number) => {
      const y = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
      return y * y * (3 - 2 * y);
    };
    const entering = this.targetState === "avoidant" ? 1 : 0;
    const shellTarget = entering ? ss01(0.55, 0.85, mf) * (1 - ss01(0.85, 1.0, mf)) * 0.12 : 0;
    const fadeTarget = 0; // 粒子永不因「壳线接管」而隐去
    const ka = Math.min(1, dtSec * 4.5);
    this.shellAlpha += (shellTarget - this.shellAlpha) * ka;
    this.particleFade += (fadeTarget - this.particleFade) * ka;
    PM.uCurveFade.value = this.particleFade;
    const CM = this.curveMat.uniforms;
    CM.uTime.value = snap.elapsed;
    CM.uResW.value = this.width;
    CM.uResH.value = this.height;
    CM.uOpacity.value = this.shellAlpha;
    CM.uVeil.value = this.interludeAlpha;
    CM.uCore.value.set(snap.entityPos.x, snap.entityPos.y);
    if (snap.cursorPos) {
      CM.uCursor.value.set(snap.cursorPos.x, snap.cursorPos.y);
      CM.uHasCursor.value = 1;
    } else {
      CM.uHasCursor.value = 0;
    }

    // 恐惧态元球：全屏场 uniform
    const BM = this.blobMat.uniforms;
    BM.uTime.value = snap.elapsed;
    BM.uBlobMode.value = this.blobMode;
    BM.uVeil.value = this.interludeAlpha;
    this.writeBlobUniforms(BM);

    const TM = this.threadsMat.uniforms;
    TM.uCore.value.set(snap.entityPos.x, snap.entityPos.y);
    if (snap.cursorPos) TM.uCursor.value.set(snap.cursorPos.x, snap.cursorPos.y);
    TM.uConnect.value = cur.connect;
    TM.uColorTemp.value = cur.colorTemp;
    TM.uVeil.value = this.interludeAlpha;

    const GM = this.glowMat.uniforms;
    GM.uColorTemp.value = cur.colorTemp;
    GM.uManifest.value = snap.manifestProgress;
    GM.uVeil.value = this.interludeAlpha;
    const gAttr = this.glow.geometry.attributes;
    const gp = gAttr.position.array as Float32Array;
    gp[0] = snap.entityPos.x;
    gp[1] = snap.entityPos.y;
    gp[3] = snap.cursorPos ? snap.cursorPos.x : -9999;
    gp[4] = snap.cursorPos ? snap.cursorPos.y : -9999;
    gAttr.position.needsUpdate = true;
    const gs = gAttr.aSize.array as Float32Array;
    gs[0] = 36 + snap.manifestProgress * 70;
    gAttr.aSize.needsUpdate = true;

    // 流体光标（NDC + 速度）
    if (snap.cursorPos) {
      const nx = (snap.cursorPos.x / this.width) * 2 - 1;
      const ny = -((snap.cursorPos.y / this.height) * 2 - 1);
      Mouse.setNormalized(nx, ny);
    }
  }

  /** 每帧渲染（流体更新 + 粒子更新 + 绘制） */
  render(now: number) {
    if (this.disposed) return;
    const r = this.renderer;

    // 流体速度场更新
    if (this.fluidSim) {
      Mouse.update();
      this.fluidSim.update();
    }

    // 粒子 GPGPU 更新（乒乓）
    const src = this.posRT[this.ping];
    const dst = this.posRT[1 - this.ping];
    this.updateMaterial.uniforms.uPosTex.value = src.texture;
    this.updateMaterial.uniforms.uFluidTex.value = this.fluidSim ? this.fluidSim.velTexture : null;
    r.setRenderTarget(dst);
    r.render(this.updateScene, this.updateCamera);
    r.setRenderTarget(null);
    this.ping = 1 - this.ping;

    // 绘制
    const PM = this.pointsMat.uniforms;
    PM.uPosTex.value = this.posRT[this.ping].texture;
    const TM = this.threadsMat.uniforms;
    TM.uPosTex.value = this.posRT[this.ping].texture;

    r.render(this.points, this.updateCamera);
    if (this.currentParams.connect > 0.3) {
      r.render(this.threads, this.updateCamera);
    }
    if (this.shellAlpha > 0.003) {
      r.render(this.curveMesh, this.updateCamera);
    }
    // 恐惧态元球：全屏场（加性叠加在粒子之上，形成柔边浅蓝球）
    if (this.blobMode > 0.01) {
      r.render(this.blobMesh, this.updateCamera);
    }
    r.render(this.glow, this.updateCamera);
  }

  setBurstUntil(t: number) {
    this.burstUntil = t;
  }

  /**
   * 间奏异象调度：
   * - 非间奏期：同一非休眠状态驻留满 15s → 浮现涟漪水面，持续 4s
   * - 淡入 0.7s / 持续 / 淡出 0.8s，interludeAlpha 同步驱动粒子渐隐与水面淡入
   * - 播完后粒子归位，并随机切换到另一个依恋状态
   */
  private updateInterlude(now: number) {
    if (this.interludeType) {
      const p = (now - this.interludeStart) / INTERLUDE_DURATION_MS;
      if (p >= 1) {
        this.interludeType = null;
        this.interludeAlpha = 0;
        this.switchToRandomOtherState();
        return;
      }
      const fadeIn = INTERLUDE_FADE_IN_MS / INTERLUDE_DURATION_MS;
      const fadeOutStart = 1 - INTERLUDE_FADE_OUT_MS / INTERLUDE_DURATION_MS;
      if (p < fadeIn) {
        this.interludeAlpha = smooth01(p / fadeIn);
      } else if (p > fadeOutStart) {
        this.interludeAlpha = smooth01((1 - p) / (1 - fadeOutStart));
      } else {
        this.interludeAlpha = 1;
      }
      return;
    }

    this.interludeAlpha = 0;
    if (
      this.targetState !== "dormant" &&
      now - this.stateSince >= INTERLUDE_TRIGGER_MS
    ) {
      this.interludeType = "ripple";
      this.interludeStart = now;
    }
  }

  /** 间奏结束：随机切换到与当前不同的另一个依恋状态（fusion 需历史解锁，不参与） */
  private switchToRandomOtherState() {
    const all: AttachmentState[] = ["secure", "anxious", "avoidant", "fearful"];
    const pool = all
      // 焦虑型已出现过一次后不再直接呈现（改由恐惧型承接）
      .filter((s) => !(s === "anxious" && this.anxiousSeen))
      .filter((s) => s !== this.targetState);
    const next = pool[Math.floor(Math.random() * pool.length)];
    if (next) {
      this.setTarget(next);
      // 锁定 6s：新态完整成形后再交还给实时检测
      this.pinnedState = next;
      this.pinnedUntil = performance.now() + 6000;
    }
  }

  /** 调试：立即触发一次涟漪间奏（浏览器验证用） */
  debugTriggerVeil() {
    this.interludeType = "ripple";
    this.interludeStart = performance.now();
  }

  /** 调试：强制目标状态并立即触发过渡（浏览器验证六态截图用） */
  debugSetState(s: AttachmentState) {
    this.debugOverride = s;
    this.setTarget(s);
  }

  /** 关闭调试强制，恢复自动状态检测 */
  debugRelease() {
    this.debugOverride = null;
  }

  /** 播种恐惧态元球：6 球心聚成单团软球（有机而非正圆） */
  private seedBlobs() {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const m = Math.min(this.width, this.height);
    const n = 6;
    this.blobs = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.7;
      const spread = m * 0.075 + Math.random() * 16;
      this.blobs.push({
        x: cx + Math.cos(ang) * spread * 0.55,
        y: cy + Math.sin(ang) * spread * 0.4,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        r: m * (0.09 + Math.random() * 0.035),
      });
    }
  }

  /** 每帧推进元球：光标排斥 + 软互斥 + 回中 + 阻尼 + 边界反弹（复刻 metaballPool） */
  private stepBlobs(snap: EngineSnapshot, dt: number) {
    const cursor = snap.cursorPos;
    const tScale = Math.min(2.5, Math.max(0.2, dt * 60)); // 归一化到 60fps
    const cx = this.width / 2;
    const cy = this.height / 2;
    for (const b of this.blobs) {
      // 光标排斥（近则推开，回避语义）
      if (cursor) {
        const dx = b.x - cursor.x;
        const dy = b.y - cursor.y;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < 220) {
          const force = (220 - dist) * 0.055;
          b.vx += (dx / dist) * force;
          b.vy += (dy / dist) * force;
        }
      }
      // 弱回中：整体不漂出屏幕中央区
      const hdx = cx - b.x;
      const hdy = cy - b.y;
      const hd = Math.hypot(hdx, hdy) || 1;
      b.vx += (hdx / hd) * Math.min(36, hd * 0.02) * 0.5 * tScale;
      b.vy += (hdy / hd) * Math.min(36, hd * 0.02) * 0.5 * tScale;
      b.vx *= 0.985;
      b.vy *= 0.985;
      b.x += b.vx * tScale;
      b.y += b.vy * tScale;
      // 边界反弹
      if (b.x - b.r < 0) { b.x = b.r; b.vx *= -0.8; }
      else if (b.x + b.r > this.width) { b.x = this.width - b.r; b.vx *= -0.8; }
      if (b.y - b.r < 0) { b.y = b.r; b.vy *= -0.8; }
      else if (b.y + b.r > this.height) { b.y = this.height - b.r; b.vy *= -0.8; }
    }
    // 两两软互斥（参考 minDist = (r1+r2)*0.55）
    for (let i = 0; i < this.blobs.length; i++) {
      for (let j = i + 1; j < this.blobs.length; j++) {
        const a = this.blobs[i];
        const b = this.blobs[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const minDist = (a.r + b.r) * 0.55;
        if (dist < minDist) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;
          a.x -= nx * overlap * 0.5;
          a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.y += ny * overlap * 0.5;
        }
      }
    }
  }

  /** 将 CPU 元球状态写入材质 uniform（更新 pass / 全屏场共用） */
  private writeBlobUniforms(U: { [k: string]: { value: unknown } }) {
    const pos = U.uBlob.value as THREE.Vector2[];
    const rad = U.uBlobR.value as number[];
    const vel = U.uBlobV ? (U.uBlobV.value as THREE.Vector2[]) : null;
    for (let i = 0; i < this.blobs.length; i++) {
      const b = this.blobs[i];
      pos[i].set(b.x, b.y);
      rad[i] = b.r;
      if (vel) vel[i].set(b.vx, b.vy);
    }
  }

  private setTarget(s: AttachmentState) {
    if (s === this.targetState) return;
    this.morphFrom = { ...this.currentParams };
    this.prevState = this.targetState;
    this.targetState = s;
    // 焦虑型一旦真正出现即被记录：之后再次触发将改判为恐惧型
    if (s === "anxious") this.anxiousSeen = true;
    // 状态切换：驻留计时重新开始（间奏期间的切换不影响当前间奏播完）
    this.stateSince = performance.now();
    // 进入恐惧态：重播元球，形成新的有机软球
    if (s === "fearful") this.seedBlobs();
    this.transitionStart = performance.now();
    this.morphStart = performance.now();
    const sp = transitionSpeed(this.prevState, this.targetState);
    this.paramDuration = Math.min(3.0, Math.max(0.7, 3.0 - sp * 0.85));
    this.morphDuration = Math.min(3.0, Math.max(1.5, 3.0 - sp * 0.6));
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, Math.floor(w));
    this.height = Math.max(1, Math.floor(h));
    this.renderer.setSize(this.width, this.height, false);
    Common.resize(this.width, this.height);
    if (this.fluidSim) this.fluidSim.resize();
    // 更新尺寸 uniform
    this.updateMaterial.uniforms.uResW.value = this.width;
    this.updateMaterial.uniforms.uResH.value = this.height;
    this.pointsMat.uniforms.uRes.value.set(this.width, this.height);
    this.pointsMat.uniforms.uResW.value = this.width;
    this.pointsMat.uniforms.uResH.value = this.height;
    this.threadsMat.uniforms.uRes.value.set(this.width, this.height);
    this.glowMat.uniforms.uRes.value.set(this.width, this.height);
  }

  dispose() {
    this.disposed = true;
    try {
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
      this.posRT.forEach((rt) => rt.dispose());
      this.paletteTex.dispose();
      this.silhouetteTex.dispose();
      this.curveMesh.geometry.dispose();
      this.curveMat.dispose();
      this.blobMesh.geometry.dispose();
      this.blobMat.dispose();
    } catch {
      /* noop */
    }
  }
}
