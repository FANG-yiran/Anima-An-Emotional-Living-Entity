"use client";

import { useEffect, useRef, useState } from "react";
import type { WebGLLifeform } from "@/lib/webglLifeform";
import RippleVeil from "./interlude/RippleVeil";

/**
 * 间奏异象覆盖层：
 * 轮询 WebGLLifeform.interludeType / interludeAlpha，
 * 在同态驻留 15s 后挂载涟漪水面（4s），
 * 水面透明度由 fadeRef 每帧驱动，与粒子渐隐严格同步，保证交叉溶解丝滑；
 * 涟漪结束后由 lifeform 随机切换到另一个依恋状态。
 */
export default function AmbientInterlude({
  lifeform,
}: {
  lifeform: WebGLLifeform;
}) {
  const [active, setActive] = useState(0);
  const fadeRef = useRef(0);
  const activeRef = useRef(0);
  activeRef.current = active;

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      // 单一数据源：透明度每帧由 lifeform 写入，组件不另算时序
      fadeRef.current = lifeform.interludeAlpha;
      const on = lifeform.interludeType === "ripple";
      if (on && activeRef.current === 0) {
        setActive(Date.now());
      } else if (!on && activeRef.current !== 0 && lifeform.interludeAlpha < 0.02) {
        // 等淡出真正归近零再卸载，避免末尾闪变
        setActive(0);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [lifeform]);

  if (!active) return null;

  return (
    <div className="ambient-veil" key={active} aria-hidden="true">
      <RippleVeil fadeRef={fadeRef} />
    </div>
  );
}
