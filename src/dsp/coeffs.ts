// Second-order-section (SOS) filter coefficients, generated with the exact same
// scipy.signal.butter() calls that subcheck.py uses, at fs = 44100 Hz:
//
//   BANDPASS = butter(4, [20, 60], btype="bandpass", fs=44100, output="sos")
//   LOWPASS  = butter(4, 100,      btype="lowpass",  fs=44100, output="sos")
//
// Hard-coding them keeps the browser engine bit-for-bit aligned with the Python
// reference engine without shipping a filter-design library. Each row is
// [b0, b1, b2, a0, a1, a2] with a0 == 1.

export const SR = 44100;

export const BANDPASS_SOS: number[][] = [
  [6.544191121300629e-11, 1.3088382242601258e-10, 6.544191121300629e-11, 1.0, -1.993400452583304, 0.9934409042688581],
  [1.0, 2.0, 1.0, 1.0, -1.9960434169195167, 0.9960580086702132],
  [1.0, -2.0, 1.0, 1.0, -1.9967136625356956, 0.9967824676889573],
  [1.0, -2.0, 1.0, 1.0, -1.9988529277989535, 0.9988615329317091],
];

export const LOWPASS_SOS: number[][] = [
  [2.528074615822979e-9, 5.056149231645958e-9, 2.528074615822979e-9, 1.0, -1.9738164386508996, 0.9740167917470341],
  [1.0, 2.0, 1.0, 1.0, -1.9889529784426025, 0.9891548679797925],
];
