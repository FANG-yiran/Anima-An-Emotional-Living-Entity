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

/** Canvas 场景绘制：粒子生命体 + 显式连线 + 聚形时的眼睛/嘴 */
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
  const { entityPos: pos, state, cursorPos, manifestProgress } = snap;

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

  // 聚形成"身体"时叠加眼睛与嘴（manifest > 0.5）
  if (manifestProgress > 0.5) {
    const breathe = 1 + 0.05 * Math.sin(now / 420);
    const r = 30 * breathe + state.axis_arousal * 4;
    const safety = state.axis_safety;

    // 眼睛：安全时看向光标，防御时警觉乱转
    const eyeY = pos.y - r * 0.08;
    const eyeDX = r * 0.34;
    let lookX = 0;
    let lookY = 0;
    if (cursorPos && safety > 0.45) {
      const dx = cursorPos.x - pos.x;
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
    ctx.arc(pos.x - eyeDX + lookX, eyeY + lookY, 5.2, 0, Math.PI * 2);
    ctx.arc(pos.x + eyeDX + lookX, eyeY + lookY, 5.2, 0, Math.PI * 2);
    ctx.fill();

    // 嘴：安全微笑 / 高唤起惊讶 / 防御平线
    const mouthY = pos.y + r * 0.38;
    ctx.strokeStyle = "rgba(8,11,22,0.85)";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    if (safety > 0.55) {
      ctx.beginPath();
      ctx.arc(pos.x, mouthY, r * 0.18, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
    } else if (state.axis_arousal > 0.6) {
      ctx.beginPath();
      ctx.arc(pos.x, mouthY, r * 0.11, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(pos.x - r * 0.16, mouthY);
      ctx.lineTo(pos.x + r * 0.16, mouthY);
      ctx.stroke();
    }
  }
}
