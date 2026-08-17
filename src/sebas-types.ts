/** Contrato publico do Sebas (core/modules/sdk-types.ts). Modulos nao importam do core —
 * vendorizam esse arquivo, igual qualquer SDK de terceiro. */
export interface SebasModuleLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface SebasModuleStorage {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface SebasModuleConfig {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

export type SebasModuleFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  status: number;
  headers: Record<string, string>;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

export interface SebasModuleDiscord {
  sendChannelMessage(channelId: string, content: { content?: string; embeds?: unknown[]; mentionRoleIds?: string[] }): Promise<void>;
  sendDm(discordUserId: string, content: { content?: string; embeds?: unknown[] }): Promise<void>;
  editInteractionResponse(applicationId: string, interactionToken: string, content: { content?: string; embeds?: unknown[] }): Promise<void>;
}

export interface SebasModuleAiRequest {
  systemPrompt?: string;
  userPrompt: string;
  jsonSchema?: Record<string, unknown>;
  jsonSchemaName?: string;
  maxOutputTokens?: number;
  temperature?: number;
  /** Prefixa o systemPrompt com a personalidade do Sebas (mordomo, honorificos, tom formal).
   * So faz sentido pra texto livre voltado a pessoa — deixe de fora em extracao estruturada
   * (json schema tecnico), onde sotaque de personagem so atrapalha. Por isso o formatter deste
   * modulo (extracao tecnica) nao usa. */
  usePersona?: boolean;
}

export interface SebasModuleAiResult {
  ok: boolean;
  json?: unknown;
  text?: string;
  error?: string;
}

export interface SebasModuleAi {
  run(request: SebasModuleAiRequest): Promise<SebasModuleAiResult>;
}

export type SebasSqlColumnType = "text" | "integer" | "real";
export type SebasSqlValue = string | number | boolean | null;
export interface SebasSqlRow {
  [column: string]: SebasSqlValue;
}
export interface SebasSqlSelectOptions {
  where?: Record<string, SebasSqlValue>;
  orderDirection?: "asc" | "desc";
  cursor?: number;
  limit?: number;
}
export interface SebasModuleSql {
  createTable(table: string, columns: Record<string, SebasSqlColumnType>): Promise<void>;
  insert(table: string, row: SebasSqlRow): Promise<{ id: number }>;
  select(table: string, options?: SebasSqlSelectOptions): Promise<Array<SebasSqlRow & { id: number }>>;
  update(table: string, where: Record<string, SebasSqlValue>, patch: SebasSqlRow): Promise<{ changes: number }>;
  delete(table: string, where: Record<string, SebasSqlValue>): Promise<{ changes: number }>;
}

export interface SebasModuleContext {
  moduleId: string;
  logger: SebasModuleLogger;
  storage: SebasModuleStorage;
  config: SebasModuleConfig;
  sql: SebasModuleSql;
  fetch: SebasModuleFetch;
  discord: SebasModuleDiscord;
  ai: SebasModuleAi | null;
}

export interface SebasControllerRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

export interface SebasControllerResponse {
  status: number;
  body: unknown;
}
