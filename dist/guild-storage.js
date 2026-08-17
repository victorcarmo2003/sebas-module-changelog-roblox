function configKey(guildId) {
    return `guild:${guildId}:config`;
}
function stateKey(guildId) {
    return `guild:${guildId}:state`;
}
export async function loadGuildConfig(ctx, guildId) {
    return ctx.storage.get(configKey(guildId));
}
export async function saveGuildConfig(ctx, guildId, config) {
    await ctx.storage.set(configKey(guildId), config);
}
export async function listConfiguredGuilds(ctx) {
    const keys = await ctx.storage.list("guild:");
    const configKeys = keys.filter((key) => key.endsWith(":config"));
    const entries = [];
    for (const key of configKeys) {
        const guildId = key.slice("guild:".length, -":config".length);
        const config = await ctx.storage.get(key);
        if (config)
            entries.push({ guildId, config });
    }
    return entries;
}
export async function loadGuildState(ctx, guildId) {
    return ctx.storage.get(stateKey(guildId));
}
export async function saveGuildState(ctx, guildId, state) {
    await ctx.storage.set(stateKey(guildId), state);
}
export function createInitialState(processedGuids) {
    return { initializedAt: new Date().toISOString(), processedGuids };
}
export function rememberGuid(state, guid, maxGuids = 500) {
    const next = [guid, ...state.processedGuids.filter((knownGuid) => knownGuid !== guid)];
    return { ...state, processedGuids: next.slice(0, maxGuids) };
}
