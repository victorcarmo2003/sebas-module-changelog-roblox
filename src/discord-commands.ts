import type { SebasModuleContext } from "./sebas-types.js";
import { formatWithFallback } from "./cron.js";
import { renderDiscordMessage } from "./discord-render.js";
import { loadGuildConfig, saveGuildConfig, createInitialState, saveGuildState } from "./guild-storage.js";
import { fetchRobloxUpdateByVersion, fetchRobloxUpdates } from "./roblox-rss.js";
import { loadModuleSettings } from "./settings.js";
import type { GuildConfig } from "./types.js";
import { DEFAULT_RSS_URL } from "./types.js";

interface Interaction {
  application_id: string;
  token: string;
  guild_id?: string;
  data?: { options?: Array<{ name: string; type: number; value?: string }> };
}

function getOptionValue(interaction: Interaction, name: string): string | undefined {
  const value = interaction.data?.options?.find((option) => option.name === name)?.value;
  return typeof value === "string" ? value : undefined;
}

async function editReply(ctx: SebasModuleContext, interaction: Interaction, content: string): Promise<void> {
  await ctx.discord.editInteractionResponse(interaction.application_id, interaction.token, { content });
}

async function handleSetup(ctx: SebasModuleContext, interaction: Interaction): Promise<void> {
  const guildId = interaction.guild_id;
  const channelId = getOptionValue(interaction, "canal");

  if (!guildId) {
    await editReply(ctx, interaction, "Use este comando dentro de um servidor.");
    return;
  }
  if (!channelId) {
    await editReply(ctx, interaction, "Escolha um canal para receber os changelogs.");
    return;
  }

  try {
    await ctx.discord.sendChannelMessage(channelId, { content: "Canal configurado para receber changelogs automaticos do Roblox." });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await editReply(
      ctx,
      interaction,
      `Nao consegui enviar mensagens em <#${channelId}>. Confira se o bot esta no servidor e tem permissoes de Ver Canal e Enviar Mensagens. Erro: ${msg.slice(0, 500)}`
    );
    return;
  }

  const settings = await loadModuleSettings(ctx);
  const updates = await fetchRobloxUpdates(ctx, settings.rssUrl || DEFAULT_RSS_URL);
  const existing = await loadGuildConfig(ctx, guildId);
  const config: GuildConfig = {
    channelId,
    mentionRoleId: existing?.mentionRoleId ?? null,
    mentionRoleEnabled: existing?.mentionRoleEnabled ?? false,
    updatedAt: new Date().toISOString()
  };
  await saveGuildConfig(ctx, guildId, config);
  await saveGuildState(ctx, guildId, createInitialState(updates.map((update) => update.guid)));

  await editReply(
    ctx,
    interaction,
    `Setup concluido. Vou postar changelogs automaticos em <#${channelId}>. Os itens atuais foram marcados como vistos. Configure o cargo de mencao no painel, se quiser.`
  );
}

async function handleTeste(ctx: SebasModuleContext, interaction: Interaction): Promise<void> {
  const versionInput = getOptionValue(interaction, "version");
  const settings = await loadModuleSettings(ctx);

  let update;
  try {
    update = await fetchRobloxUpdateByVersion(ctx, settings.rssUrl || DEFAULT_RSS_URL, versionInput);
  } catch (error) {
    await editReply(ctx, interaction, error instanceof Error ? error.message : String(error));
    return;
  }

  const { changelog } = await formatWithFallback(ctx, update);
  const message = renderDiscordMessage(update, changelog);
  await ctx.discord.editInteractionResponse(interaction.application_id, interaction.token, {
    content: message.content,
    embeds: message.embeds
  });
}

async function handleCommand(ctx: SebasModuleContext, commandName: string, interaction: unknown): Promise<{ content: string } | void> {
  const typed = interaction as Interaction;
  try {
    if (commandName === "setup") {
      await handleSetup(ctx, typed);
      return;
    }
    if (commandName === "teste") {
      await handleTeste(ctx, typed);
      return;
    }
  } catch (error) {
    ctx.logger.error("Discord command failed.", { commandName, error: error instanceof Error ? error.message : String(error) });
    await editReply(ctx, typed, `Nao consegui processar: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1500)).catch(
      () => undefined
    );
  }
}

export default {
  commands: [
    { name: "setup", description: "Configura o canal que recebe changelogs automaticos do Roblox." },
    { name: "teste", description: "Gera uma previa de changelog sem marcar nada como processado." }
  ],
  handleCommand
};
