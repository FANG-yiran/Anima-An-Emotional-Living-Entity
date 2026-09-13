# 生命体形态重构与「被看见」维度扩展 — 实现计划

## Context

当前生命体是"单圆 + 眼睛 + 嘴"的粗糙形态，视觉表现力有限，且缺少"它因观众出现才慢慢形成"的核心体验。本次改造：

1. **视觉重构**：粒子系统渲染，支持雾/液体/星云/磁场细胞/菌群/呼吸/聚形等变换形态，无固定外轮廓，可聚可散可分裂可弥散全空间。
2. **核心概念落地**：交互前生命体为弥散态，观众进入画布后 5-10s 逐渐凝聚成形；靠近/停留加速凝聚，离开/静止过久部分消散但不彻底消失（时间+交互双驱动）。
3. **新增 4 种互动方式**：双击唤醒、呼吸同步（长按）、拖拽引导、静止孵化。
4. **新增维度**：内部状态轴第 5 条「显现-弥散」(axis_manifest)；七维画像 → 八维，新增「被看见/存在感」(manifest_presence)。

技术约束：不引入新依赖，纯 Canvas 2D + rAF，粒子 300-600 个，普通设备保持 60fps（禁用 shadowBlur、禁止 O(n²) 粒子全配对连线）。90 秒流程、7 题问卷、LLM 回退逻辑均不变。

## 设计决策（已与用户确认）

- 形成机制：时间+交互双驱动（进入后 5-10s 凝聚；靠近/停留加速；离开/静止部分消散，下限 0.1 不消失）
- 形态切换：由内部状态轴驱动（arousal→星云、safety→细胞/磁场、memory→菌群、approach→液体、manifest→聚形/雾）
- 新互动：双击唤醒、呼吸同步、拖拽引导、静止孵化（全部启用）
- 维度扩展：新增「显现-弥散」轴 + 八维画像「被看见/存在感」

## 分文件改动

### lib/types.ts
- `ActionType` 扩为 10 种：`"approach"|"retreat"|"pause"|"reach"|"glide"|"leave"|"dblclick"|"hold"|"drag"|"still"`
- `InternalState` 加 `axis_manifest: number`
- `SevenScores` 加 `manifest_presence: number`（`SevenDimKey` 经 `keyof` 自动扩展）
- `EngineSnapshot` 加 `manifestProgress: number`、`interactionMode: "none"|"hold"|"drag"|"still"|"burst"`、`holdPhase: number`（呼吸相位 0-1）

### lib/constants.ts
- `AXIS_CONFIG` 加 `axis_manifest: { decay: 0, baseline: 0.15, initial: 0, label: "显现-弥散" }`
- `ACTION` 加：`DBLCLICK_INTERVAL: 350`、`HOLD_DURATION: 1200`、`DRAG_THRESHOLD: 8`、`STILL_DURATION: 6000`、`BREATH_PERIOD: 4000`、`MANIFEST_GROWTH: 0.004`、`MANIFEST_FORM_TIME: 10`（成形期秒）
- `incrementFor` 加 4 个新 case；全部 case 补 `axis_manifest` 增量（approach/reach/hold/dblclick 正，glide/leave 负，pause/still 微正）
- `ACTION_LABELS` 加：dblclick"唤醒"、hold"呼吸"、drag"引导"、still"守候"
- `SEVEN_DIM_LABELS` 加 `manifest_presence: "被看见/存在感"`
- `KEYWORD_LIB` 加 2 词条：`{dim:"manifest_presence", level:"high", words:["被看见而存在","凝聚","实感"]}`、`{dim:"manifest_presence", level:"low", words:["若隐若现","弥散","待唤醒"]}`
- `TEMPLATES` 加 2 组模板（含 `manifest_presence` 条件）：high→"被看见的实感"、low→"若隐若现"

### lib/engine.ts
- 新增字段：`pressAt/pressStartPos/pressing/dragging/lastClickAt/stillSince`
- `handleClick` 重构为 `handleDown/handleUp`（按位移/时长分流 reach/hold/drag/dblclick）；新增 `handleDoubleClick`（350ms 内两次 down-up 且位移 < 8px 触发，不重复发 reach）
- `handleMove`：拖拽期间抑制 approach/retreat/glide 判定；任何输入重置 `stillSince`
- `update()`：`axis_manifest` **不参与统一衰减循环**，单独更新：
  - 时间成长：`manifest += MANIFEST_GROWTH * dtSec`，前 `MANIFEST_FORM_TIME` 秒额外缓动加速（实现"5-10s 成形"）
  - `emitEvent` 时按 action 施加 `manifestBoost`（正/负）
  - 无输入 > 3s 缓慢弥散（-0.002/s，下限 0.1）
  - 超过 6s 无输入且光标在画布内 → 发 `still` 事件
- `getSnapshot` 输出 `manifestProgress`（= axis_manifest）、`interactionMode`、`holdPhase`（按住时随时间 0→1，用于呼吸节律）

### lib/entityBehavior.ts
- `decideBehavior` 加 4 case：dblclick→safety 高 `approach` 否则 `dodge`；hold→`approach`/`hesitate`；drag→`approach`（safety 低则 `dodge`）；still→`hesitate`/`approach`

### lib/scoring.ts
- `deriveMetrics` 加 `avgManifest`（事件日志 `internal_state_after.axis_manifest` 均值）
- `computeSevenScores` 返回 `manifest_presence = clamp(avgManifest * 100)`，事件稀少时退化 50
- `fuseWithQuestionnaire`：`{...behavior}` 自动保留新维，问卷 7 题不变、无新增融合

### lib/report.ts
- `selectKeywords` 的 `dims` 数组加 `manifest_presence`（复用现有排序/取值逻辑）

### lib/session.ts
- `dominant_axes` 计算排除 `axis_manifest`（baseline 0.15 会使其恒占前二，失真）

### lib/llm.ts
- SYSTEM_PROMPT 与 buildUserPrompt 中"七维"→"八维"（JSON 序列化自动适配）

### components/InteractionStage.tsx（核心渲染重构）
- 事件监听改为 mousedown/mouseup/dblclick/mousemove/mouseout
- `drawScene` 重写为粒子渲染：移除单圆 + shadowBlur + 高频随机抖动；眼睛/嘴仅在 `manifest > 0.6` 的聚形态叠加
- 粒子状态用 `useRef` 数组持有（不随每帧重生成）
- 新增 `lib/particles.ts`（见下），`drawScene` 调用其纯函数

### 新增 lib/particles.ts（纯渲染模块，与引擎解耦）
- `FormType = "mist"|"liquid"|"nebula"|"field"|"colony"|"breath"|"swarm"`
- `formScores(state)`：`mist=1-manifest`、`liquid=axis_approach`、`nebula=axis_arousal`、`field=axis_safety`、`colony=axis_memory`、`breath=0.5*(1-|arousal-0.4|)`、`swarm=manifest`；softmax 归一为权重
- 粒子字段：`{x,y,vx,vy,r,hue,seed,life,bond}`；每帧（约 500 粒）：
  1. 读 snapshot 算 formWeights，运动参数（cohesion/噪声幅度/扩散半径/hue）按权重插值，500-1500ms 缓动
  2. 弱向心力 + 种子相位噪声（sin/cos 时间函数）+ 形态特征力（nebula 径向爆发、field 向心包裹、colony 向记忆点/光标蔓延、liquid 横向流动、breath 半径随 4s 正弦聚散）
  3. 拖拽尾随力 / 静止织丝目标力
  4. 阻尼 + 边界反弹
- 绘制：`globalCompositeOperation="lighter"` 小圆点；连线仅显式链接（拖拽尾巴、静止丝线、主团连线），禁 O(n²) 全配对

### components/MonitoringPanel.tsx / components/ReportView.tsx
- MonitoringPanel：`AXIS_ORDER` 加 `axis_manifest`（建议从 constants 导出复用），barColor 加 case
- ReportView：`DIM_ORDER`、`dimColor` 加 `manifest_presence`（渐变色与整体风格一致）

### 文案
- app/layout.tsx、components/StartScreen.tsx：描述中"七维"→"八维"（若文案出现）

## 风险与注意

- `Record<ActionType, number>` 初始化有 3 处（engine.actionCounts、scoring deriveMetrics 的 count、behaviors 无 ActionType）需补新键，TS 会强制检查
- 新动作判定优先级：dblclick > drag > hold > click > still，避免与现有 reach/approach/retreat 冲突；hold 期间不发 reach
- 旧模板不引用新维，`matchTemplate` 不受损；但必须补关键词词条与 2 组模板，否则新维无输出
- 性能：粒子数为常量可调；拖拽期间抑制 move 事件判定，降低事件风暴
- `api/agent/route.ts`、app/page.tsx 无需改动（八维 JSON 序列化自动适配）

## 验证

1. `npx tsc --noEmit`：校验 Record 补齐与类型
2. `npm run dev` 后 GET / 200
3. 浏览器手测：
   - 进入画布：初始弥散雾 → 5-10s 内聚集成形；靠近加速凝聚；停止移动/离开后缓慢部分消散
   - 四新互动：双击（爆聚脉冲）、长按（呼吸节律聚散）、按住拖动（粒子尾随光标）、静止 6s（粒子织出丝线靠近光标）
   - 右上角监测面板显示新轴"显现-弥散"与新增动作计数
   - 完整流程：90s 交互 → 7 题问卷 → 报告（8 维画像 + 关键词 + 描述，LLM/规则回退正常，报告底部提示正常）
4. DevTools Performance 确认粒子渲染 60fps
