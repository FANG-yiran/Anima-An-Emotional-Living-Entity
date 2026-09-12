"use client";

import { useState } from "react";
import type { ReportData } from "@/lib/types";

interface Props {
  report: ReportData;
  onRestart: () => void;
}

type View = "poem" | "analysis";

/**
 * 报告：默认只呈现一句诗。
 * 点「互动记录」进入分析页（动作记录 + 依恋模式解读）；「再次体验」同样收在分析页。
 */
export default function ReportView({ report, onRestart }: Props) {
  const [view, setView] = useState<View>("poem");

  if (view === "analysis") {
    return (
      <div className="report-scroll">
        <article className="report poem-card analysis-card">
          <header className="poem-head">
            <button
              type="button"
              className="poem-back"
              onClick={() => setView("poem")}
              aria-label="返回诗句"
            >
              ← 诗
            </button>
          </header>

          {report.inferences.length > 0 && (
            <section className="poem-log">
              <div className="poem-log-label">互动记录</div>
              <ol className="poem-log-list">
                {report.inferences.map((line, i) => (
                  <li key={i} className="poem-log-item">
                    {line}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {report.keywords.length > 0 && (
            <section className="analysis-block">
              <div className="poem-log-label">关键词</div>
              <div className="analysis-chips">
                {report.keywords.map((k) => (
                  <span key={k} className="analysis-chip">
                    {k}
                  </span>
                ))}
              </div>
            </section>
          )}

          {report.description && (
            <section className="analysis-block">
              <div className="poem-log-label">关系解读</div>
              <p className="analysis-desc">{report.description}</p>
              {report.conflict_note && (
                <p className="analysis-conflict">{report.conflict_note}</p>
              )}
            </section>
          )}

          <footer className="poem-foot">
            <button className="btn ghost poem-restart" onClick={onRestart}>
              再次体验
            </button>
          </footer>
        </article>
      </div>
    );
  }

  return (
    <div className="report-scroll">
      <article className="report poem-card">
        <header className="poem-head">
          <span className="poem-eyebrow">观察</span>
        </header>

        <section className="poem-hero">
          <blockquote className="poem-text">{report.quote.text}</blockquote>
          <cite className="poem-author">—— {report.quote.author}</cite>
        </section>

        <footer className="poem-foot">
          <button
            type="button"
            className="poem-link"
            onClick={() => setView("analysis")}
          >
            互动记录
          </button>
        </footer>
      </article>
    </div>
  );
}
