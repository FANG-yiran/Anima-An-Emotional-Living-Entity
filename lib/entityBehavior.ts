// ============ 生命体表达行为决策（文档 §2.2/§6） ============
import { LATENCY } from "./constants";
import type { ActionType, EntityBehavior, InternalState } from "./types";

/**
 * 根据用户动作与当前内部状态，决定生命体表达行为。
 * 同一动作在不同状态下给出不同回应（历史依赖性的来源）。
 */
export function decideBehavior(
  action: ActionType,
  state: InternalState,
  rand: () => number = Math.random
): EntityBehavior {
  const r = rand();
  switch (action) {
    case "approach":
      if (state.axis_safety < 0.3) return "retreat";
      if (state.axis_safety < 0.5) return r < 0.6 ? "dodge" : "hesitate";
      if (state.axis_arousal > 0.75) return "hesitate";
      return r < 0.75 ? "approach" : "hesitate";
    case "retreat":
      // 记忆充足时，生命体反而可能靠近（反转的合理性来源）
      if (state.axis_memory > 0.6) return r < 0.7 ? "approach" : "hesitate";
      if (state.axis_safety < 0.35) return "ignore";
      return r < 0.5 ? "hesitate" : "approach";
    case "pause":
      if (state.axis_arousal < 0.4) return r < 0.6 ? "approach" : "hesitate";
      if (state.axis_safety > 0.6) return "approach";
      return r < 0.7 ? "hesitate" : "ignore";
    case "reach":
      if (state.axis_safety < 0.35) return "retreat";
      if (state.axis_arousal > 0.7) return "dodge";
      if (state.axis_safety > 0.6) return "approach";
      return r < 0.5 ? "hesitate" : "ignore";
    case "glide":
      return r < 0.65 ? "ignore" : "dodge";
    case "leave":
      return r < 0.6 ? "ignore" : "retreat";
    case "dblclick":
      // 被唤醒：安全时回应靠近，防御时闪躲
      if (state.axis_safety < 0.35) return "dodge";
      return r < 0.75 ? "approach" : "hesitate";
    case "hold":
      // 呼吸同频：趋向稳定靠近
      if (state.axis_safety < 0.3) return "hesitate";
      return r < 0.7 ? "approach" : "hesitate";
    case "drag":
      // 被引导：跟随靠近，防御过强则侧移
      if (state.axis_safety < 0.3) return "dodge";
      return r < 0.7 ? "approach" : "hesitate";
    case "still":
      // 静止守候：它缓缓靠近
      if (state.axis_arousal > 0.7) return "hesitate";
      return r < 0.6 ? "approach" : "hesitate";
  }
}

/**
 * 响应延迟：100-500ms，随状态变化。
 * arousal 越高越敏锐（延迟越短），并叠加随机波动。
 */
export function responseLatency(state: InternalState, rand: () => number = Math.random): number {
  const base = LATENCY.MAX - (LATENCY.MAX - LATENCY.MIN) * state.axis_arousal * 0.7;
  const jitter = (rand() - 0.5) * 160;
  return Math.min(LATENCY.MAX, Math.max(LATENCY.MIN, Math.round(base + jitter)));
}

export interface EntityMoveTarget {
  vx: number; // px/s 沿 x 的速度
  vy: number; // px/s 沿 y 的速度
}

/**
 * 计算生命体在当前行为下的移动速度向量（px/s）。
 * 靠近：缓慢趋向光标；逃开：快速远离；躲避：横向侧移；迟疑：小幅徘徊；无视：随机漂移。
 */
export function entityMovement(
  behavior: EntityBehavior,
  entityPos: { x: number; y: number },
  cursorPos: { x: number; y: number } | null,
  rand: () => number = Math.random
): EntityMoveTarget {
  const dx = cursorPos ? cursorPos.x - entityPos.x : 0;
  const dy = cursorPos ? cursorPos.y - entityPos.y : 0;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  // 距离已远时收敛逃逸/闪避速度，避免整团光流被「甩飞」
  const farScale = dist > 220 ? Math.max(0.25, 220 / dist) : 1;

  switch (behavior) {
    case "approach": {
      const speed = 45 + rand() * 35;
      return { vx: ux * speed, vy: uy * speed };
    }
    case "retreat": {
      const speed = (95 + rand() * 45) * farScale;
      return { vx: -ux * speed, vy: -uy * speed };
    }
    case "dodge": {
      const speed = (100 + rand() * 30) * farScale;
      return { vx: -uy * speed * (rand() < 0.5 ? 1 : -1), vy: ux * speed * (rand() < 0.5 ? 1 : -1) };
    }
    case "hesitate": {
      return { vx: (rand() - 0.5) * 24, vy: (rand() - 0.5) * 24 };
    }
    case "ignore":
    default: {
      return { vx: (rand() - 0.5) * 18, vy: (rand() - 0.5) * 18 };
    }
  }
}
