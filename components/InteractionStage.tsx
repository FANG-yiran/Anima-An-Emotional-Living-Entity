"use client";

import { useEffect, useRef } from "react";
import type { AnimaEngine } from "@/lib/engine";
import type { EngineSnapshot } from "@/lib/types";
import {
  createParticles,
  drawParticles,
  updateParticles,
  type Particle,
} from "@/lib/particles";

interface Props {
  engine: AnimaEngine;
  snapshot: EngineSnapshot | null;
  onSnapshot: (snap: EngineSnapshot) => void;
}

/** 交互舞台：Canvas 渲染生命体 + 鼠标事件捕获 */
export default function InteractionStage({ engine, snapshot, onSnapshot }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const lastPushRef = useRef(0);
  const lastFrameRef = useRef(0);
  const lastEventCountRef = useRef(0);
  const burstUntilRef = useRef(0);
  const particlesRef = useRef<Particle[] | null>(null);
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
      engine.handleDown(p.x, p.y);
    };
    const onUp = (e: MouseEvent) => {
      const p = toLocal(e);
      engine.handleUp(p.x, p.y);
    };
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget) engine.handleWindowLeave();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    document.documentElement.addEventListener("mouseout", onOut);

    const loop = (now: number) => {
      engine.update(now);

      // 检测新的双击唤醒事件 → 触发爆聚脉冲
      if (engine.events.length > lastEventCountRef.current) {
        lastEventCountRef.current = engine.events.length;
        if (engine.events[engine.events.length - 1].user_action === "dblclick") {
          burstUntilRef.current = now + 700;
        }
      }

      const { w, h } = dimsRef.current;
      if (!particlesRef.current && w > 0) {
        particlesRef.current = createParticles(w, h);
      }

      const snap = engine.getSnapshot(now);
      const dt = lastFrameRef.current
        ? Math.min(0.05, Math.max(0.005, (now - lastFrameRef.current) / 1000))
        : 0.016;
      lastFrameRef.current = now;
      if (particlesRef.current) {
        updateParticles(particlesRef.current, snap, w, h, now, dt, {
          burstUntil: burstUntilRef.current,
        });
      }
      drawScene(ctx, w, h, snap, particlesRef.current, now, burstUntilRef.current);
      if (now - lastPushRef.current > 200) {
        lastPushRef.current = now;
        onSnapshot(snap);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      document.documentElement.removeEventListener("mouseout", onOut);
    };
  }, [engine, onSnapshot]);

  const remaining = snapshot?.remaining ?? 90;
  const mm = Math.floor(remaining / 60);
  const ss = Math.floor(remaining % 60);
  return (
    <div className="stage-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="stage-canvas" />
      <div className="stage-hud" aria-label="剩余时间">
        <span className="hud-time">
          {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}

/** Canvas 场景绘制：粒子生命体 + 显式连线（不绘制人脸轮廓，保持无固定外形的弥散感） */
function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  snap: EngineSnapshot,
  particles: Particle[] | null,
  now: number,
  burstUntil: number
) {
  ctx.clearRect(0, 0, w, h);
  const { entityPos: pos, cursorPos, manifestProgress } = snap;

  if (particles && particles.length > 0) {
    drawParticles(ctx, particles, snap, now, w, h, { burstUntil });
  }

  // 光标连接线（靠近时浮现，随显现进度淡入）
  if (cursorPos) {
    const d = Math.hypot(cursorPos.x - pos.x, cursorPos.y - pos.y);
    if (d < 260) {
      const alpha = (1 - d / 260) * 0.35 * manifestProgress;
      ctx.strokeStyle = `rgba(110,231,255,${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cursorPos.x, cursorPos.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
  }
}
