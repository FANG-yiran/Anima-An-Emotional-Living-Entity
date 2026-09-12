"use client";

interface Props {
  onStart: () => void;
}

/** 开始页 */
export default function StartScreen({ onStart }: Props) {
  return (
    <div className="start-wrap">
      <div className="start-orb" aria-hidden="true" />
      <h1 className="start-title">Anima</h1>
      <p className="start-sub">一个拥有内部状态、记忆与不可解释性的情绪生命体</p>
      <p className="start-desc">
        你将与它进行 <b>90 秒</b> 自由交互。移动鼠标靠近、远离、停住，或点击触碰它——
        它会有自己的回应，但不总是如你所愿。
        <br />
        结束后，系统将基于全程行为，为你生成一面「关系之镜」：情感联结评分、关键词与七维关系画像。
      </p>
      <div className="start-actions">
        <button className="btn" onClick={onStart}>
          开始交互
        </button>
      </div>
      <p className="start-note">
        结果仅反映本次交互中的行为倾向，不构成心理诊断
      </p>
    </div>
  );
}
