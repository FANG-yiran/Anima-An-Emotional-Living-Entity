"use client";

import type { ReportData } from "@/lib/types";

interface Props {
  report: ReportData;
  onRestart: () => void;
}

/** 报告：一句诗 + 客观动作记录。无测评、无维度分。 */
export default function ReportView({ report, onRestart }: Props) {
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

        <footer className="poem-foot">
          <p className="poem-ethics">{report.ethics_note}</p>
          <button className="btn ghost poem-restart" onClick={onRestart}>
            再次体验
          </button>
        </footer>
      </article>
    </div>
  );
}
