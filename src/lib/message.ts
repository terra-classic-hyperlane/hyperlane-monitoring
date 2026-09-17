// Hyperlane message envelope: version(1) nonce(4) origin(4) sender(32) destination(4) recipient(32) body
export interface ParsedMessage {
  version: number;
  nonce: number;
  origin: number;
  sender: string; // 0x + 64 hex
  destination: number;
  recipient: string; // 0x + 64 hex
  bodyHex: string;
}

export function strip0x(h: string): string {
  return h.startsWith('0x') || h.startsWith('0X') ? h.slice(2) : h;
}
export function ensure0x(h: string): string {
  return h.startsWith('0x') ? h : `0x${h}`;
}

export function parseMessage(hex: string): ParsedMessage {
  const b = Buffer.from(strip0x(hex), 'hex');
  if (b.length < 77) throw new Error(`message too short (${b.length} bytes)`);
  return {
    version: b[0],
    nonce: b.readUInt32BE(1),
    origin: b.readUInt32BE(5),
    sender: `0x${b.subarray(9, 41).toString('hex')}`,
    destination: b.readUInt32BE(41),
    recipient: `0x${b.subarray(45, 77).toString('hex')}`,
    bodyHex: `0x${b.subarray(77).toString('hex')}`,
  };
}

// Minimal message whose origin is `origin`, used to ask a routing ISM which module it routes to.
export function probeMessageHex(origin: number, destination: number): string {
  const b = Buffer.alloc(77);
  b[0] = 3;
  b.writeUInt32BE(origin, 5);
  b.writeUInt32BE(destination, 41);
  return b.toString('hex');
}

export function shortHex(h: string, n = 6): string {
  const s = ensure0x(h);
  return s.length <= 2 * n + 2 ? s : `${s.slice(0, n + 2)}…${s.slice(-n)}`;
}
