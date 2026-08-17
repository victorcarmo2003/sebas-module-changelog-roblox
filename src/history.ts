import type { SebasModuleContext } from "./sebas-types.js";

const TABLE = "posted";

export type PostedStatus = "posted" | "fallback";

export interface PostedRow {
  id: number;
  guildId: string;
  guid: string;
  title: string;
  versionNumber: string | null;
  channelId: string;
  postedAt: string;
  status: string;
}

export interface PostedPage {
  items: PostedRow[];
  nextCursor: number | null;
}

async function ensureTable(ctx: SebasModuleContext): Promise<void> {
  await ctx.sql.createTable(TABLE, {
    guild_id: "text",
    guid: "text",
    title: "text",
    version_number: "text",
    channel_id: "text",
    posted_at: "text",
    status: "text"
  });
}

function toPostedRow(row: Record<string, unknown>): PostedRow {
  return {
    id: row.id as number,
    guildId: row.guild_id as string,
    guid: row.guid as string,
    title: row.title as string,
    versionNumber: (row.version_number as string | null) ?? null,
    channelId: row.channel_id as string,
    postedAt: row.posted_at as string,
    status: row.status as string
  };
}

export async function recordPosted(
  ctx: SebasModuleContext,
  entry: { guildId: string; guid: string; title: string; versionNumber?: string; channelId: string; status: PostedStatus }
): Promise<void> {
  await ensureTable(ctx);
  await ctx.sql.insert(TABLE, {
    guild_id: entry.guildId,
    guid: entry.guid,
    title: entry.title,
    version_number: entry.versionNumber ?? null,
    channel_id: entry.channelId,
    posted_at: new Date().toISOString(),
    status: entry.status
  });
}

export async function listPosted(ctx: SebasModuleContext, filter: { guildId?: string; cursor?: number; limit?: number }): Promise<PostedPage> {
  await ensureTable(ctx);
  const limit = Math.min(Math.max(filter.limit ?? 25, 1), 100);
  const rows = await ctx.sql.select(TABLE, {
    where: filter.guildId ? { guild_id: filter.guildId } : undefined,
    orderDirection: "desc",
    cursor: filter.cursor,
    limit: limit + 1
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map(toPostedRow);

  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export async function getPosted(ctx: SebasModuleContext, id: number): Promise<PostedRow | null> {
  await ensureTable(ctx);
  const rows = await ctx.sql.select(TABLE, { where: { id }, limit: 1 });
  return rows.length > 0 ? toPostedRow(rows[0]) : null;
}
