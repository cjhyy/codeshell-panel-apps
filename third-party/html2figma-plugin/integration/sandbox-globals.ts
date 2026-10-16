// Figma's plugin sandbox has no browser TextEncoder/atob. Keep these lexical.
export class TextEncoder {
  encode(value = "") {
    const bytes: number[] = [];
    for (const char of String(value)) {
      let code = char.codePointAt(0)!;
      if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      else if (code < 0x10000)
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      else
        bytes.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 63),
          0x80 | ((code >> 6) & 63),
          0x80 | (code & 63),
        );
    }
    return new Uint8Array(bytes);
  }
}
export function atob(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "",
    bits = 0,
    buffer = 0;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4) throw new Error("Invalid base64");
  for (const char of value.replace(/=+$/, "")) {
    buffer = (buffer << 6) | alphabet.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 255);
    }
  }
  return out;
}
