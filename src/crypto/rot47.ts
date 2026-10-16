export function rot47(input: string): string {
  return input.replace(/[\x21-\x7e]/g, (char) =>
    String.fromCharCode(33 + ((char.charCodeAt(0) + 14) % 94)),
  );
}
