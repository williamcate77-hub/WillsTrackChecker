// Runs the CPU-heavy DSP off the main thread so the UI stays responsive.

import { analyze, verdict } from "./dsp/analyze";
import type { TrackResult } from "./dsp/types";

export interface WorkerRequest {
  id: number;
  name: string;
  left: Float32Array;
  right: Float32Array;
}

export type WorkerResponse =
  | { id: number; ok: true; result: TrackResult }
  | { id: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, name, left, right } = e.data;
  try {
    const metrics = analyze({ left, right });
    if (!metrics) {
      const res: WorkerResponse = { id, ok: false, error: "too short or silent to read" };
      (self as unknown as Worker).postMessage(res);
      return;
    }
    const v = verdict(metrics);
    const result: TrackResult = { name, ...metrics, ...v };
    const res: WorkerResponse = { id, ok: true, result };
    (self as unknown as Worker).postMessage(res);
  } catch (err) {
    const res: WorkerResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : "analysis failed",
    };
    (self as unknown as Worker).postMessage(res);
  }
};
