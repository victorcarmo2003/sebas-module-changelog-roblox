import { buildConceptualCodeExample, selectOfficialReleaseNotes, stripMarkdown, versionLabel } from "./formatter.js";
import type { ChangelogTopic, FormattedChangelog, RobloxUpdate, TopicAnalysis } from "./types.js";

const DEFAULT_MAX_TOPICS = 6;
const STATUS_PRIORITY: Record<string, number> = { Live: 0, Changed: 1, Deprecated: 2, Removed: 3, Pending: 4, Unknown: 5 };
const CONFIDENCE_PRIORITY: Record<string, number> = { high: 0, medium: 1, low: 2 };
const BREAKING_STATUSES = new Set(["Removed", "Deprecated", "Changed"]);

export function splitChangelogIntoTopics(update: RobloxUpdate, maxTopics = DEFAULT_MAX_TOPICS): ChangelogTopic[] {
  const notes = selectOfficialReleaseNotes(update);

  if (notes.length > 0) {
    return notes.slice(0, maxTopics).map((note, index) => {
      const apiRefs = extractApiRefsFromText(note.text);
      return {
        topicId: `topic-${index + 1}`,
        title: buildTopicTitle(note.text, apiRefs),
        apiRefs,
        status: note.status,
        sourceText: note.text
      };
    });
  }

  const fallbackText = [update.description, ...update.changes].filter(Boolean).join("\n").trim();
  if (!fallbackText) return [];

  const apiRefs = extractApiRefsFromText(fallbackText);
  return [
    { topicId: "topic-1", title: buildTopicTitle(update.title, apiRefs), apiRefs, status: "Unknown", sourceText: fallbackText }
  ];
}

export function aggregateTopicAnalyses(
  update: RobloxUpdate,
  analyses: TopicAnalysis[],
  meta: { completedTopics: number; totalTopics: number }
): FormattedChangelog {
  if (analyses.length === 0) {
    throw new Error("No topic analyses to aggregate.");
  }

  const ordered = orderTopicsByPriority(analyses);
  const primary = ordered[0];
  const secondary = ordered.slice(1, 3);

  const title = `${versionLabel(update)} - ${primary.title}`.slice(0, 120);
  const description = buildDescription(primary, secondary);
  const highlights = ordered.slice(0, 5).map((topic) => truncateAtWordBoundary(`[${topic.status}] ${topic.title}: ${topic.summary}`, 220));

  const codeSource = ordered.find((topic) => topic.status === "Live" && topic.safeCodeExample && topic.codeExample.trim().length > 0);
  const codeExample = codeSource ? codeSource.codeExample.trim() : buildConceptualCodeExample(update);

  const advantages = dedupe(
    ordered.filter((topic) => topic.status === "Live" || topic.status === "Changed").map((topic) => topic.developerImpact)
  ).slice(0, 4);

  const disadvantages = dedupe(ordered.flatMap((topic) => topic.caveats)).slice(0, 4);

  const breakingChanges = ordered
    .filter((topic) => BREAKING_STATUSES.has(topic.status))
    .map((topic) => truncateAtWordBoundary(`${topic.title}: ${topic.summary}`, 220))
    .slice(0, 4);

  const footnoteParts: string[] = [];
  if (!codeSource) footnoteParts.push("Exemplo conceitual: nenhum topico Live trouxe um exemplo seguro.");
  if (meta.completedTopics < meta.totalTopics) footnoteParts.push(`${meta.completedTopics}/${meta.totalTopics} topicos analisados com IA a tempo.`);

  return {
    title,
    description,
    highlights,
    codeLanguage: "lua",
    codeExample,
    advantages: advantages.length > 0 ? advantages : ["Destaca uma mudanca oficial relevante para desenvolvedores Roblox."],
    disadvantages: disadvantages.length > 0 ? disadvantages : ["A release note pode nao detalhar assinatura, parametros ou formato de retorno."],
    breakingChanges,
    footnote: footnoteParts.length > 0 ? footnoteParts.join(" ") : undefined
  };
}

function buildDescription(primary: TopicAnalysis, secondary: TopicAnalysis[]): string {
  const parts = [primary.summary, primary.developerImpact];
  if (secondary.length > 0) {
    const secondaryTitles = secondary.map((topic) => topic.title).join(", ");
    parts.push(`Tambem chegaram mudancas em ${secondaryTitles}, listadas nos destaques abaixo.`);
  }
  return parts.filter(Boolean).join(" ").slice(0, 1200);
}

function orderTopicsByPriority(analyses: TopicAnalysis[]): TopicAnalysis[] {
  return [...analyses].sort((left, right) => {
    const statusDiff = (STATUS_PRIORITY[left.status] ?? 5) - (STATUS_PRIORITY[right.status] ?? 5);
    if (statusDiff !== 0) return statusDiff;
    return (CONFIDENCE_PRIORITY[left.confidence] ?? 2) - (CONFIDENCE_PRIORITY[right.confidence] ?? 2);
  });
}

function buildTopicTitle(text: string, apiRefs: string[]): string {
  if (apiRefs.length > 0) return apiRefs[0];
  return stripMarkdown(text).split(/\s+/).slice(0, 8).join(" ");
}

function extractApiRefsFromText(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const cleaned = match[1].replace(/^Class\./, "").replace(/^Library\./, "").replace(/\(\)$/, "").trim();
    if (cleaned) refs.add(cleaned);
  }
  return [...refs].slice(0, 5);
}

function truncateAtWordBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const truncated = value.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated}...`;
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
