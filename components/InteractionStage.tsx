"use client";

import { useEffect, useRef } from "react";
import { ACTION, PHASE_LABELS } from "@/lib/constants";
import type { AnimaEngine } from "@/lib/engine";
import type { EngineSnapshot } from "@/lib/types";

interface Props {
  engine: AnimaEngine;
  snapshot: EngineSnapshot | null;
  onSnapshot: (snap: EngineSnapshot) => void;
  onEnd: () => void;
}

/** 交互舞台：Canvas 渲染生命体 + 鼠标事件捕获 */
export default function InteractionStage({ engine, snapshot, onSnapshot, onEnd }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const lastPushRef = useRef(0);
  const dimsRef = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dimsRef.current = { w: rect.width, h: rect.height };
      engine.setBounds(rect.width, rect.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    engine.start();

    const toLocal = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onMove = (e: MouseEvent) => {
      const p = toLocal(e);
      engine.handleMove(p.x, p.y);
    };
    const onDown = (e: MouseEvent) => {
      const p = toLocal(e);
      engine.handleClick(p.x, p.y);
    };
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget) engine.handleWindowLeave();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    document.documentElement.addEventListener("mouseout", onOut);

    const loop = (now: number) => {
      engine.update(now);
      drawScene(ctx, dimsRef.current.w, dimsRef.current.h, engine, now);
      if (now - lastPushRef.current > 200) {
        lastPushRef.current = now;
        onSnapshot(engine.getSnapshot(now));
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      document.documentElement.removeEventListener("mouseout", onOut);
    };
  }, [engine, onSnapshot]);

  const remaining = snapshot?.remaining ?? 90;
  const mm = Math.floor(remaining / 60);
  const ss = Math.floor(remaining % 60);
  const phase = snapshot?.phase ?? "exploration";

  return (
    <div className="stage-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="stage-canvas" />
      <div className="stage-hud panel">
        <div className="hud-left">
          <span className="hud-phase">{PHASE_LABELS[phase]}</span>
          <span className="hud-time">
            {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
          </span>
        </div>
        <button className="btn ghost small" onClick={onEnd}>
          提前结束 · 生成报告
        </button>
      </div>
    </div>
  );
}

/** Canvas 场景绘制：生命体（粗糙形态）+ 接触圈 + 连接线 + 光标 */
function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  engine: AnimaEngine,
  now: number
) {
  ctx.clearRect(0, 0, w, h);
  const snap = engine.getSnapshot(now);
  const { entityPos: pos, state, cursorPos } = snap;

  // 光标光点
  if (cursorPos) {
    ctx.fillStyle = "rgba(238,242,255,0.75)";
    ctx.beginPath();
    ctx.arc(cursorPos.x, cursorPos.y, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // 连接线（靠近时浮现）
    const d = Math.hypot(cursorPos.x - pos.x, cursorPos.y - pos.y);
    if (d < 260) {
      const alpha = (1 - d / 260) * 0.35;
      ctx.strokeStyle = `rgba(110,231,255,${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cursorPos.x, cursorPos.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
  }

  // 接触圈（点击判定范围 R）
  ctx.save();
  ctx.setLineDash([4, 7]);
  ctx.strokeStyle = "rgba(110,231,255,0.2)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, ACTION.REACH_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 生命体本体
  const rBase = 42;
  const breathe = 1 + 0.05 * Math.sin(now / 420);
  const arousal = state.axis_arousal;
  const safety = state.axis_safety;
  const defensive = 0.62 + 0.38 * safety;
  const r = rBase * breathe * defensive + arousal * 6;
  const tremble = arousal > 0.55 ? (Math.random() - 0.5) * arousal * 16 : 0;
  const px = pos.x + tremble;

  const hue = 190 + (1 - safety) * 95; // 青(安全) → 紫(防御)
  ctx.shadowColor = `hsla(${hue}, 85%, 65%, ${0.3 + arousal * 0.35})`;
  ctx.shadowBlur = 45 + arousal * 45;
  const grad = ctx.createRadialGradient(px, pos.y, r * 0.15, px, pos.y, r);
  grad.addColorStop(0, `hsla(${hue}, 80%, 66%, 0.95)`);
  grad.addColorStop(0.65, `hsla(${hue}, 78%, 52%, 0.72)`);
  grad.addColorStop(1, `hsla(${hue}, 80%, 38%, 0.32)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(px, pos.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // 眼睛：安全时看向光标，防御时警觉乱转
  const eyeY = pos.y - r * 0.08;
  const eyeDX = r * 0.34;
  let lookX = 0;
  let lookY = 0;
  if (cursorPos && safety > 0.45) {
    const dx = cursorPos.x - px;
    const dy = cursorPos.y - eyeY;
    const dd = Math.hypot(dx, dy) || 1;
    lookX = (dx / dd) * 3.5;
    lookY = (dy / dd) * 3.5;
  } else if (safety < 0.3) {
    lookX = (Math.random() - 0.5) * 7;
    lookY = (Math.random() - 0.5) * 7;
  }
  ctx.fillStyle = "rgba(8,11,22,0.92)";
  ctx.beginPath();
  ctx.arc(px - eyeDX + lookX, eyeY + lookY, 4.6, 0, Math.PI * 2);
  ctx.arc(px + eyeDX + lookX, eyeY + lookY, 4.6, 0, Math.PI * 2);
  ctx.fill();

  // 嘴：安全微笑 / 高唤起惊讶 / 防御平线
  const mouthY = pos.y + r * 0.38;
  ctx.strokeStyle = "rgba(8,11,22,0.85)";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  if (safety > 0.55) {
    ctx.beginPath();
    ctx.arc(px, mouthY, r * 0.18, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
  } else if (arousal > 0.6) {
    ctx.beginPath();
    ctx.arc(px, mouthY, r * 0.11, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(px - r * 0.16, mouthY);
    ctx.lineTo(px + r * 0.16, mouthY);
    ctx.stroke();
  }
}
