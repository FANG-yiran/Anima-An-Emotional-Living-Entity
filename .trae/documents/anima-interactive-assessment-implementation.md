# 情绪生命体交互评估系统 · 实现计划

## Context（背景）

用户交付了 v2.0 定稿开发文档（详见用户输入），需要一个可运行的网页：
1. 用户与一个**情绪生命体**（先用粗糙形态代替，后续用户自行调整）进行 3 分钟自由鼠标交互；
2. **Agent 实时监测**每次交互事件，并**实时显示监测结果**（内部状态轴、事件日志、动作统计等）；
3. 交互结束后弹出 **7 题问卷**，随后 **1 秒内输出评估报告**（情感联结评分 + 关键词 + 七维量化分数 + 哲学性关系描述）。

已确认决策：
- **技术栈**：Next.js 项目（App Router + TypeScript + 原生 CSS，无 UI 库，Canvas 渲染生命体）
- **Agent 实现**：接入 OpenAI 兼容 LLM 接口（通过 .env 配置 baseURL/Key，兼容 DeepSeek/通义/Kimi/OpenAI/本地代理）；**内置规则引擎回退**，保证无 Key 时网页完整可跑通
- **问卷**：本次包含 7 题 5 点量表问卷（行为权重 0.7 / 问卷权重 0.3）

## 架构总览

页面状态机：`start → interacting(180s) → questionnaire → generating → report`

```
[开始页] → [交互舞台 + 实时监测面板] → [问卷弹窗] → [生成中] → [评估报告]
```

- 交互循环（内部状态、动作判定、生命体行为）全部在**前端**实时计算（每 100ms 更新内部状态，30Hz 采样鼠标）
- 结束后前端确定性计算：五维指标（0-10 联结分）、七维分数（含问卷融合）、关键词与模板匹配
- 调用 `POST /api/agent`：携带会话汇总 JSON → LLM 生成关键词 + 关系描述；失败/无 Key 时回退到规则引擎

## 文件结构

```
Anima-An-Emotional-Living-Entity/
├── package.json / tsconfig.json / next.config.mjs / .gitignore
├── .env.example                 # OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
├── README.md                    # 更新运行说明
├── app/
│   ├── layout.tsx               # 根布局 + 元数据（深色基调）
│   ├── globals.css              # 设计令牌 + 全局样式
│   ├── page.tsx                 # 状态机编排（start→interact→questionnaire→report）
│   └── api/agent/route.ts       # POST：会话汇总 → LLM 生成关键词+描述（含规则回退）
├── components/
│   ├── StartScreen.tsx          # 开始页（大按钮，说明文字）
│   ├── InteractionStage.tsx     # 交互舞台：Canvas 渲染生命体 + 光标/事件捕获
│   ├── MonitoringPanel.tsx      # 实时监测面板（可折叠）
│   ├── Questionnaire.tsx        # 7 题 5 点量表问卷
│   └── ReportView.tsx           # 最终报告展示
└── lib/
    ├── types.ts                 # 共享类型（动作/内部状态/事件/会话/分数等）
    ├── constants.ts             # 阈值(R/V/时长)、衰减率、基线、噪声σ、增量映射表、关键词库、20 组文案模板
    ├── engine.ts                # 鼠标采样+动作判定、内部状态更新、阶段管理、事件日志
    ├── entityBehavior.ts        # 生命体表达行为决策 + 100-500ms 响应延迟
    ├── scoring.ts               # 五维指标(0-10)、七维分数(0-100)、问卷融合(0.7/0.3)
    ├── report.ts                # 关键词选择、模板匹配、报告组装（回退用）
    ├── llm.ts                   # OpenAI 兼容客户端（fetch 调用）+ 第 6 节提示词组装
    └── session.ts               # 会话汇总 JSON（session log）生成
```

## 核心实现要点

### 1. 交互引擎（lib/engine.ts + entityBehavior.ts）— 严格按文档
- **动作判定**：approach（距离减小>阈值）/ retreat（距离增大>阈值）/ pause（停止≥0.5s）/ reach（R 内点击）/ glide（速度>V 且停留<0.2s 不点击）/ leave（出窗口或无操作≥3s）
- **内部状态**：4 轴 `new = clamp(cur + 增量f(动作,当前状态) - 衰减率*(cur-基线)*dt + 高斯噪声σ=0.02, 0, 1)`，衰减回归基线
- **增量映射表**：按文档示例扩展（如 approach 时 safety<0.4 → approach+0.15/safety-0.1；safety>0.6 → +0.1/+0.05），覆盖全部 6 种动作
- **生命体行为**：由内部状态+用户动作决定 逃开/躲避/靠近/无视/迟疑；响应延迟 100-500ms 随 arousal 变化；未立即触发
- **阶段**：exploration 0-45 / repetition 45-105 / deepening 105-150 / closure 150-180
- **事件日志**：每次动作生成文档 3.1 格式 JSON（含 attachment_markers 四项）
- **生命体渲染**（粗糙形态）：Canvas 发光的软质圆润 blob，带呼吸脉动与轻微漂移；行为表现为朝/离光标移动、颤抖、缩放；安全度高→靠近，安全度低→躲避，arousal 高→颤抖/快缩

### 2. 实时监测面板（MonitoringPanel.tsx）
- 4 个核心轴实时数值条（0-1）
- 当前阶段 + 倒计时
- 事件日志滚动（最近 N 条，紧凑 JSON）
- 各动作累计次数、生命体行为计数、当前响应延迟
- 可折叠，避免遮挡交互舞台

### 3. 评分（lib/scoring.ts）— 严格按文档 4.1/4.2
- **五维指标**（历史依赖度/反转合理性/表达过滤比/响应延迟演化/会话内协调性）各 0-2 分，总计 0-10，判定 8-10 强/5-7 中/2-4 弱/0-1 无
- **七维分数**：按 4.2 公式计算（靠近倾向/确认需求/拒绝敏感/亲密耐受/不确定耐受/边界/修复倾向）
- **问卷融合**：7 题映射到对应维度，`final = 0.7*行为 + 0.3*问卷`；行为与问卷冲突时在报告中提示"此次交互中你的体验存在矛盾"

### 4. 输出生成（report.ts + llm.ts + api/agent/route.ts）
- 关键词：按七维高分从关键词库选 3-5 个
- 模板匹配：20 组模板各带条件（如"高靠近+高确认+低不确定耐受+高修复"），计算条件满足数取最优
- **LLM 路径**：组装第 6 节系统提示词 + 会话汇总 JSON（含五维/七维/模板种子）→ POST `/api/agent` → OpenAI 兼容 chat completions → 解析 `{keywords, description}`；无 Key/失败 → 使用规则引擎的关键词 + 模板原文
- 报告格式严格按文档 5.3，底部附伦理声明"本结果仅反映本次交互中的行为倾向，不构成心理诊断"

### 5. 页面编排（app/page.tsx）
- 状态机管理各阶段；交互 180s 自动结束，另提供"提前结束"按钮
- 问卷提交后 → generating 状态（显示醒目的加载文案）→ 报告

## 视觉风格
- 深色氛围背景（深蓝黑渐变），发光的生命体（蓝紫/青色调辉光），字体与间距统一
- 遵循用户偏好：关键动作按钮大而醒目、加载文案大而清楚、整体配色与页面风格一致

## 验证方式
1. `npm install && npm run dev`，浏览器打开 http://localhost:3000
2. **无 Key 回退链路**：完整走 开始→移动鼠标接近/远离/点击生命体→提前结束→问卷→报告，验证报告完整生成、模板命中、伦理声明存在
3. **完整 180s**：等待自动结束，验证阶段切换与闭卷报告
4. **监测面板**：验证 4 轴数值实时变化、事件日志逐条出现、动作计数正确
5. **LLM 路径**：配置 .env 后验证 /api/agent 返回关键词+描述；无 Key 时验证回退
6. 用 browser_use 子代理执行上述浏览器测试（点击、移动、截图核对）
