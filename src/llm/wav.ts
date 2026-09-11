/**
 * Raw PCM into a WAV file a browser can play — ADR 0025, "Corrected after the
 * first live calls".
 *
 * WHY: the speech model answers only in raw PCM — OpenRouter refused
 * `response_format: 'mp3'` with HTTP 400 on the first live call — and no browser
 * plays headerless PCM. A WAV file is the same samples behind a 44-byte header,
 * so there is no encoder to ship and no dependency to add.
 */

/**
 * The model's output: 16-bit little-endian mono at 24 kHz — the parameters
 * Google's own speech-generation guide writes its wave file with.
 *
 * AI-NOTE: these belong to SPEECH_MODEL in src/llm/models.ts. A different model
 *          may answer in another rate, width or byte order, and this header
 *          would then play its samples as noise or at the wrong speed.
 */
export const PCM_SAMPLE_RATE = 24_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const HEADER_BYTES = 44;

/** How many bytes one second of the model's PCM takes at `rate`. */
export function pcmBytesPerSecond(rate: number): number {
  return (rate * CHANNELS * BITS_PER_SAMPLE) / 8;
}

/**
 * The sample rate a content type names, as in `audio/L16;rate=24000`, or the
 * model's documented rate when it names none or names nonsense.
 */
export function pcmRate(contentType: string): number {
  const match = /(?:^|;)\s*rate\s*=\s*(\d+)/i.exec(contentType);
  const rate = match ? Number(match[1]) : Number.NaN;
  return Number.isInteger(rate) && rate >= 8_000 && rate <= 192_000 ? rate : PCM_SAMPLE_RATE;
}

/**
 * The samples behind a canonical 44-byte RIFF/WAVE header.
 *
 * An odd trailing byte is half a 16-bit sample and is dropped, so the data
 * chunk stays whole samples.
 */
export function pcmToWav(
  pcm: Uint8Array,
  sampleRate: number = PCM_SAMPLE_RATE
): Uint8Array<ArrayBuffer> {
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8;
  const dataBytes = pcm.byteLength - (pcm.byteLength % blockAlign);
  const wav = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(wav.buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // the size of this fmt chunk
  view.setUint16(20, 1, true); // 1: linear PCM
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // bytes per second
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  wav.set(pcm.subarray(0, dataBytes), HEADER_BYTES);
  return wav;
}
