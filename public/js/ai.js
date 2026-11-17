// ============================================================================
// Processamento de linguagem natural com Firebase AI Logic (Gemini)
// Fase 1: Modelo Flash-Lite, streaming, cache em memória, timeout 8s e fallback
// ============================================================================

import { getGenerativeModel, Schema } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js';
import { ai } from './firebase-config.js?v=5';

const PRIORIDADES_VALIDAS = new Set(['baixa', 'media', 'alta', 'urgente']);
const MODELO_GEMINI = 'gemini-3.5-flash-lite';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_CACHE_SIZE = 50;

let structuredModel = null;
const aiResponseCache = new Map();

/**
 * Retorna ou cria a instância do modelo Gemini configurado com Structured Output.
 * Pré-aquecido no carregamento para eliminar custo de inicialização na primeira fala.
 */
function getStructuredModel() {
  if (!ai) return null;
  if (!structuredModel) {
    structuredModel = getGenerativeModel(ai, {
      model: MODELO_GEMINI,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 280,
        responseMimeType: 'application/json',
        responseSchema: Schema.object({
          properties: {
            titulo: Schema.string(),
            descricao: Schema.string(),
            prioridade: Schema.enumString({ enum: ['baixa', 'media', 'alta', 'urgente'] }),
            prazo: Schema.string({ nullable: true }),
            categoria: Schema.string({ nullable: true })
          },
          optionalProperties: ['prazo', 'categoria']
        })
      }
    });
  }
  return structuredModel;
}

/**
 * Pré-aquece o modelo Gemini ao abrir o sistema.
 */
export function warmUpAiModel() {
  try {
    getStructuredModel();
  } catch {
    // Ignora caso o Firebase ainda não esteja configurado
  }
}

/**
 * Calcula data ISO (YYYY-MM-DD) somando dias a partir de hoje no fuso local.
 * @param {number} daysToAdd
 */
function addDaysISO(daysToAdd) {
  const d = new Date();
  d.setDate(d.getDate() + daysToAdd);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Tenta inferir prioridade localmente a partir de palavras-chave em português.
 * @param {string} textoLower
 */
function inferPriorityFallback(textoLower) {
  if (/\b(urgente|urgência|emergência|emergencia|pra ontem|para ontem|imediato|imediatamente|crítico|critico|o quanto antes)\b/.test(textoLower)) {
    return 'urgente';
  }
  if (/\b(alta|importante|prioridade|prioritário|prioritario)\b/.test(textoLower)) {
    return 'alta';
  }
  if (/\b(baixa|sem pressa|quando der|tranquilo|depois)\b/.test(textoLower)) {
    return 'baixa';
  }
  return 'media';
}

/**
 * Tenta inferir prazo ISO localmente ("hoje", "amanhã", dia da semana, "dia X [de mês]").
 * @param {string} textoLower
 */
function inferDeadlineFallback(textoLower) {
  if (/\bdepois de amanh[ãa]\b/.test(textoLower)) return addDaysISO(2);
  if (/\bamanh[ãa]\b/.test(textoLower)) return addDaysISO(1);
  if (/\bhoje\b/.test(textoLower)) return addDaysISO(0);

  const diasSemana = [
    { regex: /\bdomingo\b/, dow: 0 },
    { regex: /\bsegunda(?:-feira)?\b/, dow: 1 },
    { regex: /\bter[çc]a(?:-feira)?\b/, dow: 2 },
    { regex: /\bquarta(?:-feira)?\b/, dow: 3 },
    { regex: /\bquinta(?:-feira)?\b/, dow: 4 },
    { regex: /\bsexta(?:-feira)?\b/, dow: 5 },
    { regex: /\bs[áa]bado\b/, dow: 6 }
  ];

  const hojeDow = new Date().getDay();
  for (const item of diasSemana) {
    if (item.regex.test(textoLower)) {
      let diff = (item.dow - hojeDow + 7) % 7;
      if (diff === 0) diff = 7;
      return addDaysISO(diff);
    }
  }

  const meses = {
    janeiro: 0, fevereiro: 1, marco: 2, 'março': 2, abril: 3,
    maio: 4, junho: 5, julho: 6, agosto: 7, setembro: 8,
    outubro: 9, novembro: 10, dezembro: 11
  };

  const matchDiaMes = textoLower.match(/\bdia\s+(\d{1,2})(?:\s+de\s+([a-zç]+))?\b/);
  if (matchDiaMes) {
    const dia = Number(matchDiaMes[1]);
    const nomeMes = matchDiaMes[2];
    if (dia >= 1 && dia <= 31) {
      const agora = new Date();
      const mes = nomeMes && meses[nomeMes] !== undefined ? meses[nomeMes] : agora.getMonth();
      const alvo = new Date(agora.getFullYear(), mes, dia);
      if (alvo < new Date(agora.getFullYear(), agora.getMonth(), agora.getDate())) {
        if (nomeMes && meses[nomeMes] !== undefined) {
          alvo.setFullYear(alvo.getFullYear() + 1);
        } else {
          alvo.setMonth(alvo.getMonth() + 1);
        }
      }
      const y = alvo.getFullYear();
      const m = String(alvo.getMonth() + 1).padStart(2, '0');
      const d = String(alvo.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  return null;
}

/**
 * Gera um título curto e objetivo localmente removendo prefixos de fala e menções de urgência/prazo.
 * @param {string} limpo
 */
function buildCleanTitleFallback(limpo) {
  let base = limpo
    .replace(/^(eu\s+)?(preciso|tenho que|precisamos|lembrar de|anota a[íi]|por favor|favor|demanda(?:\s+de)?)\s+/i, '')
    .replace(/[,;.\s]*(?:essa\s+demanda\s+)?(?:urgente|priorit[áa]ria)?\s*precisa\s+ser\s+(?:realizada|feita|entregue).*$/i, '')
    .replace(/[,;.\s]*(?:at[ée]|para)\s+(?:o\s+)?dia\s+\d{1,2}(?:\s+de\s+[a-zç]+)?.*$/i, '')
    .replace(/[,;.\s]*(?:isso\s+)?[ée]\s+(?:uma\s+demanda\s+)?(urgente|prioridade|alta|baixa|para ontem)\b.*$/i, '')
    .replace(/[,;.\s]*\b(urgente|com urg[êe]ncia)\b[.!]*$/i, '')
    .trim();

  if (!base) base = limpo;

  const primeiraFrase = base.split(/[.!?]/)[0].trim();
  if (primeiraFrase.length >= 6) {
    base = primeiraFrase;
  }

  base = base.charAt(0).toUpperCase() + base.slice(1);

  if (base.length <= 70) return base;
  const corte = base.slice(0, 67);
  const ultimoEspaco = corte.lastIndexOf(' ');
  return `${ultimoEspaco > 20 ? corte.slice(0, ultimoEspaco) : corte}...`;
}

/**
 * Heurística local instantânea (< 5ms) para prévia imediata e fallback.
 * @param {string} texto
 */
export function buildFallbackDemand(texto) {
  const limpo = String(texto || '').trim().replace(/\s+/g, ' ');
  const lower = limpo.toLowerCase();

  const titulo = buildCleanTitleFallback(limpo) || 'Nova demanda';
  const descricao = limpo
    ? limpo.charAt(0).toUpperCase() + limpo.slice(1)
    : '';
  const prioridade = inferPriorityFallback(lower);
  const prazo = inferDeadlineFallback(lower);

  return {
    titulo,
    descricao,
    prioridade,
    prazo,
    categoria: null
  };
}

/**
 * Valida e sanitiza o JSON devolvido pela IA antes de qualquer uso ou gravação.
 * @param {unknown} raw
 * @param {string} textoOriginal
 */
export function validateAiDemandJson(raw, textoOriginal) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Resposta da IA não é um objeto JSON válido.');
  }

  const titulo = typeof raw.titulo === 'string' ? raw.titulo.trim() : '';
  if (!titulo) {
    throw new Error('Título ausente na resposta da IA.');
  }

  const descricao =
    typeof raw.descricao === 'string' && raw.descricao.trim()
      ? raw.descricao.trim()
      : textoOriginal.trim();

  const prioridade = PRIORIDADES_VALIDAS.has(raw.prioridade) ? raw.prioridade : 'media';

  let prazo = null;
  if (typeof raw.prazo === 'string' && raw.prazo.trim()) {
    const candidato = raw.prazo.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidato)) {
      prazo = candidato;
    }
  }

  const categoria =
    typeof raw.categoria === 'string' && raw.categoria.trim()
      ? raw.categoria.trim().slice(0, 80)
      : null;

  return {
    titulo: titulo.slice(0, 70),
    descricao: descricao.slice(0, 5000),
    prioridade,
    prazo,
    categoria
  };
}

/**
 * Extrai campos completos já fechados de um buffer JSON parcial durante o streaming.
 * @param {string} buffer
 */
function extractPartialFieldsFromJsonStream(buffer) {
  const partial = {};
  const extractStringField = (key) => {
    const regex = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
    const m = buffer.match(regex);
    if (!m) return undefined;
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch {
      return m[1];
    }
  };

  const titulo = extractStringField('titulo');
  if (titulo) partial.titulo = titulo.slice(0, 70);

  const descricao = extractStringField('descricao');
  if (descricao) partial.descricao = descricao;

  const prioridade = extractStringField('prioridade');
  if (prioridade && PRIORIDADES_VALIDAS.has(prioridade)) partial.prioridade = prioridade;

  const prazo = extractStringField('prazo');
  if (prazo && /^\d{4}-\d{2}-\d{2}$/.test(prazo)) partial.prazo = prazo;

  const categoria = extractStringField('categoria');
  if (categoria) partial.categoria = categoria.slice(0, 80);

  return partial;
}

/**
 * Monta prompt enxuto com data/hora atual e fuso horário do navegador.
 * @param {string} texto
 */
function buildCompactPrompt(texto) {
  const agora = new Date();
  const dataISO = addDaysISO(0);
  const hora = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const diaSemana = agora.toLocaleDateString('pt-BR', { weekday: 'long' });
  const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';

  return `Organize a demanda em JSON (pt-BR). Hoje: ${diaSemana}, ${dataISO} ${hora} (${fuso}).
Regras:
- titulo: ação curta e objetiva (máx. 70 chars), sem "preciso/urgente/prazo".
- descricao: resumo claro do que foi dito, sem inventar dados.
- prioridade: "baixa" | "media" | "alta" | "urgente".
- prazo: "YYYY-MM-DD" se mencionado, senão null.
- categoria: tema ou solicitante se mencionado, senão null.
Texto: """${texto}"""`;
}

/**
 * Salva resultado no cache em memória respeitando limite máximo.
 */
function saveToCache(key, demanda) {
  if (aiResponseCache.size >= MAX_CACHE_SIZE) {
    const firstKey = aiResponseCache.keys().next().value;
    aiResponseCache.delete(firstKey);
  }
  aiResponseCache.set(key, demanda);
}

/**
 * Organiza demanda com streaming via Firebase AI Logic, cache local e timeout (~8s).
 * @param {string} textoLivre
 * @param {{ onPartial?: (fields: object) => void, timeoutMs?: number }} [options]
 */
export async function parseDemandWithAIStream(textoLivre, options = {}) {
  const texto = String(textoLivre || '').trim();
  if (!texto) {
    throw new Error('Digite ou fale algo antes de organizar.');
  }

  const cacheKey = texto.toLowerCase().replace(/\s+/g, ' ');
  const t0 = performance.now();

  if (aiResponseCache.has(cacheKey)) {
    const cachedDemand = aiResponseCache.get(cacheKey);
    const elapsedMs = Math.round(performance.now() - t0);
    return { demanda: { ...cachedDemand }, usedFallback: false, cached: true, elapsedMs };
  }

  const model = getStructuredModel();
  if (!model) {
    return {
      demanda: buildFallbackDemand(texto),
      usedFallback: true,
      timedOut: false,
      reason: 'IA não inicializada',
      elapsedMs: Math.round(performance.now() - t0)
    };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let cancelled = false;

  const runStream = async () => {
    const prompt = buildCompactPrompt(texto);
    const result = await model.generateContentStream(prompt);
    let buffer = '';
    const sent = {};

    for await (const chunk of result.stream) {
      if (cancelled) break;
      buffer += chunk.text();
      if (options.onPartial) {
        const partial = extractPartialFieldsFromJsonStream(buffer);
        const delta = {};
        for (const [k, v] of Object.entries(partial)) {
          if (sent[k] !== v) {
            sent[k] = v;
            delta[k] = v;
          }
        }
        if (Object.keys(delta).length > 0) {
          options.onPartial(delta);
        }
      }
    }

    const finalResponse = await result.response;
    const finalJsonText = finalResponse.text() || buffer;
    const parsed = JSON.parse(finalJsonText);
    const demanda = validateAiDemandJson(parsed, texto);
    saveToCache(cacheKey, demanda);
    return demanda;
  };

  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      cancelled = true;
      reject(new Error(`Tempo limite da IA (${Math.round(timeoutMs / 1000)}s) excedido`));
    }, timeoutMs);
  });

  try {
    const demanda = await Promise.race([runStream(), timeoutPromise]);
    clearTimeout(timerId);
    const elapsedMs = Math.round(performance.now() - t0);
    return { demanda, usedFallback: false, cached: false, elapsedMs };
  } catch (err) {
    clearTimeout(timerId);
    const elapsedMs = Math.round(performance.now() - t0);
    const timedOut = String(err?.message || '').includes('Tempo limite');
    console.warn('[Pauta AI] Fallback acionado:', err);
    return {
      demanda: buildFallbackDemand(texto),
      usedFallback: true,
      timedOut,
      reason: err?.message || 'Erro ao consultar IA',
      elapsedMs
    };
  }
}

// ============================================================================
// Fase 3: Detecção local de duplicatas + Captura em lote
// ============================================================================

function tokenizeNorm(str) {
  return new Set(
    String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\W+/)
      .filter((w) => w.length >= 3)
  );
}

/**
 * Compara um novo título/descrição com demandas pendentes locais.
 * Retorna a demanda mais parecida se similaridade >= 0.55.
 */
export function findSimilarPendingDemand(titulo, descricao, demandasPendentes) {
  const tokensA = tokenizeNorm(`${titulo} ${descricao}`);
  if (tokensA.size === 0) return null;

  let best = null;
  let bestScore = 0;

  for (const d of demandasPendentes) {
    if (d.status === 'concluida') continue;
    const tokensB = tokenizeNorm(`${d.titulo} ${d.descricao || ''}`);
    if (tokensB.size === 0) continue;

    let intersection = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) intersection += 1;
    }
    const union = new Set([...tokensA, ...tokensB]).size;
    const jaccard = union > 0 ? intersection / union : 0;

    if (jaccard >= 0.55 && jaccard > bestScore) {
      bestScore = jaccard;
      best = d;
    }
  }

  return best;
}

/**
 * Divide localmente textos com múltiplas demandas (ex: "fazer A, depois B, e também C").
 */
export function splitLocalBatchFallback(texto) {
  const partes = String(texto || '')
    .split(/\n+|;\s+|\s+e\s+tamb[ée]m\s+|,\s*depois\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 4);

  if (partes.length <= 1) {
    return [buildFallbackDemand(texto)];
  }
  return partes.slice(0, 10).map((p) => buildFallbackDemand(p));
}

/**
 * Extrai 1 ou múltiplas demandas de um texto/e-mail colado ou fala em lote.
 */
export async function parseBatchDemandsWithAI(textoLivre) {
  const texto = String(textoLivre || '').trim();
  if (!texto) throw new Error('Texto vazio.');
  if (!ai) return { demandas: splitLocalBatchFallback(texto), usedFallback: true };

  const batchModel = getGenerativeModel(ai, {
    model: MODELO_GEMINI,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 700,
      responseMimeType: 'application/json',
      responseSchema: Schema.object({
        properties: {
          demandas: Schema.array({
            items: Schema.object({
              properties: {
                titulo: Schema.string(),
                descricao: Schema.string(),
                prioridade: Schema.enumString({ enum: ['baixa', 'media', 'alta', 'urgente'] }),
                prazo: Schema.string({ nullable: true }),
                categoria: Schema.string({ nullable: true })
              },
              optionalProperties: ['prazo', 'categoria']
            })
          })
        }
      })
    }
  });

  const dataISO = addDaysISO(0);
  const prompt = `Extraia todas as demandas distintas do texto abaixo (pt-BR). Hoje: ${dataISO}.
Se houver apenas 1 demanda, retorne lista com 1 item. Máximo 10 itens.
Texto: """${texto}"""`;

  try {
    const res = await batchModel.generateContent(prompt);
    const parsed = JSON.parse(res.response.text());
    if (!Array.isArray(parsed?.demandas) || parsed.demandas.length === 0) {
      throw new Error('Lista vazia');
    }
    const validas = parsed.demandas
      .slice(0, 10)
      .map((item) => validateAiDemandJson(item, texto));
    return { demandas: validas, usedFallback: false };
  } catch (err) {
    console.warn('[Pauta AI Batch] Usando fallback local:', err);
    return { demandas: splitLocalBatchFallback(texto), usedFallback: true };
  }
}

// ============================================================================
// Fase 4: Interpretação de Comandos de Voz de Gestão
// ============================================================================

function interpretCommandLocally(texto) {
  const lower = texto.toLowerCase().trim();
  if (/(o que|quais).*(pendente|abert|falta)/i.test(lower)) {
    return { tipo: 'comando', acao: 'listar_pendentes', alvo: null };
  }
  if (/(qual|quais).*(mais antiga|antiga)/i.test(lower)) {
    return { tipo: 'comando', acao: 'mais_antiga', alvo: null };
  }
  if (/(o que|quais).*(vence|vencem).*hoje/i.test(lower)) {
    return { tipo: 'comando', acao: 'vence_hoje', alvo: null };
  }
  const mConcluir = lower.match(/^(?:conclui|concluir|finaliza|finalizar|fecha|fechar|marca como conclu[íi]da)\s+(?:a\s+demanda\s+(?:do|da|de)?\s*)?(.+)$/i);
  if (mConcluir) {
    return { tipo: 'comando', acao: 'concluir', alvo: mConcluir[1].trim() };
  }
  const mAdiar = lower.match(/^(?:adia|adiar|empurra|joga)\s+(?:a\s+demanda\s+(?:do|da|de)?\s*)?(.+?)\s+(?:para|pra)\s+(.+)$/i);
  if (mAdiar) {
    return {
      tipo: 'comando',
      acao: 'adiar',
      alvo: mAdiar[1].trim(),
      novoPrazo: inferDeadlineFallback(mAdiar[2]) || addDaysISO(1)
    };
  }
  const mExcluir = lower.match(/^(?:exclui|excluir|apaga|apagar|remove|remover|deleta|deletar)\s+(?:a\s+demanda\s+(?:do|da|de)?\s*)?(.+)$/i);
  if (mExcluir) {
    return { tipo: 'comando', acao: 'excluir', alvo: mExcluir[1].trim() };
  }
  return { tipo: 'nova_demanda', acao: 'nenhuma', alvo: null };
}

/**
 * Classifica se a fala é comando de gestão ou nova demanda e devolve JSON estruturado de intenção.
 */
export async function interpretVoiceCommandWithAI(textoLivre, modoForcado = 'auto') {
  const texto = String(textoLivre || '').trim();
  if (!texto) throw new Error('Texto vazio.');

  if (!ai) {
    const local = interpretCommandLocally(texto);
    if (modoForcado === 'comando' && local.tipo === 'nova_demanda') {
      return { ...local, tipo: 'comando', acao: 'listar_pendentes' };
    }
    return local;
  }

  const cmdModel = getGenerativeModel(ai, {
    model: MODELO_GEMINI,
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 180,
      responseMimeType: 'application/json',
      responseSchema: Schema.object({
        properties: {
          tipo: Schema.enumString({ enum: ['nova_demanda', 'comando'] }),
          acao: Schema.enumString({
            enum: ['listar_pendentes', 'mais_antiga', 'vence_hoje', 'concluir', 'adiar', 'alterar_prioridade', 'excluir', 'nenhuma']
          }),
          alvo: Schema.string({ nullable: true }),
          novaPrioridade: Schema.enumString({ enum: ['baixa', 'media', 'alta', 'urgente'], nullable: true }),
          novoPrazo: Schema.string({ nullable: true })
        },
        optionalProperties: ['alvo', 'novaPrioridade', 'novoPrazo']
      })
    }
  });

  const dataISO = addDaysISO(0);
  const prompt = `Classifique a fala do usuário (pt-BR). Hoje: ${dataISO}. Modo: ${modoForcado}.
Se modo="comando", sempre retorne tipo="comando".
Se for pergunta ou ação sobre demandas existentes ("o que está pendente?", "qual a mais antiga?", "conclui X", "adia X para sexta", "muda prioridade de X para urgente", "exclui X"), retorne tipo="comando" e preencha acao/alvo/novaPrioridade/novoPrazo (YYYY-MM-DD).
Caso contrário, retorne tipo="nova_demanda" e acao="nenhuma".
Fala: """${texto}"""`;

  try {
    const res = await cmdModel.generateContent(prompt);
    const parsed = JSON.parse(res.response.text());
    if (modoForcado === 'comando') parsed.tipo = 'comando';
    return parsed;
  } catch (err) {
    console.warn('[Pauta AI Command] Fallback local:', err);
    return interpretCommandLocally(texto);
  }
}

// ============================================================================
// Fase 5: Resumo Semanal sob demanda
// ============================================================================

export async function generateWeeklySummaryWithAI(metrics, demandas) {
  if (!ai) {
    return `Resumo local: você tem ${metrics.totalPendentes} pendente(s) e ${metrics.totalConcluidas} concluída(s). Tempo médio de conclusão: ${metrics.tempoMedioDias} dias.`;
  }

  const model = getGenerativeModel(ai, {
    model: MODELO_GEMINI,
    generationConfig: { temperature: 0.3, maxOutputTokens: 260 }
  });

  const pendentesTitulos = demandas
    .filter((d) => d.status !== 'concluida')
    .slice(0, 10)
    .map((d) => `- ${d.titulo} (${d.prioridade})`)
    .join('\n');

  const prompt = `Escreva um resumo semanal calmo e objetivo em português (máx. 4 frases) para o usuário com base nestes dados:
- Pendentes: ${metrics.totalPendentes}
- Concluídas no total: ${metrics.totalConcluidas}
- Tempo médio até concluir: ${metrics.tempoMedioDias} dias
- Taxa no prazo: ${metrics.taxaNoPrazo}
Principais pendentes:
${pendentesTitulos || '(nenhuma)'}`;

  try {
    const res = await model.generateContent(prompt);
    return res.response.text().trim();
  } catch {
    return `Você está com ${metrics.totalPendentes} pendência(s) e ${metrics.totalConcluidas} demanda(s) concluída(s). Tempo médio de conclusão: ${metrics.tempoMedioDias} dias.`;
  }
}

