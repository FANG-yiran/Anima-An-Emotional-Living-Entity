// ============ LLM Agent 客户端（OpenAI 兼容接口；文档 §6） ============
import type {
  FiveIndicators,
  QuestionnaireAnswers,
  SessionLog,
  SevenScores,
} from "./types";

export interface LLMResult {
  keywords: string[];
  description: string;
}

export interface AgentPayload {
  session: SessionLog;
  fiveIndicators: FiveIndicators;
  connection: { score: number; label: string };
  questionnaire: QuestionnaireAnswers;
  templateText: string;
}

const SYSTEM_PROMPT = `你是一个交互记录与评估 Agent 的关系描述生成模块。你只负责两件事：
1. 根据七维关系画像分数生成 3-5 个中文关键词；
2. 生成一段 100-150 字的哲学性关系描述（共情式、去标签化）。

【核心伦理约束】
1. 绝对禁止输出"焦虑型依恋""回避型""恐惧型"等任何临床心理学标签。
2. 所有描述必须是描述性的、体验性的，不能是诊断性的。
3. 不以"距离"简单等同于"亲密程度"。
4. 如果分数组合互相冲突，使用"同时容纳""摇摆"等词汇来统合，而不是贬低。
5. 实时反馈是艺术体验的一部分，不是心理评估报告。

【输出格式】
只输出一个 JSON 对象，不要输出其他任何内容：
{"keywords": ["关键词1", "关键词2", "关键词3"], "description": "100-150字的关系描述"}`;

export function buildUserPrompt(payload: AgentPayload): string {
  const { session, fiveIndicators, connection, questionnaire, templateText } = payload;
  return `以下是本次 90 秒交互的会话数据，请生成关键词与关系描述。

【会话汇总】
${JSON.stringify(session, null, 2)}

【五维评估指标】（各 0-2 分，合计 0-10）
${JSON.stringify(fiveIndicators, null, 2)}

【情感联结评分】${connection.score} / 10（${connection.label}）

【问卷答案】（1-5 分）
${JSON.stringify(questionnaire, null, 2)}

【规则引擎匹配到的参考模板文案】（可参考语气与结构，但不要逐字复制）
${templateText}`;
}

/**
 * 调用 OpenAI 兼容接口生成关键词与描述。
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
        temperature: 0.8,
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

    const parsed = JSON.parse(content) as { keywords?: unknown; description?: unknown };
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((k): k is string => typeof k === "string").slice(0, 5)
      : [];
    const description = typeof parsed.description === "string" ? parsed.description : "";
    if (keywords.length === 0 || !description) return null;

    return { keywords, description };
  } catch {
    return null;
  }
}
