// ============ LLM Agent 客户端（OpenAI 兼容接口；文档 §6） ============
import type {
  FiveIndicators,
  QuestionnaireAnswers,
  SessionLog,
} from "./types";

export interface LLMResult {
  /** 客观动作记录（与规则引擎 formatActionLog 同构） */
  inferences: string[];
  /** 一句诗 */
  quote: { text: string; author: string };
}

export interface AgentPayload {
  session: SessionLog;
  fiveIndicators: FiveIndicators;
  connection: { score: number; label: string };
  questionnaire: QuestionnaireAnswers;
  templateText: string;
  timeline: { t: number; a: string; b: string }[]; // 事件时间线（秒/动作/生命体回应）
}

const SYSTEM_PROMPT = `你是一个交互艺术装置的观察记录模块。你只做两件事：

1. 从事件时间线中整理出简短、客观的互动记录。只陈述双方动作，不解读情绪、不使用推测性语言。
   格式严格为：MM:SS\\t你[动作]\\t它[回应]
   挑选 5-8 个有代表性的瞬间（含开场与收尾），按时间顺序输出。

2. 根据整体互动的气质，选一句适合的诗或哲思短句（中文，或可靠的中译）。
   要求：深沉、克制、发人深省；与亲密/靠近/距离/凝视/孤独相关；尽量不超过 30 字。
   优先可信出处：里尔克、特拉克尔、聂鲁达、辛波斯卡、博尔赫斯、木心、顾城、海子、张枣、余光中、沈从文、尼采等。
   必须给出作者。若不确定出处，作者写「佚名」。

【核心约束】
1. 绝对禁止输出"焦虑型依恋""回避型""恐惧型"等任何临床心理学标签。
2. 互动记录必须客观：只写「你接近」「它逃开」，不写「你很不安」「它感到温暖」。
3. 不输出关键词列表，不输出长篇关系描述，不输出任何评分。
4. 这是艺术装置的观察，不是心理评估报告。

【输出格式】
只输出一个 JSON 对象：
{"inferences": ["00:12\t你接近\t它靠近", "00:28\t你回避\t它迟疑"], "quote": {"text": "诗句", "author": "作者"}}`;

export function buildUserPrompt(payload: AgentPayload): string {
  const { session, timeline } = payload;
  return `以下是本次 90 秒交互的会话数据，请整理客观互动记录，并给出一句诗。

【会话汇总】
${JSON.stringify(session, null, 2)}

【事件时间线】（秒 / 你的动作 / 它的回应）
${JSON.stringify(timeline, null, 2)}

注意：inferences 只陈述双方动作，格式 "MM:SS\\t你…\\t它…"；quote 是本次互动最契合的一句诗。`;
}

/**
 * 调用 OpenAI 兼容接口生成客观记录与诗句。
 * 未配置 Key / 网络失败 / 解析失败时返回 null，由调用方回退到规则引擎。
 */
export async function generateWithLLM(payload: AgentPayload): Promise<LLMResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.75,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(payload) },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as {
      inferences?: unknown;
      quote?: unknown;
    };

    const inferences = Array.isArray(parsed.inferences)
      ? parsed.inferences
          .filter((k): k is string => typeof k === "string")
          .map((s) => s.replace(/\t/g, "　").trim())
          .slice(0, 8)
      : [];

    let quoteText = "";
    let quoteAuthor = "";
    if (parsed.quote && typeof parsed.quote === "object") {
      const q = parsed.quote as { text?: unknown; author?: unknown };
      if (typeof q.text === "string" && q.text) quoteText = q.text.trim();
      if (typeof q.author === "string" && q.author) quoteAuthor = q.author.trim();
    }

    if (!quoteText) return null;
    return { inferences, quote: { text: quoteText, author: quoteAuthor || "佚名" } };
  } catch {
    return null;
  }
}
