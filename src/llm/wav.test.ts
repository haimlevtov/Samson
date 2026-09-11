/**
 * Tests for `src/llm/wav.ts` — the header that makes the model's raw PCM
 * playable. A wrong field here is a clip that plays at the wrong speed, or not
 * at all, so each is read back from the bytes.
 */
import { describe, expect, it } from 'vitest';
import { PCM_SAMPLE_RATE, pcmRate, pcmToWav } from './wav';

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

describe('pcmToWav', () => {
  const pcm = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const wav = pcmToWav(pcm);
  const view = new DataView(wav.buffer);

  it('writes a canonical RIFF/WAVE header ahead of the samples', () => {
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(ascii(wav, 36, 4)).toBe('data');
    expect(wav.byteLength).toBe(44 + pcm.byteLength);
    expect([...wav.subarray(44)]).toEqual([...pcm]);
  });

  it('describes 16-bit linear PCM, mono, at the model rate', () => {
    expect(view.getUint32(4, true)).toBe(36 + pcm.byteLength); // RIFF size
    expect(view.getUint32(16, true)).toBe(16); // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // linear PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(PCM_SAMPLE_RATE);
    expect(view.getUint32(28, true)).toBe(PCM_SAMPLE_RATE * 2); // bytes a second
    expect(view.getUint16(32, true)).toBe(2); // bytes a sample
    expect(view.getUint16(34, true)).toBe(16); // bits a sample
    expect(view.getUint32(40, true)).toBe(pcm.byteLength); // data size
  });

  it('writes the rate it is given', () => {
    const at16k = new DataView(pcmToWav(pcm, 16_000).buffer);
    expect(at16k.getUint32(24, true)).toBe(16_000);
    expect(at16k.getUint32(28, true)).toBe(32_000);
  });

  it('drops a trailing half sample, so the data is whole samples', () => {
    const odd = pcmToWav(new Uint8Array([1, 2, 3]));
    expect(odd.byteLength).toBe(44 + 2);
    expect(new DataView(odd.buffer).getUint32(40, true)).toBe(2);
  });
});

describe('pcmRate', () => {
  it('reads the rate a content type names', () => {
    expect(pcmRate('audio/L16;rate=16000')).toBe(16_000);
    expect(pcmRate('audio/pcm; codec=pcm; rate=24000')).toBe(24_000);
  });

  it('falls back to the model rate when none is named, or the one named is not a rate', () => {
    expect(pcmRate('audio/pcm')).toBe(PCM_SAMPLE_RATE);
    expect(pcmRate('audio/pcm;rate=0')).toBe(PCM_SAMPLE_RATE);
    expect(pcmRate('audio/pcm;rate=abc')).toBe(PCM_SAMPLE_RATE);
    expect(pcmRate('audio/pcm;samplerate=16000')).toBe(PCM_SAMPLE_RATE);
  });
});
