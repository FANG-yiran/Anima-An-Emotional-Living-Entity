"use client";

import { SEVEN_DIM_LABELS } from "@/lib/constants";
import type { ReportData, SevenDimKey } from "@/lib/types";

interface Props {
  report: ReportData;
  onRestart: () => void;
}

const DIM_ORDER: SevenDimKey[] = [
  "approach_tendency",
  "confirmation_need",
  "rejection_sensitivity",
  "intimacy_tolerance",
  "uncertainty_tolerance",
  "boundary",
  "repair_tendency",
  "manifest_presence",
];

function dimColor(dim: SevenDimKey): string {
  switch (dim) {
    case "approach_tendency": return "linear-gradient(90deg,#6ee7ff,#a78bfa)";
    case "confirmation_need": return "linear-gradient(90deg,#fbbf24,#fb7185)";
    case "rejection_sensitivity": return "linear-gradient(90deg,#fb7185,#f0abfc)";
    case "intimacy_tolerance": return "linear-gradient(90deg,#4ade80,#6ee7ff)";
    case "uncertainty_tolerance": return "linear-gradient(90deg,#a78bfa,#6ee7ff)";
    case "boundary": return "linear-gradient(90deg,#94a3b8,#6ee7ff)";
    case "repair_tendency": return "linear-gradient(90deg,#f0abfc,#4ade80)";
    case "manifest_presence": return "linear-gradient(90deg,#e2e8f0,#6ee7ff)";
  }
}

/** 最终评估报告（文档 §5.3 输出格式） */
export default function ReportView({ report, onRestart }: Props) {
  return (
    <div className="report-scroll">
      <div className="report panel">
        <div className="report-head">
          <div className="report-eyebrow">关系之镜 · 评估报告</div>
          <div className="report-score">
            <span className="score-num">{report.connection_score}</span>
            <span className="score-den"> / 10</span>
          </div>
          <div className={`score-label score-${Math.min(3, Math.floor(report.connection_score / 3))}`}>
            {report.connection_label}
          </div>
        </div>

        <div className="report-section">
          <div className="report-h">关键词</div>
          <div className="chip-row">
            {report.keywords.map((k) => (
              <span className="chip" key={k}>
                {k}
              </span>
            ))}
          </div>
        </div>

        <div className="report-section">
          <div className="report-h">关系维度量化</div>
          <div className="dims">
            {DIM_ORDER.map((dim) => {
              const v = report.scores[dim];
              return (
                <div className="dim-row" key={dim}>
                  <span className="dim-name">{SEVEN_DIM_LABELS[dim]}</span>
                  <div className="bar-track dim-bar">
                    <div
                      className="bar-fill"
                      style={{ width: `${v}%`, background: dimColor(dim) }}
                    />
                  </div>
                  <span className="dim-val">{Math.round(v)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="report-section">
          <div className="report-h">关系描述</div>
          <p className="report-desc">{report.description}</p>
          {report.conflict_note && <p className="report-conflict">◈ {report.conflict_note}</p>}
          {!report.llm_enhanced && (
            <p className="report-source-note">本次报告由本地规则引擎生成，未接入第三方 LLM。</p>
          )}
        </div>

        <div className="report-ethics">{report.ethics_note}</div>

        <div className="report-actions">
          <button className="btn ghost" onClick={onRestart}>
            再次体验
          </button>
        </div>
      </div>
    </div>
  );
}
