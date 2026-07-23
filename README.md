# Will's Track Checker

**Will it survive the big system?** Drop a folder of tracks and find out which ones
fall apart on a proper rig — thin low end, no sub, phase that cancels on the sub
stacks, clipped at source — before you leave the house, not at 1am in front of a room.

Built for me and mates. No accounts, no paid tier, no upload. **Every track is
decoded and analysed entirely in your own browser** using the Web Audio API — the
files never leave your machine, so it costs nothing to run and there's nothing to
keep private.

## What it reads

Measured only over the loud sections where the kick and bassline are running:

| Reading | Meaning | Reference records measured |
| ------- | ------- | -------------------------- |
| **tilt**  | sub-to-mids balance (dB), higher = heavier | +4.2 to +10.4 (≈ +8) |
| **holds** | lowest frequency the track actually sustains | 39–44 Hz (median 40) |
| **mono**  | L/R correlation below 100 Hz (subs get full signal) | +0.995 to +1.00 |
| **peak**  | sample peak + how much of the track is pinned full-scale | all at 0 dBFS |

### Calibration

The pass marks are set from **six real big-room reference records** (great-sounding
club masters), not from theory. Running them through the engine showed the naive
marks were wrong in two ways: every loud master hits 0 dBFS with thousands of
full-scale samples (so counting clipped samples cried wolf on all of them), and
the mono/tilt marks were a touch strict. Clipping is now judged by the *fraction*
of the track pinned full-scale, and the tilt/holds/mono thresholds sit just outside
the reference spread. Re-run the calibration any time with:

```bash
# decode any set of records to 44.1k WAV (macOS afconvert), then:
npx esbuild test/analyze-file.ts --bundle --platform=node --format=esm --outfile=test/af.mjs
node test/af.mjs /path/to/*.wav
```

Each track gets one plain-language verdict and one action. The **set-level view** —
the tilt spread across the whole crate, the lightest and heaviest track, and a
warning when they're more than 3 dB apart — is the point: a single file tells you
little; the set tells you which track is out of line with the rest. Export the
readiness sheet as CSV to take to the booth.

## The engine

The DSP is a faithful TypeScript port of `subcheck.py`. The Butterworth filter
coefficients are generated from the exact same `scipy.signal.butter()` calls, and
the port is validated against golden values produced by the Python reference engine
(`test/validate.ts`): tilt, holds and mono all match scipy to within 1e-6.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build to dist/
```

Validate the DSP port against the scipy reference:

```bash
npx esbuild test/validate.ts --bundle --platform=node --format=esm --outfile=test/validate.mjs
node test/validate.mjs
```

## Deploy (Vercel)

Fully static — no server, no environment variables. Import the GitHub repo into
Vercel; `vercel.json` sets the framework (Vite), build command (`npm run build`)
and output directory (`dist`). Every push to `main` redeploys.

## Stack

Vite + React + TypeScript. All analysis runs in a Web Worker so the UI stays
responsive while a full crate is read.
