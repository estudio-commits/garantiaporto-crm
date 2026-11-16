// Voice notes recorded in the browser → the format WhatsApp plays as a voice note (Ogg/Opus).
// Chrome, Edge and recent Safari record Opus inside WebM; this repackages the same Opus packets
// into an Ogg file, without re-encoding, so it runs in the browser with no extra dependencies.
// Firefox already records Ogg/Opus and needs no conversion.

const OPUS_HEAD = [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]; // "OpusHead"
const OGGS = [0x4f, 0x67, 0x67, 0x53]; // "OggS"

// WebM (Matroska) element ids used here.
const ID = {
  ebml: 0x1a45dfa3,
  segment: 0x18538067,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  codecId: 0x86,
  codecPrivate: 0x63a2,
  codecDelay: 0x56aa,
  audio: 0xe1,
  channels: 0x9f,
  cluster: 0x1f43b675,
  blockGroup: 0xa0,
  block: 0xa1,
  simpleBlock: 0xa3,
};
// Containers we step into instead of skipping (their size may be "unknown" in recorder output).
const CONTAINERS = new Set([
  ID.segment,
  ID.tracks,
  ID.trackEntry,
  ID.audio,
  ID.cluster,
  ID.blockGroup,
]);

/** Variable-length integer: returns [value, length]; value -1 means "unknown size". */
function vint(
  b: Uint8Array,
  at: number,
  keepMarker: boolean,
): [number, number] {
  const first = b[at];
  if (first === undefined || first === 0) return [NaN, 0];
  let len = 1;
  while (!(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || at + len > b.length) return [NaN, 0];
  let value = keepMarker ? first : first & (0xff >> len);
  let allOnes = value === 0xff >> len;
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[at + i]!;
    if (b[at + i] !== 0xff) allOnes = false;
  }
  return [!keepMarker && allOnes ? -1 : value, len];
}

const uint = (b: Uint8Array, at: number, len: number) => {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + b[at + i]!;
  return v;
};

const startsWith = (b: Uint8Array, sig: number[], at = 0) =>
  sig.every((x, i) => b[at + i] === x);

/** Samples (at 48 kHz) in one Opus packet, from its TOC byte (RFC 6716 §3.1). */
export function opusPacketSamples(packet: Uint8Array) {
  const toc = packet[0];
  if (toc === undefined) return 0;
  const config = toc >> 3;
  const frame =
    config < 12
      ? [480, 960, 1920, 2880][config % 4]!
      : config < 16
        ? [480, 960][config % 2]!
        : [120, 240, 480, 960][config % 4]!;
  const code = toc & 3;
  const frames =
    code === 0
      ? 1
      : code < 3
        ? 2
        : packet[1] === undefined
          ? 0
          : packet[1] & 0x3f;
  return frame * frames;
}

type WebmOpus = { head: Uint8Array; packets: Uint8Array[] };

/** Reads the Opus header and packets of the first Opus track of a WebM recording. */
export function readWebmOpus(b: Uint8Array): WebmOpus | null {
  if (uint(b, 0, 4) !== ID.ebml) return null;
  let track = 0,
    current = 0,
    codec = "",
    head: Uint8Array | null = null,
    channels = 1,
    delayNs = 0;
  const packets: Uint8Array[] = [];
  let at = 0;
  while (at < b.length) {
    const [id, idLen] = vint(b, at, true);
    if (!idLen) break;
    const [size, sizeLen] = vint(b, at + idLen, false);
    if (!sizeLen) break;
    const start = at + idLen + sizeLen;
    if (CONTAINERS.has(id)) {
      if (id === ID.trackEntry) current = 0;
      at = start; // step inside
      continue;
    }
    if (size < 0 || start + size > b.length) {
      // Unknown or truncated size on a leaf element: a recording cut short; keep what was read.
      break;
    }
    const data = b.subarray(start, start + size);
    switch (id) {
      case ID.trackNumber:
        current = uint(data, 0, data.length);
        break;
      case ID.codecId:
        codec = new TextDecoder().decode(data);
        if (codec === "A_OPUS" && !track) track = current;
        break;
      case ID.codecPrivate:
        if (current === track && startsWith(data, OPUS_HEAD))
          head = data.slice();
        break;
      case ID.codecDelay:
        delayNs = uint(data, 0, data.length);
        break;
      case ID.channels:
        channels = uint(data, 0, data.length);
        break;
      case ID.simpleBlock:
      case ID.block: {
        const [n, nLen] = vint(data, 0, false);
        const flags = data[nLen + 2];
        if (!track || n !== track || flags === undefined) break;
        if (flags & 0x06) return null; // laced blocks: not produced by browser recorders
        const frame = data.subarray(nLen + 3);
        if (frame.length) packets.push(frame.slice());
        break;
      }
    }
    at = start + size;
  }
  if (!track || !packets.length) return null;
  if (!head) {
    // No Opus header stored: build the standard one (RFC 7845 §5.1).
    head = new Uint8Array(19);
    head.set(OPUS_HEAD);
    head[8] = 1;
    head[9] = Math.min(2, Math.max(1, channels));
    const preSkip = Math.round((delayNs / 1e9) * 48000);
    head[10] = preSkip & 0xff;
    head[11] = (preSkip >> 8) & 0xff;
    head.set([0x80, 0xbb, 0, 0], 12); // 48000 Hz
  }
  return { head, packets };
}

// ---- Ogg writer (RFC 3533 / RFC 7845) ----

let CRC_TABLE: Uint32Array | null = null;
function oggCrc(page: Uint8Array) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let j = 0; j < 8; j++)
        r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
      CRC_TABLE[i] = r >>> 0;
    }
  }
  let crc = 0;
  for (const byte of page)
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  return crc;
}

function oggPage(
  packets: Uint8Array[],
  granule: number,
  serial: number,
  sequence: number,
  flags: number,
) {
  const lacing: number[] = [];
  for (const p of packets) {
    let left = p.length;
    while (left >= 255) {
      lacing.push(255);
      left -= 255;
    }
    lacing.push(left);
  }
  const bodyLen = packets.reduce((n, p) => n + p.length, 0);
  const page = new Uint8Array(27 + lacing.length + bodyLen);
  const view = new DataView(page.buffer);
  page.set(OGGS);
  page[4] = 0;
  page[5] = flags;
  view.setUint32(6, granule % 2 ** 32, true);
  view.setUint32(10, Math.floor(granule / 2 ** 32), true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  page[26] = lacing.length;
  page.set(lacing, 27);
  let at = 27 + lacing.length;
  for (const p of packets) {
    page.set(p, at);
    at += p.length;
  }
  view.setUint32(22, oggCrc(page), true);
  return page;
}

/** Wraps an Opus header and packets in an Ogg file. */
export function writeOggOpus(
  head: Uint8Array,
  packets: Uint8Array[],
  serial = 0x506f7274,
) {
  const vendor = new TextEncoder().encode("Garantia Porto CRM");
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  tags.set(new TextEncoder().encode("OpusTags"));
  new DataView(tags.buffer).setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  const pages = [
    oggPage([head], 0, serial, 0, 0x02),
    oggPage([tags], 0, serial, 1, 0),
  ];
  let granule = 0,
    batch: Uint8Array[] = [],
    segments = 0,
    bytes = 0;
  const flush = (last: boolean) => {
    pages.push(oggPage(batch, granule, serial, pages.length, last ? 0x04 : 0));
    batch = [];
    segments = 0;
    bytes = 0;
  };
  packets.forEach((p, i) => {
    const need = Math.floor(p.length / 255) + 1;
    if (batch.length && (segments + need > 255 || bytes + p.length > 4096))
      flush(false);
    batch.push(p);
    segments += need;
    bytes += p.length;
    granule += opusPacketSamples(p);
    if (i === packets.length - 1) flush(true);
  });
  const out = new Uint8Array(pages.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pages) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** WebM/Opus recording → Ogg/Opus voice note, or null if it is not a WebM with Opus audio. */
export function webmToOggOpus(webm: Uint8Array) {
  const parsed = readWebmOpus(webm);
  return parsed ? writeOggOpus(parsed.head, parsed.packets) : null;
}

/** Checks that a file is Ogg with Opus audio; returns its channel count, or null. */
export function oggOpusChannels(b: Uint8Array) {
  if (!startsWith(b, OGGS) || b[4] !== 0 || !(b[5]! & 0x02)) return null;
  const at = 27 + (b[26] ?? 0);
  if (!startsWith(b, OPUS_HEAD, at)) return null;
  const channels = b[at + 9];
  return channels ? channels : null;
}
