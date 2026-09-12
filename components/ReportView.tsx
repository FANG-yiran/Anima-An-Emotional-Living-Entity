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

// 冷色调统一渐变：所有维度条同一颜色（减少颜色数量）
const DIM_BAR = "linear-gradient(90deg, rgba(148, 180, 210, 0.28), #9bd7ff)";

/** 最终评估报告：第三性的观察（冷色、神秘、艺术化） */
export default function ReportView({ report, onRestart }: Props) {
  return (
    <div className="report-scroll">
      <div className="report panel">
        <div className="report-head">
          <div className="report-eyebrow">关系之镜 · 第三性的观察</div>
          <div className="report-ornament" aria-hidden="true">
            <span />
          </div>
        </div>

        {report.keywords.length > 0 && (
          <div className="report-section">
            <div className="report-h">关键词</div>
            <div className="chip-row">
              {report.keywords.map((k) => (
                <span className="chip chip-cold" key={k}>
                  {k}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="report-section">
          <div className="report-h">它如何记得你</div>
          <div className="inferences">
            {report.inferences.map((line, i) => (
              <div className="inference" key={i}>
                <span className="inference-mark" aria-hidden="true" />
                <p className="inference-text">{line}</p>
              </div>
            ))}
          </div>
        </div>

        {report.quote.text && (
          <div className="report-section report-quote-section">
            <div className="quote-mark" aria-hidden="true">
              ❝
            </div>
            <p className="report-quote">{report.quote.text}</p>
            <div className="quote-author">—— {report.quote.author}</div>
          </div>
        )}

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
                      style={{ width: `${v}%`, background: DIM_BAR }}
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
