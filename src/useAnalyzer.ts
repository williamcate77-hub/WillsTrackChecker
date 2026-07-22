import { useCallback, useEffect, useRef, useState } from "react";
import { decodeFile } from "./audio";
import type { FailedResult, TrackResult } from "./dsp/types";
import type { WorkerRequest, WorkerResponse } from "./worker";

export type Phase = "idle" | "working" | "done";

export interface Progress {
  done: number;
  total: number;
  current: string;
}

export interface AnalyzerState {
  phase: Phase;
  results: TrackResult[];
  failures: FailedResult[];
  progress: Progress;
  run: (files: File[]) => Promise<void>;
  reset: () => void;
}

const AUDIO_EXTS = [".wav", ".aiff", ".aif", ".flac", ".mp3", ".m4a", ".aac", ".ogg", ".wv", ".opus"];

export function isAudioFile(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_EXTS.some((ext) => lower.endsWith(ext)) && !name.startsWith(".");
}

export function useAnalyzer(): AnalyzerState {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<number, (r: WorkerResponse) => void>());
  const idRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<TrackResult[]>([]);
  const [failures, setFailures] = useState<FailedResult[]>([]);
  const [progress, setProgress] = useState<Progress>({ done: 0, total: 0, current: "" });

  useEffect(() => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const resolve = pendingRef.current.get(e.data.id);
      if (resolve) {
        pendingRef.current.delete(e.data.id);
        resolve(e.data);
      }
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const analyzeInWorker = useCallback(
    (name: string, left: Float32Array, right: Float32Array): Promise<WorkerResponse> => {
      const worker = workerRef.current;
      if (!worker) return Promise.reject(new Error("worker not ready"));
      const id = ++idRef.current;
      const req: WorkerRequest = { id, name, left, right };
      return new Promise<WorkerResponse>((resolve) => {
        pendingRef.current.set(id, resolve);
        // Transfer the sample buffers to avoid a copy.
        worker.postMessage(req, [left.buffer, right.buffer]);
      });
    },
    [],
  );

  const reset = useCallback(() => {
    setPhase("idle");
    setResults([]);
    setFailures([]);
    setProgress({ done: 0, total: 0, current: "" });
  }, []);

  const run = useCallback(
    async (files: File[]) => {
      const audio = files.filter((f) => isAudioFile(f.name));
      if (audio.length === 0) return;

      setPhase("working");
      setResults([]);
      setFailures([]);
      setProgress({ done: 0, total: audio.length, current: audio[0].name });

      for (let i = 0; i < audio.length; i++) {
        const file = audio[i];
        setProgress({ done: i, total: audio.length, current: file.name });
        try {
          const { left, right } = await decodeFile(file);
          const res = await analyzeInWorker(file.name, left, right);
          if (res.ok) {
            setResults((prev) => [...prev, res.result]);
          } else {
            setFailures((prev) => [...prev, { name: file.name, error: res.error }]);
          }
        } catch (err) {
          setFailures((prev) => [
            ...prev,
            { name: file.name, error: err instanceof Error ? err.message : "could not decode" },
          ]);
        }
      }

      setProgress((p) => ({ ...p, done: audio.length, current: "" }));
      setPhase("done");
    },
    [analyzeInWorker],
  );

  return { phase, results, failures, progress, run, reset };
}
