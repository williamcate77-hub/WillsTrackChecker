// TypeScript port of the analysis in subcheck.py. Given decoded stereo audio at
// 44.1 kHz, it reproduces the three validated readings (tilt / holds / mono),
// the loud-section detection they are measured over, and adds cheap, honest
// extras (peak, clipped samples, crest factor).

import { BANDPASS_SOS, LOWPASS_SOS, SR } from "./coeffs";
import { sosfiltfilt } from "./filters";
import { welch, type Psd } from "./welch";
import type { Status, TrackMetrics } from "./types";

// Pass marks calibrated from six big-room reference records (measured tilt +2.5
// to +9.7 / median +4, held 28-44 Hz, mono +0.86 to +1.00). See README.
const TILT_OK = 2.5; // below this = light
const TILT_LOW = 1.5; // below this = thin
const HOLD_OK = 45.0; // above this = shallow
const HOLD_HIGH = 55.0; // above this = no real sub
const MONO_CAUTION = 0.93; // below this = a touch wide
const MONO_OK = 0.83; // below this = cancels on a mono sub

// Loud masters routinely sit at 0 dBFS, so a few full-scale samples are normal
// (the references had 85-47,440 of them and all sound great). Judge clipping by
// how much of the track is pinned full-scale, not by any single sample.
const CLIP_LEVEL = 0.9997;
const CLIP_CAUTION_FRAC = 0.01; // 1% of samples pinned = running hot
const CLIP_PROBLEM_FRAC = 0.03; // 3% = genuinely clipped / destroyed

function toFloat64(a: Float32Array): Float64Array {
  const out = new Float64Array(a.length);
  out.set(a);
  return out;
}

/** numpy-style linear-interpolation percentile. */
function percentile(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const idx = (q / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}

/** Seconds where 20-60 Hz energy is within 3 dB of this track's own peak. */
function loudSections(mono: Float64Array): [number, number][] {
  const n = Math.floor(mono.length / SR);
  if (n < 20) return [[0, Math.max(n, 1)]];

  const band = sosfiltfilt(BANDPASS_SOS, mono.subarray(0, n * SR));

  const lvl = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    let sumSq = 0;
    const base = s * SR;
    for (let i = 0; i < SR; i++) {
      const v = band[base + i];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / SR);
    lvl[s] = 20 * Math.log10(Math.max(rms, 1e-12));
  }

  const sorted = Array.from(lvl).sort((a, b) => a - b);
  const thr = percentile(sorted, 95) - 3.0;
  const mask = Array.from(lvl, (v) => v >= thr);

  const runs: [number, number][] = [];
  let start: number | null = null;
  for (let i = 0; i < n; i++) {
    const hot = mask[i];
    if (hot && start === null) start = i;
    if ((!hot || i === n - 1) && start !== null) {
      const end = !hot ? i : i + 1;
      if (end - start >= 8) runs.push([start, end]);
      start = null;
    }
  }
  return runs.length ? runs : [[0, n]];
}

/** Duration-weighted power spectrum across the loud sections. */
function spectrum(mono: Float64Array, runs: [number, number][]): Psd {
  let acc: Float64Array | null = null;
  let f: Float64Array | null = null;
  let total = 0;

  for (const [a, b] of runs) {
    const seg = mono.subarray(a * SR, b * SR);
    if (seg.length < 32768) continue;
    const { f: sf, p } = welch(copy(seg), SR, 32768, 16384);
    const w = b - a;
    if (acc === null) {
      acc = new Float64Array(p.length);
      f = sf;
    }
    for (let i = 0; i < p.length; i++) acc[i] += p[i] * w;
    total += w;
  }

  if (acc === null || f === null) {
    const { f: sf, p } = welch(copy(mono), SR, 8192, 4096);
    return { f: sf, p };
  }
  for (let i = 0; i < acc.length; i++) acc[i] /= total;
  return { f, p: acc };
}

function copy(a: Float64Array): Float64Array {
  const out = new Float64Array(a.length);
  out.set(a);
  return out;
}

/** Trapezoid integration of the PSD over [lo, hi). */
function bandPower(f: Float64Array, p: Float64Array, lo: number, hi: number): number {
  let area = 0;
  let prevF = 0;
  let prevP = 0;
  let have = false;
  for (let i = 0; i < f.length; i++) {
    if (f[i] >= lo && f[i] < hi) {
      if (have) area += (f[i] - prevF) * (p[i] + prevP) * 0.5;
      prevF = f[i];
      prevP = p[i];
      have = true;
    }
  }
  return area + 1e-24;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Pearson correlation of two equal-length arrays. */
function corrcoef(x: Float64Array, y: Float64Array): number {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

export interface AnalyzeInput {
  left: Float32Array;
  right: Float32Array;
}

export function analyze(input: AnalyzeInput): TrackMetrics | null {
  const left = toFloat64(input.left);
  const right = toFloat64(input.right);
  if (left.length < SR * 5) return null;

  const n = left.length;
  const mono = new Float64Array(n);
  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    const l = left[i];
    const r = right[i];
    mono[i] = 0.5 * (l + r);
    const al = Math.abs(l);
    const ar = Math.abs(r);
    if (al > peak) peak = al;
    if (ar > peak) peak = ar;
    if (al >= CLIP_LEVEL) clipped++;
    if (ar >= CLIP_LEVEL) clipped++;
  }

  const runs = loudSections(mono);
  const { f, p } = spectrum(mono, runs);

  const sub =
    bandPower(f, p, 20, 30) +
    bandPower(f, p, 30, 40) +
    bandPower(f, p, 40, 50) +
    bandPower(f, p, 50, 60);
  const mids = bandPower(f, p, 250, 2000);
  const tilt = 10 * Math.log10(sub) - 10 * Math.log10(mids);

  // lowest frequency held before dropping 12 dB under the 45-60 Hz plateau
  const plateauVals: number[] = [];
  for (let i = 0; i < f.length; i++) {
    if (f[i] >= 45 && f[i] <= 60) plateauVals.push(p[i]);
  }
  const plateau = median(plateauVals);
  const threshold = plateau / Math.pow(10, 1.2);
  let holds = 20.0;
  let foundUnder = false;
  let maxUnder = -Infinity;
  for (let i = 0; i < f.length; i++) {
    if (f[i] >= 20 && f[i] <= 60 && p[i] < threshold) {
      foundUnder = true;
      if (f[i] > maxUnder) maxUnder = f[i];
    }
  }
  if (foundUnder) holds = maxUnder;

  // correlation only where the bassline runs (avoids false phase flags on
  // quiet stereo intros)
  const corrs: number[] = [];
  const weights: number[] = [];
  let loudSampleSum = 0;
  let loudSqSum = 0;
  let loudPeak = 0;
  for (const [a, b] of runs) {
    const lSeg = left.subarray(a * SR, b * SR);
    const rSeg = right.subarray(a * SR, b * SR);
    // accumulate loud-section stats for crest factor
    const mSeg = mono.subarray(a * SR, b * SR);
    for (let i = 0; i < mSeg.length; i++) {
      const v = mSeg[i];
      loudSqSum += v * v;
      loudSampleSum++;
      const av = Math.abs(v);
      if (av > loudPeak) loudPeak = av;
    }
    if (lSeg.length < SR * 5) continue;
    const lf = sosfiltfilt(LOWPASS_SOS, copy(lSeg));
    const rf = sosfiltfilt(LOWPASS_SOS, copy(rSeg));
    const c = corrcoef(lf, rf);
    if (Number.isFinite(c)) {
      corrs.push(c);
      weights.push(b - a);
    }
  }

  let mono_corr = NaN;
  if (corrs.length) {
    let num = 0;
    let den = 0;
    for (let i = 0; i < corrs.length; i++) {
      num += corrs[i] * weights[i];
      den += weights[i];
    }
    mono_corr = num / den;
  }

  const loudRms = loudSampleSum ? Math.sqrt(loudSqSum / loudSampleSum) : 1e-12;
  const crest =
    20 * Math.log10(Math.max(loudPeak, 1e-12)) - 20 * Math.log10(Math.max(loudRms, 1e-12));
  const peakDb = 20 * Math.log10(Math.max(peak, 1e-12));
  const loudSecs = runs.reduce((acc, [a, b]) => acc + (b - a), 0);
  const clippedFrac = clipped / (2 * n);

  return { tilt, holds, mono: mono_corr, peakDb, clipped, clippedFrac, crest, loudSecs };
}

export function verdict(m: TrackMetrics): {
  status: Status;
  notes: string[];
  verdict: string;
  action: string;
} {
  const notes: string[] = [];
  // Candidate actions, most severe first; the first one added wins.
  const actions: string[] = [];
  let status: Status = "ok";
  const bump = (s: Status) => {
    if (s === "problem") status = "problem";
    else if (s === "caution" && status === "ok") status = "caution";
  };

  if (m.clippedFrac > CLIP_PROBLEM_FRAC) {
    notes.push(`clipped at source (${m.clipped.toLocaleString()} samples)`);
    actions.push("Heavily clipped in the file itself — a limiter can't undo it. Find a clean copy.");
    bump("problem");
  } else if (m.clippedFrac > CLIP_CAUTION_FRAC) {
    notes.push("running hot");
    actions.push("Sits right on the ceiling. Fine on most rigs, but leave a touch of headroom if you can.");
    bump("caution");
  }
  if (m.mono < MONO_OK) {
    const sign = m.mono >= 0 ? "+" : "";
    notes.push(`phase issue below 100 Hz (${sign}${m.mono.toFixed(2)})`);
    actions.push("Sum to mono below 100 Hz or replace it — the sub stacks will cancel.");
    bump("problem");
  } else if (m.mono < MONO_CAUTION) {
    const sign = m.mono >= 0 ? "+" : "";
    notes.push(`bass a touch wide (${sign}${m.mono.toFixed(2)})`);
    actions.push("Low end is a little wide. Most of it reaches the subs, but keep an eye on it.");
    bump("caution");
  }
  if (m.tilt < TILT_LOW) {
    notes.push("thin, needs mid cut");
    actions.push("Thin low end. Cut 2-3 dB around 300-800 Hz, or swap the file.");
    bump("problem");
  } else if (m.tilt < TILT_OK) {
    notes.push("light");
    actions.push("A touch light. Trim ~1-2 dB of mids so it sits with the heavier tracks.");
    bump("caution");
  }
  if (m.holds > HOLD_HIGH) {
    notes.push(`no sub under ${m.holds.toFixed(0)} Hz`);
    actions.push(`Almost no energy under ${m.holds.toFixed(0)} Hz — it'll feel light on a sub-heavy rig.`);
    bump("problem");
  } else if (m.holds > HOLD_OK) {
    notes.push("shallow");
    actions.push("Sub rolls off early. Fine on tops, a bit shallow on a big system.");
    bump("caution");
  }

  const text = notes.length ? notes.join(", ") : "fills the system";
  const action = actions.length ? actions[0] : "Good to go.";
  return { status, notes, verdict: text, action };
}
