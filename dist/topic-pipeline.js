import { analyzeTopic, stripMarkdown } from "./formatter.js";
import { aggregateTopicAnalyses, splitChangelogIntoTopics } from "./topics.js";
const MAX_ATTEMPTS_PER_TOPIC = 3;
const MIN_REMAINING_MS_TO_ATTEMPT = 3_000;
export async function runTopicPipeline(ai, update, options) {
    const topics = splitChangelogIntoTopics(update);
    if (topics.length === 0) {
        throw new Error("No topics found to analyze.");
    }
    // Uma chamada de IA por vez (concorrencia degrada latencia/confiabilidade do provider
    // compartilhado). Topicos que falham ou estouram o timeout voltam pro fim da fila e sao
    // tentados de novo enquanto sobrar orcamento de tempo.
    const deadline = Date.now() + options.maxTotalMs;
    const attempts = new Map();
    const attemptCounts = new Map();
    while (Date.now() < deadline) {
        let attemptedSomethingThisPass = false;
        for (const topic of topics) {
            if (attempts.get(topic.topicId)?.ok)
                continue;
            const attemptCount = attemptCounts.get(topic.topicId) ?? 0;
            if (attemptCount >= MAX_ATTEMPTS_PER_TOPIC)
                continue;
            const remaining = deadline - Date.now();
            if (remaining < MIN_REMAINING_MS_TO_ATTEMPT)
                break;
            const timeoutForAttempt = Math.min(options.perTopicTimeoutMs, remaining);
            const result = await analyzeTopicWithTimeout(ai, update, topic, timeoutForAttempt);
            attempts.set(topic.topicId, result);
            attemptCounts.set(topic.topicId, attemptCount + 1);
            attemptedSomethingThisPass = true;
        }
        if (!attemptedSomethingThisPass)
            break;
    }
    const analyses = topics.map((topic) => attempts.get(topic.topicId)?.analysis ?? buildFallbackAnalysis(topic, "sem tempo disponivel para analise"));
    const completedTopics = topics.filter((topic) => attempts.get(topic.topicId)?.ok).length;
    const totalTopics = topics.length;
    const changelog = aggregateTopicAnalyses(update, analyses, { completedTopics, totalTopics });
    return { changelog, completedTopics, totalTopics };
}
async function analyzeTopicWithTimeout(ai, update, topic, timeoutMs) {
    let timeoutId;
    const task = analyzeTopic(ai, update, topic)
        .then((analysis) => ({ analysis, ok: true }))
        .catch((error) => ({ analysis: buildFallbackAnalysis(topic, sanitizeErrorReason(error)), ok: false }));
    const timeoutTask = new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve({ analysis: buildFallbackAnalysis(topic, `timeout apos ${Math.round(timeoutMs / 1000)}s`), ok: false }), timeoutMs);
    });
    const result = await Promise.race([task, timeoutTask]);
    if (timeoutId)
        clearTimeout(timeoutId);
    return result;
}
function sanitizeErrorReason(error) {
    const raw = error instanceof Error ? error.message : String(error);
    if (/<html|<!doctype html/i.test(raw)) {
        const statusMatch = raw.match(/\b(50\d)\b/);
        return statusMatch ? `servico de IA instavel (HTTP ${statusMatch[1]})` : "servico de IA instavel";
    }
    return raw.replace(/\s+/g, " ").trim().slice(0, 120);
}
function buildFallbackAnalysis(topic, reason) {
    return {
        topicId: topic.topicId,
        title: topic.title,
        apiRefs: topic.apiRefs,
        status: topic.status,
        summary: stripMarkdown(topic.sourceText).slice(0, 220),
        developerImpact: "Nao foi possivel analisar este topico com IA a tempo; revise a fonte oficial.",
        safeCodeExample: false,
        codeExample: "",
        caveats: [`Analise automatica indisponivel (${reason}).`],
        confidence: "low"
    };
}
