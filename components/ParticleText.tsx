"use client";

import { useEffect, useRef } from "react";

/**
 * 粒子汇聚成字：离屏采样文字像素作为目标点，
 * 粒子从随机位置弹性汇聚到字形上，短暂驻留后散开再汇聚，循环往复。
 */
export default function ParticleText({ text }: { text: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;

    // 软光点精灵（避免逐粒子 shadowBlur 的性能开销）
    const sprite = document.createElement("canvas");
    const sp = 16 * dpr;
    sprite.width = sp;
    sprite.height = sp;
    const sctx2 = sprite.getContext("2d");
    if (sctx2) {
      const g = sctx2.createRadialGradient(sp / 2, sp / 2, 0, sp / 2, sp / 2, sp / 2);
      g.addColorStop(0, "rgba(255,238,208,0.95)");
      g.addColorStop(0.35, "rgba(255,215,140,0.5)");
      g.addColorStop(1, "rgba(255,215,140,0)");
      sctx2.fillStyle = g;
      sctx2.fillRect(0, 0, sp, sp);
    }

    // 离屏画布：采样文字像素
    const sampler = document.createElement("canvas");
    const sctx = sampler.getContext("2d", { willReadFrequently: true });
    let particles: {
      tx: number;
      ty: number;
      sx: number | null;
      sy: number | null;
      x: number;
      y: number;
      vx: number;
      vy: number;
      ph: number;
    }[] = [];

    const build = () => {
      if (!sctx) return;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW < 10 || cssH < 10) return;
      w = Math.round(cssW * dpr);
      h = Math.round(cssH * dpr);
      canvas.width = w;
      canvas.height = h;

      // 字号自适应：约 7 字宽，取 cssW/8，上限 72px
      const fontSize = Math.max(40, Math.min(72, Math.round(cssW / 8))) * dpr;
      sampler.width = w;
      sampler.height = h;
      sctx.clearRect(0, 0, w, h);
      sctx.fillStyle = "#fff";
      sctx.font = `700 ${fontSize}px "新宋体","NSimSun","SimSun","宋体","Songti SC","Noto Serif SC",serif`;
      sctx.textAlign = "center";
      sctx.textBaseline = "middle";
      sctx.fillText(text, w / 2, h / 2);

      const img = sctx.getImageData(0, 0, w, h).data;
      // 采样密度：目标约 900~1600 个粒子
      const step = Math.max(3, Math.round(Math.sqrt(w * h) / 70));
      const targets: { x: number; y: number }[] = [];
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          if (img[(y * w + x) * 4 + 3] > 110) targets.push({ x, y });
        }
      }
      if (targets.length === 0) return;
      // 粒子初始随机散布
      particles = targets.map((t) => ({
        tx: t.x,
        ty: t.y,
        sx: null,
        sy: null,
        x: Math.random() * w,
        y: Math.random() * h,
        vx: 0,
        vy: 0,
        ph: Math.random() * Math.PI * 2,
      }));
    };

    build();
    const ro = new ResizeObserver(() => build());
    ro.observe(canvas);

    // 周期：0-2.6s 汇聚，2.6-4.2s 驻留，4.2-6.5s 散开
    const CYCLE = 6500;
    const CONVERGE_END = 2600;
    const HOLD_END = 4200;
    const K = 0.03; // 弹性系数
    const DAMP = 0.87; // 阻尼
    const t0 = performance.now();
    let raf = 0;

    const step = () => {
      const now = performance.now() - t0;
      const t = now % CYCLE;
      ctx.clearRect(0, 0, w, h);
      const dotSize = 3.4 * dpr;
      const glowSize = dotSize * 3.2;

      for (const p of particles) {
        // 依据阶段选择"家"：目标字形点 或 随机散开点
        let hx = p.tx;
        let hy = p.ty;
        if (t > HOLD_END) {
          if (p.sx === null) {
            p.sx = Math.random() * w;
            p.sy = Math.random() * h;
          }
          hx = p.sx!;
          hy = p.sy!;
        } else if (t < CONVERGE_END) {
          p.sx = null;
          p.sy = null;
        } else {
          // 驻留：字形点周围轻微浮动
          hx = p.tx + Math.sin(now * 0.0015 + p.ph) * 0.8;
          hy = p.ty + Math.cos(now * 0.0012 + p.ph) * 0.8;
        }

        p.vx += (hx - p.x) * K;
        p.vy += (hy - p.y) * K;
        p.vx *= DAMP;
        p.vy *= DAMP;
        p.x += p.vx;
        p.y += p.vy;

        // 汇聚中渐亮，散开时渐隐
        const active = t > HOLD_END ? 0.4 : 1;
        ctx.globalAlpha = active;
        ctx.drawImage(sprite, p.x - glowSize / 2, p.y - glowSize / 2, glowSize, glowSize);
        ctx.fillStyle = "rgba(255,244,222,0.9)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, dotSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [text]);

  return (
    <canvas
      ref={canvasRef}
      className="particle-text"
      role="img"
      aria-label={text}
    />
  );
}
