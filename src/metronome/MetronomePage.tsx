import { useEffect, useRef, useState } from "react";
import { clampBpm, MAX_BPM, MetronomeEngine, MIN_BPM, tempoFromTaps, type Meter } from "./metronome";

type Settings = { bpm: number; meter: Meter; accentFirstBeat: boolean };
const STORAGE_KEY = "violin-metronome-settings-v1";

function initialSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Settings> | null;
    return {
      bpm: typeof saved?.bpm === "number" && Number.isFinite(saved.bpm) ? clampBpm(saved.bpm) : 80,
      meter: [2, 3, 4, 6].includes(saved?.meter ?? 0) ? saved!.meter as Meter : 4,
      accentFirstBeat: typeof saved?.accentFirstBeat === "boolean" ? saved.accentFirstBeat : true,
    };
  } catch {
    return { bpm: 80, meter: 4, accentFirstBeat: true };
  }
}

export function MetronomePage() {
  const [settings, setSettings] = useState(initialSettings);
  const [playing, setPlaying] = useState(false);
  const [beatInBar, setBeatInBar] = useState(-1);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const engineRef = useRef(new MetronomeEngine());
  const needleRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const tapsRef = useRef<number[]>([]);
  const runIdRef = useRef(0);

  useEffect(() => {
    engineRef.current.setSettings(settings.bpm, settings.meter, settings.accentFirstBeat);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      runIdRef.current += 1;
      engineRef.current.stop();
      setPlaying(false);
      setBeatInBar(-1);
      setMessage("已暂停；返回后轻触开始");
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      runIdRef.current += 1;
      engineRef.current.stop();
    };
  }, []);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      const visual = engineRef.current.getVisual();
      if (!visual) {
        engineRef.current.stop();
        setPlaying(false);
        setBeatInBar(-1);
        setMessage("音频已中断；轻触开始恢复");
        return;
      }
      const angle = reduceMotion ? 0 : visual.angle;
      if (needleRef.current) needleRef.current.style.transform = `translateX(-50%) rotate(${angle}deg)`;
      if (ghostRef.current) ghostRef.current.style.transform = `translateX(-50%) rotate(${-angle}deg)`;
      setBeatInBar((current) => current === visual.beatInBar ? current : visual.beatInBar);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const changeBpm = (amount: number) => setSettings((current) => ({ ...current, bpm: clampBpm(current.bpm + amount) }));
  const stop = () => {
    runIdRef.current += 1;
    engineRef.current.stop();
    setPlaying(false);
    setBeatInBar(-1);
    setMessage("");
    if (needleRef.current) needleRef.current.style.transform = "translateX(-50%) rotate(0deg)";
    if (ghostRef.current) ghostRef.current.style.transform = "translateX(-50%) rotate(0deg)";
  };
  const start = async () => {
    const runId = ++runIdRef.current;
    setError("");
    setMessage("");
    try {
      engineRef.current.setSettings(settings.bpm, settings.meter, settings.accentFirstBeat);
      await engineRef.current.start();
      if (runId !== runIdRef.current) return;
      setPlaying(true);
    } catch (cause) {
      if (runId !== runIdRef.current) return;
      setError(cause instanceof Error ? cause.message : "无法启动节拍音频");
      setPlaying(false);
    }
  };
  const tapTempo = () => {
    const now = performance.now();
    tapsRef.current = tapsRef.current.filter((time) => now - time <= 2000).slice(-5);
    tapsRef.current.push(now);
    const tappedBpm = tempoFromTaps(tapsRef.current);
    if (tappedBpm !== null) {
      setSettings((current) => ({ ...current, bpm: tappedBpm }));
      setMessage(`已设为 ${tappedBpm} BPM`);
    } else setMessage("按想要的速度再轻拍一次");
  };

  return (
    <main className="app-shell metronome-shell">
      <header className="practice-header">
        <span className="practice-header-title">节拍器</span>
      </header>

      <section className="metronome-card" aria-label="节拍器控制">
        <div className="metro-tempo-readout"><strong>{settings.bpm}</strong><span>BPM</span></div>

        <div className="pendulum-area" aria-label={playing ? `第 ${beatInBar + 1} 拍，指针摆动中` : "节拍指针已停止"}>
          <svg className="pendulum-arc" viewBox="0 0 340 260" aria-hidden="true">
            <path d="M 56 105 Q 170 -30 284 105" fill="none" stroke="#dde5ef" strokeWidth="3" strokeLinecap="round" />
            <circle cx="56" cy="105" r="4" /><circle cx="112" cy="51" r="4" /><circle cx="170" cy="31" r="4" /><circle cx="228" cy="51" r="4" /><circle cx="284" cy="105" r="4" />
          </svg>
          <div ref={ghostRef} className="pendulum-needle ghost" aria-hidden="true" />
          <div ref={needleRef} className="pendulum-needle" aria-hidden="true"><i /></div>
          <div className="pendulum-pivot" aria-hidden="true" />
        </div>
        <div className="metro-beats" aria-label={`${settings.meter} 拍中的第 ${beatInBar < 0 ? "—" : beatInBar + 1} 拍`}>
          {Array.from({ length: settings.meter }, (_, index) => <span key={index} className={playing && index === beatInBar ? "active" : ""} />)}
        </div>

        <div className="metro-adjust" role="group" aria-label="速度调节">
          <button onClick={() => changeBpm(-1)} disabled={settings.bpm <= MIN_BPM} aria-label="每分钟减一拍">−</button>
          <strong>{settings.bpm}</strong>
          <button onClick={() => changeBpm(1)} disabled={settings.bpm >= MAX_BPM} aria-label="每分钟加一拍">＋</button>
        </div>

        <div className="metro-meter" role="group" aria-label="选择拍号">
          {([2, 3, 4, 6] as const).map((meter) => <button key={meter} className={settings.meter === meter ? "selected" : ""} aria-label={meter === 6 ? "6/8，每个八分音符一拍" : undefined} aria-pressed={settings.meter === meter} onClick={() => { setSettings((current) => ({ ...current, meter })); setBeatInBar(-1); }}>{meter}/{meter === 6 ? 8 : 4}</button>)}
        </div>
        <div className="metro-options">
          <button className="metro-tap" onClick={tapTempo}><span aria-hidden="true">◎</span> 轻拍测速</button>
          <button className="metro-accent" aria-pressed={settings.accentFirstBeat} onClick={() => setSettings((current) => ({ ...current, accentFirstBeat: !current.accentFirstBeat }))}>
            <span>强调首拍</span><i className={settings.accentFirstBeat ? "on" : ""} aria-hidden="true" />
          </button>
        </div>
        {(message || error) && <p className={`metro-message ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{error || message}</p>}
        <button className={`primary metro-start ${playing ? "stop" : ""}`} onClick={() => playing ? stop() : void start()}>{playing ? "停止" : "开始"}</button>
      </section>
    </main>
  );
}
