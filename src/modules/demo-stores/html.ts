const BLOCKED_CONTAINERS = /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi;
const CONCEALED_CONTAINERS = /<(div|section|aside|article|span|p)\b(?=[^>]*(?:\bhidden\b|\baria-hidden\s*=\s*["']?true|\bdata-agent-only\s*=|\bstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)))[^>]*>[\s\S]*?<\/\1>/gi;

const decodeEntities = (value: string): string => value
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  .replace(/&#x([a-f0-9]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'");

export function extractVisibleText(rawHtml: string): string {
  const withoutComments = rawHtml.replace(/<!--[\s\S]*?-->/g, " ");
  const withoutNonVisible = withoutComments
    .replace(BLOCKED_CONTAINERS, " ")
    .replace(CONCEALED_CONTAINERS, " ");

  return decodeEntities(withoutNonVisible
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function extractBodyHtml(rawHtml: string): string {
  return rawHtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? rawHtml;
}
