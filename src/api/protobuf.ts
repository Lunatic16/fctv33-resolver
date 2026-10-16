function readVarint(buffer: Buffer, offset: number): [number, number] {
  let value = 0;
  let shift = 0;
  let index = offset;
  while (index < buffer.length) {
    const byte = buffer[index++]!;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [value, index];
}

function readBytes(buffer: Buffer, offset: number): [Buffer, number] {
  const [length, start] = readVarint(buffer, offset);
  return [buffer.subarray(start, start + length), start + length];
}

function readFields(buffer: Buffer): Map<number, Buffer[]> {
  const fields = new Map<number, Buffer[]>();
  let offset = 0;
  while (offset < buffer.length) {
    const [tag, next] = readVarint(buffer, offset);
    offset = next;
    const field = tag >> 3;
    const wire = tag & 0x7;
    if (wire === 0) {
      const [value, after] = readVarint(buffer, offset);
      offset = after;
      const encoded = Buffer.allocUnsafe(8);
      let size = 0;
      let temp = value;
      while (temp >= 0x80) {
        encoded[size++] = (temp & 0x7f) | 0x80;
        temp >>>= 7;
      }
      encoded[size++] = temp;
      const list = fields.get(field) ?? [];
      list.push(encoded.subarray(0, size));
      fields.set(field, list);
      continue;
    }
    if (wire !== 2) break;
    const [chunk, after] = readBytes(buffer, offset);
    offset = after;
    const list = fields.get(field) ?? [];
    list.push(chunk);
    fields.set(field, list);
  }
  return fields;
}

function readVarintValue(buffer: Buffer | undefined): number | undefined {
  return buffer ? readVarint(buffer, 0)[0] : undefined;
}

export function parseApiEnvelope(buffer: Buffer): { message: string; payload: Buffer[] } {
  const fields = readFields(buffer);
  return {
    message: fields.get(3)?.[0]?.toString("utf8") ?? "",
    payload: fields.get(10) ?? [],
  };
}

export function parseSignatureEntries(buffer: Buffer): Array<{ code: number; value: string }> {
  const entries: Array<{ code: number; value: string }> = [];
  let offset = 0;
  while (offset < buffer.length) {
    const [tag, next] = readVarint(buffer, offset);
    offset = next;
    if ((tag & 0x7) !== 2) continue;
    const [chunk, after] = readBytes(buffer, offset);
    offset = after;
    let code = 0;
    let value = "";
    let inner = 0;
    while (inner < chunk.length) {
      const [innerTag, innerNext] = readVarint(chunk, inner);
      inner = innerNext;
      const field = innerTag >> 3;
      const wire = innerTag & 0x7;
      if (wire === 0) {
        const [num, numNext] = readVarint(chunk, inner);
        inner = numNext;
        if (field === 1) code = num;
      } else if (wire === 2) {
        const [text, textNext] = readBytes(chunk, inner);
        inner = textNext;
        if (field === 2) value = text.toString("utf8");
      }
    }
    if (code) entries.push({ code, value });
  }
  return entries;
}

export type UserGeo = { country?: string; continent?: string };

export function parseUserGeo(buffer: Buffer): UserGeo {
  const first = parseApiEnvelope(buffer).payload[0];
  if (!first) return {};
  const fields = readFields(first);
  const country = fields.get(2)?.[0]?.toString("utf8");
  const continent = fields.get(3)?.[0]?.toString("utf8");
  return {
    ...(country ? { country } : {}),
    ...(continent ? { continent } : {}),
  };
}

export type StreamItem = {
  streamId?: string;
  url?: string;
  name?: string;
  siteType?: number;
};

function parseStreamItem(buffer: Buffer): StreamItem {
  const fields = readFields(buffer);
  const idChunk = fields.get(1)?.[0];
  const streamId =
    idChunk && idChunk.length <= 8
      ? String(readVarint(idChunk, 0)[0])
      : idChunk?.toString("utf8");
  const url = fields.get(4)?.[0]?.toString("utf8");
  const name = fields.get(3)?.[0]?.toString("utf8");
  const siteType = readVarintValue(fields.get(9)?.[0]);
  return {
    ...(streamId ? { streamId } : {}),
    ...(url ? { url } : {}),
    ...(name ? { name } : {}),
    ...(siteType !== undefined ? { siteType } : {}),
  };
}

export type LiveMatch = { matchId: number; sportType: number; name: string };

function parseMatchName(buffer: Buffer): string {
  for (const chunk of readFields(buffer).get(30) ?? []) {
    const name = readFields(chunk).get(2)?.[0]?.toString("utf8");
    if (name) return name;
  }
  return "";
}

export function parseLiveMatchList(buffer: Buffer): LiveMatch[] {
  const { message, payload } = parseApiEnvelope(buffer);
  const rootBuf = payload[0];
  if (message !== "Success" || !rootBuf) return [];
  const root = readFields(rootBuf);
  const streamIds = new Set(
    (root.get(2) ?? [])
      .map((chunk) => readVarintValue(readFields(chunk).get(50)?.[0]))
      .filter((id): id is number => id !== undefined),
  );
  return (root.get(1) ?? [])
    .map((chunk) => {
      const fields = readFields(chunk);
      const matchId = readVarintValue(fields.get(1)?.[0]);
      const sportType = readVarintValue(fields.get(2)?.[0]);
      if (matchId === undefined || sportType === undefined) return null;
      return { matchId, sportType, name: parseMatchName(chunk) };
    })
    .filter((match): match is LiveMatch => match !== null && streamIds.has(match.matchId));
}

export function parseMatchDetail(buffer: Buffer): { stream: StreamItem[] } {
  const first = parseApiEnvelope(buffer).payload[0];
  if (!first) return { stream: [] };
  return { stream: (readFields(first).get(2) ?? []).map(parseStreamItem) };
}

export function parseStreamDetail(buffer: Buffer): StreamItem {
  const first = parseApiEnvelope(buffer).payload[0];
  if (!first) return {};
  const fields = readFields(first);
  return parseStreamItem(fields.get(2)?.[0] ?? fields.get(1)?.[0] ?? first);
}
