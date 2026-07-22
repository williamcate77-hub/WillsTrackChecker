// Zero-phase SOS filtering, a faithful port of scipy.signal.sosfiltfilt.
//
// The measurements this app makes are only meaningful if the browser reproduces
// what subcheck.py measured, so this mirrors scipy's algorithm exactly:
// odd-extension padding + steady-state initial conditions (sosfilt_zi) applied
// forward and backward. Anything looser leaves long low-frequency transients on
// the edges of the narrow 20-60 Hz band and shifts the numbers.

/**
 * Steady-state initial conditions for one biquad, port of
 * scipy.signal.lfilter_zi for a length-3 b / a. Returns [zi0, zi1].
 */
function lfilterZiBiquad(b: number[], a: number[]): [number, number] {
  const b0 = b[0], b1 = b[1], b2 = b[2];
  const a1 = a[1], a2 = a[2];
  // Solve (I - A^T) zi = B, where
  //   I - A^T = [[1 + a1, -1], [a2, 1]]
  //   B       = [b1 - a1*b0, b2 - a2*b0]
  const m00 = 1 + a1, m01 = -1;
  const m10 = a2, m11 = 1;
  const r0 = b1 - a1 * b0;
  const r1 = b2 - a2 * b0;
  const det = m00 * m11 - m01 * m10;
  const zi0 = (r0 * m11 - m01 * r1) / det;
  const zi1 = (m00 * r1 - r0 * m10) / det;
  return [zi0, zi1];
}

/** Per-section steady-state initial conditions, port of scipy sosfilt_zi. */
export function sosfiltZi(sos: number[][]): [number, number][] {
  const zi: [number, number][] = [];
  let scale = 1.0;
  for (const s of sos) {
    const b = [s[0], s[1], s[2]];
    const a = [s[3], s[4], s[5]];
    const z = lfilterZiBiquad(b, a);
    zi.push([scale * z[0], scale * z[1]]);
    const bSum = b[0] + b[1] + b[2];
    const aSum = a[0] + a[1] + a[2];
    scale *= bSum / aSum; // DC gain of this section
  }
  return zi;
}

/**
 * Forward SOS filter (transposed direct form II) with per-section initial
 * conditions. `zi` is scaled by the caller (scipy multiplies zi by x[0]).
 */
function sosfilt(sos: number[][], x: Float64Array, zi: [number, number][]): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  const nsec = sos.length;
  // Mutable per-section state.
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

/** scipy default padlen for sosfiltfilt (no trailing-zero sections here). */
function defaultPadlen(sos: number[][]): number {
  return 3 * (2 * sos.length + 1);
}

/** Odd extension of `x` by `ext` samples on each end (scipy _odd_ext). */
function oddExt(x: Float64Array, ext: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n + 2 * ext);
  const x0 = x[0];
  const xLast = x[n - 1];
  for (let i = 0; i < ext; i++) {
    // left: 2*x[0] - x[ext], x[ext-1], ..., x[1]
    out[i] = 2 * x0 - x[ext - i];
    // right: 2*x[-1] - x[-2], x[-3], ...
    out[n + ext + i] = 2 * xLast - x[n - 2 - i];
  }
  out.set(x, ext);
  return out;
}

function reversed(x: Float64Array): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = x[n - 1 - i];
  return out;
}

function scaledZi(zi: [number, number][], factor: number): [number, number][] {
  return zi.map(([a, b]) => [a * factor, b * factor] as [number, number]);
}

/** Zero-phase forward-backward SOS filtering. Port of scipy sosfiltfilt. */
export function sosfiltfilt(sos: number[][], x: Float64Array): Float64Array {
  const n = x.length;
  const edge = Math.min(defaultPadlen(sos), n - 1);
  const ext = oddExt(x, edge);
  const zi = sosfiltZi(sos);

  // forward
  let y = sosfilt(sos, ext, scaledZi(zi, ext[0]));
  // backward
  y = reversed(y);
  y = sosfilt(sos, y, scaledZi(zi, y[0]));
  y = reversed(y);

  // trim padding
  return y.subarray(edge, edge + n);
}
