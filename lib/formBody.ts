// ============ 形态体表面距离：实时动作判定与光流体量对齐 ============
// 近似几何，与 webglLifeform 各态锚点尺度同源（非像素级）。
import type { AttachmentState } from "./webglLifeform";

export type FormBodyKind = "sphere" | "ring" | "capsule" | "cloud";

export interface FormBodySpec {
  kind: FormBodyKind;
  /** 主半径（px，按 min(w,h)/800 缩放） */
  radius: number;
  /** ring 内径（仅 ring） */
  inner?: number;
  /** capsule 半高（仅 capsule） */
  halfHeight?: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface Bounds {
  w: number;
  h: number;
}

const BASE_FORMS: Record<AttachmentState, FormBodySpec> = {
  dormant: { kind: "cloud", radius: 360 },
  secure: { kind: "ring", radius: 230, inner: 50 },
  anxious: { kind: "sphere", radius: 190 },
  avoidant: { kind: "capsule", radius: 160, halfHeight: 260 },
  fearful: { kind: "sphere", radius: 240 },
  fusion: { kind: "sphere", radius: 150 },
};

function scaleFor(bounds: Bounds): number {
  const m = Math.max(1, Math.min(bounds.w, bounds.h));
  return Math.max(0.55, Math.min(1.6, m / 800));
}

export function formBodySpec(state: AttachmentState, bounds: Bounds): FormBodySpec {
  const s = scaleFor(bounds);
  const base = BASE_FORMS[state] ?? BASE_FORMS.dormant;
  return {
    kind: base.kind,
    radius: base.radius * s,
    inner: base.inner !== undefined ? base.inner * s : undefined,
    halfHeight: base.halfHeight !== undefined ? base.halfHeight * s : undefined,
  };
}

/**
 * 光标到形态体「表面」的距离。
 * 体内（含环带内空腔的实体部分外的环孔不算体内）返回 0；体外返回到边界的距离。
 *
 * - sphere/cloud：|p−c| − R
 * - ring：到环带 [inner, R] 的距离（环孔内为到 inner 的距离）
 * - capsule：竖直胶囊，半宽 R、半高 H，到胶囊表面距离
 */
export function surfaceDistanceToForm(
  cursor: Pt,
  entity: Pt,
  state: AttachmentState,
  bounds: Bounds
): number {
  const spec = formBodySpec(state, bounds);
  const dx = cursor.x - entity.x;
  const dy = cursor.y - entity.y;
  const r = Math.hypot(dx, dy) + 1e-6;

  switch (spec.kind) {
    case "sphere":
    case "cloud":
      return Math.max(0, r - spec.radius);
    case "ring": {
      const inner = spec.inner ?? spec.radius * 0.25;
      const outer = spec.radius;
      if (r >= inner && r <= outer) return 0;
      if (r < inner) return inner - r;
      return r - outer;
    }
    case "capsule": {
      const rad = spec.radius;
      const hh = spec.halfHeight ?? spec.radius * 1.6;
      // 胶囊中轴为过 entity 的竖直线段，半长 hh
      const cy = Math.max(-hh, Math.min(hh, dy));
      const ddx = dx;
      const ddy = dy - cy;
      const d = Math.hypot(ddx, ddy);
      return Math.max(0, d - rad);
    }
    default:
      return Math.max(0, r - spec.radius);
  }
}
