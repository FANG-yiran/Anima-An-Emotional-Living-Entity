// ============ 交互引擎：动作判定 + 内部状态 + 事件日志（文档 §2.1/§2.2/§3.1） ============
import { ACTION, AXIS_CONFIG, NOISE_SIGMA, incrementFor, phaseFor } from "./constants";
import { decideBehavior, entityMovement, responseLatency } from "./entityBehavior";
import type {
  ActionType,
  AttachmentMarkers,
  EngineSnapshot,
  EntityBehavior,
  EventLogEntry,
  InternalState,
  Phase,
  UserActionParams,
} from "./types";

export interface EngineCallbacks {
  onEvent?: (entry: EventLogEntry, snapshot: EngineSnapshot) => void;
  onComplete?: () => void;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function gaussian(rand: () => number = Math.random): number {
  // Box-Muller 高斯噪声（σ 由调用方缩放）
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class AnimaEngine {
  private bounds = { w: 1200, h: 800 };
  private startTime = 0;
  private lastTick = 0;
  private lastStateUpdate = 0;
  private lastEntityUpdate = 0;

  private state: InternalState = {
    axis_approach: AXIS_CONFIG.axis_approach.initial,
    axis_safety: AXIS_CONFIG.axis_safety.initial,
    axis_arousal: AXIS_CONFIG.axis_arousal.initial,
    axis_memory: AXIS_CONFIG.axis_memory.initial,
  };

  // 光标与生命体
  private cursorPos: { x: number; y: number } | null = null;
  private entityPos = { x: 600, y: 400 };
  private entityBehavior: EntityBehavior = "ignore";
  private pendingBehavior: { behavior: EntityBehavior; at: number } | null = null;

  // 事件与统计
  events: EventLogEntry[] = [];
  private actionCounts: Record<ActionType, number> = {
    approach: 0, retreat: 0, pause: 0, reach: 0, glide: 0, leave: 0,
  };
  private behaviorCounts: Record<EntityBehavior, number> = {
    retreat: 0, dodge: 0, approach: 0, ignore: 0, hesitate: 0,
  };
  private latencyList: number[] = [];
  private lastLatency = 0;
  private lastEventAt = 0;
  private finished = false;

  // 采样与动作判定状态
  private lastSample = { x: 0, y: 0, t: 0 };
  private speed = 0;
  private distAtLastEvent = Infinity;
  private nearSince = 0;
  private lastInputAt = 0;
  private pauseEmitted = true; // 尚未开始静止
  private leaveEmitted = true;

  // 依恋标记上下文
  private lastRejectionAt = -1e9;
  private lastLeaveAt = -1e9;
  private lastApproachAt = -1e9;

  constructor(private cb: EngineCallbacks = {}) {}

  get started() {
    return this.startTime > 0;
  }

  setBounds(w: number, h: number) {
    this.bounds = { w, h };
    this.entityPos.x = Math.min(w - 60, Math.max(60, this.entityPos.x));
    this.entityPos.y = Math.min(h - 60, Math.max(60, this.entityPos.y));
  }

  get entityPosNow() {
    return { ...this.entityPos };
  }

  start(now = performance.now()) {
    if (this.started) return;
    this.startTime = now;
    this.lastTick = now;
    this.lastStateUpdate = now;
    this.lastEntityUpdate = now;
    this.lastInputAt = now;
    this.lastEventAt = now;
  }

  elapsed(now = performance.now()) {
    return this.started ? (now - this.startTime) / 1000 : 0;
  }

  phase(now = performance.now()): Phase {
    return phaseFor(this.elapsed(now));
  }

  handleMove(x: number, y: number, now = performance.now()) {
    if (!this.started) return;
    this.cursorPos = { x, y };
    this.lastInputAt = now;
    this.pauseEmitted = false;
    this.leaveEmitted = false;

    // 瞬时速度（基于最近两次采样）
    const dt = Math.max(1, now - this.lastSample.t);
    const d = Math.hypot(x - this.lastSample.x, y - this.lastSample.y);
    this.speed = d / dt * 1000;
    this.lastSample = { x, y, t: now };

    const dist = Math.hypot(x - this.entityPos.x, y - this.entityPos.y);
    const canEmit = now - this.lastEventAt >= ACTION.MIN_EVENT_INTERVAL;

    // 首次采样只建立基线，不触发事件
    if (!Number.isFinite(this.distAtLastEvent)) {
      this.distAtLastEvent = dist;
      return;
    }

    // approach / retreat：距离相对上次事件累计变化超过阈值
    if (canEmit && Math.abs(this.distAtLastEvent - dist) >= ACTION.APPROACH_DIST_DELTA) {
      const action: ActionType = dist < this.distAtLastEvent ? "approach" : "retreat";
      this.distAtLastEvent = dist;
      this.emitEvent(action, { cursor_speed: this.speed, distance_to_entity: dist, pause_duration: 0 }, now);
    }

    // glide：快速经过生命体附近且停留 < 0.2s
    const nearZone = ACTION.REACH_RADIUS * 1.5;
    if (dist < nearZone) {
      if (this.nearSince === 0) this.nearSince = now;
      if (
        canEmit &&
        this.speed > ACTION.GLIDE_SPEED &&
        dist < ACTION.REACH_RADIUS &&
        now - this.nearSince < ACTION.GLIDE_MAX_DWELL
      ) {
        this.emitEvent("glide", { cursor_speed: this.speed, distance_to_entity: dist, pause_duration: 0 }, now);
      }
    } else {
      this.nearSince = 0;
    }
  }

  handleClick(x: number, y: number, now = performance.now()) {
    if (!this.started) return;
    this.cursorPos = { x, y };
    this.lastInputAt = now;
    const dist = Math.hypot(x - this.entityPos.x, y - this.entityPos.y);
    if (dist <= ACTION.REACH_RADIUS) {
      this.emitEvent("reach", { cursor_speed: this.speed, distance_to_entity: dist, pause_duration: 0 }, now);
    }
  }

  handleWindowLeave(now = performance.now()) {
    if (!this.started) return;
    this.lastInputAt = now;
    this.emitEvent("leave", { cursor_speed: 0, distance_to_entity: Math.hypot(1e9, 1e9), pause_duration: 0 }, now);
    this.leaveEmitted = true;
  }

  /** 主循环：内部状态衰减 + 生命体运动 + pause/leave 判定 */
  update(now = performance.now()) {
    if (!this.started || this.finished) return;

    const dtState = now - this.lastStateUpdate;
    if (dtState >= ACTION.STATE_UPDATE_INTERVAL) {
      this.lastStateUpdate = now;
      const dtSec = dtState / 1000;
      for (const key of Object.keys(AXIS_CONFIG) as (keyof InternalState)[]) {
        const cfg = AXIS_CONFIG[key];
        const noise = gaussian() * NOISE_SIGMA;
        // 衰减回归基线 + 随机噪声（文档 §2.2）
        this.state[key] = clamp01(
          this.state[key] - cfg.decay * (this.state[key] - cfg.baseline) * dtSec + noise
        );
      }
    }

    const dtEntity = now - this.lastEntityUpdate;
    if (dtEntity >= ACTION.ENTITY_UPDATE_INTERVAL) {
      this.lastEntityUpdate = now;
      this.moveEntity(dtEntity / 1000, now);
    }

    // pause：停止 ≥ 0.5s（一次性触发）
    if (!this.pauseEmitted && now - this.lastInputAt >= ACTION.PAUSE_DURATION) {
      this.pauseEmitted = true;
      const dist = this.cursorPos
        ? Math.hypot(this.cursorPos.x - this.entityPos.x, this.cursorPos.y - this.entityPos.y)
        : Infinity;
      this.emitEvent(
        "pause",
        { cursor_speed: 0, distance_to_entity: dist, pause_duration: ACTION.PAUSE_DURATION },
        now
      );
    }

    // leave：停止操作 ≥ 3s（一次性触发）
    if (!this.leaveEmitted && now - this.lastInputAt >= ACTION.LEAVE_DURATION) {
      this.leaveEmitted = true;
      this.emitEvent(
        "leave",
        { cursor_speed: 0, distance_to_entity: Infinity, pause_duration: 0 },
        now
      );
    }

    // 生命周期结束
    if (this.elapsed(now) >= ACTION.SESSION_DURATION) {
      this.finished = true;
      this.cb.onComplete?.();
    }
  }

  private moveEntity(dtSec: number, now: number) {
    // 到达延迟时间后激活行为
    if (this.pendingBehavior && now >= this.pendingBehavior.at) {
      this.entityBehavior = this.pendingBehavior.behavior;
      this.pendingBehavior = null;
    }
    const mv = entityMovement(this.entityBehavior, this.entityPos, this.cursorPos);
    this.entityPos.x += mv.vx * dtSec;
    this.entityPos.y += mv.vy * dtSec;
    const m = 55;
    this.entityPos.x = Math.min(this.bounds.w - m, Math.max(m, this.entityPos.x));
    this.entityPos.y = Math.min(this.bounds.h - m, Math.max(m, this.entityPos.y));
  }

  private emitEvent(
    action: ActionType,
    params: UserActionParams,
    now: number
  ) {
    if (this.finished) return;

    const before: InternalState = { ...this.state };
    const inc = incrementFor(action, this.state);
    for (const key of Object.keys(inc) as (keyof InternalState)[]) {
      this.state[key] = clamp01(this.state[key] + (inc[key] ?? 0));
    }
    const after: InternalState = { ...this.state };

    const behavior = decideBehavior(action, this.state);
    const latency = responseLatency(this.state);
    this.pendingBehavior = { behavior, at: now + latency };

    // 更新上下文标记
    if (behavior === "retreat" || behavior === "dodge") this.lastRejectionAt = now;
    if (action === "approach") this.lastApproachAt = now;
    if (action === "leave") this.lastLeaveAt = now;

    this.actionCounts[action] += 1;
    this.behaviorCounts[behavior] += 1;
    this.latencyList.push(latency);
    this.lastLatency = latency;
    this.lastEventAt = now;

    const entry: EventLogEntry = {
      timestamp: Math.round(this.elapsed(now) * 1000) / 1000,
      user_action: action,
      user_action_params: params,
      action_occurrence: this.actionCounts[action],
      phase: this.phase(now),
      internal_state_before: before,
      internal_state_after: after,
      expressed_behavior: behavior,
      response_latency_ms: latency,
      attachment_markers: this.computeMarkers(action, now),
    };
    this.events.push(entry);
    this.cb.onEvent?.(entry, this.getSnapshot(now));
  }

  private computeMarkers(action: ActionType, now: number): AttachmentMarkers {
    return {
      approach_after_rejection:
        action === "approach" && now - this.lastRejectionAt < 4000,
      return_after_leave:
        action === "approach" && now - this.lastLeaveAt < 6000,
      rapid_pass: action === "glide",
      click_without_approach:
        action === "reach" && now - this.lastApproachAt > 6000,
    };
  }

  getSnapshot(now = performance.now()): EngineSnapshot {
    const elapsed = this.elapsed(now);
    return {
      elapsed,
      remaining: Math.max(0, ACTION.SESSION_DURATION - elapsed),
      phase: this.phase(now),
      state: { ...this.state },
      actionCounts: { ...this.actionCounts },
      behaviorCounts: { ...this.behaviorCounts },
      lastLatency: this.lastLatency,
      avgLatency:
        this.latencyList.length > 0
          ? this.latencyList.reduce((a, b) => a + b, 0) / this.latencyList.length
          : 0,
      entityPos: { ...this.entityPos },
      entityBehavior: this.entityBehavior,
      cursorPos: this.cursorPos ? { ...this.cursorPos } : null,
    };
  }

  /** 主动结束：返回事件列表与耗时 */
  finish(now = performance.now()) {
    this.finished = true;
    return { events: this.events, durationSec: this.elapsed(now) };
  }
}
