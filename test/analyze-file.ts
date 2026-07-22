// Runs one or more WAV files through the shipped TS engine and prints metrics.
// Used to calibrate the reference marks from real records.
//   npx esbuild test/analyze-file.ts --bundle --platform=node --format=esm --outfile=test/af.mjs
//   node test/af.mjs a.wav b.wav ...

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { analyze, verdict } from "../src/dsp/analyze";

function readWav(b: Buffer): { left: Float32Array; right: Float32Array } {
  let off = 12;
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
      bits = b.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataOff = body;
      dataLen = size;
      break;
    }
    off = body + size + (size % 2);
  }
  if (dataOff < 0 || bits !== 16) throw new Error("expected PCM16 wav");
  const frames = dataLen / (channels * 2);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const base = dataOff + i * channels * 2;
    const l = b.readInt16LE(base);
    const r = channels > 1 ? b.readInt16LE(base + 2) : l;
    left[i] = l / 32768;
    right[i] = r / 32768;
  }
  return { left, right };
}

const files = process.argv.slice(2);
console.log(
  `${"file".padEnd(10)} ${"tilt".padStart(7)} ${"holds".padStart(6)} ${"mono".padStart(6)} ${"peak".padStart(7)} ${"clip".padStart(6)} ${"crest".padStart(6)}  verdict`,
);
const rows: { tilt: number; holds: number; mono: number }[] = [];
for (const f of files) {
  const { left, right } = readWav(readFileSync(f));
  const m = analyze({ left, right });
  if (!m) {
    console.log(`${basename(f).padEnd(10)}  (too short / silent)`);
    continue;
  }
  const v = verdict(m);
  rows.push({ tilt: m.tilt, holds: m.holds, mono: m.mono });
  console.log(
    `${basename(f).padEnd(10)} ${m.tilt.toFixed(1).padStart(7)} ${m.holds.toFixed(0).padStart(6)} ${m.mono.toFixed(3).padStart(6)} ${m.peakDb.toFixed(1).padStart(7)} ${String(m.clipped).padStart(6)} ${m.crest.toFixed(1).padStart(6)}  ${v.verdict}`,
  );
}

if (rows.length) {
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const tilts = rows.map((r) => r.tilt);
  const holds = rows.map((r) => r.holds);
  const monos = rows.map((r) => r.mono);
  console.log("\n-- across the reference set --");
  console.log(
    `tilt : min ${Math.min(...tilts).toFixed(1)}  median ${med(tilts).toFixed(1)}  mean ${mean(tilts).toFixed(1)}  max ${Math.max(...tilts).toFixed(1)}`,
  );
  console.log(
    `holds: min ${Math.min(...holds).toFixed(0)}  median ${med(holds).toFixed(0)}  mean ${mean(holds).toFixed(0)}  max ${Math.max(...holds).toFixed(0)}`,
  );
  console.log(
    `mono : min ${Math.min(...monos).toFixed(3)}  median ${med(monos).toFixed(3)}  mean ${mean(monos).toFixed(3)}  max ${Math.max(...monos).toFixed(3)}`,
  );
}
