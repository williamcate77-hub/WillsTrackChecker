// Numeric validation of the TS DSP port against subcheck.py's scipy engine.
// Bundled with esbuild and run under node (see package.json isn't wired; run via
// npx esbuild). Golden values were produced by subcheck.py's own functions on
// test/golden.wav:  tilt +7.691174, holds 59.216309, mono 1.000000.

import { readFileSync } from "node:fs";
import { analyze } from "../src/dsp/analyze";

const GOLDEN = { tilt: 7.691174, holds: 59.216309, mono: 1.0 };
const path = new URL("./golden.wav", import.meta.url);
const buf = readFileSync(path);

// Minimal WAV reader for the PCM16 stereo file we generated. Walk chunks to
// find "fmt " and "data" rather than assuming a fixed 44-byte header.
function readWav(b: Buffer): { left: Float32Array; right: Float32Array; sr: number } {
  let off = 12; // skip RIFF....WAVE
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
    off = body + size + (size % 2);
  }
  if (dataOff < 0 || bits !== 16) throw new Error("unexpected wav format");
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
  return { left, right, sr };
}

const { left, right } = readWav(buf);
const m = analyze({ left, right });
if (!m) throw new Error("analyze returned null");

function check(name: string, got: number, want: number, tol: number): boolean {
  const diff = Math.abs(got - want);
  const ok = diff <= tol;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(6)} got ${got.toFixed(6)}  want ${want.toFixed(6)}  (|Δ| ${diff.toExponential(2)}, tol ${tol})`,
  );
  return ok;
}

let allOk = true;
allOk = check("tilt", m.tilt, GOLDEN.tilt, 0.01) && allOk;
allOk = check("holds", m.holds, GOLDEN.holds, 0.5) && allOk;
allOk = check("mono", m.mono, GOLDEN.mono, 0.001) && allOk;

console.log(
  `\nextras: peak ${m.peakDb.toFixed(2)} dBFS, clipped ${m.clipped}, crest ${m.crest.toFixed(2)} dB, loud ${m.loudSecs}s`,
);

if (!allOk) {
  console.error("\nVALIDATION FAILED");
  process.exit(1);
}
console.log("\nVALIDATION PASSED — TS engine matches the scipy reference.");
