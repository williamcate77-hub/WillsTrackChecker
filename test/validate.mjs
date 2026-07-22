// test/validate.ts
import { readFileSync } from "node:fs";

// src/dsp/coeffs.ts
var SR = 44100;
var BANDPASS_SOS = [
  [6544191121300629e-26, 13088382242601258e-26, 6544191121300629e-26, 1, -1.993400452583304, 0.9934409042688581],
  [1, 2, 1, 1, -1.9960434169195167, 0.9960580086702132],
  [1, -2, 1, 1, -1.9967136625356956, 0.9967824676889573],
  [1, -2, 1, 1, -1.9988529277989535, 0.9988615329317091]
];
var LOWPASS_SOS = [
  [2528074615822979e-24, 5056149231645958e-24, 2528074615822979e-24, 1, -1.9738164386508996, 0.9740167917470341],
  [1, 2, 1, 1, -1.9889529784426025, 0.9891548679797925]
];

// src/dsp/filters.ts
function lfilterZiBiquad(b, a) {
  const b0 = b[0], b1 = b[1], b2 = b[2];
  const a1 = a[1], a2 = a[2];
  const m00 = 1 + a1, m01 = -1;
  const m10 = a2, m11 = 1;
  const r0 = b1 - a1 * b0;
  const r1 = b2 - a2 * b0;
  const det = m00 * m11 - m01 * m10;
  const zi0 = (r0 * m11 - m01 * r1) / det;
  const zi1 = (m00 * r1 - r0 * m10) / det;
  return [zi0, zi1];
}
function sosfiltZi(sos) {
  const zi = [];
  let scale = 1;
  for (const s of sos) {
    const b = [s[0], s[1], s[2]];
    const a = [s[3], s[4], s[5]];
    const z = lfilterZiBiquad(b, a);
    zi.push([scale * z[0], scale * z[1]]);
    const bSum = b[0] + b[1] + b[2];
    const aSum = a[0] + a[1] + a[2];
    scale *= bSum / aSum;
  }
  return zi;
}
function sosfilt(sos, x, zi) {
  const n = x.length;
  const out = new Float64Array(n);
  const nsec = sos.length;
  const z1 = new Float64Array(nsec);
  const z2 = new Float64Array(nsec);
  for (let s = 0; s < nsec; s++) {
    z1[s] = zi[s][0];
    z2[s] = zi[s][1];
  }
  for (let i = 0; i < n; i++) {
    let v = x[i];
    for (let s = 0; s < nsec; s++) {
      const b0 = sos[s][0], b1 = sos[s][1], b2 = sos[s][2];
      const a1 = sos[s][4], a2 = sos[s][5];
      const y = b0 * v + z1[s];
      z1[s] = b1 * v + z2[s] - a1 * y;
      z2[s] = b2 * v - a2 * y;
      v = y;
    }
    out[i] = v;
  }
  return out;
}
function defaultPadlen(sos) {
  return 3 * (2 * sos.length + 1);
}
function oddExt(x, ext) {
  const n = x.length;
  const out = new Float64Array(n + 2 * ext);
  const x0 = x[0];
  const xLast = x[n - 1];
  for (let i = 0; i < ext; i++) {
    out[i] = 2 * x0 - x[ext - i];
    out[n + ext + i] = 2 * xLast - x[n - 2 - i];
  }
  out.set(x, ext);
  return out;
}
function reversed(x) {
  const n = x.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = x[n - 1 - i];
  return out;
}
function scaledZi(zi, factor) {
  return zi.map(([a, b]) => [a * factor, b * factor]);
}
function sosfiltfilt(sos, x) {
  const n = x.length;
  const edge = Math.min(defaultPadlen(sos), n - 1);
  const ext = oddExt(x, edge);
  const zi = sosfiltZi(sos);
  let y = sosfilt(sos, ext, scaledZi(zi, ext[0]));
  y = reversed(y);
  y = sosfilt(sos, y, scaledZi(zi, y[0]));
  y = reversed(y);
  return y.subarray(edge, edge + n);
}

// src/dsp/fft.ts
function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = -2 * Math.PI / len;
    const wReal = Math.cos(ang);
    const wImag = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curReal = 1;
      let curImag = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b] * curReal - im[b] * curImag;
        const ti = re[b] * curImag + im[b] * curReal;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nextReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
      }
    }
  }
}

// src/dsp/welch.ts
function hannPeriodic(m2) {
  const w = new Float64Array(m2);
  for (let i = 0; i < m2; i++) {
    w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / m2);
  }
  return w;
}
function welch(x, fs, nperseg, noverlap) {
  const n = x.length;
  const nfreq = nperseg / 2 + 1;
  const f = new Float64Array(nfreq);
  for (let k = 0; k < nfreq; k++) f[k] = k * fs / nperseg;
  const p = new Float64Array(nfreq);
  if (n < nperseg) return { f, p };
  const win = hannPeriodic(nperseg);
  let winSumSq = 0;
  for (let i = 0; i < nperseg; i++) winSumSq += win[i] * win[i];
  const scale = 1 / (fs * winSumSq);
  const step = nperseg - noverlap;
  const re = new Float64Array(nperseg);
  const im = new Float64Array(nperseg);
  let nseg = 0;
  for (let start = 0; start + nperseg <= n; start += step) {
    let mean = 0;
    for (let i = 0; i < nperseg; i++) mean += x[start + i];
    mean /= nperseg;
    for (let i = 0; i < nperseg; i++) {
      re[i] = (x[start + i] - mean) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < nfreq; k++) {
      let pk = (re[k] * re[k] + im[k] * im[k]) * scale;
      if (k !== 0 && k !== nperseg / 2) pk *= 2;
      p[k] += pk;
    }
    nseg++;
  }
  if (nseg > 0) {
    for (let k = 0; k < nfreq; k++) p[k] /= nseg;
  }
  return { f, p };
}

// src/dsp/analyze.ts
var CLIP_LEVEL = 0.9997;
function toFloat64(a) {
  const out = new Float64Array(a.length);
  out.set(a);
  return out;
}
function percentile(sorted, q) {
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const idx = q / 100 * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}
function loudSections(mono) {
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
  const thr = percentile(sorted, 95) - 3;
  const mask = Array.from(lvl, (v) => v >= thr);
  const runs = [];
  let start = null;
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
function spectrum(mono, runs) {
  let acc = null;
  let f = null;
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
function copy(a) {
  const out = new Float64Array(a.length);
  out.set(a);
  return out;
}
function bandPower(f, p, lo, hi) {
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
function median(values) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function corrcoef(x, y) {
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
function analyze(input) {
  const left2 = toFloat64(input.left);
  const right2 = toFloat64(input.right);
  if (left2.length < SR * 5) return null;
  const n = left2.length;
  const mono = new Float64Array(n);
  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    const l = left2[i];
    const r = right2[i];
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
  const sub = bandPower(f, p, 20, 30) + bandPower(f, p, 30, 40) + bandPower(f, p, 40, 50) + bandPower(f, p, 50, 60);
  const mids = bandPower(f, p, 250, 2e3);
  const tilt = 10 * Math.log10(sub) - 10 * Math.log10(mids);
  const plateauVals = [];
  for (let i = 0; i < f.length; i++) {
    if (f[i] >= 45 && f[i] <= 60) plateauVals.push(p[i]);
  }
  const plateau = median(plateauVals);
  const threshold = plateau / Math.pow(10, 1.2);
  let holds = 20;
  let foundUnder = false;
  let maxUnder = -Infinity;
  for (let i = 0; i < f.length; i++) {
    if (f[i] >= 20 && f[i] <= 60 && p[i] < threshold) {
      foundUnder = true;
      if (f[i] > maxUnder) maxUnder = f[i];
    }
  }
  if (foundUnder) holds = maxUnder;
  const corrs = [];
  const weights = [];
  let loudSampleSum = 0;
  let loudSqSum = 0;
  let loudPeak = 0;
  for (const [a, b] of runs) {
    const lSeg = left2.subarray(a * SR, b * SR);
    const rSeg = right2.subarray(a * SR, b * SR);
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
  const crest = 20 * Math.log10(Math.max(loudPeak, 1e-12)) - 20 * Math.log10(Math.max(loudRms, 1e-12));
  const peakDb = 20 * Math.log10(Math.max(peak, 1e-12));
  const loudSecs = runs.reduce((acc, [a, b]) => acc + (b - a), 0);
  return { tilt, holds, mono: mono_corr, peakDb, clipped, crest, loudSecs };
}

// test/validate.ts
var GOLDEN = { tilt: 7.691174, holds: 59.216309, mono: 1 };
var path = new URL("./golden.wav", import.meta.url);
var buf = readFileSync(path);
function readWav(b) {
  let off = 12;
  let sr = 44100;
  let channels = 2;
  let bits = 16;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      channels = b.readUInt16LE(body + 2);
      sr = b.readUInt32LE(body + 4);
      bits = b.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataOff = body;
      dataLen = size;
      break;
    }
    off = body + size + size % 2;
  }
  if (dataOff < 0 || bits !== 16) throw new Error("unexpected wav format");
  const frames = dataLen / (channels * 2);
  const left2 = new Float32Array(frames);
  const right2 = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const base = dataOff + i * channels * 2;
    const l = b.readInt16LE(base);
    const r = channels > 1 ? b.readInt16LE(base + 2) : l;
    left2[i] = l / 32768;
    right2[i] = r / 32768;
  }
  return { left: left2, right: right2, sr };
}
var { left, right } = readWav(buf);
var m = analyze({ left, right });
if (!m) throw new Error("analyze returned null");
function check(name, got, want, tol) {
  const diff = Math.abs(got - want);
  const ok = diff <= tol;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(6)} got ${got.toFixed(6)}  want ${want.toFixed(6)}  (|\u0394| ${diff.toExponential(2)}, tol ${tol})`
  );
  return ok;
}
var allOk = true;
allOk = check("tilt", m.tilt, GOLDEN.tilt, 0.01) && allOk;
allOk = check("holds", m.holds, GOLDEN.holds, 0.5) && allOk;
allOk = check("mono", m.mono, GOLDEN.mono, 1e-3) && allOk;
console.log(
  `
extras: peak ${m.peakDb.toFixed(2)} dBFS, clipped ${m.clipped}, crest ${m.crest.toFixed(2)} dB, loud ${m.loudSecs}s`
);
if (!allOk) {
  console.error("\nVALIDATION FAILED");
  process.exit(1);
}
console.log("\nVALIDATION PASSED \u2014 TS engine matches the scipy reference.");
