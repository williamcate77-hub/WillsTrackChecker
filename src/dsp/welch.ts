import { fft } from "./fft";

// Welch's power spectral density, matching scipy.signal.welch defaults:
// periodic Hann window, constant detrend, density scaling, one-sided, mean
// average.

function hannPeriodic(m: number): Float64Array {
  const w = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / m);
  }
  return w;
}

export interface Psd {
  f: Float64Array;
  p: Float64Array;
}

export function welch(
  x: Float64Array,
  fs: number,
  nperseg: number,
  noverlap: number,
): Psd {
  const n = x.length;
  const nfreq = nperseg / 2 + 1;
  const f = new Float64Array(nfreq);
  for (let k = 0; k < nfreq; k++) f[k] = (k * fs) / nperseg;

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
    // detrend constant: subtract segment mean
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
      // one-sided: double everything except DC and Nyquist
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
