// ============ 输出生成：关键词 + 模板匹配 + 情绪化推测 + 名言 + 报告组装（文档 §5.1/§5.2/§5.3） ============
import {
  ACTION_LABELS,
  BEHAVIOR_LABELS,
  ETHICS_NOTE,
  KEYWORD_LIB,
  QUOTE_LIB,
  SCORE_LEVEL,
  TEMPLATES,
} from "./constants";
import type { CondOp, Quote, QuoteMood, Template } from "./constants";
import type {
  EventLogEntry,
  ReportData,
  SevenDimKey,
  SevenScores,
} from "./types";

function condMatches(op: CondOp, value: number): boolean {
  switch (op) {
    case "high": return value >= SCORE_LEVEL.HIGH;
    case "low": return value <= SCORE_LEVEL.LOW;
    case "mid": return value > SCORE_LEVEL.LOW && value < SCORE_LEVEL.HIGH;
    case "very_high": return value >= SCORE_LEVEL.VERY_HIGH;
    case "very_low": return value <= SCORE_LEVEL.VERY_LOW;
  }
}

/** 模板匹配：取满足条件数最多的模板（条件带权重） */
export function matchTemplate(scores: SevenScores): Template {
  let best: Template | null = null;
  let bestScore = -1;
  for (const t of TEMPLATES) {
    let s = 0;
    for (const c of t.conditions) {
      const w = c.op === "very_high" || c.op === "very_low" ? 1.5 : 1;
      if (condMatches(c.op, scores[c.dim])) s += w;
    }
    // 条件数越少越精确，作为平局打破项
    s -= t.conditions.length * 0.05;
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return best ?? TEMPLATES[0];
}

/** 关键词选择：按八维高分/低分从关键词库取 3-5 个 */
export function selectKeywords(scores: SevenScores, connectionScore: number): string[] {
  const picked: string[] = [];
  const push = (arr: string[]) => {
    for (const w of arr) {
      if (!picked.includes(w)) picked.push(w);
      if (picked.length >= 5) return;
    }
  };

  const dims: SevenDimKey[] = [
    "approach_tendency",
    "confirmation_need",
    "rejection_sensitivity",
    "intimacy_tolerance",
    "uncertainty_tolerance",
    "boundary",
    "repair_tendency",
    "manifest_presence",
  ];
  // 按“显著程度”排序（离 50 越远越显著）
  const ranked = [...dims].sort((a, b) => Math.abs(scores[b] - 50) - Math.abs(scores[a] - 50));

  for (const dim of ranked) {
    if (picked.length >= 3) break;
    const v = scores[dim];
    for (const item of KEYWORD_LIB) {
      if (item.dim !== dim) continue;
      if ((item.level === "high" && v >= SCORE_LEVEL.HIGH) || (item.level === "low" && v <= SCORE_LEVEL.LOW)) {
        push(item.words);
      }
    }
  }

  // 综合词
  if (picked.length < 3) {
    if (connectionScore >= 8) push(KEYWORD_LIB.find((k) => k.dim === "overall" && k.level === "high")!.words);
    if (connectionScore <= 1) push(KEYWORD_LIB.find((k) => k.dim === "overall" && k.level === "low")!.words);
  }
  if (picked.length === 0) push(["安静", "克制", "疏离"]);

  return picked.slice(0, 5);
}

/** 客观动作记录：双方动作的简短并置，不做情绪解读 */
export function formatActionLog(events: EventLogEntry[]): string[] {
  if (events.length === 0) return [];
  // 采样最多 8 条，按时间均匀取样，保留首尾
  const max = 8;
  let picked: EventLogEntry[] = events;
  if (events.length > max) {
    picked = [];
    for (let i = 0; i < max; i++) {
      picked.push(events[Math.round((i * (events.length - 1)) / (max - 1))]);
    }
    picked = [...new Set(picked)];
  }
  return picked.map((e) => {
    const t = Math.max(0, Math.round(e.timestamp));
    const mm = String(Math.floor(t / 60)).padStart(2, "0");
    const ss = String(t % 60).padStart(2, "0");
    return `${mm}:${ss}　你${ACTION_LABELS[e.user_action]}　它${BEHAVIOR_LABELS[e.expressed_behavior]}`;
  });
}

/**
 * 诗句匹配：按八维画像给情境标签打分，取最高分；
 * 同分时用 session 级噪音微扰，避免每次落同一句。
 */
export function pickFallbackQuote(
  scores: SevenScores,
  rand: () => number = Math.random
): Quote {
  const high = (v: number) => v >= SCORE_LEVEL.HIGH;
  const low = (v: number) => v <= SCORE_LEVEL.LOW;

  // 画像 → 情境权重
  const weights: Partial<Record<QuoteMood, number>> = {};

  if (low(scores.manifest_presence)) weights.unseen = 2.2;
  else if (high(scores.manifest_presence)) weights.presence = 1.6;

  if (high(scores.approach_tendency)) weights.reach = 2.0;
  if (low(scores.approach_tendency)) weights.retreat = 1.8;

  if (high(scores.confirmation_need)) {
    weights.chase = 2.2;
    weights.wildfire = 1.2;
  } else if (low(scores.confirmation_need)) {
    weights.silence = 1.6;
  }

  if (high(scores.rejection_sensitivity)) weights.retreat = (weights.retreat ?? 0) + 1.4;

  if (high(scores.intimacy_tolerance)) weights.intimacy = 1.8;
  if (low(scores.intimacy_tolerance)) weights.distance = (weights.distance ?? 0) + 1.2;

  if (high(scores.uncertainty_tolerance) && high(scores.approach_tendency)) {
    weights.gaze = 1.4;
    weights.intimacy = (weights.intimacy ?? 0) + 0.8;
  }
  if (low(scores.uncertainty_tolerance)) weights.chase = (weights.chase ?? 0) + 1.0;

  if (high(scores.boundary)) weights.distance = (weights.distance ?? 0) + 1.5;
  if (low(scores.boundary) && high(scores.approach_tendency)) weights.ambivalence = 2.0;

  if (high(scores.repair_tendency)) weights.repair = 2.0;
  if (low(scores.repair_tendency) && high(scores.confirmation_need)) {
    weights.wildfire = (weights.wildfire ?? 0) + 1.0;
  }

  // 兜底
  if (Object.keys(weights).length === 0) weights.default = 1;

  let bestScore = -Infinity;
  let pool: Quote[] = [];
  for (const q of QUOTE_LIB) {
    let s = 0;
    for (const mood of q.moods) s += weights[mood] ?? 0;
    // 略偏短句：报告页视觉更干净
    s -= Math.max(0, q.text.length - 28) * 0.02;
    // 轻微随机，避免千篇一律
    s += rand() * 0.35;
    if (s > bestScore + 1e-6) {
      bestScore = s;
      pool = [q];
    } else if (Math.abs(s - bestScore) < 1e-6) {
      pool.push(q);
    }
  }
  if (pool.length === 0) return QUOTE_LIB[0];
  return pool[Math.floor(rand() * pool.length)];
}

/** 组装最终报告（规则引擎回退路径） */
export function buildRuleReport(
  events: EventLogEntry[],
  connectionScore: number,
  scores: SevenScores,
  conflictNote?: string
): ReportData {
  return {
    keywords: selectKeywords(scores, connectionScore),
    inferences: formatActionLog(events),
    quote: pickFallbackQuote(scores),
    scores,
    description: matchTemplate(scores).text,
    conflict_note: conflictNote,
    llm_enhanced: false,
    ethics_note: ETHICS_NOTE,
  };
}
