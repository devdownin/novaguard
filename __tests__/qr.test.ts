/**
 * The encoder is checked by decoding, with jsQR — an independent decoder. A
 * symbol that "looks right" is worth nothing; one a decoder reads back to the
 * same bytes is the whole contract.
 */
import jsQR from 'jsqr';
import { encodeQr, qrVersionFor } from '../src/utils/qr';

function decode(text: string): string | null {
  const matrix = encodeQr(text);
  const scale = 4;
  const quiet = 4;
  const side = (matrix.length + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  matrix.forEach((row, y) => row.forEach((dark, x) => {
    if (!dark) return;
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const i = (((y + quiet) * scale + dy) * side + (x + quiet) * scale + dx) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
      }
    }
  }));
  return jsQR(pixels, side, side)?.data ?? null;
}

const config = JSON.stringify({
  mcpServers: {
    novaguard: {
      url: 'http://192.168.1.42:8081/mcp',
      headers: { Authorization: `Bearer mcp_${'Ab3'.repeat(10)}xy` },
    },
  },
});

it('round-trips the MCP client configuration', () => {
  expect(decode(config)).toBe(config);
});

it.each([
  ['the shortest text', 'a'],
  ['a version 1 limit', 'x'.repeat(14)],
  ['a multi-block version', 'NovaGuard '.repeat(12)],
  ['a version with version bits', 'z'.repeat(400)],
  ['non-ASCII text', 'Caméra « entrée » · ok'],
])('decodes %s', (_label, text) => {
  expect(decode(text)).toBe(text);
});

it('picks the smallest version that fits, and refuses what none can hold', () => {
  expect(qrVersionFor(14)).toBe(1);
  expect(qrVersionFor(15)).toBe(2);
  expect(encodeQr(config).length).toBe(qrVersionFor(Buffer.byteLength(config))! * 4 + 17);
  expect(qrVersionFor(5000)).toBeNull();
  expect(() => encodeQr('x'.repeat(5000))).toThrow();
});
