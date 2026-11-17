// ============================================================================
// Processamento de linguagem natural com Firebase AI Logic (Gemini) + Fallback
// ============================================================================

import { getGenerativeModel, Schema } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js';
import { ai } from './firebase-config.js';

const PRIORIDADES_VALIDAS = new Set(['baixa', 'media', 'alta', 'urgente']);
const MODELO_GEMINI = 'gemini-4-hydrogen';

let structuredModel = null;

/**
 * Retorna ou cria a instância do modelo Gemini configurado com Structured Output.
 */
function getStructuredModel() {
  if (!ai) return null;
  if (!structuredModel) {
    structuredModel = getGenerativeModel(ai, {
      model: MODELO_GEMINI,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: Schema.object({
          properties: {
            titulo: Schema.string(),
            descricao: Schema.string(),
            prioridade: Schema.enumString({ enum: ['baixa', 'media', 'alta', 'urgente'] }),
            prazo: Schema.string({ nullable: true }),
            categoria: Schema.string({ nullable: true })
          }
        })
      }
    });
  }
  return structuredModel;
}

/**
 * Modo simples (fallback) caso a IA esteja indisponível ou falhe.
 * Título = primeiras palavras da fala (até 70 caracteres); descrição = fala completa.
 * @param {string} texto
 */
export function buildFallbackDemand(texto) {
  const limpo = String(texto || '').trim().replace(/\s+/g, ' ');
  let titulo = limpo.slice(0, 70);
  if (limpo.length > 70) {
    const ultimoEspaco = titulo.lastIndexOf(' ');
    if (ultimoEspaco > 20) {
      titulo = titulo.slice(0, ultimoEspaco);
    }
    titulo = `${titulo}...`.slice(0, 70);
  }

  return {
    titulo: titulo || 'Nova demanda',
    descricao: limpo,
    prioridade: 'media',
    prazo: null,
    categoria: null
  };
}

/**
 * Valida e sanitiza o JSON devolvido pela IA antes de qualquer uso ou gravação.
 * Lança erro se o objeto estiver corrompido ou fora do formato esperado.
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
 * Organiza uma fala ou texto livre usando o Gemini via Firebase AI Logic.
 * Em caso de falha, retorna automaticamente o modo simples (fallback).
 * @param {string} textoLivre
 * @returns {Promise<{ demanda: object, usedFallback: boolean, reason?: string }>}
 */
export async function parseDemandWithAI(textoLivre) {
  const texto = String(textoLivre || '').trim();
  if (!texto) {
    throw new Error('Digite ou fale algo antes de organizar.');
  }

  const model = getStructuredModel();
  if (!model) {
    return {
      demanda: buildFallbackDemand(texto),
      usedFallback: true,
      reason: 'IA não inicializada'
    };
  }

  const hoje = new Date();
  const dataHojeISO = hoje.toISOString().slice(0, 10);
  const diaSemana = hoje.toLocaleDateString('pt-BR', { weekday: 'long' });

  const prompt = `Você é um assistente de organização de demandas em português do Brasil.
Hoje é ${diaSemana}, ${dataHojeISO}.

Converta a fala/texto do usuário abaixo em um JSON estruturado seguindo exatamente estas regras:
- "titulo": curto e objetivo, no máximo 70 caracteres.
- "descricao": detalhamento claro e organizado do que foi dito, SEM inventar fatos ou detalhes não mencionados.
- "prioridade": infira entre "baixa", "media", "alta" ou "urgente" conforme o tom e contexto; se não ficar claro, use "media".
- "prazo": data no formato ISO "YYYY-MM-DD" se o usuário mencionar um prazo (ex: "amanhã", "sexta", "dia 20"), calculada a partir de hoje (${dataHojeISO}); caso contrário, null.
- "categoria": categoria ou nome do solicitante se mencionado claramente; caso contrário, null.

Texto do usuário:
"""${texto}"""`;

  try {
    const result = await model.generateContent(prompt);
    const jsonText = result.response.text();
    const parsed = JSON.parse(jsonText);
    const demanda = validateAiDemandJson(parsed, texto);
    return { demanda, usedFallback: false };
  } catch (err) {
    console.warn('[Pauta AI] Falha ao processar com Gemini, usando modo simples:', err);
    return {
      demanda: buildFallbackDemand(texto),
      usedFallback: true,
      reason: err?.message || 'Erro ao consultar IA'
    };
  }
}
