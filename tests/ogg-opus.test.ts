import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  oggOpusChannels,
  opusPacketSamples,
  readWebmOpus,
  webmToOggOpus,
  writeOggOpus,
} from "../lib/ogg-opus";

// A 2.5 s tone recorded by Chromium's fake microphone (no real voice).
const webm = new Uint8Array(
  readFileSync(new URL("./fixtures/voz-ficticia.webm", import.meta.url)),
);

type Page = {
  flags: number;
  granule: number;
  seq: number;
  crc: number;
  raw: Uint8Array;
};
function pages(b: Uint8Array) {
  const out: Page[] = [];
  let at = 0;
  while (at < b.length) {
    assert.equal(String.fromCharCode(...b.subarray(at, at + 4)), "OggS");
    const view = new DataView(b.buffer, b.byteOffset + at);
    const n = b[at + 26]!;
    let size = 27 + n;
    for (let i = 0; i < n; i++) size += b[at + 27 + i]!;
    out.push({
      flags: b[at + 5]!,
      granule: view.getUint32(6, true) + view.getUint32(10, true) * 2 ** 32,
      seq: view.getUint32(18, true),
      crc: view.getUint32(22, true),
      raw: b.slice(at, at + size),
    });
    at += size;
  }
  return out;
}

// Reference CRC (bit by bit) to check the table-driven one in the writer.
function crc(page: Uint8Array) {
  const copy = page.slice();
  copy.fill(0, 22, 26);
  let c = 0;
  for (const byte of copy) {
    c ^= byte << 24;
    for (let i = 0; i < 8; i++)
      c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    c >>>= 0;
  }
  return c;
}

test("reads the Opus track of a browser WebM recording", () => {
  const parsed = readWebmOpus(webm)!;
  assert.ok(parsed);
  assert.equal(String.fromCharCode(...parsed.head.subarray(0, 8)), "OpusHead");
  assert.equal(parsed.head[9], 1); // mono
  assert.equal(parsed.packets.length, 41);
  assert.equal(readWebmOpus(new TextEncoder().encode("not a webm")), null);
  assert.equal(readWebmOpus(webm.subarray(0, 120)), null); // cut before any audio
});

test("repackages the recording as a valid Ogg/Opus voice note", () => {
  const ogg = webmToOggOpus(webm)!;
  const list = pages(ogg);
  assert.equal(list[0]!.flags, 0x02); // first page
  assert.equal(list.at(-1)!.flags, 0x04); // last page
  assert.deepEqual(
    list.map((p) => p.seq),
    list.map((_, i) => i),
  );
  for (const p of list) assert.equal(p.crc, crc(p.raw));
  // 41 packets of 60 ms = 2.46 s at 48 kHz.
  assert.equal(list.at(-1)!.granule, 118080);
  assert.equal(oggOpusChannels(ogg), 1);
  assert.equal(
    String.fromCharCode(...list[1]!.raw.subarray(28, 36)),
    "OpusTags",
  );
});

test("counts Opus samples from the packet header", () => {
  assert.equal(opusPacketSamples(Uint8Array.of(0xfb, 0x03)), 2880); // CELT 20 ms × 3
  assert.equal(opusPacketSamples(Uint8Array.of(0x08)), 960); // SILK 20 ms
  assert.equal(opusPacketSamples(Uint8Array.of(0x79)), 1920); // hybrid 20 ms × 2
  assert.equal(opusPacketSamples(new Uint8Array()), 0);
});

test("splits long recordings into pages under 255 segments", () => {
  const head = readWebmOpus(webm)!.head;
  const packets = Array.from({ length: 600 }, () =>
    Uint8Array.of(0xfb, 0x03, ...new Array(300).fill(1)),
  );
  const list = pages(writeOggOpus(head, packets));
  for (const p of list) assert.ok(p.raw[26]! <= 255);
  assert.equal(list.at(-1)!.granule, 600 * 2880);
  assert.ok(list.length > 10);
});

test("recognizes Ogg/Opus files only", () => {
  assert.equal(oggOpusChannels(new TextEncoder().encode("OggS")), null);
  const vorbis = webmToOggOpus(webm)!.slice();
  vorbis.set(new TextEncoder().encode("Vorbis!!"), 28);
  assert.equal(oggOpusChannels(vorbis), null);
});
