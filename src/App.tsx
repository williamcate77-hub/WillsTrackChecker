import { useCallback, useMemo, useRef, useState } from "react";
import {
  assess,
  READING_INFO,
  type Gauge as GaugeData,
  type Reading,
  type ReadingInfo,
} from "./assess";
import { filesFromDrop } from "./files";
import { downloadCsv, summarise, toCsv } from "./setSummary";
import { useAnalyzer } from "./useAnalyzer";
import type { Status, TrackResult } from "./dsp/types";

const STATUS_LABEL: Record<Status, string> = {
  ok: "ready",
  caution: "worth a look",
  problem: "problem",
};

const STATUS_MARK: Record<Status, string> = {
  ok: "✓",
  caution: "!",
  problem: "✕",
};

const READING_BY_CODE = Object.fromEntries(READING_INFO.map((r) => [r.code, r])) as Record<
  ReadingInfo["code"],
  ReadingInfo
>;

export function App() {
  const { phase, results, failures, progress, run, reset } = useAnalyzer();
  const summary = useMemo(() => summarise(results), [results]);
  const [copied, setCopied] = useState(false);

  const onFiles = useCallback((files: File[]) => void run(files), [run]);

  const copyTrimSheet = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(toCsv(results));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the download button still works */
    }
  }, [results]);

  const hasResults = results.length > 0 || failures.length > 0;

  return (
    <div className="page">
      <header className="hero">
        <div className="wordmark">
          <span className="dot" aria-hidden />
          Will&apos;s Track Checker
        </div>
        <h1>Will it survive the big system?</h1>
        <p className="lede">
          Drop a folder of tracks. Find out which ones fall apart on a proper rig —
          thin low end, no sub, phase that cancels on the stacks, clipped at source —
          before you leave the house, not at 1am in front of a room.
        </p>
        <p className="privacy">
          <span className="lock" aria-hidden />
          Nothing is uploaded. Every track is read on your own machine.
        </p>
      </header>

      <DropZone onFiles={onFiles} busy={phase === "working"} compact={hasResults} />

      {phase === "working" && (
        <div className="progress">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
          <div className="progress-label">
            Reading {progress.done + 1} of {progress.total}
            {progress.current ? ` — ${progress.current}` : ""}
          </div>
        </div>
      )}

      {results.length > 0 && (
        <SummaryCard
          summary={summary}
          onCopy={copyTrimSheet}
          onDownload={() => downloadCsv(results)}
          copied={copied}
        />
      )}

      {results.length > 0 && (
        <>
          <ReadingsKey />
          <section className="results">
            {results.map((r, i) => (
              <TrackCard key={`${r.name}-${i}`} r={r} />
            ))}
          </section>
        </>
      )}

      {failures.length > 0 && (
        <section className="failures">
          <h3>Couldn&apos;t read {failures.length}</h3>
          <ul>
            {failures.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span className="fail-name">{f.name}</span> — {f.error}
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasResults && phase === "done" && (
        <div className="reset-row">
          <button className="btn ghost" onClick={reset}>
            Check another set
          </button>
        </div>
      )}

      {!hasResults && phase === "idle" && <HowItReads />}

      <footer className="foot">
        Seven of the checks come from the same engine used on known-good club records.
        The three that matter most — sub balance, sub extension and mono behaviour —
        are measured only over the sections where the kick and bassline are running.
        No account, no upload, no cost.
      </footer>
    </div>
  );
}

function DropZone({
  onFiles,
  busy,
  compact,
}: {
  onFiles: (files: File[]) => void;
  busy: boolean;
  compact: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);

  const setFolderAttrs = useCallback((el: HTMLInputElement | null) => {
    folderInput.current = el;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (busy) return;
      const files = await filesFromDrop(e.dataTransfer);
      onFiles(files);
    },
    [busy, onFiles],
  );

  return (
    <div
      className={`dropzone${dragging ? " dragging" : ""}${compact ? " compact" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="dz-icon" aria-hidden>
        ↓
      </div>
      <div className="dz-title">
        {compact ? "Drop another folder or crate" : "Drop a folder, crate or a pile of tracks here"}
      </div>
      {!compact && (
        <div className="dz-sub">wav · aiff · flac · mp3 · m4a · aac · ogg</div>
      )}
      <div className="dz-buttons">
        <button className="btn" onClick={() => fileInput.current?.click()} disabled={busy}>
          Choose files
        </button>
        <button className="btn ghost" onClick={() => folderInput.current?.click()} disabled={busy}>
          Choose folder
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="audio/*,.wav,.aiff,.aif,.flac,.mp3,.m4a,.aac,.ogg,.wv,.opus"
        multiple
        hidden
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <input
        ref={setFolderAttrs}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </div>
  );
}

function SummaryCard({
  summary,
  onCopy,
  onDownload,
  copied,
}: {
  summary: ReturnType<typeof summarise>;
  onCopy: () => void;
  onDownload: () => void;
  copied: boolean;
}) {
  return (
    <section className="summary">
      <div className="summary-top">
        <div>
          <div className="summary-headline">
            {summary.count} track{summary.count === 1 ? "" : "s"} ·{" "}
            <span className={summary.steppy ? "spread-bad" : "spread-ok"}>
              {summary.spread.toFixed(1)} dB spread
            </span>
          </div>
          <div className="summary-counts">
            <Pill status="ok" n={summary.counts.ok} />
            <Pill status="caution" n={summary.counts.caution} />
            <Pill status="problem" n={summary.counts.problem} />
          </div>
        </div>
        <div className="summary-actions">
          <button className="btn" onClick={onCopy}>
            {copied ? "Copied ✓" : "Copy trim sheet"}
          </button>
          <button className="btn ghost" onClick={onDownload}>
            Download CSV
          </button>
        </div>
      </div>

      {summary.lightest && summary.heaviest && summary.count > 1 && (
        <div className="summary-ends">
          <div>
            <span className="end-label">Lightest</span>
            <span className="end-name">{summary.lightest.name}</span>
            <span className="end-val">{summary.lightest.tilt.toFixed(1)} dB</span>
          </div>
          <div>
            <span className="end-label">Heaviest</span>
            <span className="end-name">{summary.heaviest.name}</span>
            <span className="end-val">{summary.heaviest.tilt.toFixed(1)} dB</span>
          </div>
        </div>
      )}

      {summary.steppy && (
        <p className="summary-warn">
          More than 3 dB apart across the set — that&apos;s an audible step between tracks.
          A mid trim on the light ones will even it out.
        </p>
      )}
    </section>
  );
}

function Pill({ status, n }: { status: Status; n: number }) {
  if (n === 0) return null;
  return (
    <span className={`pill pill-${status}`}>
      {n} {STATUS_LABEL[status]}
    </span>
  );
}

function TrackCard({ r }: { r: TrackResult }) {
  const [open, setOpen] = useState(false);
  const a = useMemo(() => assess(r, r.status, r.action), [r]);

  return (
    <article className={`track track-${r.status}${open ? " open" : ""}`}>
      <button className="track-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={`verdict-badge vb-${r.status}`}>
          <span className="vb-mark">{STATUS_MARK[r.status]}</span>
          {a.headline}
        </span>
        <span className="track-head-main">
          <span className="track-name" title={r.name}>
            {r.name}
          </span>
          <span className="track-summary">{r.status === "ok" ? a.summary : r.action}</span>
        </span>
        <span className="track-chips">
          {a.readings.map((rd) => (
            <span
              key={rd.key}
              className={`chip chip-${rd.status}`}
              title={READING_BY_CODE[rd.key].plain}
            >
              <span className="chip-label">{rd.metric}</span>
              <span className="chip-value">{rd.value}</span>
            </span>
          ))}
        </span>
        <span className={`chev${open ? " up" : ""}`} aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="track-detail">
          <p className="detail-hint">What each reading means and how this track did:</p>
          {a.readings.map((rd) => (
            <ReadingRow key={rd.key} rd={rd} />
          ))}
        </div>
      )}
    </article>
  );
}

function ReadingRow({ rd }: { rd: Reading }) {
  return (
    <div className={`reading reading-${rd.status}`}>
      <div className="reading-top">
        <span className="reading-label">{rd.label}</span>
        <span className={`reading-verdict rv-${rd.status}`}>
          {STATUS_MARK[rd.status]} {rd.value}
        </span>
      </div>
      <Gauge g={rd.gauge} status={rd.status} />
      <p className="reading-result">{rd.reading}</p>
      <p className="reading-concept">{rd.concept}</p>
    </div>
  );
}

function Gauge({ g, status }: { g: GaugeData; status: Status }) {
  const span = g.max - g.min || 1;
  const clampPct = (v: number) => Math.max(0, Math.min(100, ((v - g.min) / span) * 100));
  const goodLeft = clampPct(g.goodMin);
  const goodWidth = clampPct(g.goodMax) - goodLeft;
  const markLeft = clampPct(g.value);
  return (
    <div className="gauge" aria-hidden>
      <div className="gauge-track">
        <div className="gauge-good" style={{ left: `${goodLeft}%`, width: `${goodWidth}%` }} />
        <div className={`gauge-mark gm-${status}`} style={{ left: `${markLeft}%` }} />
      </div>
      <div className="gauge-ends">
        <span>{g.min}</span>
        <span className="gauge-good-label">good</span>
        <span>{g.max}</span>
      </div>
    </div>
  );
}

function GlossaryGrid() {
  return (
    <div className="legend-grid">
      {READING_INFO.map((info) => (
        <div key={info.code}>
          <h3>
            {info.code}
            {info.unit ? <span className="legend-unit"> {info.unit}</span> : null}
          </h3>
          <p>{info.plain}</p>
          <p className="legend-good">{info.good}</p>
        </div>
      ))}
    </div>
  );
}

// Shown on the landing screen, before any track is dropped.
function HowItReads() {
  return (
    <section className="legend">
      <h2>What it reads</h2>
      <GlossaryGrid />
      <p className="legend-ref">
        Calibrated against six big-room reference records — they measured tilt +2.5
        to +9.7 (around +4), held to 28–44 Hz, and mono +0.86 to +1.00. Every track
        you drop is scored against those marks.
      </p>
    </section>
  );
}

// A collapsible version of the glossary that stays available while you're
// looking at results, so the meaning of each reading is always one tap away.
function ReadingsKey() {
  const [open, setOpen] = useState(false);
  return (
    <section className={`key${open ? " open" : ""}`}>
      <button className="key-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>What do tilt · holds · mono · peak mean?</span>
        <span className={`chev${open ? " up" : ""}`} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="key-body">
          <GlossaryGrid />
        </div>
      )}
    </section>
  );
}
