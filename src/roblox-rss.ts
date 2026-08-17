import type { SebasModuleContext } from "./sebas-types.js";
import type { RobloxReleaseNote, RobloxUpdate } from "./types.js";

type ReleaseNotesData = {
  props?: {
    pageProps?: {
      data?: {
        releaseNoteContents?: {
          content?: Array<{
            ReleaseNotesText?: string;
            ReleaseNotesType?: string;
            Status?: string;
          }>;
        };
      };
    };
  };
};

function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

export async function fetchRobloxUpdates(ctx: SebasModuleContext, rssUrl: string): Promise<RobloxUpdate[]> {
  const response = await ctx.fetch(rssUrl);
  if (!isOk(response.status)) {
    throw new Error(`Roblox RSS failed with ${response.status}.`);
  }

  const xml = await response.text();
  const updates = extractXmlItems(xml).map((item) => {
    const title = childText(item, "title") || "Roblox API update";
    const link = childText(item, "link");
    const guid = childText(item, "guid") || link || title;
    const pubDate = childText(item, "pubDate");
    const description = childText(item, "description");
    const contentEncoded = childText(item, "content:encoded");
    const publishedAt = pubDate ? new Date(pubDate).toISOString() : undefined;
    const versionNumber = extractVersionNumber(title);
    const releaseNotesUrl = versionNumber ? releaseNotesUrlForVersion(versionNumber) : undefined;

    return {
      guid,
      title,
      versionNumber,
      link,
      releaseNotesUrl,
      description,
      publishedAt,
      changes: extractRssChanges(contentEncoded || description || ""),
      releaseNotes: []
    };
  });

  return updates.filter((update) => update.guid);
}

export async function fetchRobloxUpdateByVersion(ctx: SebasModuleContext, rssUrl: string, versionInput?: string): Promise<RobloxUpdate> {
  const updates = await fetchRobloxUpdates(ctx, rssUrl);

  if (!versionInput?.trim()) {
    const latest = updates.find((update) => update.versionNumber);
    if (!latest) {
      throw new Error("Nenhum changelog com versao foi encontrado no feed do Roblox.");
    }
    return enrichRobloxUpdate(ctx, latest);
  }

  const versionNumber = normalizeVersionInput(versionInput);
  if (!versionNumber) {
    throw new Error(`Nao consegui entender a versao "${versionInput}". Tente algo como 725.`);
  }

  const fromFeed = updates.find((update) => update.versionNumber === versionNumber);
  if (fromFeed) {
    return enrichRobloxUpdate(ctx, fromFeed);
  }

  const releaseNotesUrl = releaseNotesUrlForVersion(versionNumber);
  const syntheticUpdate: RobloxUpdate = {
    guid: `release-notes-${versionNumber}`,
    title: `Release notes for ${versionNumber}`,
    link: releaseNotesUrl,
    versionNumber,
    releaseNotesUrl,
    changes: [],
    releaseNotes: []
  };
  const enriched = await enrichRobloxUpdate(ctx, syntheticUpdate);

  if (enriched.releaseNotes.length === 0) {
    throw new Error(`Nao encontrei release notes para a versao ${versionNumber}.`);
  }

  return enriched;
}

export async function enrichRobloxUpdate(ctx: SebasModuleContext, update: RobloxUpdate): Promise<RobloxUpdate> {
  if (!update.releaseNotesUrl || update.releaseNotes.length > 0) {
    return update;
  }

  return { ...update, releaseNotes: await fetchReleaseNotes(ctx, update.releaseNotesUrl) };
}

function extractVersionNumber(title: string): string | undefined {
  const match = title.match(/^v0\.(\d+)\./);
  return match?.[1];
}

function normalizeVersionInput(input: string): string | undefined {
  const trimmed = input.trim().toLowerCase();
  const releaseNotesMatch = trimmed.match(/release-notes-(\d+)/);
  if (releaseNotesMatch) return releaseNotesMatch[1];
  const fullVersionMatch = trimmed.match(/v?0\.(\d+)\./);
  if (fullVersionMatch) return fullVersionMatch[1];
  const shortVersionMatch = trimmed.match(/^v?(\d+)$/);
  return shortVersionMatch?.[1];
}

function releaseNotesUrlForVersion(versionNumber: string): string {
  return `https://create.roblox.com/docs/release-notes/release-notes-${versionNumber}`;
}

function extractXmlItems(xml: string): string[] {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
}

function childText(xml: string, tagName: string): string | undefined {
  const escapedTag = escapeRegExp(tagName);
  const match = xml.match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i"));
  const value = match ? decodeEntities(stripCdata(match[1])).trim() : "";
  return value || undefined;
}

function extractRssChanges(content: string): string[] {
  if (!content.trim()) return [];
  const changes: string[] = [];
  for (const listItem of content.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const itemHtml = listItem[1];
    const anchor = itemHtml.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    const text = htmlToText(anchor?.[1] || itemHtml);
    if (text) changes.push(text);
  }
  if (changes.length > 0) return changes;
  return [...content.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => htmlToText(match[1])).filter(Boolean);
}

async function fetchReleaseNotes(ctx: SebasModuleContext, url: string): Promise<RobloxReleaseNote[]> {
  try {
    const response = await ctx.fetch(url);
    if (!isOk(response.status)) return [];

    const html = await response.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(?<json>.*?)<\/script>/s);
    const jsonText = match?.groups?.json;
    if (!jsonText) return [];

    const data = JSON.parse(jsonText) as ReleaseNotesData;
    const releaseNotes =
      data.props?.pageProps?.data?.releaseNoteContents?.content?.map((note) => ({
        text: note.ReleaseNotesText || "",
        type: note.ReleaseNotesType || "Change",
        status: note.Status || "Unknown"
      })) || [];

    return releaseNotes.filter((note) => note.text.trim());
  } catch (error) {
    ctx.logger.warn(`Could not fetch release notes from ${url}`, { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function htmlToText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) return codePointToString(Number.parseInt(lower.slice(2), 16), entity);
    if (lower.startsWith("#")) return codePointToString(Number.parseInt(lower.slice(1), 10), entity);
    const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: "\"" };
    return named[lower] || entity;
  });
}

function codePointToString(codePoint: number, fallback: string): string {
  if (!Number.isFinite(codePoint)) return fallback;
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return fallback;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
