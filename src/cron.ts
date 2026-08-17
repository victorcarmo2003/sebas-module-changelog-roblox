import type { SebasModuleAi, SebasModuleContext } from "./sebas-types.js";
import { renderDiscordMessage } from "./discord-render.js";
import { formatChangelogLocally } from "./formatter.js";
import { createInitialState, listConfiguredGuilds, loadGuildState, rememberGuid, saveGuildState } from "./guild-storage.js";
import { recordPosted } from "./history.js";
import { enrichRobloxUpdate, fetchRobloxUpdates } from "./roblox-rss.js";
import { loadModuleSettings } from "./settings.js";
import { runTopicPipeline } from "./topic-pipeline.js";
import type { FormattedChangelog, GuildConfig, RobloxUpdate } from "./types.js";
import { DEFAULT_MAX_ITEMS_PER_POLL, DEFAULT_RSS_URL } from "./types.js";

const FORMAT_TIMEOUT_MS = 170_000;
const TOPIC_TIMEOUT_MS = 35_000;
const PIPELINE_MAX_MS = 130_000;

async function poll(ctx: SebasModuleContext): Promise<void> {
  const settings = await loadModuleSettings(ctx);
  const rssUrl = settings.rssUrl || DEFAULT_RSS_URL;
  const maxItemsPerPoll = settings.maxItemsPerPoll ?? DEFAULT_MAX_ITEMS_PER_POLL;

  const guilds = await listConfiguredGuilds(ctx);
  if (guilds.length === 0) return;

  const updates = await fetchRobloxUpdates(ctx, rssUrl);

  for (const guild of guilds) {
    try {
      await processGuildUpdates(ctx, guild.guildId, guild.config, updates, maxItemsPerPoll);
    } catch (error) {
      ctx.logger.error("Guild poll failed.", {
        guildId: guild.guildId,
        channelId: guild.config.channelId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

async function processGuildUpdates(
  ctx: SebasModuleContext,
  guildId: string,
  guildConfig: GuildConfig,
  updates: RobloxUpdate[],
  maxItemsPerPoll: number
): Promise<void> {
  let state = await loadGuildState(ctx, guildId);

  if (!state) {
    state = createInitialState(updates.map((update) => update.guid));
    await saveGuildState(ctx, guildId, state);
    return;
  }

  const known = new Set(state.processedGuids);
  const freshUpdates = updates
    .filter((update) => !known.has(update.guid))
    .slice(0, maxItemsPerPoll)
    .reverse();

  for (const update of freshUpdates) {
    const enrichedUpdate = await enrichRobloxUpdate(ctx, update);
    if (!hasLiveReleaseNotes(enrichedUpdate)) {
      state = rememberGuid(state, update.guid);
      await saveGuildState(ctx, guildId, state);
      continue;
    }

    await formatAndPost(ctx, {
      guildId,
      channelId: guildConfig.channelId,
      update: enrichedUpdate,
      mentionRoleId: guildConfig.mentionRoleId,
      mentionRoleEnabled: guildConfig.mentionRoleEnabled
    });

    state = rememberGuid(state, update.guid);
    await saveGuildState(ctx, guildId, state);
  }
}

function hasLiveReleaseNotes(update: RobloxUpdate): boolean {
  if (update.releaseNotes.length === 0) return true;
  return update.releaseNotes.some((note) => note.status === "Live");
}

export async function formatAndPost(
  ctx: SebasModuleContext,
  params: { guildId: string; channelId: string; update: RobloxUpdate; mentionRoleId: string | null; mentionRoleEnabled: boolean }
): Promise<void> {
  const { changelog: formatted, usedFallback } = await formatWithFallback(ctx, params.update);

  const message = renderDiscordMessage(params.update, formatted, {
    mentionChangelogRole: params.mentionRoleEnabled,
    changelogRoleId: params.mentionRoleId ?? undefined
  });

  await ctx.discord.sendChannelMessage(params.channelId, message);
  await recordPosted(ctx, {
    guildId: params.guildId,
    guid: params.update.guid,
    title: params.update.title,
    versionNumber: params.update.versionNumber,
    channelId: params.channelId,
    status: usedFallback ? "fallback" : "posted"
  });
}

export async function formatWithFallback(
  ctx: SebasModuleContext,
  update: RobloxUpdate
): Promise<{ changelog: FormattedChangelog; usedFallback: boolean }> {
  const ai: SebasModuleAi | null = ctx.ai;
  if (!ai) {
    return { changelog: formatChangelogLocally(update), usedFallback: true };
  }

  type FormatResult = { status: "ok"; value: FormattedChangelog } | { status: "error"; error: unknown } | { status: "timeout" };

  const producer = (): Promise<FormattedChangelog> =>
    runTopicPipeline(ai, update, { perTopicTimeoutMs: TOPIC_TIMEOUT_MS, maxTotalMs: PIPELINE_MAX_MS }).then((result) => result.changelog);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const formatTask = producer()
    .then((value): FormatResult => ({ status: "ok", value }))
    .catch((error): FormatResult => ({ status: "error", error }));
  const timeoutTask = new Promise<FormatResult>((resolve) => {
    timeoutId = setTimeout(() => resolve({ status: "timeout" }), FORMAT_TIMEOUT_MS);
  });

  const result = await Promise.race([formatTask, timeoutTask]);
  if (timeoutId) clearTimeout(timeoutId);

  if (result.status === "ok") {
    return { changelog: result.value, usedFallback: false };
  }

  const errorText =
    result.status === "timeout"
      ? `timeout depois de ${Math.round(FORMAT_TIMEOUT_MS / 1000)}s`
      : result.error instanceof Error
        ? result.error.message
        : String(result.error);

  ctx.logger.warn("Formatter fallback used.", { guid: update.guid, reason: errorText });

  const fallback = formatChangelogLocally(update);
  return {
    changelog: { ...fallback, footnote: `Fallback local usado: ${errorText.slice(0, 180)}.` },
    usedFallback: true
  };
}

export default { run: poll };
