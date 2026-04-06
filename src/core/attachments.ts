const TEXT_EXTS = new Set([
  ".js", ".ts", ".jsx", ".tsx", ".py", ".rb", ".rs", ".go", ".java",
  ".c", ".cpp", ".h", ".cs", ".lua", ".sh", ".sql", ".html", ".css",
  ".json", ".yaml", ".yml", ".toml", ".xml", ".md", ".txt", ".svelte",
  ".vue", ".php", ".dart", ".zig",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);

export function isTextFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot !== -1 && TEXT_EXTS.has(name.slice(dot).toLowerCase());
}

export function isImageFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot !== -1 && IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

const ALLOWED_ATTACHMENT_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
]);

function isAllowedAttachmentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_ATTACHMENT_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export async function fetchAttachment(url: string, maxChars = 8000): Promise<string | null> {
  if (!isAllowedAttachmentUrl(url)) {
    console.log(`[attachments] Blocked fetch to non-Discord host: ${url}`);
    return null;
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > maxChars ? text.slice(0, maxChars) + "\n... [truncated]" : text;
  } catch {
    return null;
  }
}

export async function processAttachments(attachments: any[]): Promise<string> {
  if (!attachments || attachments.length === 0) return "";

  const parts: string[] = [];
  const imageUrls: string[] = [];

  for (const att of attachments.slice(0, 10)) {
    const filename: string = att.filename || "";
    const contentType: string = att.content_type || "";
    const url: string = att.url || "";
    if (!url) continue;

    if (contentType.startsWith("image/") || isImageFile(filename)) {
      if (imageUrls.length < 5) imageUrls.push(url);
    } else if (isTextFile(filename)) {
      const text = await fetchAttachment(url);
      if (text) {
        const ext = filename.split(".").pop() || "txt";
        parts.push(`File: \`${filename}\`\n\`\`\`${ext}\n${text}\n\`\`\``);
      }
    }
  }

  if (imageUrls.length > 0) {
    const imageLines = imageUrls.map((url, i) => `${i + 1}. ${url}`);
    parts.push(`Attached images:\n${imageLines.join("\n")}`);
  }

  return parts.length > 0 ? "\n\n" + parts.join("\n\n") : "";
}
