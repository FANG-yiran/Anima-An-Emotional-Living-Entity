// ============ 输出生成：关键词 + 模板匹配 + 情绪化推测 + 名言 + 报告组装（文档 §5.1/§5.2/§5.3） ============
import {
  ETHICS_NOTE,
  INFERENCE_TEXTS,
  KEYWORD_LIB,
  QUOTE_LIB,
  SCORE_LEVEL,
  TEMPLATES,
} from "./constants";
import type { CondOp, Quote, Template } from "./constants";
import type {
  ActionType,
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

/** 规则引擎回退：从事件时间线提炼 3-5 条情绪化推测 */
export function buildFallbackInferences(events: EventLogEntry[]): string[] {
  const picked = new Map<ActionType, EventLogEntry>();
  for (const e of events) {
    if (picked.has(e.user_action)) continue;
    // 被无视的动作不构成"可感的瞬间"，跳过（still 守候除外）
    if (e.expressed_behavior === "ignore" && e.user_action !== "still") continue;
    picked.set(e.user_action, e);
  }
  const lines = [...picked.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, 5)
    .map((e) => `第${Math.round(e.timestamp)}秒，${INFERENCE_TEXTS[e.user_action]}`);
  if (lines.length === 0) {
    lines.push("这九十秒里，Animo 只是安静地弥散着，等待被看见。");
  }
  return lines;
}

/** 规则引擎回退：按画像显著维度挑选一句哲理性名言 */
export function pickFallbackQuote(scores: SevenScores): Quote {
  if (scores.manifest_presence < 35) return QUOTE_LIB[7]; // 孤独与看见
  if (scores.approach_tendency < 35 && scores.boundary > 60) return QUOTE_LIB[4]; // 里尔克
  if (scores.rejection_sensitivity > 60) return QUOTE_LIB[3]; // 尼采
  if (scores.approach_tendency > 60 && scores.intimacy_tolerance > 60) return QUOTE_LIB[1]; // 黑塞
  if (scores.uncertainty_tolerance < 35) return QUOTE_LIB[5]; // 被看见的时刻
  if (scores.confirmation_need > 60) return QUOTE_LIB[8]; // 靠近与离开
  return QUOTE_LIB[0]; // 王尔德
}

/** 组装最终报告（规则引擎回退路径） */
export function buildRuleReport(
  events: EventLogEntry[],
  connectionScore: number,
  scores: SevenScores,
  conflictNote?: string
): ReportData {
  const tpl = matchTemplate(scores);
  return {
    keywords: selectKeywords(scores, connectionScore),
    inferences: buildFallbackInferences(events),
    quote: pickFallbackQuote(scores),
    scores,
    description: tpl.text,
    conflict_note: conflictNote,
    llm_enhanced: false,
    ethics_note: ETHICS_NOTE,
  };
}
