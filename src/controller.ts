import type { SebasControllerRequest, SebasControllerResponse, SebasModuleContext } from "./sebas-types.js";
import { formatAndPost } from "./cron.js";
import { listConfiguredGuilds, loadGuildConfig, saveGuildConfig } from "./guild-storage.js";
import { getPosted, listPosted } from "./history.js";
import { enrichRobloxUpdate, fetchRobloxUpdateByVersion } from "./roblox-rss.js";
import { loadModuleSettings, saveModuleSettings } from "./settings.js";
import type { GuildConfig } from "./types.js";
import { DEFAULT_RSS_URL } from "./types.js";

function json(status: number, body: unknown): SebasControllerResponse {
  return { status, body };
}

async function handleRequest(ctx: SebasModuleContext, req: SebasControllerRequest): Promise<SebasControllerResponse> {
  const parts = req.path.split("/").filter(Boolean);

  if (req.method === "GET" && parts.length === 1 && parts[0] === "guilds") {
    return json(200, { items: await listConfiguredGuilds(ctx) });
  }

  if (parts[0] === "guilds" && parts.length === 2) {
    const guildId = parts[1];
    if (req.method === "GET") {
      const config = await loadGuildConfig(ctx, guildId);
      return config ? json(200, config) : json(404, { error: "not found" });
    }
    if (req.method === "PUT") {
      const body = req.body as { channelId?: string; mentionRoleId?: string | null; mentionRoleEnabled?: boolean } | null;
      if (!body?.channelId) return json(400, { error: "channelId is required" });

      const existing = await loadGuildConfig(ctx, guildId);
      const config: GuildConfig = {
        channelId: body.channelId,
        mentionRoleId: body.mentionRoleId !== undefined ? body.mentionRoleId : (existing?.mentionRoleId ?? null),
        mentionRoleEnabled: body.mentionRoleEnabled !== undefined ? body.mentionRoleEnabled : (existing?.mentionRoleEnabled ?? false),
        updatedAt: new Date().toISOString()
      };
      await saveGuildConfig(ctx, guildId, config);
      return json(200, config);
    }
  }

  if (parts.length === 1 && parts[0] === "settings") {
    if (req.method === "GET") return json(200, await loadModuleSettings(ctx));
    if (req.method === "PUT") {
      const body = req.body as { rssUrl?: string | null; maxItemsPerPoll?: number | null } | null;
      const settings = {
        rssUrl: body?.rssUrl?.trim() || null,
        maxItemsPerPoll:
          body?.maxItemsPerPoll !== undefined && body.maxItemsPerPoll !== null && Number.isFinite(body.maxItemsPerPoll)
            ? body.maxItemsPerPoll
            : null
      };
      await saveModuleSettings(ctx, settings);
      return json(200, settings);
    }
  }

  if (req.method === "GET" && parts.length === 1 && parts[0] === "history") {
    const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const page = await listPosted(ctx, { guildId: req.query.guildId || undefined, cursor, limit });
    return json(200, page);
  }

  if (req.method === "POST" && parts.length === 3 && parts[0] === "history" && parts[2] === "repost") {
    const id = Number(parts[1]);
    if (!Number.isFinite(id)) return json(400, { error: "invalid id" });

    const row = await getPosted(ctx, id);
    if (!row) return json(404, { error: "not found" });
    if (!row.versionNumber) return json(400, { error: "this changelog has no version number to re-fetch" });

    try {
      const settings = await loadModuleSettings(ctx);
      const rssUrl = settings.rssUrl || DEFAULT_RSS_URL;
      const update = await fetchRobloxUpdateByVersion(ctx, rssUrl, row.versionNumber);
      const enriched = await enrichRobloxUpdate(ctx, update);
      await formatAndPost(ctx, {
        guildId: row.guildId,
        channelId: row.channelId,
        update: enriched,
        mentionRoleId: null,
        mentionRoleEnabled: false
      });
      return json(200, { status: "posted" });
    } catch (error) {
      return json(502, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  return json(404, { error: "not found" });
}

// Roda durante a instalacao, ANTES de qualquer grant ser concedido — so pode usar ctx.storage
// (sempre liberado). O instalador usa o entry point "controller" como alvo do smoke test
// porque e' o primeiro presente no manifesto; por isso o selfTest mora aqui, nao num arquivo
// separado que nunca seria carregado nesse momento.
async function selfTest(ctx: SebasModuleContext): Promise<void> {
  await ctx.storage.set("__selftest__", { at: new Date().toISOString() });
  const value = await ctx.storage.get<{ at: string }>("__selftest__");
  if (!value?.at) {
    throw new Error("storage roundtrip falhou no smoke test.");
  }
  await ctx.storage.delete("__selftest__");
  ctx.logger.info("changelog-roblox: smoke test ok.");
}

export default { handleRequest, selfTest };
