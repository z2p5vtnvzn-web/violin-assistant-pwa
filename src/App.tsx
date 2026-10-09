import { useCallback, useEffect, useRef, useState } from "react";
import { detectPitchYin } from "./pitch/yin";
import { PitchStabilizer, type SignalState } from "./pitch/stabilizer";
import { PitchSessionMetrics, type PitchSessionSummary } from "./pitch/sessionMetrics";
import { getViolinStrings, selectCandidateForString, selectViolinCandidate, type TuningState, type ViolinStringId } from "./tuning/violin";
import { BUILD_VERSION } from "./version";
import { AutoFingerTracker, getPracticeTarget, PracticeTracker, type AutoPracticeResult, type Finger, type PracticeReading } from "./practice/firstPosition";
import { PracticePage } from "./practice/PracticePage";
import { MetronomePage } from "./metronome/MetronomePage";
import { BottomNav, type AppPage } from "./BottomNav";

type ProbeStatus = "idle" | "starting" | "running" | "interrupted" | "error";
type StringSelection = "auto" | ViolinStringId;

type LevelMessage = {
  type: "level";
  rms: number;
  peak: number;
  sampleRate: number;
  currentFrame: number;
  currentTime: number;
};

type SamplesMessage = {
  type: "samples";
  samples: Float32Array;
  sampleRate: number;
  capturedAt: number;
};

type WorkletMessage = LevelMessage | SamplesMessage;

type PitchDiagnostic = {
  frequencyHz: number;
  confidence: number;
  stringId: ViolinStringId;
  correctedFrequencyHz: number;
  cents: number;
  tuningState: TuningState;
  octaveFactor: 0.5 | 1 | 2;
  analysisMs: number;
  signalState: SignalState;
};

type LogEntry = {
  at: string;
  message: string;
};

type AudioResources = {
  context: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  worklet: AudioWorkletNode;
  mute: GainNode;
};

const formatLevel = (value: number) => (value > 0 ? `${(20 * Math.log10(value)).toFixed(1)} dBFS` : "−∞ dBFS");

const nowLabel = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });

export default function App() {
  const [page, setPage] = useState<AppPage>("tuner");
  const pageRef = useRef<AppPage>("tuner");
  const practiceTrackerRef = useRef(new PracticeTracker());
  const autoFingerTrackerRef = useRef(new AutoFingerTracker());
  const practiceModeRef = useRef<"auto" | "manual">("auto");
  const [practiceMode, setPracticeMode] = useState<"auto" | "manual">("auto");
  const [autoPracticeResult, setAutoPracticeResult] = useState<AutoPracticeResult>({ target: null, reading: null, phase: "listening" });
  const practiceTargetRef = useRef({ stringId: "A" as ViolinStringId, finger: 2 as Finger });
  const [practiceString, setPracticeString] = useState<ViolinStringId>("A");
  const [practiceFinger, setPracticeFinger] = useState<Finger>(2);
  const [practiceReading, setPracticeReading] = useState<PracticeReading | null>(null);
  const resourcesRef = useRef<AudioResources | null>(null);
  const startRequestIdRef = useRef(0);
  const wantedRunningRef = useRef(false);
  const stabilizerRef = useRef(new PitchStabilizer());
  const sessionMetricsRef = useRef<PitchSessionMetrics | null>(null);
  const selectionRef = useRef<StringSelection>("auto");
  const referenceA4Ref = useRef(440);
  const [status, setStatus] = useState<ProbeStatus>("idle");
  const [error, setError] = useState("");
  const [rms, setRms] = useState(0);
  const [peak, setPeak] = useState(0);
  const [sampleRate, setSampleRate] = useState<number | null>(null);
  const [trackSettings, setTrackSettings] = useState<MediaTrackSettings | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pitch, setPitch] = useState<PitchDiagnostic | null>(null);
  const [lastCapturedPitch, setLastCapturedPitch] = useState<(PitchDiagnostic & { capturedAt: string }) | null>(null);
  const [lastSessionSummary, setLastSessionSummary] = useState<PitchSessionSummary | null>(null);
  const [selection, setSelection] = useState<StringSelection>("auto");
  const [referenceA4, setReferenceA4] = useState(() => {
    const saved = Number.parseInt(localStorage.getItem("violin-tuner-reference-a4") ?? "440", 10);
    return saved >= 415 && saved <= 466 ? saved : 440;
  });

  useEffect(() => {
    selectionRef.current = selection;
    stabilizerRef.current.reset();
    setPitch(null);
  }, [selection]);

  useEffect(() => {
    referenceA4Ref.current = referenceA4;
    localStorage.setItem("violin-tuner-reference-a4", String(referenceA4));
    stabilizerRef.current.reset();
    setPitch(null);
    practiceTrackerRef.current.reset();
    setPracticeReading(null);
    autoFingerTrackerRef.current.reset();
    setAutoPracticeResult({ target: null, reading: null, phase: "listening" });
  }, [referenceA4]);

  useEffect(() => {
    practiceTargetRef.current = { stringId: practiceString, finger: practiceFinger };
    practiceTrackerRef.current.reset();
    setPracticeReading(null);
    autoFingerTrackerRef.current.reset();
    setAutoPracticeResult({ target: null, reading: null, phase: "listening" });
  }, [practiceString, practiceFinger]);

  const addLog = useCallback((message: string) => {
    setLogs((current) => [...current.slice(-29), { at: nowLabel(), message }]);
  }, []);

  const releaseAudio = useCallback(async () => {
    const resources = resourcesRef.current;
    resourcesRef.current = null;
    if (!resources) return;
    resources.worklet.port.onmessage = null;
    resources.stream.getTracks().forEach((track) => track.stop());
    resources.source.disconnect();
    resources.worklet.disconnect();
    resources.mute.disconnect();
    if (resources.context.state !== "closed") await resources.context.close().catch(() => undefined);
  }, []);

  const startAudio = useCallback(async () => {
    if (!window.isSecureContext) {
      setError("麦克风要求 HTTPS 安全环境。localhost 仅用于电脑开发。 ");
      setStatus("error");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !("AudioWorkletNode" in window)) {
      setError("当前浏览器缺少 MediaDevices 或 AudioWorklet 支持。");
      setStatus("error");
      return;
    }

    const requestId = ++startRequestIdRef.current;
    wantedRunningRef.current = true;
    stabilizerRef.current.reset();
    practiceTrackerRef.current.reset();
    setPracticeReading(null);
    autoFingerTrackerRef.current.reset();
    setAutoPracticeResult({ target: null, reading: null, phase: "listening" });
    sessionMetricsRef.current = new PitchSessionMetrics();
    setStatus("starting");
    setError("");
    addLog("用户请求启动音频");
    await releaseAudio();

    let context: AudioContext | null = null;
    let stream: MediaStream | null = null;
    try {
      context = new AudioContext({ latencyHint: "interactive" });
      await context.resume();
      addLog(`AudioContext: ${context.state}, ${context.sampleRate} Hz`);

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      if (requestId !== startRequestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        await context.close().catch(() => undefined);
        return;
      }

      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error("浏览器没有返回音频轨道");
      if ("contentHint" in track) track.contentHint = "music";
      track.onended = () => {
        addLog("麦克风轨道 ended");
        setStatus("interrupted");
      };
      track.onmute = () => addLog("麦克风轨道 muted");
      track.onunmute = () => addLog("麦克风轨道 unmuted");

      await context.audioWorklet.addModule("./audio-probe-processor.js");
      if (requestId !== startRequestIdRef.current) {
        stream.getTracks().forEach((item) => item.stop());
        await context.close().catch(() => undefined);
        return;
      }
      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, "audio-probe-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(worklet).connect(mute).connect(context.destination);

      worklet.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
        if (event.data.type === "level") {
          setRms(event.data.rms);
          setPeak(event.data.peak);
          setSampleRate(event.data.sampleRate);
          return;
        }

        const startedAt = performance.now();
        const result = detectPitchYin(event.data.samples, event.data.sampleRate, pageRef.current === "practice" ? { minFrequency: 170, maxFrequency: 1150 } : undefined);
        if (pageRef.current === "practice") {
          if (practiceModeRef.current === "auto") {
            setAutoPracticeResult(autoFingerTrackerRef.current.update(result?.frequencyHz ?? null, result?.confidence ?? 0, practiceTargetRef.current.stringId, referenceA4Ref.current, event.data.capturedAt * 1000));
            return;
          }
          const target = getPracticeTarget(practiceTargetRef.current.stringId, practiceTargetRef.current.finger, referenceA4Ref.current);
          setPracticeReading(practiceTrackerRef.current.update(result?.frequencyHz ?? null, result?.confidence ?? 0, target.targetFrequencyHz, event.data.capturedAt * 1000));
          return;
        }
        const candidate = result
          ? selectionRef.current === "auto"
            ? selectViolinCandidate(result.frequencyHz, referenceA4Ref.current)
            : selectCandidateForString(result.frequencyHz, selectionRef.current, referenceA4Ref.current)
          : null;
        const stable = stabilizerRef.current.update(
          result && candidate
            ? {
                frequencyHz: result.frequencyHz,
                confidence: result.confidence,
                stringId: candidate.string.id,
                correctedFrequencyHz: candidate.correctedFrequencyHz,
                cents: candidate.cents,
                octaveFactor: candidate.octaveFactor,
              }
            : null,
          event.data.capturedAt * 1000,
        );
        const analysisMs = performance.now() - startedAt;
        sessionMetricsRef.current?.record({
          rawValid: Boolean(result && candidate),
          stable,
          analysisMs,
        });
        if (!stable) {
          setPitch(null);
          return;
        }
        const diagnosticPitch = {
          ...stable,
          analysisMs,
        };
        setPitch(diagnosticPitch);
        setLastCapturedPitch({ ...diagnosticPitch, capturedAt: new Date().toISOString() });
      };

      resourcesRef.current = { context, stream, source, worklet, mute };
      const settings = track.getSettings();
      setTrackSettings(settings);
      setSampleRate(context.sampleRate);
      setStatus("running");
      addLog(`麦克风已连接；track=${track.readyState}, muted=${track.muted}`);
    } catch (cause) {
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") await context.close().catch(() => undefined);
      const message = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
      setError(message);
      setStatus("error");
      addLog(`启动失败：${message}`);
    }
  }, [addLog, releaseAudio]);

  const stopAudio = useCallback(async () => {
    startRequestIdRef.current += 1;
    wantedRunningRef.current = false;
    if (sessionMetricsRef.current) {
      setLastSessionSummary(sessionMetricsRef.current.finish());
      sessionMetricsRef.current = null;
    }
    await releaseAudio();
    setRms(0);
    setPeak(0);
    setPitch(null);
    stabilizerRef.current.reset();
    practiceTrackerRef.current.reset();
    setPracticeReading(null);
    autoFingerTrackerRef.current.reset();
    setAutoPracticeResult({ target: null, reading: null, phase: "listening" });
    setStatus("idle");
    addLog("用户停止音频，资源已释放");
  }, [addLog, releaseAudio]);

  const tryResume = useCallback(async () => {
    const resources = resourcesRef.current;
    if (!resources || resources.stream.getAudioTracks().some((track) => track.readyState === "ended")) {
      await startAudio();
      return;
    }
    try {
      await resources.context.resume();
      setStatus(resources.context.state === "running" ? "running" : "interrupted");
      addLog(`恢复请求完成：AudioContext=${resources.context.state}`);
    } catch (cause) {
      setStatus("interrupted");
      addLog(`恢复失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, [addLog, startAudio]);

  useEffect(() => {
    const handleVisibility = () => {
      const contextState = resourcesRef.current?.context.state ?? "none";
      addLog(`visibility=${document.visibilityState}, AudioContext=${contextState}`);
      if (document.visibilityState === "visible" && wantedRunningRef.current && contextState !== "running") {
        setStatus("interrupted");
      }
    };
    const handlePageShow = (event: PageTransitionEvent) => addLog(`pageshow, persisted=${event.persisted}`);
    const handlePageHide = (event: PageTransitionEvent) => addLog(`pagehide, persisted=${event.persisted}`);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("pagehide", handlePageHide);
      void releaseAudio();
    };
  }, [addLog, releaseAudio]);

  const diagnostic = {
    buildVersion: BUILD_VERSION,
    generatedAt: new Date().toISOString(),
    status,
    secureContext: window.isSecureContext,
    standalone: window.matchMedia("(display-mode: standalone)").matches,
    visibility: document.visibilityState,
    userAgent: navigator.userAgent,
    audioContext: resourcesRef.current
      ? {
          state: resourcesRef.current.context.state,
          sampleRate: resourcesRef.current.context.sampleRate,
          baseLatency: resourcesRef.current.context.baseLatency,
          outputLatency: resourcesRef.current.context.outputLatency,
        }
      : null,
    trackSettings,
    lastPitch: lastCapturedPitch,
    lastSessionSummary,
    tuning: { selection, referenceA4 },
    logs,
  };

  const copyDiagnostic = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2));
      addLog("诊断信息已复制");
    } catch {
      addLog("复制失败；浏览器可能未授予剪贴板权限");
    }
  };

  const levelPercent = Math.min(100, Math.max(0, ((20 * Math.log10(Math.max(rms, 0.00001)) + 70) / 70) * 100));
  const cents = pitch?.cents ?? 0;
  const needlePercent = 50 + Math.max(-50, Math.min(50, cents));
  const visualState = pitch?.tuningState ?? "waiting";
  const displayedString = pitch?.stringId ?? (selection === "auto" ? "—" : selection);
  const stateText = pitch
    ? ({ low: "音低", "in-tune": "音准", high: "音高" } as const)[pitch.tuningState]
    : status === "running" ? "请演奏一根空弦" : "准备调音";
  const targetFrequency = selection === "auto"
    ? null
    : getViolinStrings(referenceA4).find((item) => item.id === selection)?.frequencyHz;

  const changePage = async (next: AppPage) => {
    if (next === page) return;
    if (wantedRunningRef.current || resourcesRef.current) await stopAudio();
    pageRef.current = next;
    setPage(next);
    setError("");
  };

  const changePracticeTarget = (stringId: ViolinStringId, finger: Finger) => {
    practiceTargetRef.current = { stringId, finger };
    practiceTrackerRef.current.reset();
    autoFingerTrackerRef.current.reset();
    setPracticeReading(null);
    setAutoPracticeResult({ target: null, reading: null, phase: "listening" });
    setPracticeString(stringId);
    setPracticeFinger(finger);
  };

  const changePracticeMode = (next: "auto" | "manual") => {
    practiceModeRef.current = next;
    practiceTrackerRef.current.reset();
    autoFingerTrackerRef.current.reset();
    setPracticeReading(null);
    setAutoPracticeResult({ target: null, reading: null, phase: "listening" });
    setPracticeMode(next);
  };

  const bottomNav = <BottomNav page={page} onSelect={(next) => void changePage(next)} />;

  if (page === "practice") return <>
    <PracticePage
      stringId={practiceString}
      finger={practiceFinger}
      mode={practiceMode}
      onModeChange={changePracticeMode}
      onStringChange={(stringId) => changePracticeTarget(stringId, practiceFinger)}
      onFingerChange={(finger) => changePracticeTarget(practiceString, finger)}
      referenceA4={referenceA4}
      reading={practiceReading}
      autoResult={autoPracticeResult}
      status={status}
      error={error}
      onStart={() => void startAudio()}
      onStop={() => void stopAudio()}
      onResume={() => void tryResume()}
    />
    {bottomNav}
  </>;

  if (page === "metronome") return <><MetronomePage />{bottomNav}</>;

  return <>
    <main className={`app-shell tuner-${visualState}`}>
      <header className="app-header">
        <div>
          <h1>小提琴调音</h1>
        </div>
        <details className="settings-menu">
          <summary>设置</summary>
          <div className="settings-popover">
            <span>基准音 A4</span>
            <div className="reference-control">
              <button aria-label="降低基准音" onClick={() => setReferenceA4((value) => Math.max(415, value - 1))}>−</button>
              <strong>{referenceA4} Hz</strong>
              <button aria-label="提高基准音" onClick={() => setReferenceA4((value) => Math.min(466, value + 1))}>＋</button>
            </div>
          </div>
        </details>
      </header>

      <nav className="string-selector" aria-label="琴弦选择">
        {(["auto", "G", "D", "A", "E"] as const).map((item) => (
          <button
            key={item}
            className={selection === item ? "selected" : ""}
            aria-pressed={selection === item}
            onClick={() => setSelection(item)}
          >
            {item === "auto" ? "自动" : item}
          </button>
        ))}
      </nav>

      <section className="tuner-stage" aria-live="polite">
        <div className="tuner-stage-body">
        <div className={`state-label ${visualState}`}>
          <span />{stateText}
        </div>
        <div className="note-display">{displayedString}</div>
        <div className="frequency-line">
          {pitch ? `${pitch.correctedFrequencyHz.toFixed(2)} Hz` : targetFrequency ? `目标 ${targetFrequency.toFixed(2)} Hz` : `A4 = ${referenceA4} Hz`}
        </div>
        <div className="cents-display">
          {pitch ? <><strong>{cents >= 0 ? "+" : ""}{cents.toFixed(1)}</strong><span> cents</span></> : <><strong>—</strong><span> cents</span></>}
        </div>

        <div className="tuning-gauge" role="meter" aria-label="音分偏差" aria-valuemin={-50} aria-valuemax={50} aria-valuenow={pitch ? Math.max(-50, Math.min(50, cents)) : 0}>
          <div className="gauge-labels"><span>音低</span><span>音准</span><span>音高</span></div>
          <div className="gauge-track">
            <span className="in-tune-zone" />
            <span className={`gauge-needle ${pitch ? "active" : ""}`} style={{ left: `${needlePercent}%` }} />
          </div>
          <div className="gauge-numbers"><span>−50</span><span>0</span><span>+50</span></div>
        </div>
        </div>
        {error && <p className="error-message">{error}</p>}
        <div className="primary-actions">
        {status === "running" ? (
          <button className="primary stop" onClick={() => void stopAudio()}>停止调音</button>
        ) : status === "interrupted" ? (
          <button className="primary" onClick={() => void tryResume()}>恢复麦克风</button>
        ) : (
          <button className="primary" disabled={status === "starting"} onClick={() => void startAudio()}>
            {status === "starting" ? "正在打开麦克风…" : "开始调音"}
          </button>
        )}
        </div>
      </section>

      <details className="diagnostics">
        <summary>高级诊断 · {BUILD_VERSION}</summary>
        <div className="diagnostic-content">
          <section className="meter-card">
            <div className="meter-heading"><span>实时输入</span><strong>{formatLevel(rms)}</strong></div>
            <div className="meter"><span style={{ width: `${levelPercent}%` }} /></div>
            <div className="level-details"><span>Peak {formatLevel(peak)}</span><span>{sampleRate ? `${sampleRate} Hz` : "等待采样率"}</span></div>
          </section>

          <section className="data-card">
            <h2>设备与音轨</h2>
            <dl>
              <div><dt>安全环境</dt><dd>{window.isSecureContext ? "是" : "否"}</dd></div>
              <div><dt>AudioWorklet</dt><dd>{"AudioWorkletNode" in window ? "支持" : "不支持"}</dd></div>
              <div><dt>声道</dt><dd>{trackSettings?.channelCount ?? "—"}</dd></div>
              <div><dt>采样率</dt><dd>{trackSettings?.sampleRate ?? sampleRate ?? "—"}</dd></div>
              <div><dt>回声消除</dt><dd>{String(trackSettings?.echoCancellation ?? "—")}</dd></div>
              <div><dt>自动增益</dt><dd>{String(trackSettings?.autoGainControl ?? "—")}</dd></div>
            </dl>
          </section>

          {lastSessionSummary && (
            <section className="summary-card">
              <div className="section-heading"><h2>上次测试摘要</h2><span>{lastSessionSummary.durationSeconds.toFixed(1)} 秒</span></div>
              <div className="summary-grid">
                <div><small>有效识别率</small><strong>{(lastSessionSummary.rawValidRate * 100).toFixed(0)}%</strong></div>
                <div><small>弦名切换</small><strong>{lastSessionSummary.stringSwitches}</strong></div>
                <div><small>分析 P95</small><strong>{lastSessionSummary.analysisMs.p95.toFixed(1)} ms</strong></div>
              </div>
              <div className="string-summary">
                {(["G", "D", "A", "E"] as const).map((stringId) => {
                  const summary = lastSessionSummary.strings[stringId];
                  return <div key={stringId}><b>{stringId}</b>{summary ? <span>{summary.samples} 帧 · 置信度 {(summary.medianConfidence * 100).toFixed(0)}% · 波动 {summary.centsStdDev.toFixed(1)}¢</span> : <span>未采集</span>}</div>;
                })}
              </div>
            </section>
          )}

          <section className="log-card">
            <div className="section-heading"><h2>生命周期记录</h2><button className="secondary" onClick={() => void copyDiagnostic()}>复制诊断</button></div>
            <ol>{logs.length === 0 ? <li className="empty">启动后会在这里记录系统事件</li> : [...logs].reverse().map((entry, index) => <li key={`${entry.at}-${index}`}><time>{entry.at}</time>{entry.message}</li>)}</ol>
          </section>
        </div>
      </details>
    </main>
    {bottomNav}
  </>;
}
