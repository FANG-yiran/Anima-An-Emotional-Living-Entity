"use client";

import { useCallback, useEffect, useRef } from "react";

interface Props {
  /** 单击封面：开始散开并通知上层进入交互 */
  onStart: () => void;
  /** 已进入交互、封面正在散开（盖在舞台上方，不可再点） */
  leaving?: boolean;
}

/** 封面：全屏视频循环；单击后自然散开，化入光晕 */
export default function StartScreen({ onStart, leaving = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const armedRef = useRef(false);

  useEffect(() => {
    videoRef.current?.play().catch(() => {});
  }, []);

  const handleEnter = useCallback(() => {
    if (leaving || armedRef.current) return;
    armedRef.current = true;
    onStart();
  }, [leaving, onStart]);

  return (
    <div
      className={`cover ${leaving ? "cover--dissolve" : ""}`}
      onClick={handleEnter}
      role="button"
      tabIndex={leaving ? -1 : 0}
      aria-label="开始交互"
      aria-hidden={leaving || undefined}
      onKeyDown={(e) => {
        if (leaving) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleEnter();
        }
      }}
    >
      <video
        ref={videoRef}
        className="cover-video"
        src="/cover.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
      />
    </div>
  );
}
