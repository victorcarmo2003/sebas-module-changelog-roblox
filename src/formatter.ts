import type { SebasModuleAi } from "./sebas-types.js";
import type { ChangelogTopic, FormattedChangelog, RobloxReleaseNote, RobloxUpdate, TopicAnalysis } from "./types.js";

const changelogSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    highlights: { type: "array", maxItems: 5, items: { type: "string" } },
    codeLanguage: { type: "string", enum: ["lua"] },
    codeExample: { type: "string" },
    advantages: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
    disadvantages: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } },
    breakingChanges: { type: "array", maxItems: 4, items: { type: "string" } },
    footnote: { type: "string" }
  },
  required: ["title", "description", "codeLanguage", "codeExample", "advantages", "disadvantages"],
  additionalProperties: false
} as const;

const topicAnalysisSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    developerImpact: { type: "string" },
    safeCodeExample: { type: "boolean" },
    codeExample: { type: "string" },
    caveats: { type: "array", maxItems: 3, items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] }
  },
  required: ["summary", "developerImpact", "safeCodeExample", "codeExample", "caveats", "confidence"],
  additionalProperties: false
} as const;

const MAX_OFFICIAL_RELEASE_NOTES = 16;
const MAX_API_CHANGE_HINTS = 12;

type TopicAnalysisAiOutput = {
  summary?: string;
  developerImpact?: string;
  safeCodeExample?: boolean;
  codeExample?: string;
  caveats?: string[];
  confidence?: string;
};

export async function formatChangelog(ai: SebasModuleAi | null, update: RobloxUpdate): Promise<FormattedChangelog> {
  if (!ai) {
    return formatLocally(update);
  }

  const payload = buildPromptPayload(update);
  const prompt = buildMainPrompt(payload);

  const result = await ai.run({
    systemPrompt:
      "Voce transforma changelogs do Roblox em resumos tecnicos para Discord. Foque em mudancas impactantes para desenvolvedores.",
    userPrompt: prompt,
    jsonSchema: changelogSchema,
    jsonSchemaName: "discord_changelog",
    // Generoso de proposito: varios modelos free da OpenCode Zen sao "reasoning models" que
    // consomem parte do orcamento de tokens pensando antes de escrever o JSON final. Um budget
    // curto corta o reasoning no meio e o content sai vazio/invalido, caindo no fallback local.
    maxOutputTokens: 6000,
    temperature: 0.15
  });

  if (!result.ok || !result.json) {
    return formatLocally(update);
  }

  return normalizeFormatted(result.json as Partial<FormattedChangelog>, update);
}

export function formatChangelogLocally(update: RobloxUpdate): FormattedChangelog {
  return formatLocally(update);
}

export async function analyzeTopic(ai: SebasModuleAi | null, update: RobloxUpdate, topic: ChangelogTopic): Promise<TopicAnalysis> {
  if (!ai) {
    return analyzeTopicLocally(topic);
  }

  const result = await ai.run({
    systemPrompt:
      "Voce analisa um unico topico de changelog do Roblox por vez e responde em JSON estrito, sem inventar detalhes.",
    userPrompt: buildTopicPrompt(update, topic),
    jsonSchema: topicAnalysisSchema,
    jsonSchemaName: "topic_analysis",
    maxOutputTokens: 2000,
    temperature: 0.15
  });

  if (!result.ok || !result.json) {
    throw new Error(result.error || "AI provider failed to analyze topic.");
  }

  return normalizeTopicAnalysis(topic, result.json as TopicAnalysisAiOutput);
}

function analyzeTopicLocally(topic: ChangelogTopic): TopicAnalysis {
  return normalizeTopicAnalysis(topic, {
    summary: stripMarkdown(topic.sourceText).slice(0, 200),
    developerImpact: "Consulte a documentacao oficial para avaliar o impacto no seu jogo.",
    safeCodeExample: false,
    codeExample: "",
    caveats: ["Gerado sem IA (formatter local)."],
    confidence: "low"
  });
}

function buildTopicPrompt(update: RobloxUpdate, topic: ChangelogTopic): string {
  return [
    "TAREFA: analisar UM UNICO topico de um changelog do Roblox para desenvolvedores.",
    "",
    "REGRAS CRITICAS:",
    "1. Use apenas `sourceText` e `apiRefs` como fonte. Nao invente comportamento, assinatura, parametros ou retorno que nao estejam explicitos.",
    "2. `status` ja e conhecido; nao o reinterprete nem o contradiga.",
    "3. safeCodeExample so pode ser true se status for \"Live\" E sourceText detalhar o suficiente para escrever uma chamada real sem inventar assinatura.",
    "4. Se safeCodeExample for false, codeExample deve ser a string vazia \"\".",
    "5. Se safeCodeExample for true, codeExample deve ter de 3 a 8 linhas Luau e mostrar um uso realista, nao so uma chamada solta: obtenha o servico com game:GetService(...) quando fizer sentido, chame a API do topico, e use o resultado (print, comparacao ou comentario explicando o efeito). Nao adicione comentarios genericos irrelevantes.",
    "6. summary: 1-2 frases objetivas em pt-BR sobre o que mudou.",
    "7. developerImpact: 1 frase objetiva em pt-BR sobre por que isso importa para quem programa no Roblox.",
    "8. caveats: ate 3 avisos curtos em pt-BR (ex: \"nao detalha retorno\", \"ainda Pending\").",
    "9. Nao traduza nomes de APIs Roblox.",
    "10. Responda somente com JSON valido, sem markdown, sem texto antes/depois.",
    "",
    "Topico:",
    JSON.stringify(
      {
        title: topic.title,
        status: topic.status,
        apiRefs: topic.apiRefs,
        sourceText: topic.sourceText,
        updateVersion: update.versionNumber,
        updateTitle: update.title
      },
      null,
      2
    )
  ].join("\n");
}

function isCodeGroundedInApiRefs(code: string, apiRefs: string[]): boolean {
  if (!code || apiRefs.length === 0) return false;
  const lowerCode = code.toLowerCase();
  return apiRefs.some((ref) => {
    const token = (ref.split(/[:.]/).pop() || ref).toLowerCase();
    return token.length > 0 && lowerCode.includes(token);
  });
}

function normalizeTopicAnalysis(topic: ChangelogTopic, output: TopicAnalysisAiOutput): TopicAnalysis {
  const rawCodeExample = stripCodeFences(output.codeExample || "").trim();
  const groundedInApiRef = isCodeGroundedInApiRefs(rawCodeExample, topic.apiRefs);
  const safeCodeExample = output.safeCodeExample === true && topic.status === "Live" && groundedInApiRef;
  const codeExample = safeCodeExample ? rawCodeExample.slice(0, 700) : "";
  const confidence =
    output.confidence === "high" || output.confidence === "medium" || output.confidence === "low"
      ? output.confidence
      : "medium";

  return {
    topicId: topic.topicId,
    title: topic.title,
    apiRefs: topic.apiRefs,
    status: topic.status,
    summary: stripMarkdown(output.summary || topic.sourceText).slice(0, 260),
    developerImpact: stripMarkdown(output.developerImpact || "Consulte a documentacao oficial para avaliar o impacto.").slice(0, 200),
    safeCodeExample,
    codeExample,
    caveats: normalizeList(output.caveats).slice(0, 3),
    confidence
  };
}

function buildPromptPayload(update: RobloxUpdate): Record<string, unknown> {
  const officialReleaseNotes = selectOfficialReleaseNotes(update);
  const apiChangeHints = selectApiChangeHints(update);

  return {
    title: update.title,
    versionNumber: update.versionNumber,
    publishedAt: update.publishedAt,
    sourceLink: update.link,
    releaseNotesUrl: update.releaseNotesUrl,
    description: update.description,
    officialReleaseNotes,
    officialReleaseNotesOmitted: Math.max(0, update.releaseNotes.length - officialReleaseNotes.length),
    pendingReleaseNotesIgnored: countIgnoredPendingReleaseNotes(update, officialReleaseNotes),
    apiChangeHints,
    apiChangeHintsOmitted: Math.max(0, update.changes.length - apiChangeHints.length),
    sourcePriority:
      update.releaseNotes.length > 0
        ? "officialReleaseNotes are authoritative; apiChangeHints are secondary."
        : "apiChangeHints are the only source available."
  };
}

export function selectOfficialReleaseNotes(update: RobloxUpdate): Array<{ text: string; type: string; status: string }> {
  const liveNotes = update.releaseNotes.filter((note) => note.status === "Live");
  const sourceNotes = liveNotes.length > 0 ? liveNotes : update.releaseNotes;

  return sourceNotes
    .map((note, index) => ({
      ...note,
      text: normalizeApiMarkup(note.text),
      score: scoreReleaseNote(note.text, note.status),
      index
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_OFFICIAL_RELEASE_NOTES)
    .map(({ text, type, status }) => ({ text, type, status }));
}

function countIgnoredPendingReleaseNotes(update: RobloxUpdate, selectedNotes: Array<{ text: string; status: string }>): number {
  if (!update.releaseNotes.some((note) => note.status === "Live")) return 0;
  const selected = new Set(selectedNotes.map((note) => `${note.status}:${note.text}`));
  return update.releaseNotes.filter(
    (note) => note.status === "Pending" && !selected.has(`${note.status}:${normalizeApiMarkup(note.text)}`)
  ).length;
}

function selectApiChangeHints(update: RobloxUpdate): string[] {
  if (update.releaseNotes.some((note) => note.status === "Live")) return [];
  const breakingHints = update.changes.filter((change) => /^(Remove|Change)\s/.test(change));
  const additiveHints = update.releaseNotes.length > 0 ? [] : update.changes.filter((change) => /^Add\s/.test(change));
  return [...breakingHints, ...additiveHints].map(normalizeApiMarkup).slice(0, MAX_API_CHANGE_HINTS);
}

function scoreReleaseNote(text: string, status: string): number {
  const lower = text.toLowerCase();
  let score = status === "Live" ? 8 : 2;
  if (/\b(adds?|deprecates?|removes?|now|fixes?|validates?|logs?)\b/.test(lower)) score += 3;
  if (/(engine api|method|propert|class\.|service|getuser|groupservice|editablemesh|animation|texturecontent|controller)/i.test(text)) score += 5;
  if (/(deprecat|remove|breaking|now only|changed from|renamed)/i.test(text)) score += 5;
  if (/(windows accessibility|script editor|highlight|assistant|generate_mesh|generate_procedural_model)/i.test(text)) score -= 5;
  return score;
}

function normalizeApiMarkup(value: string): string {
  return value.replace(/`Class\./g, "`").replace(/`Library\./g, "`").replace(/\s+/g, " ").trim();
}

function buildMainPrompt(payload: Record<string, unknown>): string {
  return [
    "TAREFA: escrever um card tecnico de Discord sobre uma release do Roblox para desenvolvedores.",
    "",
    "REGRAS CRITICAS:",
    "1. Use `officialReleaseNotes` como fonte primaria. Elas vieram do Creator Hub.",
    "2. Use `apiChangeHints` somente para detectar possiveis breaking changes ou como apoio, nunca como tema principal se officialReleaseNotes existir.",
    "3. Nao cite quantidade total de revisoes, diffs, itens ou alteracoes. Evite frases como 'Atualizacao com X revisoes'.",
    "4. Escolha UM tema principal e, no maximo, DOIS temas secundarios. Nao misture varias features desconexas.",
    "5. Nao invente APIs, classes, propriedades, assinaturas, Services ou comportamento que nao aparecam explicitamente no payload.",
    "6. Ignore itens com status `Pending` quando houver qualquer item `Live`; Pending ainda nao foi implementado e nao deve virar tema principal.",
    "7. O exemplo Luau deve demonstrar apenas o tema principal. Nao use tema secundario no codigo.",
    "8. No codeExample, use apenas APIs com status `Live`. Se nao houver item Live, escreva um exemplo conceitual generico sem chamar APIs Pending.",
    "9. Status e disponibilidade sao por item: nunca diga que uma API `Live` esta `Pending`, nem agrupe APIs Live e Pending na mesma frase de status.",
    "10. Nao afirme permissoes, tipos de retorno, formato de dados, limites ou comportamento operacional se isso nao estiver explicitamente no payload.",
    "11. Escreva em pt-BR natural, tecnico e objetivo. Nao traduza nomes de APIs Roblox.",
    "12. Identifique breaking changes apenas quando houver remocao, deprecacao, mudanca de assinatura/tipo ou comportamento que possa quebrar codigo existente.",
    "13. Nunca escreva 'assinatura sugerida', 'retorna uma tabela', ou nomes de campos de retorno se isso nao aparecer no payload.",
    "14. Nao seja telegraphico: preencha descricao, destaques, vantagens e desvantagens com contexto util, mantendo cada item direto.",
    "15. Responda somente com JSON valido, sem markdown, sem texto antes/depois.",
    "",
    "FORMATO EXATO:",
    JSON.stringify({
      title: "string - versao + tema principal, ex: v0.725 - GetUserFromGlobalUserIdAsync",
      description: "string - 3 a 4 frases: o que mudou, onde impacta e por que importa",
      highlights: ["string objetiva baseada em officialReleaseNotes"],
      codeLanguage: "lua",
      codeExample: "string - Luau compacto e seguro, sem ```, com comentarios uteis quando a API nao detalhar assinatura",
      advantages: ["string objetiva", "string objetiva", "string objetiva"],
      disadvantages: ["string objetiva", "string objetiva"],
      breakingChanges: ["string - apenas se houver; caso contrario array vazio"],
      footnote: "string opcional - mencione escopo conceitual se relevante"
    }),
    "",
    "Changelog:",
    JSON.stringify(payload, null, 2)
  ].join("\n");
}

function formatLocally(update: RobloxUpdate): FormattedChangelog {
  const highlights = buildOfficialHighlights(update);
  const firstAdd = update.changes.find((change) => change.startsWith("Add "));
  const firstReleaseNote = update.releaseNotes[0]?.text;
  const firstChange = firstAdd || update.changes[0] || firstReleaseNote || "Roblox API update";
  const sourceSummary = highlights.length > 0 ? highlights.slice(0, 3).map(stripMarkdown).join(" ") : stripMarkdown(firstChange);

  return normalizeFormatted(
    {
      title: `Roblox ${update.title}`,
      description: `${versionLabel(update)} traz uma nova rodada de mudancas oficiais para APIs e comportamento do Roblox. ${sourceSummary} Use este resumo como ponto de partida e confira a referencia oficial antes de alterar codigo de producao.`,
      highlights,
      codeLanguage: "lua",
      codeExample: [
        "-- Exemplo conceitual baseado no changelog",
        "local Players = game:GetService(\"Players\")",
        "",
        "Players.PlayerAdded:Connect(function(player)",
        "    print(\"Novo recurso do Roblox disponivel para testar:\", player.Name)",
        "end)"
      ].join("\n"),
      advantages: [
        "Ajuda desenvolvedores a notar novas APIs rapidamente.",
        "Facilita testes logo depois que a mudanca fica disponivel.",
        "Mantem o resumo preso aos dados oficiais do feed e do Creator Hub."
      ],
      disadvantages: [
        "Algumas mudancas podem estar pendentes ou protegidas por seguranca.",
        "O exemplo local e generico; confira a documentacao oficial para uso real.",
        "Sem IA, o texto fica menos interpretativo e pode priorizar menos contexto de impacto."
      ],
      breakingChanges: [],
      footnote: "Gerado com formatter local."
    },
    update
  );
}

function normalizeFormatted(changelog: Partial<FormattedChangelog>, update?: RobloxUpdate): FormattedChangelog {
  const formatted: FormattedChangelog = {
    title: stripMarkdown(changelog.title || "Roblox changelog").slice(0, 120),
    description: stripCodeFences(changelog.description || "Resumo indisponivel. Consulte a fonte oficial.").slice(0, 1200),
    highlights: normalizeList(changelog.highlights).slice(0, 5),
    codeLanguage: "lua",
    codeExample: stripCodeFences(changelog.codeExample || "-- Consulte a documentacao oficial para um exemplo completo.").trim().slice(0, 980),
    advantages: normalizeList(changelog.advantages).slice(0, 4),
    disadvantages: normalizeList(changelog.disadvantages).slice(0, 4),
    breakingChanges: normalizeList(changelog.breakingChanges).slice(0, 4),
    footnote: changelog.footnote ? stripMarkdown(changelog.footnote).slice(0, 240) : undefined
  };

  return update ? sanitizeFormatted(formatted, update) : formatted;
}

function sanitizeFormatted(changelog: FormattedChangelog, update: RobloxUpdate): FormattedChangelog {
  const sourceText = sourceTextForUpdate(update);
  const description = removeUnsupportedSentences(changelog.description, sourceText);
  const footnote = changelog.footnote ? removeUnsupportedSentences(changelog.footnote, sourceText) : undefined;
  const advantages = filterUnsupportedItems(changelog.advantages, sourceText);
  const disadvantages = filterUnsupportedItems(changelog.disadvantages, sourceText);
  const useConceptualCode = shouldUseConceptualCode(changelog.codeExample, update);
  const highlights = buildOfficialHighlights(update);

  return {
    ...changelog,
    title: useConceptualCode ? `${versionLabel(update)} - Destaques do Creator Hub` : changelog.title,
    highlights,
    description: useConceptualCode
      ? buildReleaseOverviewDescription(update)
      : description || changelog.description.split(/[.!?]\s+/)[0] || changelog.description,
    codeExample: useConceptualCode ? buildConceptualCodeExample(update) : changelog.codeExample,
    advantages: useConceptualCode
      ? [
          "Foca apenas nas mudanças Live que já podem ser consideradas pelos desenvolvedores.",
          "Evita transformar itens Pending em exemplos ou recomendações prematuras."
        ]
      : advantages.length > 0
        ? advantages
        : ["Destaca uma mudanca oficial relevante para desenvolvedores Roblox."],
    disadvantages: useConceptualCode
      ? [
          "Algumas notas Live ainda não detalham assinatura, parâmetros ou formato de retorno.",
          "Itens Pending são omitidos até aparecerem como Live no Creator Hub."
        ]
      : disadvantages.length > 0
        ? disadvantages
        : ["A release note pode nao detalhar assinatura, parametros ou formato de retorno."],
    breakingChanges: filterUnsupportedItems(changelog.breakingChanges || [], sourceText),
    footnote: useConceptualCode ? buildReleaseFootnote(update) : footnote || undefined
  };
}

function sourceTextForUpdate(update: RobloxUpdate): string {
  return [update.title, update.description, ...update.releaseNotes.map((note) => `${note.status} ${note.text}`), ...update.changes]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function removeUnsupportedSentences(value: string, sourceText: string): string {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !isUnsupportedClaim(sentence, sourceText))
    .join(" ")
    .trim();
}

function filterUnsupportedItems(items: string[], sourceText: string): string[] {
  return items.filter((item) => !isUnsupportedClaim(item, sourceText));
}

function isUnsupportedClaim(value: string, sourceText: string): boolean {
  const lower = value.toLowerCase();
  const unsupportedClaims = [
    { claim: /login|autentic/, source: /login|auth|autentic/ },
    { claim: /extern/, source: /external|extern/ },
    { claim: /permiss/, source: /permission|permiss/ },
    { claim: /retorno|estrutura de dados|formato de dados/, source: /return|retorno|structure|estrutura|format|formato/ },
    { claim: /conta ativa|usuario ativo|usuário ativo/, source: /active|ativo|ativa/ },
    { claim: /inativ|inactive/, source: /inactive|inativ/ },
    { claim: /cache/, source: /cache/ }
  ];
  if (unsupportedClaims.some(({ claim, source }) => claim.test(lower) && !source.test(sourceText))) return true;
  return hasIncorrectPendingClaim(lower, sourceText);
}

function hasIncorrectPendingClaim(value: string, sourceText: string): boolean {
  if (!/pending/i.test(value) || /\blive\b/i.test(value)) return false;
  return extractIdentifiersByStatus(sourceText, "live").some((identifier) => value.includes(identifier.toLowerCase()));
}

function shouldUseConceptualCode(codeExample: string, update: RobloxUpdate): boolean {
  const code = codeExample.toLowerCase();
  const sourceText = sourceTextForUpdate(update);

  if (/(assinatura sugerida|signature suggested|retorna uma tabela|returns a table|possui cargo|role\.name|players\.localplayer|findfirstchildofclass\("animationtrack"\))/i.test(codeExample)) {
    return true;
  }
  if (extractIdentifiersByStatus(sourceText, "pending").some((identifier) => code.includes(identifier.toLowerCase()))) return true;
  if (extractApiTokensByStatus(update, "Pending").some((token) => code.includes(token.toLowerCase()))) return true;

  return extractAmbiguousMethods(update).some((method) => {
    const callMatch = codeExample.match(new RegExp(`[:.]${escapeRegExp(method)}\\((?<args>[^)]*)\\)`, "i"));
    return Boolean(callMatch?.groups?.["args"]?.trim());
  });
}

export function buildConceptualCodeExample(update: RobloxUpdate): string {
  const notes = selectOfficialReleaseNotes(update);
  const pendingMethodNote = notes.find((item) => item.status === "Pending" && extractFirstMethodReference(item.text));
  if (pendingMethodNote) {
    const method = extractFirstMethodReference(pendingMethodNote.text)!;
    return [
      `-- ${method.service}:${method.method} ainda esta Pending nesta release`,
      "-- Padrao seguro: mantenha um fallback ate confirmar que a API ficou Live.",
      `local ${method.service} = game:GetService("${method.service}")`,
      "",
      "local FEATURE_LIVE = false",
      "",
      "local function useNewApiWhenAvailable()",
      "    if not FEATURE_LIVE then",
      "        -- Use o fluxo antigo/atual do seu jogo por enquanto.",
      "        return nil",
      "    end",
      "",
      "    -- Quando o Creator Hub marcar como Live e documentar a assinatura,",
      `    -- implemente aqui a chamada para ${method.service}:${method.method}.`,
      "    return nil",
      "end",
      "",
      "print(useNewApiWhenAvailable())"
    ].join("\n");
  }

  const note = notes.find((item) => item.status === "Live") || notes[0];
  const method = note ? extractFirstMethodReference(note.text) : undefined;

  if (method) {
    return [
      `-- Preparando adoção de ${method.service}:${method.method}`,
      `local ${method.service} = game:GetService("${method.service}")`,
      "",
      "local function runWithReleaseGuard(callback)",
      "    local ok, result = pcall(callback)",
      "    if not ok then",
      "        warn(\"API da release ainda precisa ser validada:\", result)",
      "        return nil",
      "    end",
      "    return result",
      "end",
      "",
      "-- A release note confirma a API, mas nao detalha todos os argumentos/retorno.",
      "-- Troque o corpo abaixo pela chamada oficial depois de conferir a referencia.",
      "local result = runWithReleaseGuard(function()",
      `    -- return ${method.service}:${method.method}(...)`,
      "    return nil",
      "end)",
      "",
      "print(result)"
    ].join("\n");
  }

  return [
    "-- Exemplo conceitual baseado no changelog oficial",
    "-- Confira a documentação oficial da release antes de usar em produção.",
    `print("${update.title}")`
  ].join("\n");
}

function buildReleaseOverviewDescription(update: RobloxUpdate): string {
  const liveCount = update.releaseNotes.filter((note) => note.status === "Live").length;
  const pendingCount = update.releaseNotes.filter((note) => note.status === "Pending").length;
  const pendingText =
    liveCount > 0 && pendingCount > 0
      ? "Itens Pending foram ignorados porque ainda não estão implementados."
      : "O exemplo fica conceitual quando a nota não traz assinatura completa.";
  return `${versionLabel(update)} traz mudanças oficiais do Creator Hub para APIs, propriedades e correções de engine/Studio. ${pendingText}`;
}

function buildReleaseFootnote(update: RobloxUpdate): string | undefined {
  const liveCount = update.releaseNotes.filter((note) => note.status === "Live").length;
  const pendingCount = update.releaseNotes.filter((note) => note.status === "Pending").length;
  if (liveCount > 0 && pendingCount > 0) return `${pendingCount} item(ns) Pending foram omitidos.`;
  return undefined;
}

export function versionLabel(update: RobloxUpdate): string {
  return update.versionNumber ? `v${update.versionNumber}` : update.title;
}

function buildOfficialHighlights(update: RobloxUpdate): string[] {
  const selected: RobloxReleaseNote[] = [];
  const hasLiveNotes = update.releaseNotes.some((note) => note.status === "Live");
  const candidateNotes = hasLiveNotes ? update.releaseNotes.filter((note) => note.status === "Live") : update.releaseNotes;
  const preferredPatterns = [
    /editablemesh|createdatamodelcontentasync/i,
    /getuserfromglobaluseridasync/i,
    /getrolesingroupasync|deprecates/i,
    /texturecontent|meshcontent|animationcontent|charactermesh/i,
    /editablemesh:clear/i,
    /groundcontroller/i
  ];

  for (const status of hasLiveNotes ? ["Live"] : ["Pending"]) {
    for (const pattern of preferredPatterns) {
      const note = candidateNotes.find((item) => item.status === status && pattern.test(item.text) && !selected.includes(item));
      if (note) selected.push(note);
    }
  }

  for (const pattern of preferredPatterns) {
    const note = candidateNotes.find((item) => pattern.test(item.text) && !selected.includes(item));
    if (note) selected.push(note);
  }

  for (const note of selectOfficialReleaseNotes(update)) {
    if (selected.length >= 5) break;
    const original = update.releaseNotes.find((item) => item.text === note.text || normalizeApiMarkup(item.text) === note.text);
    if (original && !selected.includes(original)) selected.push(original);
  }

  return selected.slice(0, 5).map(formatReleaseNoteHighlight);
}

function formatReleaseNoteHighlight(note: RobloxReleaseNote): string {
  const status = note.status === "Live" ? "Live" : note.status === "Pending" ? "Pending" : note.status;
  const text = normalizeApiMarkup(note.text);

  if (/getuserfromglobaluseridasync/i.test(text)) return `[${status}] \`UserService:GetUserFromGlobalUserIdAsync()\` foi adicionado.`;
  if (/createdatamodelcontentasync|editablemesh/i.test(text) && /descriptive errors|errors?|mensagens?/i.test(text)) {
    return `[${status}] \`AssetService:CreateDataModelContentAsync()\` agora registra erros mais claros ao criar \`EditableMesh\`.`;
  }
  if (/getrolesingroupasync/i.test(text)) return `[${status}] \`GroupService:GetRolesInGroupAsync(userId, groupId)\` lista todos os roles e depreca os helpers antigos de \`Player\`.`;
  if (/texturecontent|meshcontent|animationcontent|charactermesh/i.test(text)) return `[${status}] Novos campos de conteúdo para animações, meshes, beams e partículas.`;
  if (/editablemesh:clear/i.test(text)) return `[${status}] \`EditableMesh:Clear()\` limpa vértices, bones e FACS sem remover o objeto.`;
  if (/groundcontroller/i.test(text)) return `[${status}] \`GroundController.AccelerationTime\` e \`DecelerationTime\` passam a afetar só aceleração linear.`;
  return `[${status}] ${stripMarkdown(text).slice(0, 180)}`;
}

function extractApiTokensByStatus(update: RobloxUpdate, status: string): string[] {
  const tokens = new Set<string>();
  for (const note of update.releaseNotes) {
    if (note.status !== status) continue;
    const text = normalizeApiMarkup(note.text);
    const patterns = [/\b[A-Z]\w*[:.][A-Za-z]\w*(?:Async)?\b/g, /`([^`]+)`/g];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const raw = (match[1] || match[0]).replace(/\(\)$/g, "");
        for (const token of raw.split(/[,\s]+/)) {
          const cleaned = token.replace(/[()`]/g, "").trim();
          if (/^[A-Z]\w*[:.][A-Za-z]\w*(?:Async)?$/.test(cleaned)) {
            tokens.add(cleaned);
            tokens.add(cleaned.split(/[:.]/).pop()!);
          }
        }
      }
    }
  }
  return [...tokens];
}

function extractIdentifiersByStatus(sourceText: string, status: string): string[] {
  const identifiers = new Set<string>();
  const pattern = new RegExp(`${status}[^\\n]*\`([^\\\`]+)\``, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sourceText))) {
    const identifier = match[1].split(/[(:.]/).filter(Boolean).pop();
    if (identifier) identifiers.add(identifier);
  }
  return [...identifiers];
}

function extractAmbiguousMethods(update: RobloxUpdate): string[] {
  return update.releaseNotes.flatMap((note) => {
    const matches = [...note.text.matchAll(/`(?:Class\.)?[A-Za-z]\w*:(?<method>[A-Za-z]\w*)\(\)`/g)];
    return matches.map((match) => match.groups?.["method"]).filter((method): method is string => Boolean(method));
  });
}

function extractFirstMethodReference(text: string): { service: string; method: string } | undefined {
  const match = text.match(/`(?:Class\.)?(?<service>[A-Za-z]\w*):(?<method>[A-Za-z]\w*)\(/);
  if (!match?.groups) return undefined;
  return { service: match.groups["service"], method: match.groups["method"] };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map(stripMarkdown).filter(Boolean);
}

export function stripMarkdown(value: string): string {
  return value.replace(/[`*_~>#]/g, "").replace(/\s+/g, " ").trim();
}

function stripCodeFences(value: string): string {
  return value.replace(/```(?:lua)?/gi, "").trim();
}
