import type { Status, TrackResult } from "./dsp/types";

export interface SetSummary {
  count: number;
  spread: number;
  lightest: TrackResult | null;
  heaviest: TrackResult | null;
  counts: Record<Status, number>;
  steppy: boolean;
}

// Set-level view — the part the brief calls "the actual product". A single file
// tells you little; the set tells you which track is out of line with the rest.
export function summarise(results: TrackResult[]): SetSummary {
  const counts: Record<Status, number> = { ok: 0, caution: 0, problem: 0 };
  for (const r of results) counts[r.status]++;

  if (results.length < 1) {
    return { count: 0, spread: 0, lightest: null, heaviest: null, counts, steppy: false };
  }

  const byTilt = [...results].sort((a, b) => a.tilt - b.tilt);
  const lightest = byTilt[0];
  const heaviest = byTilt[byTilt.length - 1];
  const spread = heaviest.tilt - lightest.tilt;

  return {
    count: results.length,
    spread,
    lightest,
    heaviest,
    counts,
    steppy: results.length > 1 && spread > 3.0,
  };
}

// Trim sheet — the thing you take to the booth. CSV so it opens anywhere.
export function toCsv(results: TrackResult[]): string {
  const header = [
    "track",
    "tilt_dB",
    "holds_Hz",
    "mono",
    "peak_dBFS",
    "clipped_samples",
    "crest_dB",
    "status",
    "verdict",
    "action",
  ];
  const rows = results.map((r) => [
    r.name,
    r.tilt.toFixed(1),
    r.holds.toFixed(0),
    r.mono.toFixed(2),
    r.peakDb.toFixed(1),
    String(r.clipped),
    r.crest.toFixed(1),
    r.status,
    r.verdict,
    r.action,
  ]);
  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export function downloadCsv(results: TrackResult[]): void {
  const blob = new Blob([toCsv(results)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "trim-sheet.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
