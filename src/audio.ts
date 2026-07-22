// Decode any browser-supported audio file to 44.1 kHz stereo Float32 channels,
// entirely on the client. Nothing is uploaded.

const TARGET_SR = 44100;

interface AudioCtor {
  new (contextOptions?: AudioContextOptions): AudioContext;
}

function getAudioContext(): AudioContext {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio API not available in this browser");
  return new Ctor();
}

async function resampleTo44k(buffer: AudioBuffer): Promise<AudioBuffer> {
  if (buffer.sampleRate === TARGET_SR) return buffer;
  const frames = Math.ceil((buffer.duration || buffer.length / buffer.sampleRate) * TARGET_SR);
  const offline = new OfflineAudioContext(
    Math.max(buffer.numberOfChannels, 1),
    Math.max(frames, 1),
    TARGET_SR,
  );
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start();
  return offline.startRendering();
}

export interface DecodedAudio {
  left: Float32Array;
  right: Float32Array;
}

export async function decodeFile(file: File): Promise<DecodedAudio> {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = getAudioContext();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    void ctx.close();
  }
  audioBuffer = await resampleTo44k(audioBuffer);

  const left = audioBuffer.getChannelData(0);
  const right =
    audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
  // Copy out of the AudioBuffer so we own transferable buffers.
  return { left: new Float32Array(left), right: new Float32Array(right) };
}
