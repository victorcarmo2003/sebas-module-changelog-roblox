import type { SebasModuleContext } from "./sebas-types.js";
import type { ModuleSettings } from "./types.js";

const SETTINGS_KEY = "module-settings";

export async function loadModuleSettings(ctx: SebasModuleContext): Promise<ModuleSettings> {
  const settings = await ctx.config.get<ModuleSettings>(SETTINGS_KEY);
  return settings ?? { rssUrl: null, maxItemsPerPoll: null };
}

export async function saveModuleSettings(ctx: SebasModuleContext, settings: ModuleSettings): Promise<void> {
  await ctx.config.set(SETTINGS_KEY, settings);
}
