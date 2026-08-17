const SETTINGS_KEY = "module-settings";
export async function loadModuleSettings(ctx) {
    const settings = await ctx.config.get(SETTINGS_KEY);
    return settings ?? { rssUrl: null, maxItemsPerPoll: null };
}
export async function saveModuleSettings(ctx, settings) {
    await ctx.config.set(SETTINGS_KEY, settings);
}
