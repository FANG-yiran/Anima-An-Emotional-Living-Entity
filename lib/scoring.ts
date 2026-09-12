// ============ 评估计算：五维指标 + 八维分数 + 问卷融合（文档 §4.1/§4.2/§4.3） ============
import type {
  ActionType,
  EntityBehavior,
  EventLogEntry,
  FiveIndicators,
  LatencyTrend,
  QuestionnaireAnswers,
  SevenScores,
} from "./types";

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

export interface DerivedMetrics {
  total: number;
  durationSec: number;
  count: Record<ActionType, number>;
  behaviors: Record<EntityBehavior, number>;
  userApproachCount: number;
  userRetreatCount: number;
  firstApproachTime: number; // -1 表示从未接近
  avgSpeed: number;
  avgDistance: number;
  actionsAfterIgnore: number;
  chaseAfterRetreat: number;
  waitAfterRetreat: number;
  entityApproachCount: number;
  retreatAfterEntityApproach: number;
  alternations: number;
  reversalJustified: number;
  distanceVariance: number;
  returnsAfterWithdrawal: number;
  suppressionEvents: number;
  coordinationRuns: number;
  latencyTrend: LatencyTrend;
  avgManifest: number; // 平均显现度（0-1）
}

export function deriveMetrics(events: EventLogEntry[], durationSec: number): DerivedMetrics {
  const total = events.length;
  const count: Record<ActionType, number> = {
    approach: 0, retreat: 0, pause: 0, reach: 0, glide: 0, leave: 0,
    dblclick: 0, hold: 0, drag: 0, still: 0,
  };
  const behaviors: Record<EntityBehavior, number> = {
    retreat: 0, dodge: 0, approach: 0, ignore: 0, hesitate: 0,
  };

  let firstApproachTime = -1;
  let speedSum = 0;
  let distSum = 0;
  let distSqSum = 0;
  let actionsAfterIgnore = 0;
  let chaseAfterRetreat = 0;
  let waitAfterRetreat = 0;
  let retreatAfterEntityApproach = 0;
  let alternations = 0;
  let reversalJustified = 0;
  let returnsAfterWithdrawal = 0;
  let suppressionEvents = 0;
  let coordinationRun = 0;
  let coordinationRuns = 0;
  const latencies: number[] = [];
  let manifestSum = 0;

  const lastRetreatBehaviorAt = new Map<number, number>(); // event idx → 时间
  const lastEntityApproachAt: number[] = [];

  for (let i = 0; i < total; i++) {
    const e = events[i];
    const a = e.user_action;
    count[a] += 1;
    behaviors[e.expressed_behavior] += 1;
    latencies.push(e.response_latency_ms);
    manifestSum += e.internal_state_after.axis_manifest;

    if (a === "approach") {
      if (firstApproachTime < 0) firstApproachTime = e.timestamp;
      // 修复倾向：退开后再次接近
      for (let j = i - 1; j >= 0; j--) {
        if (events[j].user_action === "retreat") {
          returnsAfterWithdrawal += 1;
          break;
        }
      }
    }
    speedSum += e.user_action_params.cursor_speed;
    if (Number.isFinite(e.user_action_params.distance_to_entity)) {
      const d = e.user_action_params.distance_to_entity;
      distSum += d;
      distSqSum += d * d;
    }

    // 无视后的追加动作（确认需求）
    if (i > 0 && events[i - 1].expressed_behavior === "ignore" && e.timestamp - events[i - 1].timestamp <= 3) {
      actionsAfterIgnore += 1;
    }
    // 逃开/躲避后的追击或等待（拒绝敏感）
    if (i > 0 && (events[i - 1].expressed_behavior === "retreat" || events[i - 1].expressed_behavior === "dodge")) {
      const gap = e.timestamp - events[i - 1].timestamp;
      if (a === "approach" && gap <= 2.5) chaseAfterRetreat += 1;
      if (a === "pause" && gap <= 2.5) waitAfterRetreat += 1;
    }
    // 生命体靠近后用户后退（亲密耐受）
    if (a === "retreat") {
      for (let j = i - 1; j >= 0; j--) {
        if (events[j].expressed_behavior === "approach" && e.timestamp - events[j].timestamp <= 3) {
          retreatAfterEntityApproach += 1;
          break;
        }
      }
    }
    // 反转（approach↔retreat 交替）与合理性
    if (i > 0) {
      const prev = events[i - 1].user_action;
      if (
        ((a === "approach" && prev === "retreat") || (a === "retreat" && prev === "approach"))
      ) {
        alternations += 1;
        const justified =
          (a === "approach" && (events[i - 1].expressed_behavior === "retreat" || events[i - 1].expressed_behavior === "dodge")) ||
          (a === "retreat" && events[i - 1].expressed_behavior === "approach");
        if (justified) reversalJustified += 1;
      }
    }
    // 表达过滤比：生命体无视但内部有显著变化
    const maxDelta = Math.max(
      Math.abs(e.internal_state_after.axis_approach - e.internal_state_before.axis_approach),
      Math.abs(e.internal_state_after.axis_safety - e.internal_state_before.axis_safety),
      Math.abs(e.internal_state_after.axis_arousal - e.internal_state_before.axis_arousal),
      Math.abs(e.internal_state_after.axis_memory - e.internal_state_before.axis_memory)
    );
    if (e.expressed_behavior === "ignore" && maxDelta > 0.08) suppressionEvents += 1;

    // 会话内协调性（互补回应的连续回合）
    const complementary =
      e.expressed_behavior !== "ignore" &&
      ((a === "approach" && (e.expressed_behavior === "approach" || e.expressed_behavior === "hesitate")) ||
        (a === "pause" && (e.expressed_behavior === "approach" || e.expressed_behavior === "hesitate")) ||
        (a === "retreat" && e.expressed_behavior === "hesitate"));
    if (complementary) {
      coordinationRun += 1;
    } else {
      if (coordinationRun >= 2) coordinationRuns += 1;
      coordinationRun = 0;
    }
  }
  if (coordinationRun >= 2) coordinationRuns += 1;

  // 响应延迟演化
  let latencyTrend: LatencyTrend = "stable";
  if (latencies.length >= 4) {
    const mid = Math.floor(latencies.length / 2);
    const first = latencies.slice(0, mid);
    const second = latencies.slice(mid);
    const mean = (arr: number[]) => arr.reduce((x, y) => x + y, 0) / arr.length;
    const mf = mean(first);
    const ms = mean(second);
    const meanAll = mean(latencies);
    const std = Math.sqrt(latencies.reduce((x, y) => x + (y - meanAll) ** 2, 0) / latencies.length);
    if (std < 30) latencyTrend = "stable";
    else if (Math.abs(mf - ms) > 50) latencyTrend = ms > mf ? "increasing" : "decreasing";
    else latencyTrend = "fluctuating";
  }

  const meanDist = total > 0 ? distSum / total : 0;
  const variance = total > 0 ? Math.max(0, distSqSum / total - meanDist * meanDist) : 0;
  const distanceVariance = meanDist > 0 ? Math.min(1, Math.sqrt(variance) / meanDist / 0.6) : 0;

  return {
    total,
    durationSec,
    count,
    behaviors,
    userApproachCount: count.approach,
    userRetreatCount: count.retreat,
    firstApproachTime,
    avgSpeed: total > 0 ? speedSum / total : 0,
    avgDistance: meanDist,
    actionsAfterIgnore,
    chaseAfterRetreat,
    waitAfterRetreat,
    entityApproachCount: behaviors.approach,
    retreatAfterEntityApproach,
    alternations,
    reversalJustified,
    distanceVariance,
    returnsAfterWithdrawal,
    suppressionEvents,
    coordinationRuns,
    latencyTrend,
    avgManifest: total > 0 ? manifestSum / total : 0.5,
  };
}

// ---- 五维指标（文档 §4.1，各 0-2 分） ----
export function computeFiveIndicators(events: EventLogEntry[], durationSec: number): FiveIndicators {
  const m = deriveMetrics(events, durationSec);

  // 1. 历史依赖度：出现 ≥3 次的动作类型中，产生了 ≥2 种行为且非单一声者
  const actionBehaviorMap = new Map<ActionType, Map<EntityBehavior, number>>();
  for (const e of events) {
    if (!actionBehaviorMap.has(e.user_action)) actionBehaviorMap.set(e.user_action, new Map());
    const bm = actionBehaviorMap.get(e.user_action)!;
    bm.set(e.expressed_behavior, (bm.get(e.expressed_behavior) ?? 0) + 1);
  }
  let historyDependent = 0;
  for (const bm of actionBehaviorMap.values()) {
    const occ = [...bm.values()].reduce((a, b) => a + b, 0);
    if (occ >= 3 && bm.size >= 2) {
      const dominant = Math.max(...bm.values());
      if (dominant / occ < 0.8) historyDependent += 1;
    }
  }

  const historyDependency = historyDependent >= 2 ? 2 : historyDependent;

  // 2. 反转合理性
  const reversalJustification = m.reversalJustified >= 2 ? 2 : m.reversalJustified;

  // 3. 表达过滤比
  const expressionFilterRatio = m.suppressionEvents >= 2 ? 2 : m.suppressionEvents;

  // 4. 响应延迟演化
  const latencyEvolution =
    m.latencyTrend === "stable" ? 0 : m.latencyTrend === "fluctuating" ? 1 : 2;

  // 5. 会话内协调性
  const coordination = m.coordinationRuns >= 2 ? 2 : m.coordinationRuns;

  return {
    history_dependency: historyDependency,
    reversal_justification: reversalJustification,
    expression_filter_ratio: expressionFilterRatio,
    latency_evolution: latencyEvolution,
    coordination,
  };
}

export interface ConnectionResult {
  score: number; // 0-10
  label: string; // 强联结 / 中等联结 / 弱联结 / 无联结
}

export function connectionFromIndicators(indicators: FiveIndicators): ConnectionResult {
  const score =
    indicators.history_dependency +
    indicators.reversal_justification +
    indicators.expression_filter_ratio +
    indicators.latency_evolution +
    indicators.coordination;
  const label = score >= 8 ? "强联结" : score >= 5 ? "中等联结" : score >= 2 ? "弱联结" : "无联结";
  return { score, label };
}

// ---- 八维关系画像（文档 §4.2） ----
export function computeSevenScores(events: EventLogEntry[], durationSec: number): SevenScores {
  const m = deriveMetrics(events, durationSec);
  const total = Math.max(1, m.total);

  // 靠近倾向：主动 approach 占比 + 前 15 秒即接近加分
  let approach_tendency = (m.userApproachCount / total) * 100;
  if (m.firstApproachTime >= 0 && m.firstApproachTime <= 15) approach_tendency += 15;
  approach_tendency = clamp(approach_tendency, 0, 100);

  // 确认需求：无反应后动作频率相对基线 + 点击频率 + 光标速度
  const baseFreq = total / Math.max(1, m.durationSec) * 60;
  const noRespFreq = m.actionsAfterIgnore / Math.max(1, m.durationSec) * 60;
  const freqFactor = baseFreq > 0 ? (noRespFreq / baseFreq - 1) * 50 + 50 : 50;
  const clickFactor = (m.count.reach / total) * 60;
  const speedFactor = m.avgSpeed > 300 ? 12 : m.avgSpeed > 180 ? 6 : 0;
  const confirmation_need = clamp(freqFactor + clickFactor + speedFactor, 0, 100);

  // 拒绝敏感：逃离后立即停止等待（+30）/ 高频追击（+80）
  let rejection_sensitivity = 50;
  if (m.behaviors.retreat + m.behaviors.dodge > 0) {
    if (m.chaseAfterRetreat > 0 && m.chaseAfterRetreat > m.waitAfterRetreat) rejection_sensitivity = 80;
    else if (m.waitAfterRetreat > 0) rejection_sensitivity = 30;
  }

  // 亲密耐受：生命体靠近时用户后退的比例
  let intimacy_tolerance = 50;
  if (m.entityApproachCount > 0) {
    intimacy_tolerance = clamp(100 - (m.retreatAfterEntityApproach / m.entityApproachCount) * 100);
  }

  // 不确定耐受：与确认需求反向
  const uncertainty_tolerance = clamp(100 - confirmation_need);

  // 边界：100 - 交替频率*20 - 距离方差惩罚
  const alternationsPerMin = m.alternations / Math.max(1, m.durationSec) * 60;
  const boundary = clamp(100 - alternationsPerMin * 20 - m.distanceVariance * 10);

  // 修复倾向：退开后重新接近的比例
  let repair_tendency = 50;
  if (m.userRetreatCount > 0) {
    repair_tendency = clamp((m.returnsAfterWithdrawal / m.userRetreatCount) * 100);
  }

  // 被看见/存在感：交互全程平均显现度映射 0-100
  const manifest_presence = clamp(m.avgManifest * 100);

  return {
    approach_tendency,
    confirmation_need,
    rejection_sensitivity,
    intimacy_tolerance,
    uncertainty_tolerance,
    boundary,
    repair_tendency,
    manifest_presence,
  };
}

export interface FusionResult {
  scores: SevenScores;
  conflictNote?: string;
}

// ---- 问卷校准（文档 §4.3）：行为 0.7 / 问卷 0.3 ----
export function fuseWithQuestionnaire(
  behavior: SevenScores,
  answers: QuestionnaireAnswers
): FusionResult {
  const q = answers;
  const to100 = (v: number) => ((v - 1) / 4) * 100;

  const perceived = to100((q.q1 + q.q2 + q.q3) / 3); // 感知联结
  const qApproach = perceived * 0.5 + (1 - q.q7 / 5) * 100 * 0.5;
  const qConfirmation = to100((q.q4 + q.q5) / 2);
  const qIntimacy = ((5 - q.q6) / 4) * 100;
  const qRejection = (q.q7 / 5) * 100;

  const f = (b: number, qs: number) => clamp(0.7 * b + 0.3 * qs);

  const scores: SevenScores = {
    ...behavior,
    approach_tendency: f(behavior.approach_tendency, qApproach),
    confirmation_need: f(behavior.confirmation_need, qConfirmation),
    rejection_sensitivity: f(behavior.rejection_sensitivity, qRejection),
    intimacy_tolerance: f(behavior.intimacy_tolerance, qIntimacy),
  };

  const conflicts: string[] = [];
  if (Math.abs(behavior.approach_tendency - qApproach) > 25) conflicts.push("靠近倾向");
  if (Math.abs(behavior.confirmation_need - qConfirmation) > 25) conflicts.push("确认需求");
  if (Math.abs(behavior.rejection_sensitivity - qRejection) > 25) conflicts.push("拒绝敏感");
  if (Math.abs(behavior.intimacy_tolerance - qIntimacy) > 25) conflicts.push("亲密耐受");

  const conflictNote = conflicts.length
    ? `此次交互中你的体验存在矛盾：你的行为表现出较高的「${conflicts.join("」「")}」，但你在问卷中的自述与之不一致。这不代表任何标签，只是你此刻体验的两面。`
    : undefined;

  return { scores, conflictNote };
}
