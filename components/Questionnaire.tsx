"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QUESTIONNAIRE_ITEMS } from "@/lib/constants";
import type { QuestionnaireAnswers } from "@/lib/types";

interface Props {
  onSubmit: (answers: QuestionnaireAnswers) => void;
}

const SCALE_LABELS = ["完全不同意", "不同意", "中立", "同意", "完全同意"];
const TOTAL = QUESTIONNAIRE_ITEMS.length;

const INTRO_HOLD = 2500; // 开场白停留
const INTRO_OUT = 800; // 开场白消散
const SELECT_HOLD = 800; // 选中后停留
const Q_OUT = 600; // 题目消散
const OUTRO_HOLD = 2000; // 结束语停留
const IDLE_HINT = 15000; // 长时间未选择 → 提示光晕

/** 背景：纯雾态粒子场（Canvas，低透明度，不保留生命体残余形态） */
function BreathingField({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = Math.floor(canvas.offsetWidth * dpr);
      canvas.height = Math.floor(canvas.offsetHeight * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const N = Math.min(180, Math.floor((canvas.offsetWidth * canvas.offsetHeight) / 8200));
    const ps = Array.from({ length: N }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 1.0 + Math.random() * 2.6,
      vx: (Math.random() - 0.5) * 0.16,
      vy: -0.03 - Math.random() * 0.12,
      ph: Math.random() * Math.PI * 2,
      sp: 0.3 + Math.random() * 0.7,
    }));

    let raf = 0;
    let t = 0;
    const draw = () => {
      t += 0.016;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      for (const p of ps) {
        p.x += p.vx * 0.016;
        p.y += p.vy * 0.016;
        if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
        if (p.x < -0.02) p.x = 1.02;
        if (p.x > 1.02) p.x = -0.02;
        const tw = 0.5 + 0.5 * Math.sin(t * p.sp * 2 + p.ph);
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, p.r * (1 + 0.45 * tw), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(198, 178, 240, ${0.045 + 0.055 * tw})`;
        ctx.shadowColor = "rgba(158, 138, 220, 0.5)";
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [canvasRef]);
  return null;
}

/** 旋转魔法阵光晕（SVG 圆环 + 刻度 + 符文星） */
function MagicRing({ reverse = false }: { reverse?: boolean }) {
  const star = Array.from({ length: 16 }, (_, k) => {
    const a = ((k * 22.5 - 90) * Math.PI) / 180;
    const r = k % 2 === 0 ? 118 : 52;
    return `${(320 + r * Math.cos(a)).toFixed(1)},${(320 + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  return (
    <svg
      className={`ritual-ring ${reverse ? "ritual-ring--rev" : ""}`}
      viewBox="0 0 640 640"
      aria-hidden="true"
    >
      <circle cx="320" cy="320" r="310" fill="none" stroke="rgba(255,215,140,0.5)" strokeWidth="1" />
      <circle
        cx="320" cy="320" r="270" fill="none" stroke="rgba(255,215,140,0.26)"
        strokeWidth="1" strokeDasharray="2 14"
      />
      <circle
        cx="320" cy="320" r="224" fill="none" stroke="rgba(255,179,71,0.32)"
        strokeWidth="1.4" strokeDasharray="46 22" strokeLinecap="round"
      />
      <g stroke="rgba(255,215,140,0.38)" strokeWidth="1">
        {Array.from({ length: 36 }).map((_, i) => (
          <line
            key={i}
            x1="320" y1="12" x2="320" y2={i % 6 === 0 ? 27 : 20}
            transform={`rotate(${i * 10} 320 320)`}
          />
        ))}
      </g>
      <polygon points={star} fill="none" stroke="rgba(255,215,140,0.3)" strokeWidth="1.2" />
      <circle
        cx="320" cy="320" r="150" fill="none" stroke="rgba(255,179,71,0.22)"
        strokeWidth="1" strokeDasharray="3 10"
      />
    </svg>
  );
}

/** 体验结束后的仪式化问卷：开场白 → 7 题圆环选择 → 结束语，选中自动过渡 */
export default function Questionnaire({ onSubmit }: Props) {
  const [stage, setStage] = useState<"intro" | "question" | "outro">("intro");
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [idle, setIdle] = useState(false);
  const answersRef = useRef<Partial<QuestionnaireAnswers>>({});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timersRef = useRef<number[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  useEffect(() => {
    const ts = timersRef.current;
    return () => ts.forEach(clearTimeout);
  }, []);

  // 开场白：停留后消散，进入第一题
  useEffect(() => {
    if (stage !== "intro") return;
    later(() => setStage("question"), INTRO_HOLD + INTRO_OUT);
  }, [stage, later]);

  // 每题 15s 未选择 → 微弱提示光晕
  useEffect(() => {
    if (stage !== "question" || selected !== null) return;
    const id = window.setTimeout(() => setIdle(true), IDLE_HINT);
    return () => clearTimeout(id);
  }, [stage, index, selected]);

  // 结束语 → 提交数据
  useEffect(() => {
    if (stage !== "outro") return;
    later(() => onSubmit(answersRef.current as QuestionnaireAnswers), OUTRO_HOLD);
  }, [stage, later, onSubmit]);

  const choose = useCallback(
    (score: number) => {
      if (selected !== null) return;
      setSelected(score);
      answersRef.current[QUESTIONNAIRE_ITEMS[index].key] = score;
      later(() => {
        setLeaving(true);
        later(() => {
          if (index >= TOTAL - 1) {
            setStage("outro");
          } else {
            setIndex((i) => i + 1);
            setSelected(null);
            setLeaving(false);
            setIdle(false);
          }
        }, Q_OUT);
      }, SELECT_HOLD);
    },
    [index, later, selected]
  );

  const q = QUESTIONNAIRE_ITEMS[index];

  return (
    <div className="ritual">
      <canvas ref={canvasRef} className="ritual-field" />
      <BreathingField canvasRef={canvasRef} />
      <MagicRing />
      <MagicRing reverse />

      {stage === "intro" && (
        <div className="ritual-intro">
          <p className="intro-text">我是Animo，你现在认识我了吗？</p>
        </div>
      )}

      {stage === "question" && q && (
        <div
          key={index}
          className={`ritual-qscene ${leaving ? "is-leaving" : ""} ${idle ? "is-idle" : ""}`}
        >
          <p className="ritual-q-text">{q.text}</p>

          <div
            className="ritual-options"
            role="radiogroup"
            aria-label="1 不同意 — 5 同意"
          >
            {[1, 2, 3, 4, 5].map((v, i) => {
              const d = Math.abs(v - 3);
              const sizeCls = d === 0 ? "sz-mid" : d === 1 ? "sz-m" : "sz-lg";
              return (
                <div key={v} className="ritual-opt-wrap">
                  <button
                    className={`ritual-opt ${sizeCls} ${selected === v ? "is-selected" : ""} ${selected !== null && selected !== v ? "is-dim" : ""}`}
                    style={{ animationDelay: `${i * 0.1}s` }}
                    role="radio"
                    aria-checked={selected === v}
                    aria-label={`${SCALE_LABELS[v - 1]}，${v} 分`}
                    onClick={() => choose(v)}
                  />
                </div>
              );
            })}
          </div>

          <div className="ritual-scale-ends" aria-hidden="true">
            <span>不同意</span>
            <span>同意</span>
          </div>

          {idle && <p className="ritual-hint">它仍在等你</p>}
        </div>
      )}

      {stage === "outro" && (
        <div className="ritual-outro">
          <p className="outro-text">谢谢你，让我认识你。</p>
        </div>
      )}
    </div>
  );
}
