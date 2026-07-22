export type Status = "ok" | "caution" | "problem";

export interface TrackMetrics {
  /** sub-to-mids balance in dB (higher = heavier). Reference tracks ~ +4.0 */
  tilt: number;
  /** lowest frequency the track actually holds, in Hz. Reference ~ 38-40 */
  holds: number;
  /** L/R correlation below 100 Hz. Above +0.9 = full signal to the subs */
  mono: number;
  /** peak sample level over the whole file, in dBFS */
  peakDb: number;
  /** number of full-scale (clipped) samples across both channels */
  clipped: number;
  /** crest factor over the loud sections, in dB (peak - RMS) */
  crest: number;
  /** total seconds of "loud" (kick + bass running) analysed */
  loudSecs: number;
}

export interface TrackResult extends TrackMetrics {
  name: string;
  status: Status;
  notes: string[];
  verdict: string;
  action: string;
}

export interface FailedResult {
  name: string;
  error: string;
}

export type AnalysisOutcome = TrackResult | FailedResult;

export function isFailure(r: AnalysisOutcome): r is FailedResult {
  return (r as FailedResult).error !== undefined;
}
