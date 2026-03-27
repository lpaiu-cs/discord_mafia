export function parseCookies(header: string): Record<string, string> {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((accumulator, entry) => {
      const [key, ...rest] = entry.split("=");
      if (!key || rest.length === 0) {
        return accumulator;
      }

      accumulator[key] = safeDecodeCookieValue(rest.join("="));
      return accumulator;
    }, {});
}

function safeDecodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
