// ============ 共享类型定义 ============

/** 用户鼠标动作类型（文档 §2.1） */
export type ActionType =
  | "approach"
  | "retreat"
  | "pause"
  | "reach"
  | "glide"
  | "leave"
  | "dblclick" // 双击唤醒
  | "hold" // 长按呼吸同步
  | "drag" // 按住拖动引导
  | "still"; // 长时间静止孵化

/** 交互输入模式（渲染层用于驱动粒子行为） */
export type InteractionMode = "none" | "hold" | "drag" | "still" | "burst";

/** 生命体表达行为（文档 §2.2/§6） */
export type EntityBehavior = "retreat" | "dodge" | "approach" | "ignore" | "hesitate";

/** 交互时间线阶段（文档 §2.3） */
export type Phase = "exploration" | "repetition" | "deepening" | "closure";

/** 内部状态核心轴（文档 §2.2） */
export interface InternalState {
  axis_approach: number; // 接近-回避
  axis_safety: number; // 安全-防御
  axis_arousal: number; // 情绪强度
  axis_memory: number; // 记忆-期待
  axis_manifest: number; // 显现-弥散（被看见/被激活程度）
}

export type AxisKey = keyof InternalState;

/** 用户动作记录参数（文档 §3.1） */
export interface UserActionParams {
  cursor_speed: number;
  distance_to_entity: number;
  pause_duration: number;
}

/** 依恋标记（文档 §3.1） */
export interface AttachmentMarkers {
  approach_after_rejection: boolean;
  return_after_leave: boolean;
  rapid_pass: boolean;
  click_without_approach: boolean;
}

/** 事件级日志（文档 §3.1） */
export interface EventLogEntry {
  timestamp: number;
  user_action: ActionType;
  user_action_params: UserActionParams;
  action_occurrence: number;
  phase: Phase;
  internal_state_before: InternalState;
  internal_state_after: InternalState;
  expressed_behavior: EntityBehavior;
  response_latency_ms: number;
  attachment_markers: AttachmentMarkers;
}

/** 关键时刻（文档 §3.2） */
export interface KeyMoment {
  timestamp: number;
  description: string;
}

/** 八维关系画像分数（文档 §4.2） */
export interface SevenScores {
  approach_tendency: number; // 靠近倾向
  confirmation_need: number; // 确认需求
  rejection_sensitivity: number; // 拒绝敏感
  intimacy_tolerance: number; // 亲密耐受
  uncertainty_tolerance: number; // 不确定耐受
  boundary: number; // 边界
  repair_tendency: number; // 修复倾向
  manifest_presence: number; // 被看见/存在感
}

export type SevenDimKey = keyof SevenScores;

/** 五维评估指标（文档 §4.1，各 0-2 分） */
export interface FiveIndicators {
  history_dependency: number; // 历史依赖度
  reversal_justification: number; // 反转合理性
  expression_filter_ratio: number; // 表达过滤比
  latency_evolution: number; // 响应延迟演化
  coordination: number; // 会话内协调性
}

export type LatencyTrend = "increasing" | "decreasing" | "stable" | "fluctuating";

/** 会话级日志（文档 §3.2） */
export interface SessionLog {
  session_id: string;
  duration_sec: number;
  total_events: number;
  action_types_used: number;
  behavior_types_expressed: number;
  reversal_count: number;
  reversal_justified: number;
  suppression_events: number;
  latency_trend: LatencyTrend;
  coordination_sequences: number;
  dominant_axes: AxisKey[];
  key_moments: KeyMoment[];
  scores: SevenScores;
}

/** 问卷答案（7 题，1-5 分；文档 §4.3） */
export type QuestionnaireAnswers = Record<"q1" | "q2" | "q3" | "q4" | "q5" | "q6" | "q7", number>;

/** 报告数据（文档 §5.3） */
export interface ReportData {
  keywords: string[];
  inferences: string[]; // 3-5 条情绪化推测（"第XX秒，你…，Animo 感到…"）
  quote: { text: string; author: string }; // 哲理性名言
  scores: SevenScores;
  description: string;
  conflict_note?: string;
  llm_enhanced: boolean; // 关键词/描述是否由 LLM 生成（false = 本地规则引擎）
  ethics_note: string;
}

/** 实时监测快照 */
export interface EngineSnapshot {
  elapsed: number;
  remaining: number;
  phase: Phase;
  state: InternalState;
  actionCounts: Record<ActionType, number>;
  behaviorCounts: Record<EntityBehavior, number>;
  lastLatency: number;
  avgLatency: number;
  entityPos: { x: number; y: number };
  entityBehavior: EntityBehavior;
  cursorPos: { x: number; y: number } | null;
  manifestProgress: number; // 显现进度 0-1（= axis_manifest）
  interactionMode: InteractionMode; // 当前输入模式
  holdPhase: number; // 呼吸相位 0-1（按住时随时间推进）
}
