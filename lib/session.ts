// ============ 会话级日志生成（文档 §3.2） ============
import { AXIS_CONFIG } from "./constants";
import { deriveMetrics } from "./scoring";
import type {
  AxisKey,
  EventLogEntry,
  KeyMoment,
  SessionLog,
  SevenScores,
} from "./types";

export function buildSessionLog(
  events: EventLogEntry[],
  durationSec: number,
  scores: SevenScores
): SessionLog {
  const m = deriveMetrics(events, durationSec);

  // 主导轴：按事件间平均状态相对基线的偏移量取前二
  // axis_manifest 是元轴（随任何互动自然成长），排除以免始终占据主导
  const offset = (key: AxisKey) => {
    if (events.length === 0) return 0;
    const avg =
      events.reduce((s, e) => s + e.internal_state_after[key], 0) / events.length;
    return Math.abs(avg - AXIS_CONFIG[key].baseline);
  };
  const axes = (Object.keys(AXIS_CONFIG) as AxisKey[])
    .filter((k) => k !== "axis_manifest")
    .sort((a, b) => offset(b) - offset(a));
  const dominant_axes = axes.slice(0, 2);

  return {
    session_id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `session-${Date.now()}`,
    duration_sec: Math.round(durationSec * 10) / 10,
    total_events: events.length,
    action_types_used: Object.values(m.count).filter((v) => v > 0).length,
    behavior_types_expressed: Object.values(m.behaviors).filter((v) => v > 0).length,
    reversal_count: m.alternations,
    reversal_justified: m.reversalJustified,
    suppression_events: m.suppressionEvents,
    latency_trend: m.latencyTrend,
    coordination_sequences: m.coordinationRuns,
    dominant_axes,
    key_moments: extractKeyMoments(events),
    scores,
  };
}

/** 提取最多 3 个关键时刻（文档 §3.2） */
function extractKeyMoments(events: EventLogEntry[]): KeyMoment[] {
  const moments: KeyMoment[] = [];
  for (let i = 0; i < events.length && moments.length < 3; i++) {
    const e = events[i];
    const next = events[i + 1];

    // 第一次靠近后逃开
    if (
      e.user_action === "approach" &&
      next &&
      next.user_action === "retreat" &&
      next.timestamp - e.timestamp <= 4
    ) {
      moments.push({ timestamp: e.timestamp, description: "第一次靠近后逃开" });
      continue;
    }
    // 停住后它反而靠近
    if (e.user_action === "pause" && e.expressed_behavior === "approach") {
      moments.push({ timestamp: e.timestamp, description: "停住后它反而靠近" });
      continue;
    }
    // 伸手后完全无反应，但内部 arousal 上升
    if (
      e.user_action === "reach" &&
      e.expressed_behavior === "ignore" &&
      e.internal_state_after.axis_arousal - e.internal_state_before.axis_arousal > 0.05
    ) {
      moments.push({ timestamp: e.timestamp, description: "伸手后完全无反应，但内部 arousal 上升" });
      continue;
    }
    // 记忆式回应：重复动作得到不同回应
    if (e.action_occurrence >= 3 && e.expressed_behavior !== "ignore" && moments.length < 2) {
      const prev = events
        .slice(0, i)
        .filter((x) => x.user_action === e.user_action)
        .pop();
      if (prev && prev.expressed_behavior !== e.expressed_behavior) {
        moments.push({ timestamp: e.timestamp, description: `重复${label(e.user_action)}后，它的回应改变了` });
      }
    }
  }
  return moments;
}

function label(a: string): string {
  const map: Record<string, string> = {
    approach: "靠近",
    retreat: "回避",
    pause: "等待",
    reach: "接触",
    glide: "经过",
    leave: "离开",
  };
  return map[a] ?? a;
}
