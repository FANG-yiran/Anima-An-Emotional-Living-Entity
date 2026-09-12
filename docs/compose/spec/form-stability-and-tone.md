---
feature: form-stability-and-tone
status: delivered
updated: 2026-09-13
branch: main
---

# 形态稳定与展示调性

## Report

**What was built** — 形态不再乱跳：六态检测收紧并加粘滞，稳定窗 55 帧，轴噪声与恐惧态湍流下调。指标条移到左下并弱化。问卷免责声明删除。

**Verification** — `tsc --noEmit` PASS；dev server HTTP 200。

**Journey log**
- 随机感主因：avoidant/fearful 阈值过宽 + 20 帧过短 + noise 0.02

## [S1] Problem
1. 光流图样显得太随机：六态检测阈值过宽、20 帧稳定窗过短、轴噪声偏大，形态在 fearful/avoidant/anxious 间抖动。
2. 互动中的指标条在右侧偏抢眼。
3. 问卷免责声明偏测评口吻，破坏作品调性。

## [S2] Design
- `detectAttachmentState`：收紧阈值 + 相对上一态的 stickiness（当前态条件仍成立则维持）。
- 切换稳定窗 `pendingFrames` 20 → 55（约 0.9s）。
- `NOISE_SIGMA` 0.02 → 0.012；fearful turbulence/vortex/split 下调。
- `.signal-field` 移至左下角，opacity 0.38，更小。
- `Questionnaire` 删除免责声明。

## [S3] Out of Scope
- 报告文案 / 七维评分
- WebGL 几何本身

## Tasks
- [x] T1: 稳定六态检测与噪声
- [x] T2: 仪表板左下弱化
- [x] T3: 去掉问卷 disclaimer
- [x] T4: tsc 验证
