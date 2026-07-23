// Turns raw metrics into graded, plain-language readings. This is the
// educational layer: every reading says whether the track passed, what the
// measurement actually means on a big system, and how THIS track did against a
// reference club record — not just a number.

import type { Status, TrackMetrics } from "./dsp/types";

// One-glance definitions for each reading. Shown as tooltips on the chips, in
// the results-time key, and on the landing screen — so nobody has to guess what
// tilt / holds / mono / peak mean.
export interface ReadingInfo {
  code: "tilt" | "holds" | "mono" | "peak";
  title: string;
  unit: string;
  plain: string; // the short, plain-language definition
  good: string; // what a good reading looks like
}

export const READING_INFO: ReadingInfo[] = [
  {
    code: "tilt",
    title: "Sub weight",
    unit: "dB",
    plain:
      "How heavy the low end sits against the mids. A big rig exposes a light bottom that headphones hide.",
    good: "Higher is heavier. Reference records run +4 to +10 (around +8); below +2.5 is thin.",
  },
  {
    code: "holds",
    title: "Sub extension",
    unit: "Hz",
    plain:
      "The lowest note the track actually sustains before it rolls off — the weight you feel in your chest, not your ears.",
    good: "Lower is deeper. References reach 39–44 Hz; above 55 Hz there's no real sub.",
  },
  {
    code: "mono",
    title: "Mono behaviour",
    unit: "",
    plain:
      "How well left and right agree below 100 Hz. Club subs are mono, so anything that differs down low cancels out.",
    good: "Higher is safer. References sit +0.99 to +1.00; below +0.83 the bass cancels on a mono sub.",
  },
  {
    code: "peak",
    title: "True level",
    unit: "dB",
    plain:
      "The loudest sample, plus any clipping baked into the file. A limiter can't rebuild what was already flattened.",
    good: "Loud masters sit at 0 dBFS — that's normal. Only big stretches of flattened waveform can't be fixed.",
  },
];

export interface Gauge {
  min: number;
  max: number;
  value: number;
  goodMin: number;
  goodMax: number;
}

export interface Reading {
  key: "tilt" | "holds" | "mono" | "peak";
  label: string; // human title, e.g. "Sub weight"
  metric: string; // short code shown as a chip, e.g. "tilt"
  value: string; // formatted value, e.g. "+4.3 dB"
  status: Status;
  concept: string; // what this reading is and why it matters (teaches the idea)
  reading: string; // interpretation of this track's value (teaches the result)
  gauge: Gauge;
}

export interface Assessment {
  status: Status;
  headline: string; // big verdict word/phrase
  summary: string; // one-line plain-language verdict
  action: string;
  readings: Reading[];
}

const HEADLINE: Record<Status, string> = {
  ok: "Fills the system",
  caution: "Worth a look",
  problem: "Won't hold up",
};

const SUMMARY: Record<Status, string> = {
  ok: "Nothing to fix — this one holds up on a big rig.",
  caution: "Mostly fine, but one reading is off enough to hear.",
  problem: "Something here falls apart on a proper system.",
};

function fmtSigned(v: number, digits: number): string {
  const s = v.toFixed(digits);
  return v >= 0 ? `+${s}` : s;
}

function tiltReading(tilt: number): Reading {
  let status: Status;
  let reading: string;
  if (tilt >= 4.0) {
    status = "ok";
    reading =
      tilt >= 8
        ? `Right in the reference range (they run +4 to +10, around +8). Serious weight — the kick and bass will land.`
        : `Inside the reference range (+4 to +10). The low end sits with the good records.`;
  } else if (tilt >= 2.5) {
    status = "caution";
    reading = `Lighter than the reference records (they sit +4 to +10). Next to the heavier tracks it'll feel like the level drops.`;
  } else {
    status = "problem";
    reading = `Thin. The low end is buried under the mids and won't land on a big system.`;
  }
  return {
    key: "tilt",
    label: "Sub weight",
    metric: "tilt",
    value: `${fmtSigned(tilt, 1)} dB`,
    status,
    concept:
      "How heavy the low end sits against the mids. A big rig exposes a light bottom end that headphones and small monitors hide.",
    reading,
    gauge: { min: 0, max: 12, value: tilt, goodMin: 4, goodMax: 12 },
  };
}

function holdsReading(holds: number): Reading {
  let status: Status;
  let reading: string;
  if (holds <= 45) {
    status = "ok";
    reading = `Holds down to ${holds.toFixed(0)} Hz — full sub extension (reference records reach ~40 Hz). You'll feel the bottom octave.`;
  } else if (holds <= 55) {
    status = "caution";
    reading = `Rolls off at ${holds.toFixed(0)} Hz, so the bottom octave is missing. Fine on tops, shallow on a big sub.`;
  } else {
    status = "problem";
    reading = `Almost nothing under ${holds.toFixed(0)} Hz — there's no real sub in this track.`;
  }
  return {
    key: "holds",
    label: "Sub extension",
    metric: "holds",
    value: `${holds.toFixed(0)} Hz`,
    status,
    concept:
      "The lowest note the track actually sustains before it rolls off. On a big sub you feel this in your chest, not your ears.",
    reading,
    // lower is better: the good zone is the low end of the scale
    gauge: { min: 25, max: 60, value: holds, goodMin: 25, goodMax: 45 },
  };
}

function monoReading(mono: number): Reading {
  let status: Status;
  let reading: string;
  if (mono >= 0.95) {
    status = "ok";
    reading = `Mono-safe. The left and right agree down low, so the sub stacks receive the whole signal.`;
  } else if (mono >= 0.93) {
    status = "ok";
    reading = `Mostly mono — the subs get almost everything. No real cause for concern.`;
  } else if (mono >= 0.83) {
    status = "caution";
    reading = `The low end is a little wide (references sit +0.99 to +1.00). Most reaches the subs, but some will thin out on a mono sub.`;
  } else {
    status = "problem";
    reading = `The bass is wide stereo. A big chunk of it cancels on a mono sub stack and the weight disappears.`;
  }
  return {
    key: "mono",
    label: "Mono behaviour",
    metric: "mono",
    value: fmtSigned(mono, 2),
    status,
    concept:
      "Club subs are usually one mono stack. Anything that differs between left and right down low cancels out and takes real weight with it.",
    reading,
    gauge: { min: 0.6, max: 1, value: mono, goodMin: 0.85, goodMax: 1 },
  };
}

function peakReading(peakDb: number, clipped: number, clippedFrac: number): Reading {
  const pct = clippedFrac * 100;
  let status: Status;
  let reading: string;
  if (clippedFrac > 0.03) {
    status = "problem";
    reading = `Peak ${peakDb.toFixed(1)} dBFS with ${clipped.toLocaleString()} full-scale samples (${pct.toFixed(1)}% of the track). That's real clipping printed into the file — a limiter can't undo it. Find a clean copy.`;
  } else if (clippedFrac > 0.01) {
    status = "caution";
    reading = `Peak ${peakDb.toFixed(1)} dBFS, ${pct.toFixed(1)}% of samples pinned to the ceiling. Loud, and running hot — fine on most rigs, but there's no headroom left.`;
  } else if (clipped > 0) {
    status = "ok";
    reading = `Peak ${peakDb.toFixed(1)} dBFS with a handful of full-scale samples — normal for a loud club master. Nothing to worry about.`;
  } else {
    status = "ok";
    reading = `Peak ${peakDb.toFixed(1)} dBFS, no clipping. Clean headroom.`;
  }
  return {
    key: "peak",
    label: "Level & clipping",
    metric: "peak",
    value: `${peakDb.toFixed(1)} dB`,
    status,
    // gauge shows how much of the track is pinned full-scale (percent)
    concept:
      "Loud masters sit right at 0 dBFS — that's normal. What can't be fixed is real clipping, where big stretches of the waveform are flattened; on a revealing system it turns to glare.",
    reading,
    gauge: { min: 0, max: 3, value: pct, goodMin: 0, goodMax: 1 },
  };
}

export function assess(m: TrackMetrics, status: Status, action: string): Assessment {
  const readings = [
    tiltReading(m.tilt),
    holdsReading(m.holds),
    monoReading(m.mono),
    peakReading(m.peakDb, m.clipped, m.clippedFrac),
  ];
  return {
    status,
    headline: HEADLINE[status],
    summary: SUMMARY[status],
    action,
    readings,
  };
}
