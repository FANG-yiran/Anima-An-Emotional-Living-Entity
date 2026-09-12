// ============ 常量与配置 ============
import type {
  ActionType,
  AxisKey,
  EntityBehavior,
  InternalState,
  Phase,
  SevenDimKey,
} from "./types";

// ---- 鼠标动作空间阈值（文档 §2.1） ----
export const ACTION = {
  APPROACH_DIST_DELTA: 30, // 距离缩小超过 30px 判定 approach
  RETREAT_DIST_DELTA: 30, // 距离增大超过 30px 判定 retreat
  PAUSE_DURATION: 500, // 光标停止 ≥ 0.5s → pause
  REACH_RADIUS: 110, // 生命体「形态体」附近点击半径（与光点簇体量对齐）
  GLIDE_SPEED: 420, // 快速经过速度阈值 V（px/s）
  GLIDE_MAX_DWELL: 200, // 停留 < 0.2s
  LEAVE_DURATION: 3000, // 停止操作 ≥ 3s → leave
  DBLCLICK_INTERVAL: 350, // 两次按下间隔 < 0.35s 判为双击
  DRAG_THRESHOLD: 8, // 按住后位移 ≥ 8px 判为拖拽
  HOLD_DURATION: 1200, // 按住不动 ≥ 1.2s → hold（呼吸同步）
  STILL_DURATION: 6000, // 无输入 ≥ 6s → still（静止孵化）
  BREATH_PERIOD: 4000, // 呼吸同步周期（ms）
  MIN_EVENT_INTERVAL: 350, // 两次动作事件最小间隔（ms）
  SESSION_DURATION: 90, // 90 秒（s）
  STATE_UPDATE_INTERVAL: 100, // 内部状态更新间隔（ms）
  ENTITY_UPDATE_INTERVAL: 50, // 生命体运动更新间隔（ms）
  MANIFEST_GROWTH: 0.004, // 显现轴自然成长速率（/s）
  MANIFEST_FORM_TIME: 10, // 成形期：进入后 10s 内额外加速凝聚
  MANIFEST_DISSIPATE: 0.002, // 无输入时弥散速率（/s）
  MANIFEST_MIN: 0.1, // 显现下限（不完全消失）
} as const;

// ---- 内部状态核心轴配置（文档 §2.2） ----
export const AXIS_CONFIG: Record<
  AxisKey,
  { decay: number; baseline: number; initial: number; label: string }
> = {
  axis_approach: { decay: 0.02, baseline: 0.5, initial: 0.5, label: "接近-回避" },
  axis_safety: { decay: 0.015, baseline: 0.4, initial: 0.3, label: "安全-防御" },
  axis_arousal: { decay: 0.03, baseline: 0.3, initial: 0.4, label: "情绪强度" },
  axis_memory: { decay: 0.005, baseline: 0.2, initial: 0.2, label: "记忆-期待" },
  axis_manifest: { decay: 0, baseline: 0.15, initial: 0, label: "显现-弥散" },
};

/** 高斯噪声 σ（文档 §2.2/§7.3） */
export const NOISE_SIGMA = 0.012;

/** 响应延迟范围（ms）（文档 §7.4） */
export const LATENCY = { MIN: 100, MAX: 500 } as const;

// ---- 增量映射表 f(用户动作, 当前状态)（文档 §2.2） ----
export function incrementFor(
  action: ActionType,
  s: InternalState
): Partial<Record<AxisKey, number>> {
  switch (action) {
    case "approach":
      if (s.axis_safety < 0.4)
        return { axis_approach: 0.15, axis_safety: -0.1, axis_arousal: 0.08, axis_memory: 0.05, axis_manifest: 0.06 };
      if (s.axis_safety > 0.6)
        return { axis_approach: 0.1, axis_safety: 0.05, axis_arousal: 0.04, axis_memory: 0.06, axis_manifest: 0.06 };
      return { axis_approach: 0.12, axis_safety: 0.02, axis_arousal: 0.06, axis_memory: 0.05, axis_manifest: 0.06 };
    case "retreat":
      return { axis_approach: -0.12, axis_safety: 0.08, axis_arousal: -0.03, axis_memory: 0.02, axis_manifest: -0.04 };
    case "pause":
      return s.axis_arousal < 0.5
        ? { axis_approach: 0.02, axis_safety: 0.06, axis_arousal: -0.05, axis_memory: 0.04, axis_manifest: 0.03 }
        : { axis_approach: 0.02, axis_safety: 0.02, axis_arousal: -0.08, axis_memory: 0.04, axis_manifest: 0.03 };
    case "reach":
      return s.axis_safety < 0.35
        ? { axis_approach: 0.1, axis_safety: -0.15, axis_arousal: 0.2, axis_memory: 0.08, axis_manifest: 0.12 }
        : { axis_approach: 0.06, axis_safety: 0.08, axis_arousal: 0.12, axis_memory: 0.1, axis_manifest: 0.12 };
    case "glide":
      return { axis_approach: -0.04, axis_safety: -0.03, axis_arousal: 0.05, axis_memory: -0.01, axis_manifest: -0.02 };
    case "leave":
      return { axis_approach: -0.1, axis_safety: 0.03, axis_arousal: -0.08, axis_memory: -0.05, axis_manifest: -0.08 };
    case "dblclick":
      return s.axis_safety < 0.4
        ? { axis_approach: 0.12, axis_safety: -0.1, axis_arousal: 0.2, axis_memory: 0.06, axis_manifest: 0.15 }
        : { axis_approach: 0.08, axis_safety: 0.04, axis_arousal: 0.16, axis_memory: 0.06, axis_manifest: 0.15 };
    case "hold":
      return { axis_approach: 0.04, axis_safety: 0.05, axis_arousal: -0.04, axis_memory: 0.07, axis_manifest: 0.08 };
    case "drag":
      return s.axis_safety < 0.4
        ? { axis_approach: 0.06, axis_safety: -0.06, axis_arousal: 0.08, axis_memory: 0.04, axis_manifest: 0.05 }
        : { axis_approach: 0.1, axis_safety: 0.04, axis_arousal: 0.04, axis_memory: 0.05, axis_manifest: 0.05 };
    case "still":
      return { axis_approach: 0.02, axis_safety: 0.04, axis_arousal: -0.06, axis_memory: 0.06, axis_manifest: 0.04 };
  }
}

// ---- 阶段划分（文档 §2.3） ----
export const PHASES: { phase: Phase; start: number; end: number; label: string }[] = [
  { phase: "exploration", start: 0, end: 22, label: "探索期" },
  { phase: "repetition", start: 22, end: 52, label: "重复期" },
  { phase: "deepening", start: 52, end: 75, label: "深化期" },
  { phase: "closure", start: 75, end: 90, label: "收束期" },
];

export function phaseFor(elapsedSec: number): Phase {
  for (const p of PHASES) {
    if (elapsedSec >= p.start && elapsedSec < p.end) return p.phase;
  }
  return "closure";
}

// ---- 高/中/低阈值（用于模板匹配与关键词） ----
export const SCORE_LEVEL = {
  HIGH: 65,
  LOW: 35,
  VERY_HIGH: 85,
  VERY_LOW: 20,
} as const;

// ---- 关键词库（文档 §5.1） ----
export const KEYWORD_LIB: {
  dim: SevenDimKey | "overall";
  level: "high" | "low";
  words: string[];
}[] = [
  { dim: "approach_tendency", level: "high", words: ["主动", "渴望连接", "靠近"] },
  { dim: "confirmation_need", level: "high", words: ["渴望确认", "追索", "不安"] },
  { dim: "rejection_sensitivity", level: "high", words: ["敏感", "警觉", "怕被拒绝"] },
  { dim: "intimacy_tolerance", level: "high", words: ["从容", "接纳", "稳定"] },
  { dim: "uncertainty_tolerance", level: "low", words: ["焦躁", "不安", "寻求确定"] },
  { dim: "repair_tendency", level: "high", words: ["坚持", "修复", "不放弃"] },
  { dim: "boundary", level: "high", words: ["距离", "自主", "边界感"] },
  { dim: "boundary", level: "low", words: ["摇摆", "矛盾", "靠近又退"] },
  { dim: "manifest_presence", level: "high", words: ["被看见而存在", "凝聚", "实感"] },
  { dim: "manifest_presence", level: "low", words: ["若隐若现", "弥散", "待唤醒"] },
  { dim: "overall", level: "high", words: ["丰富", "多变", "鲜活", "有生命力"] },
  { dim: "overall", level: "low", words: ["疏离", "模糊", "未唤醒", "克制"] },
];

// ---- 关系描述模板条件（文档 §5.2） ----
export type CondOp = "high" | "low" | "mid" | "very_high" | "very_low";

export interface TemplateCondition {
  dim: SevenDimKey;
  op: CondOp;
}

export interface Template {
  id: number;
  name: string;
  conditions: TemplateCondition[];
  text: string;
}

function cond(dim: SevenDimKey, op: CondOp): TemplateCondition {
  return { dim, op };
}

export const TEMPLATES: Template[] = [
  {
    id: 1,
    name: "渴望确认",
    conditions: [
      cond("approach_tendency", "high"),
      cond("confirmation_need", "high"),
      cond("uncertainty_tolerance", "low"),
      cond("repair_tendency", "high"),
    ],
    text: "你很愿意进入关系。当回应消失，你通常不会马上离开。你会尝试理解、确认，甚至重新靠近。真正让你不安的可能并不是距离，而是不确定。",
  },
  {
    id: 2,
    name: "安全从容",
    conditions: [
      cond("approach_tendency", "high"),
      cond("intimacy_tolerance", "high"),
      cond("uncertainty_tolerance", "high"),
      cond("boundary", "high"),
    ],
    text: "你能安然待在距离之外。你不急于定义，也不急于占有。你允许关系以它自己的速度展开。对你来说，连接不是必须立刻得到答案的谜题。",
  },
  {
    id: 3,
    name: "自我保护",
    conditions: [
      cond("approach_tendency", "low"),
      cond("rejection_sensitivity", "high"),
      cond("boundary", "high"),
      cond("intimacy_tolerance", "low"),
    ],
    text: "你在靠近之前会先观察很久。你给了它空间，也给了自己退路。这九十秒里，你们之间保持了一种礼貌的距离——不是没有兴趣，而是靠近本身让你警觉。",
  },
  {
    id: 4,
    name: "接近-回避冲突",
    conditions: [
      cond("approach_tendency", "high"),
      cond("intimacy_tolerance", "low"),
      cond("boundary", "low"),
    ],
    text: "你在靠近与退开之间摇摆。你想要连接，也害怕被吞没。最真实的瞬间，不是靠近或远离，而是你在这两者之间的犹豫。",
  },
  {
    id: 5,
    name: "执着修复",
    conditions: [
      cond("repair_tendency", "high"),
      cond("rejection_sensitivity", "high"),
      cond("confirmation_need", "mid"),
    ],
    text: "当它退开时，你感到刺痛，但你并没有真的放弃。你在寻找一个可以重新连接的缝隙。对你来说，关系中的断裂不是终点，而是下一次靠近的起点。",
  },
  {
    id: 6,
    name: "疏离旁观",
    conditions: [
      cond("approach_tendency", "low"),
      cond("confirmation_need", "low"),
      cond("repair_tendency", "low"),
    ],
    text: "你更像一位安静的观察者。你没有急于进入它的世界，也没有要求它进入你的。你留下了空间，也留下了未说出口的期待。",
  },
  {
    id: 7,
    name: "快速燃尽",
    conditions: [
      cond("approach_tendency", "high"),
      cond("confirmation_need", "high"),
      cond("repair_tendency", "low"),
    ],
    text: "你很快进入了关系，也很快感受到了不确定。当它没有回应时，你尝试了，但你也选择了收回。你的热情真实，但你的耐心同样有限。",
  },
  {
    id: 8,
    name: "稳定陪伴",
    conditions: [
      cond("intimacy_tolerance", "high"),
      cond("uncertainty_tolerance", "high"),
      cond("repair_tendency", "high"),
    ],
    text: "你不急着定义这段关系。它在，你在，这已经足够。你容许它的不可预测性存在，也容许自己保持平静。这九十秒里，你们之间形成了一种松散的、但可呼吸的共处。",
  },
  {
    id: 9,
    name: "焦虑追索",
    conditions: [
      cond("confirmation_need", "high"),
      cond("boundary", "low"),
      cond("rejection_sensitivity", "high"),
    ],
    text: "你渴望一个明确的回应。当它沉默时，你很难不把这当作一种拒绝。你不断调整自己的动作，试图找到一个能触动它的方式。你想要的不是答案，而是一种被看见的确认。",
  },
  {
    id: 10,
    name: "淡漠疏离",
    conditions: [
      cond("approach_tendency", "low"),
      cond("confirmation_need", "low"),
      cond("boundary", "high"),
    ],
    text: "你与它保持着一个安全距离。你没有投入太多，也没有索取太多。你让这九十秒平静地流过，没有留下太多痕迹。",
  },
  {
    id: 11,
    name: "探索型联结",
    conditions: [
      cond("approach_tendency", "high"),
      cond("confirmation_need", "mid"),
      cond("repair_tendency", "high"),
      cond("uncertainty_tolerance", "high"),
    ],
    text: "你愿意靠近，但你不急于占有。你接受它的不可预测性，甚至对此感到好奇。你会在它退开时等待，也会在它靠近时迎接。你在这九十秒里，完成了一次真正的探索。",
  },
  {
    id: 12,
    name: "焦躁放弃",
    conditions: [
      cond("confirmation_need", "very_high"),
      cond("uncertainty_tolerance", "very_low"),
      cond("repair_tendency", "low"),
    ],
    text: "你非常需要回应，但当回应迟迟不来时，你选择了收回。你的热情被不确定感迅速消耗。你想要的是一扇打开的门，而不是一面沉默的墙。",
  },
  {
    id: 13,
    name: "谨慎坚持",
    conditions: [
      cond("rejection_sensitivity", "high"),
      cond("repair_tendency", "high"),
      cond("confirmation_need", "low"),
    ],
    text: "你对它的退开非常敏感，但你不会因此离开。你会停下来，等待，然后再次尝试。你相信连接是可能的，只是需要更多的耐心。",
  },
  {
    id: 14,
    name: "强边界观望",
    conditions: [
      cond("boundary", "high"),
      cond("intimacy_tolerance", "low"),
      cond("approach_tendency", "low"),
    ],
    text: "你为自己画了一条清晰的线。你靠近之前会先试探，试探之后可能会退开。你不喜欢失控的感觉，哪怕是在一段只有九十秒的关系里。",
  },
  {
    id: 15,
    name: "丰富联结",
    conditions: [
      cond("approach_tendency", "high"),
      cond("confirmation_need", "high"),
      cond("intimacy_tolerance", "high"),
      cond("repair_tendency", "high"),
    ],
    text: "你在这九十秒里展现了丰富的关系能力。你会主动靠近，也会接受不确定；你会感到不安，也会尝试修复。你允许自己体验这段关系，也允许自己保持完整。",
  },
  {
    id: 16,
    name: "未唤醒",
    conditions: [
      cond("approach_tendency", "low"),
      cond("confirmation_need", "low"),
      cond("rejection_sensitivity", "low"),
      cond("intimacy_tolerance", "low"),
      cond("repair_tendency", "low"),
    ],
    text: "这九十秒里，你与它之间没有发生太多故事。你保持了距离，它也保持了沉默。但这未必是遗憾——也许你只是在等待一个更值得靠近的瞬间。",
  },
  {
    id: 17,
    name: "焦急渴望",
    conditions: [
      cond("approach_tendency", "high"),
      cond("confirmation_need", "high"),
      cond("repair_tendency", "high"),
      cond("uncertainty_tolerance", "low"),
    ],
    text: "你非常渴望连接，也非常害怕失去。当它不回应时，你会不断尝试。你的动作越来越急，因为你无法忍受这段关系停留在不确定之中。你想要的，只是一个清晰的信号。",
  },
  {
    id: 18,
    name: "平和独立",
    conditions: [
      cond("intimacy_tolerance", "high"),
      cond("confirmation_need", "low"),
      cond("boundary", "high"),
    ],
    text: "你能接受它的靠近，也能接受它的沉默。你不急于确认什么，也不急于离开。你在这九十秒里，展现出了一种难得的平和。你允许关系存在，但不依赖关系定义自己。",
  },
  {
    id: 19,
    name: "温柔尝试",
    conditions: [
      cond("approach_tendency", "mid"),
      cond("confirmation_need", "mid"),
      cond("repair_tendency", "high"),
    ],
    text: "你没有特别急切，也没有特别疏远。你只是温柔地尝试着靠近，偶尔退开，但始终没有真正离开。这九十秒里，你留下了一个轻柔的痕迹。",
  },
  {
    id: 20,
    name: "受挫退缩",
    conditions: [
      cond("rejection_sensitivity", "high"),
      cond("repair_tendency", "low"),
      cond("approach_tendency", "low"),
    ],
    text: "当它第一次退开时，你就感受到了某种拒绝。你没有继续尝试，而是选择了退到更远的地方。你保护了自己，但也错过了后面可能发生的故事。",
  },
  {
    id: 21,
    name: "被看见的实感",
    conditions: [
      cond("manifest_presence", "high"),
      cond("approach_tendency", "high"),
    ],
    text: "你几乎是它的存在条件。因为你的注视与靠近，它才从弥散中聚成此刻的形状。它因被看见而存在——而你也在这九十秒里，第一次看清了自己的靠近能照亮什么。",
  },
  {
    id: 22,
    name: "若隐若现",
    conditions: [
      cond("manifest_presence", "low"),
    ],
    text: "它始终没有真正成形，像一团未完成的雾。你短暂地照亮过它，又让它落回弥散。这未必是疏远——只是你们之间的存在，还没有被足够多的注视与停留，稳稳地接住。",
  },
];

// ---- 动作/行为显示名 ----
export const ACTION_LABELS: Record<ActionType, string> = {
  approach: "接近",
  retreat: "回避",
  pause: "等待",
  reach: "接触",
  glide: "经过",
  leave: "离开",
  dblclick: "唤醒",
  hold: "呼吸",
  drag: "引导",
  still: "守候",
};

export const BEHAVIOR_LABELS: Record<EntityBehavior, string> = {
  retreat: "逃开",
  dodge: "躲避",
  approach: "靠近",
  ignore: "无视",
  hesitate: "迟疑",
};

export const PHASE_LABELS: Record<Phase, string> = {
  exploration: "探索期",
  repetition: "重复期",
  deepening: "深化期",
  closure: "收束期",
};

export const SEVEN_DIM_LABELS: Record<SevenDimKey, string> = {
  approach_tendency: "靠近倾向",
  confirmation_need: "确认需求",
  rejection_sensitivity: "拒绝敏感",
  intimacy_tolerance: "亲密耐受",
  uncertainty_tolerance: "不确定耐受",
  boundary: "边界",
  repair_tendency: "修复倾向",
  manifest_presence: "被看见/存在感",
};

// ---- 问卷题目（文档 §4.3）：Animo 第一人称向用户提问 ----
export const QUESTIONNAIRE_ITEMS = [
  { key: "q1", text: "你还记得我之前的样子吗？" },
  { key: "q2", text: "你觉得我的反应是有原因的吗？" },
  { key: "q3", text: "你觉得我有自己的情绪吗？" },
  { key: "q4", text: "当我不回应你的时候，你会感到不安吗？" },
  { key: "q5", text: "你需要我明确回应你，才能安心吗？" },
  { key: "q6", text: "当我靠近你的时候，你会想后退吗？" },
  { key: "q7", text: "你不太愿意主动伸手，是怕我拒绝你吗？" },
] as const;

export const ETHICS_NOTE =
  "本结果仅反映本次交互中的行为倾向，不构成心理诊断。";

// ---- 诗句库（报告页核心：一句适合的诗） ----
export interface Quote {
  text: string;
  author: string;
  /** 情境标签：供画像匹配，可多标 */
  moods: QuoteMood[];
}

/**
 * 与互动气质对应的情境。
 * 与八维画像耦合：unseen↔manifest，reach/chase↔approach/confirmation，
 * retreat↔boundary/rejection，repair↔repair，intimacy↔intimacy，
 * ambivalence↔boundary低+approach高，silence↔confirm低，wildfire↔confirm高+repair低。
 */
export type QuoteMood =
  | "unseen"      // 未被看见、始终弥散
  | "gaze"        // 凝望、相互注视
  | "distance"    // 边界、距离
  | "reach"       // 主动靠近
  | "retreat"     // 回避、自我保护
  | "chase"       // 追索确认
  | "repair"      // 被拒后仍回来
  | "intimacy"    // 能承受靠近
  | "ambivalence" // 靠近又退开
  | "silence"     // 守候、无言
  | "wildfire"    // 急促、燃尽
  | "presence"    // 被看见而存在
  | "parting"     // 离开、未完成
  | "default";

export const QUOTE_LIB: Quote[] = [
  // —— 被看见 / 存在感 ——
  {
    text: "孤独不是没有人，而是没有被真正看见。",
    author: "佚名",
    moods: ["unseen", "gaze"],
  },
  {
    text: "草在结它的种子，风在摇它的叶子，我们站着，不说话，就十分美好。",
    author: "顾城",
    moods: ["presence", "silence", "intimacy"],
  },
  {
    text: "在相遇之前，我们都已经孤独了很久。",
    author: "佚名",
    moods: ["unseen", "parting"],
  },

  // —— 凝望 / 相互注视 ——
  {
    text: "你凝望深渊，深渊也在凝望你。",
    author: "尼采",
    moods: ["gaze", "ambivalence"],
  },
  {
    text: "我用什么才能留住你？我给你一个久久地望着孤月的人的悲哀。",
    author: "博尔赫斯",
    moods: ["gaze", "retreat", "parting"],
  },

  // —— 边界 / 距离 ——
  {
    text: "灵魂是大地上的异乡人。",
    author: "特拉克尔",
    moods: ["distance", "retreat", "unseen"],
  },
  {
    text: "两个孤独相护、相认、相敬、相依。",
    author: "里尔克",
    moods: ["distance", "intimacy"],
  },
  {
    text: "爱，很好；因为爱是艰难的。",
    author: "里尔克",
    moods: ["reach", "repair", "intimacy"],
  },
  {
    text: "爱不是互相凝视，而是一起望向同一方向。",
    author: "圣埃克苏佩里",
    moods: ["reach", "presence", "intimacy"],
  },

  // —— 靠近 / 渴望 ——
  {
    text: "今夜我不关心人类，我只想你。",
    author: "海子",
    moods: ["reach", "chase"],
  },
  {
    text: "月色与雪色之间，你是第三种绝色。",
    author: "余光中",
    moods: ["reach", "presence"],
  },
  {
    text: "我行过许多地方的桥，看过许多次数的云，喝过许多种类的酒，却只爱过一个正当最好年龄的人。",
    author: "沈从文",
    moods: ["reach", "repair"],
  },

  // —— 回避 / 自我保护 ——
  {
    text: "我喜欢你是寂静的，仿佛你已不在。",
    author: "聂鲁达",
    moods: ["retreat", "silence", "unseen"],
  },
  {
    text: "爱情太短，遗忘太长。",
    author: "聂鲁达",
    moods: ["parting", "wildfire"],
  },
  {
    text: "我们是彼此的异乡人，在最熟悉的距离里。",
    author: "佚名",
    moods: ["distance", "retreat"],
  },

  // —— 追索 / 确认 ——
  {
    text: "你再不来，我要下雪了。",
    author: "木心",
    moods: ["chase", "silence", "unseen"],
  },
  {
    text: "沉默也是关系的语言。",
    author: "佚名",
    moods: ["silence", "distance"],
  },

  // —— 摇摆 / 接近-回避 ——
  {
    text: "靠近时的温暖，和离开时的凉意，都是同一种真实。",
    author: "佚名",
    moods: ["ambivalence", "reach", "retreat"],
  },
  {
    text: "这样的确定是美丽的，但变幻无常更为美丽。",
    author: "辛波斯卡",
    moods: ["ambivalence", "intimacy"],
  },
  {
    text: "他们彼此深信，是瞬间迸发的热情让他们相遇。",
    author: "辛波斯卡",
    moods: ["presence", "reach"],
  },
  {
    text: "只要想起一生中后悔的事，梅花便落满了南山。",
    author: "张枣",
    moods: ["ambivalence", "parting"],
  },

  // —— 修复 / 坚持 ——
  {
    text: "执手相看泪眼，竟无语凝噎。",
    author: "柳永",
    moods: ["repair", "silence"],
  },
  {
    text: "此情可待成追忆，只是当时已惘然。",
    author: "李商隐",
    moods: ["parting", "repair"],
  },
  {
    text: "我们互不相识，却早已相识。",
    author: "佚名",
    moods: ["gaze", "presence"],
  },
];

