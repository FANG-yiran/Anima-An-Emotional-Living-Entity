// ============ LLM Agent 客户端（OpenAI 兼容接口；文档 §6） ============
import type {
  FiveIndicators,
  QuestionnaireAnswers,
  SessionLog,
} from "./types";

export interface LLMResult {
  keywords: string[];
  description: string;
  inferences: string[]; // 3-5 条情绪化推测（"第XX秒，你…，Animo 感到…"）
  quote: { text: string; author: string }; // 哲理性名言
}

export interface AgentPayload {
  session: SessionLog;
  fiveIndicators: FiveIndicators;
  connection: { score: number; label: string };
  questionnaire: QuestionnaireAnswers;
  templateText: string;
  timeline: { t: number; a: string; b: string }[]; // 事件时间线（秒/动作/生命体回应）
}

const SYSTEM_PROMPT = `你是一个交互记录与评估 Agent 的关系描述生成模块。你负责三件事：
1. 根据八维关系画像分数生成 3-5 个中文关键词；
2. 根据事件时间线，用情绪化的、推测性的语言，生成 3-5 条"它对你的感受"，每一条都要引用具体时间点，格式如"第23秒，你突然离开，Animo 感到……"；
3. 根据整体关系的走向，引用一句哲理性的、引人思考的名言（可以是王尔德、黑塞、尼采、里尔克等人的原句），并标注作者。

【核心伦理约束】
1. 绝对禁止输出"焦虑型依恋""回避型""恐惧型"等任何临床心理学标签。
2. 所有描述必须是描述性的、体验性的，不能是诊断性的。
3. 不以"距离"简单等同于"亲密程度"。
4. 如果行为互相冲突，使用"同时容纳""摇摆"等词汇来统合，而不是贬低。
5. 实时反馈是艺术体验的一部分，不是心理评估报告。

【输出格式】
只输出一个 JSON 对象，不要输出其他任何内容：
{"keywords": ["关键词1", "关键词2", "关键词3"], "description": "100-150字的关系描述", "inferences": ["第XX秒，你……，Animo 感到……", "……"], "quote": {"text": "名言原文", "author": "作者名"}}`;

export function buildUserPrompt(payload: AgentPayload): string {
  const { session, fiveIndicators, connection, questionnaire, templateText, timeline } = payload;
  return `以下是本次 90 秒交互的会话数据，请生成关键词、情绪化推测与关系描述。

【会话汇总】
${JSON.stringify(session, null, 2)}

【事件时间线】（秒 / 你的动作 / 它的回应）
${JSON.stringify(timeline, null, 2)}

【五维评估指标】（各 0-2 分，合计 0-10）
${JSON.stringify(fiveIndicators, null, 2)}

【情感联结评分】${connection.score} / 10（${connection.label}）

【问卷答案】（1-5 分）
${JSON.stringify(questionnaire, null, 2)}

【规则引擎匹配到的参考模板文案】（可参考语气与结构，但不要逐字复制）
${templateText}

注意：inferences 必须从【事件时间线】里挑选最值得回味的瞬间，每条引用具体秒数，语气是推测性的、共情的，像是"它在回忆你"。quote 必须是真实存在的名人名言或高度契合的精炼句子。`;
}

/**
 * 调用 OpenAI 兼容接口生成关键词、推测与描述。
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
        temperature: 0.9,
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
      keywords?: unknown;
      description?: unknown;
      inferences?: unknown;
      quote?: unknown;
    };
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((k): k is string => typeof k === "string").slice(0, 5)
      : [];
    const description = typeof parsed.description === "string" ? parsed.description : "";
    const inferences = Array.isArray(parsed.inferences)
      ? parsed.inferences.filter((k): k is string => typeof k === "string").slice(0, 5)
      : [];
    let quoteText = "";
    let quoteAuthor = "";
    if (parsed.quote && typeof parsed.quote === "object") {
      const q = parsed.quote as { text?: unknown; author?: unknown };
      if (typeof q.text === "string" && q.text) quoteText = q.text;
      if (typeof q.author === "string" && q.author) quoteAuthor = q.author;
    }
    if (keywords.length === 0 || !description) return null;

    return { keywords, description, inferences, quote: { text: quoteText, author: quoteAuthor } };
  } catch {
    return null;
  }
}
