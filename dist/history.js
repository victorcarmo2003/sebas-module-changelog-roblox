const TABLE = "posted";
async function ensureTable(ctx) {
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
function toPostedRow(row) {
    return {
        id: row.id,
        guildId: row.guild_id,
        guid: row.guid,
        title: row.title,
        versionNumber: row.version_number ?? null,
        channelId: row.channel_id,
        postedAt: row.posted_at,
        status: row.status
    };
}
export async function recordPosted(ctx, entry) {
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
export async function listPosted(ctx, filter) {
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
export async function getPosted(ctx, id) {
    await ensureTable(ctx);
    const rows = await ctx.sql.select(TABLE, { where: { id }, limit: 1 });
    return rows.length > 0 ? toPostedRow(rows[0]) : null;
}
