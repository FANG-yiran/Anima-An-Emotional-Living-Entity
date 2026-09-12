"use client";

import { useState } from "react";
import { QUESTIONNAIRE_ITEMS } from "@/lib/constants";
import type { QuestionnaireAnswers } from "@/lib/types";

interface Props {
  onSubmit: (answers: QuestionnaireAnswers) => void;
}

const SCALE_LABELS = ["完全不同意", "不太同意", "说不清", "比较同意", "完全同意"];

/** 体验结束后 7 题 5 点量表问卷（文档 §4.3） */
export default function Questionnaire({ onSubmit }: Props) {
  const [answers, setAnswers] = useState<Partial<QuestionnaireAnswers>>({});
  const allAnswered = QUESTIONNAIRE_ITEMS.every((q) => answers[q.key] !== undefined);

  const setAnswer = (key: keyof QuestionnaireAnswers, v: number) => {
    setAnswers((prev) => ({ ...prev, [key]: v }));
  };

  return (
    <div className="modal-backdrop">
      <div className="modal panel questionnaire">
        <h2 className="modal-title">交互结束 · 几个关于感受的问题</h2>

        <div className="q-list">
          {QUESTIONNAIRE_ITEMS.map((item, idx) => (
            <div className="q-item" key={item.key}>
              <div className="q-text">
                <span className="q-idx">{idx + 1}</span>
                {item.text}
              </div>
              <div className="q-scale">
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    className={`q-btn ${answers[item.key] === v ? "active" : ""}`}
                    onClick={() => setAnswer(item.key, v)}
                    title={SCALE_LABELS[v - 1]}
                  >
                    {v}
                  </button>
                ))}
                <span className="q-scale-label">
                  {answers[item.key] ? SCALE_LABELS[answers[item.key]! - 1] : ""}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button
            className="btn"
            disabled={!allAnswered}
            onClick={() => onSubmit(answers as QuestionnaireAnswers)}
          >
            提交 · 生成评估报告
          </button>
        </div>
      </div>
    </div>
  );
}
