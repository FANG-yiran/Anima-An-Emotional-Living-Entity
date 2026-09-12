"use client";

import { useCallback, useRef, useState } from "react";
import InteractionStage from "@/components/InteractionStage";
import MonitoringPanel from "@/components/MonitoringPanel";
import Questionnaire from "@/components/Questionnaire";
import ReportView from "@/components/ReportView";
import StartScreen from "@/components/StartScreen";
import { AnimaEngine } from "@/lib/engine";
import {
  buildRuleReport,
  matchTemplate,
} from "@/lib/report";
import {
  computeFiveIndicators,
  computeSevenScores,
  connectionFromIndicators,
  fuseWithQuestionnaire,
} from "@/lib/scoring";
import { buildSessionLog } from "@/lib/session";
import type {
  EngineSnapshot,
  EventLogEntry,
  QuestionnaireAnswers,
  ReportData,
} from "@/lib/types";

type Stage = "start" | "interacting" | "questionnaire" | "generating" | "report";

export default function Home() {
  const [stage, setStage] = useState<Stage>("start");
  const engineRef = useRef<AnimaEngine | null>(null);
  const sessionRef = useRef<{ events: EventLogEntry[]; durationSec: number } | null>(null);
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);

  const handleEnd = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const result = engine.finish();
    sessionRef.current = result;
    setStage("questionnaire");
  }, []);

  const startSession = useCallback(() => {
    const engine = new AnimaEngine({
      onEvent: (entry, snap) => {
        setEvents((prev) => [...prev.slice(-59), entry]);
        setSnapshot(snap);
      },
      onComplete: handleEnd,
    });
    engineRef.current = engine;
    setSnapshot(null);
    setEvents([]);
    setStage("interacting");
  }, [handleEnd]);

  const handleSnapshot = useCallback((snap: EngineSnapshot) => {
    setSnapshot(snap);
  }, []);

  const handleQuestionnaire = useCallback(
    async (answers: QuestionnaireAnswers) => {
      const session = sessionRef.current;
      if (!session) return;
      setStage("generating");

      // ---- 确定性计算（始终本地完成，作为兜底） ----
      const behaviorScores = computeSevenScores(session.events, session.durationSec);
      const { scores, conflictNote } = fuseWithQuestionnaire(behaviorScores, answers);
      const five = computeFiveIndicators(session.events, session.durationSec);
      const conn = connectionFromIndicators(five);
      const sessionLog = buildSessionLog(session.events, session.durationSec, scores);
      const tpl = matchTemplate(scores);
      const ruleReport: ReportData = buildRuleReport(session.events, conn.score, scores, conflictNote);

      // ---- 评估期间不展示固定结果：第三性正在观察，等待 LLM 生成 ----
      const timeline = session.events.map((e) => ({
        t: e.timestamp,
        a: e.user_action,
        b: e.expressed_behavior,
      }));
      let finalReport: ReportData = ruleReport;
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session: sessionLog,
            fiveIndicators: five,
            connection: conn,
            questionnaire: answers,
            templateText: tpl.text,
            timeline,
          }),
        });
        const data = await res.json();
        const q = data.quote as { text?: string; author?: string } | undefined;
        if (
          !data.fallback &&
          Array.isArray(data.keywords) &&
          data.keywords.length &&
          data.description &&
          Array.isArray(data.inferences) &&
          data.inferences.length &&
          q?.text
        ) {
          finalReport = {
            ...ruleReport,
            keywords: data.keywords.slice(0, 5),
            inferences: data.inferences.slice(0, 5),
            quote: { text: q.text, author: q.author ?? "佚名" },
            description: data.description,
            llm_enhanced: true,
          };
        }
      } catch {
        // 保持规则版报告
      }
      setReport(finalReport);
      setStage("report");
    },
    []
  );

  const restart = useCallback(() => {
    engineRef.current = null;
    sessionRef.current = null;
    setReport(null);
    setSnapshot(null);
    setEvents([]);
    setStage("start");
  }, []);

  if (stage === "start" || stage === "interacting") {
    return (
      <main className={`app-root ${stage === "interacting" ? "app-root--stage" : ""}`}>
        {stage === "start" ? (
          <StartScreen onStart={startSession} />
        ) : (
          <>
            <InteractionStage
              engine={engineRef.current!}
              snapshot={snapshot}
              onSnapshot={handleSnapshot}
              onEnd={handleEnd}
            />
            <MonitoringPanel snapshot={snapshot} events={events} />
          </>
        )}
      </main>
    );
  }

  if (stage === "questionnaire") {
    return (
      <main className="app-root">
        <Questionnaire onSubmit={handleQuestionnaire} />
      </main>
    );
  }

  if (stage === "generating") {
    return (
      <main className="app-root">
        <div className="generating">
          <div className="observer-eye" aria-hidden="true">
            <span className="observer-iris" />
          </div>
          <div className="loading-text">第三性正在观察</div>
          <p className="generating-sub">
            一个既不属于你、也不属于生命体的第三者，正安静地注视你们之间发生的一切，并把它织成一句话。
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-root">
      {report && <ReportView report={report} onRestart={restart} />}
    </main>
  );
}
