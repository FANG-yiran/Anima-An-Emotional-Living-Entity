"use client";

import { useState } from "react";
import {
  ACTION_LABELS,
  AXIS_CONFIG,
  BEHAVIOR_LABELS,
  PHASE_LABELS,
} from "@/lib/constants";
import type { EngineSnapshot, EventLogEntry } from "@/lib/types";

interface Props {
  snapshot: EngineSnapshot | null;
  events: EventLogEntry[];
}

const AXIS_ORDER = ["axis_approach", "axis_safety", "axis_arousal", "axis_memory"] as const;

function barColor(axis: string): string {
  switch (axis) {
    case "axis_approach": return "linear-gradient(90deg,#6ee7ff,#a78bfa)";
    case "axis_safety": return "linear-gradient(90deg,#4ade80,#6ee7ff)";
    case "axis_arousal": return "linear-gradient(90deg,#fbbf24,#fb7185)";
    case "axis_memory": return "linear-gradient(90deg,#a78bfa,#f0abfc)";
    default: return "linear-gradient(90deg,#6ee7ff,#a78bfa)";
  }
}

/** 实时监测面板：内部状态轴、阶段倒计时、事件日志、动作统计 */
export default function MonitoringPanel({ snapshot, events }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  if (!snapshot) return null;

  const mm = Math.floor(snapshot.remaining / 60);
  const ss = Math.floor(snapshot.remaining % 60);
  const emm = Math.floor(snapshot.elapsed / 60);
  const ess = Math.floor(snapshot.elapsed % 60);

  return (
    <aside className={`monitor ${collapsed ? "monitor--collapsed" : ""}`}>
      {collapsed ? (
        <button className="monitor-toggle" onClick={() => setCollapsed(false)} title="展开实时监测">
          监测
        </button>
      ) : (
        <div className="monitor-body">
          <div className="monitor-head">
            <span className="monitor-title">实时监测</span>
            <button className="monitor-close" onClick={() => setCollapsed(true)} title="收起">
              −
            </button>
          </div>

          <div className="monitor-count">
            <div className="count-main">
              {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
            </div>
            <div className="count-sub">
              {PHASE_LABELS[snapshot.phase]} · 已进行 {String(emm).padStart(2, "0")}:
              {String(ess).padStart(2, "0")}
            </div>
          </div>

          <div className="monitor-section">
            <div className="section-title">生命体内部状态</div>
            {AXIS_ORDER.map((key) => {
              const cfg = AXIS_CONFIG[key];
              const v = snapshot.state[key];
              return (
                <div className="axis-row" key={key}>
                  <div className="axis-top">
                    <span>{cfg.label}</span>
                    <span className="axis-val">{v.toFixed(2)}</span>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${v * 100}%`, background: barColor(key) }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="monitor-section">
            <div className="section-title">生命体表达</div>
            <div className="chip-row">
              {(Object.keys(BEHAVIOR_LABELS) as (keyof typeof BEHAVIOR_LABELS)[]).map((b) => (
                <span className="chip chip-sm" key={b}>
                  {BEHAVIOR_LABELS[b]} <b>{snapshot.behaviorCounts[b]}</b>
                </span>
              ))}
            </div>
          </div>

          <div className="monitor-section">
            <div className="section-title">你的动作</div>
            <div className="chip-row">
              {(Object.keys(ACTION_LABELS) as (keyof typeof ACTION_LABELS)[]).map((a) => (
                <span className="chip chip-sm chip-ghost" key={a}>
                  {ACTION_LABELS[a]} <b>{snapshot.actionCounts[a]}</b>
                </span>
              ))}
            </div>
          </div>

          <div className="monitor-section">
            <div className="section-title">
              响应延迟
              <span className="section-hint">
                最近 {snapshot.lastLatency}ms · 平均 {Math.round(snapshot.avgLatency)}ms
              </span>
            </div>
          </div>

          <div className="monitor-section monitor-log">
            <div className="section-title">事件日志</div>
            {events.length === 0 ? (
              <div className="log-empty">等待交互事件…（移动鼠标接近生命体）</div>
            ) : (
              <div className="log-list">
                {events.slice(-8).map((e, i) => (
                  <div className="log-line" key={events.length - 8 + i}>
                    <span className="log-t">{e.timestamp.toFixed(1)}s</span>
                    <span className="log-a">{ACTION_LABELS[e.user_action]}</span>
                    <span className="log-arrow">→</span>
                    <span className="log-b">{BEHAVIOR_LABELS[e.expressed_behavior]}</span>
                    <span className="log-l">{e.response_latency_ms}ms</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
