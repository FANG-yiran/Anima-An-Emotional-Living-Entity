// ============ 粒子渲染模块：形态状态机 + 粒子更新与绘制（纯函数，与引擎解耦） ============
import { ACTION } from "./constants";
import type { EngineSnapshot } from "./types";

/** 形态类型：由内部状态轴映射 */
export type FormType =
  | "mist" // 弥散雾（manifest 低）
  | "liquid" // 液体（接近倾向高）
  | "nebula" // 星云（情绪强度高）
  | "field" // 磁场/细胞（安全防御高）
  | "colony" // 菌群蔓延（记忆期待高）
  | "breath" // 呼吸结构（均衡）
  | "swarm"; // 聚形成"身体"（manifest 高）

export const FORM_ORDER: FormType[] = [
  "mist", "liquid", "nebula", "field", "colony", "breath", "swarm",
];

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: number;
  seed: number; // 相位种子（噪声）
  life: number; // 0-1 亮度闪烁
  bond: number; // 0-1 联结度（连线透明度）
}

export const PARTICLE_COUNT = 560;

/** 初始弥散：粒子均匀铺满画布（"观众出现前，它散在全空间"） */
export function createParticles(w: number, h: number): Particle[] {
  const arr: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    arr.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: 0,
      vy: 0,
      r: 1.5 + Math.random() * 2.6,
      hue: 185 + Math.random() * 55,
      seed: Math.random() * Math.PI * 2,
      life: 0.35 + Math.random() * 0.65,
      bond: 0,
    });
  }
  return arr;
}

/** 各形态得分（未归一），值越大越主导 */
export function formScores(s: {
  axis_approach: number;
  axis_safety: number;
  axis_arousal: number;
  axis_memory: number;
  axis_manifest: number;
}): Record<FormType, number> {
  const m = s.axis_manifest;
  return {
    mist: Math.max(0, 1 - m * 1.3),
    liquid: s.axis_approach,
    nebula: s.axis_arousal,
    field: s.axis_safety,
    colony: s.axis_memory,
    breath: 0.5 * (1 - Math.abs(s.axis_arousal - 0.4)),
    swarm: m,
  };
}

/** softmax 归一为权重（温度 3，突出主导形态） */
function softmaxWeights(scores: Record<FormType, number>): Record<FormType, number> {
  const exp: Partial<Record<FormType, number>> = {};
  let sum = 0;
  for (const k of FORM_ORDER) {
    const e = Math.exp((scores[k] - 0.4) * 3);
    exp[k] = e;
    sum += e;
  }
  const out = {} as Record<FormType, number>;
  for (const k of FORM_ORDER) out[k] = exp[k]! / sum;
  return out;
}

/** 各形态运动参数 */
interface FormParams {
  cohesion: number; // 向心力（聚散）
  noise: number; // 随机噪声幅度
  spread: number; // 扩散半径系数
  flow: number; // 横向流动
  hue: number; // 主色相
  radial: number; // 径向爆发（向外为正）
  tangent: number; // 切向环流（磁场）
}

const FORM_PARAMS: Record<FormType, FormParams> = {
  mist:    { cohesion: 0.15, noise: 1.5, spread: 1.0, flow: 0.0, hue: 205, radial: 0.0, tangent: 0.0 },
  liquid:  { cohesion: 0.55, noise: 0.7, spread: 0.55, flow: 0.45, hue: 175, radial: 0.0, tangent: 0.2 },
  nebula:  { cohesion: 0.3, noise: 1.7, spread: 0.85, flow: 0.2, hue: 265, radial: 0.9, tangent: 0.35 },
  field:   { cohesion: 1.2, noise: 0.5, spread: 0.42, flow: 0.1, hue: 150, radial: -0.4, tangent: 1.0 },
  colony:  { cohesion: 0.4, noise: 1.2, spread: 0.95, flow: 0.15, hue: 320, radial: 0.3, tangent: 0.1 },
  breath:  { cohesion: 0.95, noise: 0.6, spread: 0.5, flow: 0.05, hue: 195, radial: 0.0, tangent: 0.0 },
  swarm:   { cohesion: 1.7, noise: 0.35, spread: 0.3, flow: 0.0, hue: 205, radial: 0.0, tangent: 0.15 },
};

export interface ParticleExtras {
  burstUntil: number; // 双击爆聚截止时间戳（ms）
}

/** 每帧更新粒子：形态权重混合 + 特征力 + 交互模式力 + 阻尼 */
export function updateParticles(
  particles: Particle[],
  snap: EngineSnapshot,
  w: number,
  h: number,
  now: number,
  dtSec: number,
  extras: ParticleExtras
) {
  const weights = softmaxWeights(formScores(snap.state));
  const { entityPos: c, cursorPos, interactionMode, holdPhase, manifestProgress } = snap;

  // 形态参数按权重混合
  let cohesion = 0, noise = 0, spread = 0, flow = 0, hue = 0, radial = 0, tangent = 0;
  for (const k of FORM_ORDER) {
    const wp = weights[k];
    const fp = FORM_PARAMS[k];
    cohesion += fp.cohesion * wp;
    noise += fp.noise * wp;
    spread += fp.spread * wp;
    flow += fp.flow * wp;
    hue += fp.hue * wp;
    radial += fp.radial * wp;
    tangent += fp.tangent * wp;
  }

  // 呼吸调制：swarm/breath 聚形时整体半径随周期涨落
  const breathe = 1 + 0.2 * Math.sin((now / 1000) * (Math.PI * 2 / (ACTION.BREATH_PERIOD / 1000)));
  // 长按呼吸同步：用 holdPhase 相位调制
  const holdBreathe =
    interactionMode === "hold" ? 1 + 0.28 * Math.sin(holdPhase * Math.PI * 2) : 1;

  const burstActive = now < extras.burstUntil;
  const burstPower = burstActive ? Math.max(0, 1 - (extras.burstUntil - now) / 700) : 0;

  for (const p of particles) {
    const dx = c.x - p.x;
    const dy = c.y - p.y;
    const d = Math.hypot(dx, dy) + 1e-6;
    const ux = dx / d;
    const uy = dy / d;

    // 向心力（扩散半径越大 → 距离越远平衡点，用 spread 放大平衡半径）
    const balanceR = 55 + spread * 170;
    const pull = cohesion * Math.min(1, d / (balanceR + 40)) * 95 * breathe * holdBreathe;
    p.vx += ux * pull * dtSec;
    p.vy += uy * pull * dtSec;

    // 相位噪声（伪布朗运动）
    const n1 = Math.sin(now / 700 * p.seed + p.seed * 5);
    const n2 = Math.cos(now / 500 * p.seed + p.seed * 3);
    p.vx += (n1 + n2 * 0.5) * noise * 55 * dtSec;
    p.vy += (n1 * 0.5 - n2) * noise * 55 * dtSec;

    // 径向爆发（星云） / 切向环流（磁场）
    p.vx += ux * radial * 130 * dtSec + -uy * tangent * 90 * dtSec;
    p.vy += uy * radial * 130 * dtSec + ux * tangent * 90 * dtSec;

    // 横向流动（液体）
    p.vx += flow * 35 * dtSec;

    // 菌群蔓延：向光标/记忆点方向缓慢推进
    if (weights.colony > 0.25 && cursorPos) {
      const mx = cursorPos.x - p.x;
      const my = cursorPos.y - p.y;
      const md = Math.hypot(mx, my) + 1e-6;
      const k = weights.colony * 55 * dtSec;
      p.vx += (mx / md) * k;
      p.vy += (my / md) * k;
    }

    // 交互模式力
    if (interactionMode === "drag" && cursorPos) {
      const k = 260 * dtSec; // 粒子尾随光标
      p.vx += (cursorPos.x - p.x) / Math.max(40, Math.hypot(cursorPos.x - p.x, cursorPos.y - p.y)) * k;
      p.vy += (cursorPos.y - p.y) / Math.max(40, Math.hypot(cursorPos.x - p.x, cursorPos.y - p.y)) * k;
    } else if (interactionMode === "still" && cursorPos) {
      const k = 90 * dtSec; // 缓慢织丝靠近
      p.vx += (cursorPos.x - p.x) / Math.max(80, Math.hypot(cursorPos.x - p.x, cursorPos.y - p.y)) * k;
      p.vy += (cursorPos.y - p.y) / Math.max(80, Math.hypot(cursorPos.x - p.x, cursorPos.y - p.y)) * k;
    }

    // 双击爆聚脉冲（唤醒）
    if (burstActive) {
      const impulse = 520 * burstPower;
      p.vx += ux * impulse * dtSec * 10;
      p.vy += uy * impulse * dtSec * 10;
    }

    // 阻尼
    const damp = Math.max(0, 1 - 2.4 * dtSec);
    p.vx *= damp;
    p.vy *= damp;

    // 积分 + 边界反弹
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    if (p.x < 4) { p.x = 4; p.vx = Math.abs(p.vx) * 0.5; }
    if (p.x > w - 4) { p.x = w - 4; p.vx = -Math.abs(p.vx) * 0.5; }
    if (p.y < 4) { p.y = 4; p.vy = Math.abs(p.vy) * 0.5; }
    if (p.y > h - 4) { p.y = h - 4; p.vy = -Math.abs(p.vy) * 0.5; }

    // 形态色相与亮度
    p.hue += (hue - p.hue) * Math.min(1, dtSec * 3);
    p.r = (1.5 + Math.sin(now / 300 + p.seed) * 0.6) * (0.8 + weights.swarm * 1.0);
    p.life = 0.35 + 0.5 * Math.abs(Math.sin(now / 900 + p.seed));
    // 联结度：manifest 高时主团联结更强
    p.bond = Math.min(1, (weights.swarm * 0.7 + weights.field * 0.3) * (1.2 - d / 400));
  }
}

/** 绘制粒子与显式连线（避免 O(n²) 全配对） */
export function drawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  snap: EngineSnapshot,
  now: number,
  w: number,
  h: number,
  extras: ParticleExtras
) {
  const { entityPos: c, cursorPos, interactionMode, manifestProgress } = snap;
  const alpha = 0.55 + manifestProgress * 0.45; // 未成形时也保持可见的雾

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineWidth = 1;

  // 呼吸/守候/引导模式的显式连线
  const center = { x: c.x, y: c.y };
  const step = interactionMode === "hold" ? 6 : interactionMode === "still" ? 4 : 9;
  for (let i = 0; i < particles.length; i += step) {
    const p = particles[i];
    const target = interactionMode === "still" && cursorPos ? cursorPos : center;
    const lineA = p.bond * 0.22 * alpha;
    if (lineA <= 0.02) continue;
    ctx.strokeStyle = `hsla(${p.hue}, 80%, 70%, ${lineA})`;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
  }

  // 粒子点
  const burstPower = now < extras.burstUntil ? Math.max(0, 1 - (extras.burstUntil - now) / 700) : 0;
  for (const p of particles) {
    const a = (0.4 + p.life * 0.6) * alpha * (0.7 + burstPower * 0.4);
    ctx.fillStyle = `hsla(${p.hue}, 85%, ${62 + p.life * 20}%, ${a})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 核心辉光：生命体的"存在核心"，随显现度凝聚变亮（径向渐变，无 shadowBlur）
  const coreR = 30 + manifestProgress * 110;
  const coreA = 0.16 + manifestProgress * 0.34;
  const glow = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, coreR);
  glow.addColorStop(0, `rgba(160, 228, 255, ${coreA})`);
  glow.addColorStop(0.45, `rgba(120, 190, 255, ${coreA * 0.4})`);
  glow.addColorStop(1, "rgba(120, 190, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(c.x, c.y, coreR, 0, Math.PI * 2);
  ctx.fill();

  // 光标光点
  if (cursorPos) {
    ctx.fillStyle = `rgba(238,242,255,${0.6 + burstPower * 0.3})`;
    ctx.beginPath();
    ctx.arc(cursorPos.x, cursorPos.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 接触圈（点击判定范围）
  ctx.save();
  ctx.setLineDash([4, 7]);
  ctx.strokeStyle = `rgba(110,231,255,${0.18 + manifestProgress * 0.12})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(c.x, c.y, 70, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
