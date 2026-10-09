import { getPracticeTarget, type AutoPracticeResult, type Finger, type PracticeReading } from "./firstPosition";
import type { ViolinStringId } from "../tuning/violin";

type Props = {
  stringId: ViolinStringId;
  finger: Finger;
  mode: "auto" | "manual";
  onModeChange: (mode: "auto" | "manual") => void;
  onStringChange: (stringId: ViolinStringId) => void;
  onFingerChange: (finger: Finger) => void;
  referenceA4: number;
  reading: PracticeReading | null;
  autoResult: AutoPracticeResult;
  status: "idle" | "starting" | "running" | "interrupted" | "error";
  error: string;
  onStart: () => void;
  onStop: () => void;
  onResume: () => void;
};

const stateLabels = { low: "偏低", "in-tune": "音准", high: "偏高", far: "与目标音差距较大" } as const;

export function PracticePage({ stringId, finger, mode, onModeChange, onStringChange, onFingerChange, referenceA4, reading, autoResult, status, error, onStart, onStop, onResume }: Props) {
  const target = mode === "auto" ? autoResult.target : getPracticeTarget(stringId, finger, referenceA4);
  const currentReading = mode === "auto" ? autoResult.reading : reading;
  const cents = currentReading?.cents ?? 0;
  const inRange = currentReading && currentReading.state !== "far";
  const needlePosition = 50 + Math.max(-50, Math.min(50, cents));
  const state = currentReading?.state ?? "waiting";
  const statusText = currentReading ? stateLabels[currentReading.state]
    : status !== "running" ? "准备练习"
    : mode === "manual" ? "等待演奏"
    : autoResult.phase === "outside" ? "暂未匹配到按指音"
    : autoResult.phase === "acquiring" ? "正在识别" : "请演奏所选琴弦";

  return (
    <main className={`app-shell practice-shell practice-${state}`}>
      <header className="practice-header">
        <span className="practice-header-title">音准练习</span>
      </header>

      <section className="practice-intro">
        <p className="eyebrow">第一把位</p>
      </section>

      <section className="practice-choices" aria-label="练习目标">
        <div className="choice-heading"><strong>选择琴弦</strong></div>
        <div className="practice-string-choices">
          {(["G", "D", "A", "E"] as const).map((item) => <button key={item} aria-label={`${item} 弦`} aria-pressed={stringId === item} className={stringId === item ? "chosen" : ""} onClick={() => onStringChange(item)}>{item}</button>)}
        </div>
        <div className="choice-heading finger-heading"><strong>按指模式</strong></div>
        <div className="practice-mode-choices" role="group" aria-label="按指识别模式">
          <button className={mode === "auto" ? "chosen" : ""} aria-pressed={mode === "auto"} onClick={() => onModeChange("auto")}>自动跟随</button>
          <button className={mode === "manual" ? "chosen" : ""} aria-pressed={mode === "manual"} onClick={() => onModeChange("manual")}>手动选指</button>
        </div>
        {mode === "manual" ? <div className="practice-finger-choices practice-note-row">
          {([1, 2, 3, 4] as const).map((item) => <button key={item} aria-pressed={finger === item} className={finger === item ? "chosen" : ""} onClick={() => onFingerChange(item)}>{item} 指</button>)}
        </div> : <div className="practice-finger-guide practice-note-row" aria-label="本弦按指目标">
          {([1, 2, 3, 4] as const).map((item) => {
            const note = getPracticeTarget(stringId, item, referenceA4);
            return <span key={item} className={target?.finger === item ? "active" : ""}><b>{item} 指</b><small>{note.solfege}</small></span>;
          })}
        </div>}
      </section>

      <section className="practice-feedback" aria-label="音准反馈">
        <div className="practice-feedback-body">
        <p className="target-caption">{target ? `${mode === "auto" ? "推测目标" : "当前目标"} · ${stringId} 弦 ${target.finger} 指` : `${stringId} 弦 · 等待识别 1–4 指`}</p>
        <div className={`target-solfege ${target ? "" : "empty"}`}>{target?.solfege ?? "—"}</div>
        <div className="target-meta">{target && <>{target.noteName} <span>·</span> {target.targetFrequencyHz.toFixed(2)} Hz <span>·</span> {target.hint}</>}</div>
        <div className={`practice-status ${state}`} aria-live="polite">
          {statusText}
        </div>
        <div className="practice-cents" aria-live="off">{currentReading ? <><strong>{cents > 0 ? "+" : ""}{cents.toFixed(1)}</strong><span> cents</span></> : <><strong>—</strong><span> cents</span></>}</div>
        <div className="practice-gauge" role="meter" aria-label="相对目标音的音分偏差" aria-valuemin={-50} aria-valuemax={50} aria-valuenow={inRange ? Math.max(-50, Math.min(50, cents)) : 0}>
          <div className="practice-gauge-track"><span className="practice-gauge-center" /><span className={`practice-needle ${inRange ? "active" : ""}`} style={{ left: `${inRange ? needlePosition : 50}%` }} /></div>
          <div className="practice-gauge-labels"><span>偏低</span><span>音准</span><span>偏高</span></div>
        </div>
        {(currentReading?.state === "far" || (mode === "auto" && autoResult.phase === "outside" && status === "running")) && <p className="practice-advice">请确认琴弦，或使用手动选指</p>}
        </div>
        {error && <p className="error-message">{error}</p>}
        <div className="practice-actions">
        {status === "running" ? <button className="primary stop" onClick={onStop}>停止练习</button> : status === "interrupted" ? <button className="primary" onClick={onResume}>恢复麦克风</button> : <button className="primary" disabled={status === "starting"} onClick={onStart}>{status === "starting" ? "正在打开麦克风…" : "开始练习"}</button>}
        </div>
      </section>
    </main>
  );
}
