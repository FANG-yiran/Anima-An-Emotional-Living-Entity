"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportData } from "@/lib/types";

interface Props {
  report: ReportData;
  onRestart: () => void;
}

type Phase = "log" | "reading" | "poem" | "ending";
const PHASE_MS = 8000;
const VANISH_MS = 1200;

/**
 * 报告卡片：实体卡随鼠标移动倾转（无需按住）。
 * 序演出：互动记录 8s → 关系解读 8s → 诗句 8s → 卡片散去，接入结尾视频。
 */
export default function ReportView({ report, onRestart }: Props) {
  const [phase, setPhase] = useState<Phase>("log");
  const [fade, setFade] = useState(true);
  const [vanishing, setVanishing] = useState(false);
  const [rot, setRot] = useState({ x: -10, y: 16 });
  const [glare, setGlare] = useState({ x: 50, y: 40 });
  const cardRef = useRef<HTMLDivElement>(null);
  const endVideoRef = useRef<HTMLVideoElement>(null);

  // 序演出推进
  useEffect(() => {
    if (phase === "poem") {
      setFade(true);
      const t = window.setTimeout(() => {
        setVanishing(true);
        window.setTimeout(() => setPhase("ending"), VANISH_MS - 80);
      }, PHASE_MS);
      return () => window.clearTimeout(t);
    }
    if (phase === "log" || phase === "reading") {
      setFade(true);
      const t1 = window.setTimeout(() => setFade(false), PHASE_MS - 500);
      const t2 = window.setTimeout(() => {
        setPhase(phase === "log" ? "reading" : "poem");
      }, PHASE_MS);
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    }
    return;
  }, [phase]);

  useEffect(() => {
    if (phase !== "ending" && !vanishing) return;
    endVideoRef.current?.play().catch(() => {});
  }, [phase, vanishing]);

  useEffect(() => {
    if (phase === "ending") setFade(true);
  }, [phase]);

  useEffect(() => {
    if (report.inferences.length === 0) {
      setPhase((p) => (p === "log" ? "reading" : p));
    }
  }, [report.inferences.length]);

  /** 鼠标在舞台上移动即可带动卡片倾转与反光，无需按住 */
  const onStageMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (phase === "ending" || vanishing) return;
      const el = cardRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const nx = (e.clientX - cx) / Math.max(1, r.width / 2);
      const ny = (e.clientY - cy) / Math.max(1, r.height / 2);
      const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
      setRot({
        x: clamp(-ny * 16, -24, 24),
        y: clamp(nx * 22, -36, 36),
      });
      setGlare({
        x: ((e.clientX - r.left) / r.width) * 100,
        y: ((e.clientY - r.top) / r.height) * 100,
      });
    },
    [phase, vanishing]
  );

  const showCard = phase !== "ending";

  return (
    <div
      className={`report-stage ${phase === "ending" || vanishing ? "is-ending" : ""}`}
      onMouseMove={onStageMove}
    >
      {(phase === "ending" || vanishing) && (
        <video
          ref={endVideoRef}
          className={`end-video ${phase === "ending" ? "is-on" : "is-pre"}`}
          src="/end.mp4"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
        />
      )}

      {showCard && (
        <div className={`report-card-scene ${vanishing ? "is-vanish" : ""}`}>
          <div
            ref={cardRef}
            className="report-card3d"
            style={{
              transform: `rotateX(${rot.x}deg) rotateY(${rot.y}deg)`,
            }}
          >
            <div className="card-face">
              <div className="card-edge" aria-hidden="true" />
              <div
                className="card-glare"
                style={{
                  background: `radial-gradient(circle at ${glare.x}% ${glare.y}%, rgba(255,255,255,0.22), transparent 42%)`,
                }}
                aria-hidden="true"
              />
              <div className="card-sheen" aria-hidden="true" />
              <div className="card-stars" aria-hidden="true" />

              <div className={`card-body ${fade && !vanishing ? "is-on" : "is-off"}`}>
                {phase === "log" && (
                  <section className="card-panel">
                    <div className="card-label">互动记录</div>
                    {report.inferences.length > 0 ? (
                      <ol className="card-log">
                        {report.inferences.slice(0, 6).map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ol>
                    ) : (
                      <p className="card-empty">这九十秒，几乎没有留下痕迹。</p>
                    )}
                  </section>
                )}

                {phase === "reading" && (
                  <section className="card-panel">
                    <div className="card-label">关系解读</div>
                    {report.keywords.length > 0 && (
                      <div className="card-chips">
                        {report.keywords.map((k) => (
                          <span key={k}>{k}</span>
                        ))}
                      </div>
                    )}
                    <p className="card-desc">{report.description}</p>
                    {report.conflict_note && (
                      <p className="card-conflict">{report.conflict_note}</p>
                    )}
                  </section>
                )}

                {phase === "poem" && (
                  <section className="card-panel card-panel--poem">
                    <div className="card-rule" aria-hidden="true" />
                    <blockquote className="card-poem">{report.quote.text}</blockquote>
                    <cite className="card-author">—— {report.quote.author}</cite>
                  </section>
                )}
              </div>

              <div className="card-hint" aria-hidden="true">
                移动鼠标 · 观察卡片
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === "ending" && (
        <div className="end-ui">
          <button type="button" className="card-restart end-restart" onClick={onRestart}>
            再次体验
          </button>
        </div>
      )}
    </div>
  );
}
