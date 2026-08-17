const COLOR_NORMAL = 0x5865f2;
const COLOR_BREAKING = 0xed4245;
export function renderDiscordMessage(update, changelog, options = {}) {
    const source = update.releaseNotesUrl || update.link;
    const hasBreaking = (changelog.breakingChanges?.length ?? 0) > 0;
    const color = hasBreaking ? COLOR_BREAKING : COLOR_NORMAL;
    const fields = [];
    if (changelog.highlights?.length) {
        fields.push({ name: "Destaques", value: changelog.highlights.map((h) => `• ${h}`).join("\n").slice(0, 1024) });
    }
    const code = changelog.codeExample?.trim()
        ? `\`\`\`lua\n${changelog.codeExample.slice(0, 980)}\n\`\`\``
        : "`-- Sem exemplo para esta versão.`";
    fields.push({ name: "Exemplo", value: code });
    if (changelog.advantages.length > 0) {
        fields.push({ name: "Vantagens", value: changelog.advantages.map((a) => `• ${a}`).join("\n").slice(0, 1024), inline: true });
    }
    if (changelog.disadvantages.length > 0) {
        fields.push({ name: "Desvantagens", value: changelog.disadvantages.map((d) => `• ${d}`).join("\n").slice(0, 1024), inline: true });
    }
    if (hasBreaking) {
        fields.push({ name: "Breaking Changes", value: changelog.breakingChanges.map((b) => `• ${b}`).join("\n").slice(0, 1024) });
    }
    const footerParts = [];
    if (changelog.footnote)
        footerParts.push(changelog.footnote);
    const embed = {
        title: changelog.title.slice(0, 256),
        description: changelog.description.slice(0, 4096),
        color,
        fields,
        url: source,
        footer: footerParts.length > 0 ? { text: footerParts.join(" • ").slice(0, 2048) } : undefined,
        timestamp: update.publishedAt
    };
    const roleId = options.changelogRoleId?.trim();
    const shouldMentionRole = options.mentionChangelogRole === true && Boolean(roleId);
    return {
        content: shouldMentionRole ? `<@&${roleId}>` : undefined,
        embeds: [embed],
        mentionRoleIds: shouldMentionRole ? [roleId] : []
    };
}
