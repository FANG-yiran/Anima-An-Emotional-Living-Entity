"use client";

import type { EngineSnapshot } from "@/lib/types";

interface Props {
  snapshot: EngineSnapshot | null;
}

const AXIS_ORDER = [
  "axis_approach",
  "axis_safety",
  "axis_arousal",
  "axis_memory",
  "axis_manifest",
] as const;

/** 匿名信号面板：只暗示系统正在记录，不暴露评测维度或数值。 */
export default function MonitoringPanel({ snapshot }: Props) {
  if (!snapshot) return null;

  return (
    <aside className="signal-field" aria-hidden="true">
      {AXIS_ORDER.map((key, index) => {
        const value = snapshot.state[key];
        return (
          <div className="signal-track" key={key}>
            <div
              className={`signal-fill signal-fill--${index + 1}`}
              style={{ width: `${8 + value * 92}%` }}
            />
          </div>
        );
      })}
    </aside>
  );
}
