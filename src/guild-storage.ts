import type { SebasModuleContext } from "./sebas-types.js";
import type { GuildConfig, GuildState } from "./types.js";

function configKey(guildId: string): string {
  return `guild:${guildId}:config`;
}
function stateKey(guildId: string): string {
  return `guild:${guildId}:state`;
}

export async function loadGuildConfig(ctx: SebasModuleContext, guildId: string): Promise<GuildConfig | null> {
  return ctx.storage.get<GuildConfig>(configKey(guildId));
}

export async function saveGuildConfig(ctx: SebasModuleContext, guildId: string, config: GuildConfig): Promise<void> {
  await ctx.storage.set(configKey(guildId), config);
}

export async function listConfiguredGuilds(ctx: SebasModuleContext): Promise<Array<{ guildId: string; config: GuildConfig }>> {
  const keys = await ctx.storage.list("guild:");
  const configKeys = keys.filter((key) => key.endsWith(":config"));
  const entries: Array<{ guildId: string; config: GuildConfig }> = [];
  for (const key of configKeys) {
    const guildId = key.slice("guild:".length, -":config".length);
    const config = await ctx.storage.get<GuildConfig>(key);
    if (config) entries.push({ guildId, config });
  }
  return entries;
}

export async function loadGuildState(ctx: SebasModuleContext, guildId: string): Promise<GuildState | null> {
  return ctx.storage.get<GuildState>(stateKey(guildId));
}

export async function saveGuildState(ctx: SebasModuleContext, guildId: string, state: GuildState): Promise<void> {
  await ctx.storage.set(stateKey(guildId), state);
}

export function createInitialState(processedGuids: string[]): GuildState {
  return { initializedAt: new Date().toISOString(), processedGuids };
}

export function rememberGuid(state: GuildState, guid: string, maxGuids = 500): GuildState {
  const next = [guid, ...state.processedGuids.filter((knownGuid) => knownGuid !== guid)];
  return { ...state, processedGuids: next.slice(0, maxGuids) };
}
