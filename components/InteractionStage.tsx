"use client";

import { useEffect, useRef, useState } from "react";
import type { AnimaEngine } from "@/lib/engine";
import type { EngineSnapshot } from "@/lib/types";
import { WebGLLifeform } from "@/lib/webglLifeform";
import AmbientInterlude from "./AmbientInterlude";

interface Props {
  engine: AnimaEngine;
  snapshot: EngineSnapshot | null;
  onSnapshot: (snap: EngineSnapshot) => void;
}

/** 交互舞台：六态 GPU 生命体（统一粒子系统 + 流体速度场），由 WebGLLifeform 全权渲染 */
export default function InteractionStage({ engine, snapshot, onSnapshot }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const lastPushRef = useRef(0);
  const lastFrameRef = useRef(0);
  const lastEventCountRef = useRef(0);
  const lifeformRef = useRef<WebGLLifeform | null>(null);
  const [veilHost, setVeilHost] = useState<WebGLLifeform | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const lifeform = new WebGLLifeform(wrap, { particleCount: 68_000, resolution: 0.22 });
    lifeformRef.current = lifeform;

    // 调试钩子：浏览器 console 强制切换六态（验证截图用）
    if (typeof window !== "undefined") {
      (window as unknown as Record<string, unknown>).__animaDebug = {
        lifeform,
        setState: (s: string) => lifeform.debugSetState(s as never),
        release: () => lifeform.debugRelease(),
        triggerVeil: () => lifeform.debugTriggerVeil(),
      };
    }

    setVeilHost(lifeform);

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      engine.setBounds(rect.width, rect.height);
      lifeform.resize(rect.width, rect.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    engine.start();

    const toLocal = (e: MouseEvent) => {
      const rect = wrap.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    // 单击检测：延迟 360ms 执行，若期间有第二次按下则取消（视为双击）
    let singleClickTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingClick: { x: number; y: number } | null = null;
    const onMove = (e: MouseEvent) => {
      const p = toLocal(e);
      engine.handleMove(p.x, p.y);
    };
    const onDown = (e: MouseEvent) => {
      const p = toLocal(e);
      engine.handleDown(p.x, p.y);
      // 若有挂起的单击，说明是双击 → 取消节点移除
      if (singleClickTimer) {
        clearTimeout(singleClickTimer);
        singleClickTimer = null;
        pendingClick = null;
      }
    };
    const onUp = (e: MouseEvent) => {
      const p = toLocal(e);
      engine.handleUp(p.x, p.y);
      // 延迟判定：360ms 内无第二次按下则视为单击，移除 Hive Mind 节点
      pendingClick = p;
      singleClickTimer = setTimeout(() => {
        if (pendingClick) lifeform.handleClick(pendingClick.x, pendingClick.y);
        singleClickTimer = null;
        pendingClick = null;
      }, 360);
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
          lifeform.setBurstUntil(now + 700);
        }
      }

      const dt = lastFrameRef.current
        ? Math.min(0.05, Math.max(0.005, (now - lastFrameRef.current) / 1000))
        : 0.016;
      lastFrameRef.current = now;

      const snap = engine.getSnapshot(now);
      // 光流形态同步给引擎：接近/触碰相对形态体表面
      engine.setVisualState(lifeform.visualState);
      lifeform.tick(snap, now, dt);
      lifeform.render(now);

      if (now - lastPushRef.current > 200) {
        lastPushRef.current = now;
        onSnapshot(snap);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      if (singleClickTimer) clearTimeout(singleClickTimer);
      ro.disconnect();
      lifeform.dispose();
      lifeformRef.current = null;
      setVeilHost(null);
      if (typeof window !== "undefined") {
        delete (window as unknown as Record<string, unknown>).__animaDebug;
      }
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
      {veilHost && <AmbientInterlude lifeform={veilHost} />}
      <div className="stage-hud" aria-label="剩余时间">
        <span className="hud-time">
          {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}
