export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function asBoolean(value: string | boolean | undefined, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(normalized)) {
      return true;
    }

    if (["false", "no", "n", "0"].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function containsUnsupportedClaims(text: string): string[] {
  const issues: string[] = [];
  const lower = text.toLowerCase();

  if (/(guarantee|guaranteed)/.test(lower)) {
    issues.push("Remove guarantee language unless there is a signed guarantee policy.");
  }

  if (/\b\d{1,3}%\b/.test(text)) {
    issues.push("Remove percentage-based performance claims unless backed by client data.");
  }

  if (/(double your|instant results|overnight)/.test(lower)) {
    issues.push("Remove exaggerated performance promises.");
  }

  return issues;
}

export function splitTags(value?: string): string[] {
  if (!value) {
    return [];
  }

  return unique(
    value
      .split(/[;,|]/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}
