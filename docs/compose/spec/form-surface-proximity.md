---
feature: form-surface-proximity
status: delivered
updated: 2026-09-13
branch: main
commits: 7a54f14.. (uncommitted working tree on main)
---

# 形态体表面距离：实时四轴对齐光流交互

## Report

**What was built** — 交互距离从「到质心」改为「到当前光流形态体表面」。新增 `lib/formBody.ts`（六态近似几何：sphere/ring/capsule/cloud），引擎 approach/retreat/glide/reach/hold/drag/still/pause 均用表面距离；形态内为 0，触碰 `<=8`。渲染层每帧 `engine.setVisualState(lifeform.visualState)`。报告七维与六态检测阈值未改。

**Verification** — `tsc --noEmit` PASS；独立 review 确认 T1–T4 与 S2 全部 MET，无 critical。

**Journey log**
- 质心距离在大体量螺旋/云上会误判「未接近」→ 表面距离
- 体内 `surfaceDist==0` 时 approach/retreat 会静默（可接受，后续可加体内深度信号）
- `visualState` 刻意用 `targetState`，与过渡中粒子姿态可能短暂不一致

## [S1] Problem

交互对象已改为光点流形态本身，但引擎仍用「光标到 `entityPos` 质心的欧氏距离」判定 approach / retreat / reach。

后果：
- 回避态螺旋可高约 500px：贴着螺旋上缘仍可能被判「未接近」
- 焦虑/恐惧态外溢粒子：碰到光流边缘不算触碰
- 绕大团块外缘扫动时质心距几乎不变 → approach/retreat 很少 → 四轴几乎不动 → 形态难切换

报告七维评分暂不动；本特性只改实时四轴的动作输入层。

## [S2] Design

### 契约

1. 新增 `lib/formBody.ts`：
   - `AttachmentState` 从 `webglLifeform` type-import（单一来源）
   - `FormBodySpec`：`kind: "sphere" | "ring" | "capsule" | "cloud"` + 半径/高度/环内外径（按 `min(w,h)/800` 缩放，clamp 0.55–1.6）
   - `surfaceDistanceToForm(cursor, entity, state, bounds): number` — 体内 0，体外到边界距离
   - 几何：dormant cloud；secure ring；anxious/fusion sphere；avoidant capsule；fearful 合并 sphere

2. `AnimaEngine`：`setVisualState` / `surfaceDist`；动作距离全部改为表面距离；reach `<=8`

3. `WebGLLifeform.visualState` → `targetState`；`InteractionStage` 每帧同步

4. 不改：`incrementFor`、`detectAttachmentState`、`scoring.ts`

## [S3] Out of Scope

- 报告七维 / 问卷融合
- 六态检测阈值与视觉参数
- GPU 最近粒子采样
- `entityMovement`（仍按质心）

## Tasks

- [x] T1: 新增 `lib/formBody.ts` — covers: S2
- [x] T2: Engine 表面距离与 `setVisualState` — covers: S2
- [x] T3: Lifeform/InteractionStage 同步 — covers: S2
- [x] T4: tsc + review — covers: S2
