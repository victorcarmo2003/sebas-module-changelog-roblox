export interface RobloxReleaseNote {
  text: string;
  type: string;
  status: string;
}

export interface RobloxUpdate {
  guid: string;
  title: string;
  versionNumber?: string;
  link?: string;
  releaseNotesUrl?: string;
  description?: string;
  publishedAt?: string;
  changes: string[];
  releaseNotes: RobloxReleaseNote[];
}

export interface FormattedChangelog {
  title: string;
  description: string;
  highlights?: string[];
  codeLanguage: "lua";
  codeExample: string;
  advantages: string[];
  disadvantages: string[];
  breakingChanges?: string[];
  footnote?: string;
}

export interface GuildConfig {
  channelId: string;
  mentionRoleId: string | null;
  mentionRoleEnabled: boolean;
  updatedAt: string;
}

export interface ModuleSettings {
  rssUrl: string | null;
  maxItemsPerPoll: number | null;
}

export interface GuildState {
  initializedAt: string;
  processedGuids: string[];
}

export type TopicConfidence = "high" | "medium" | "low";

export interface ChangelogTopic {
  topicId: string;
  title: string;
  apiRefs: string[];
  status: string;
  sourceText: string;
}

export interface TopicAnalysis {
  topicId: string;
  title: string;
  apiRefs: string[];
  status: string;
  summary: string;
  developerImpact: string;
  safeCodeExample: boolean;
  codeExample: string;
  caveats: string[];
  confidence: TopicConfidence;
}

export const DEFAULT_RSS_URL = "https://robloxapi.github.io/ref/updates/index.xml";
export const DEFAULT_MAX_ITEMS_PER_POLL = 3;
