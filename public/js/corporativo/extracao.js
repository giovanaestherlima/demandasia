// ============================================================================
// Etapa C3: Extração Estruturada de Tarefas de Reuniões, Atas e E-mails
// Usa Firebase AI Logic (gemini-3.8-flash) com responseSchema e timeout 10s.
// ============================================================================

import { getGenerativeModel, Schema } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js';
import { collection, doc, serverTimestamp, writeBatch } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { ai, db } from '../firebase-config.js?v=5';
import { trackWrites } from '../workspaces.js?v=5';

const MODELO_GEMINI = 'gemini-3.8-flash';
const EXTRACTION_TIMEOUT_MS = 10000;
export const MAX_EXTRACTION_CHARS = 15000;

let extractionModel = null;

function getExtractionModel() {
  if (!ai) return null;
  if (!extractionModel) {
    extractionModel = getGenerativeModel(ai, {
      model: MODELO_GEMINI,
      generationConfig: {
        maxOutputTokens: 1600,
        responseMimeType: 'application/json',
        responseSchema: Schema.object({
          properties: {
            reuniao: Schema.object({
              properties: {
                titulo: Schema.string(),
                assunto: Schema.string({ nullable: true }),
                resumo: Schema.string({ nullable: true })
              },
              optionalProperties: ['assunto', 'resumo']
            }),
            tarefas: Schema.array({
              items: Schema.object({
                properties: {
                  titulo: Schema.string(),
                  descricao: Schema.string(),
                  responsavelNome: Schema.string({ nullable: true }),
                  prazo: Schema.string({ nullable: true }),
                  prioridade: Schema.enumString({ enum: ['baixa', 'media', 'alta', 'urgente'] }),
                  trecho: Schema.string()
                },
                optionalProperties: ['responsavelNome', 'prazo']
              })
            })
          }
        })
      }
    });
  }
  return extractionModel;
}

function normalizeStr(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Casa o nome extraído pela IA com membros do espaço no código local (sem IA).
 * Trata correspondência exata, primeiro nome, ambiguidade e ausência.
 */
export function matchMemberByName(nomeExtraido, membros) {
  const termo = normalizeStr(nomeExtraido);
  if (!termo) return { status: 'empty', candidates: [] };
  if (!Array.isArray(membros) || membros.length === 0) return { status: 'none', candidates: [] };

  const exatos = membros.filter((m) => normalizeStr(m.nome) === termo);
  if (exatos.length === 1) return { status: 'matched', member: exatos[0], candidates: exatos };
  if (exatos.length > 1) return { status: 'ambiguous', candidates: exatos };

  const parciais = membros.filter((m) => {
    const nomeNorm = normalizeStr(m.nome);
    const primeiro = nomeNorm.split(/\s+/)[0];
    return primeiro === termo || nomeNorm.includes(termo);
  });

  if (parciais.length === 1) return { status: 'matched', member: parciais[0], candidates: parciais };
  if (parciais.length > 1) return { status: 'ambiguous', candidates: parciais };
  return { status: 'none', candidates: [] };
}

/**
 * Extrai reunião e tarefas com timeout de 10s e limite de 15 mil caracteres.
 */
export async function extractTasksFromMeetingText(textoBruto, { dataReuniao } = {}) {
  const raw = String(textoBruto || '').trim();
  const truncated = raw.length > MAX_EXTRACTION_CHARS;
  const texto = truncated ? raw.slice(0, MAX_EXTRACTION_CHARS) : raw;

  const model = getExtractionModel();
  if (!model) {
    throw new Error('Modelo de IA indisponível no momento.');
  }

  const agora = new Date();
  const hojeISO = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
  const diaSemana = agora.toLocaleDateString('pt-BR', { weekday: 'long' });
  const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';

  const prompt = [
    'Extraia as informações da reunião e TODAS as tarefas/combinados do texto abaixo.',
    `Contexto temporal: hoje é ${hojeISO} (${diaSemana}), fuso ${fuso}. Data da reunião: ${dataReuniao || hojeISO}.`,
    'Regras obrigatórias:',
    '- NUNCA invente responsáveis, prazos ou tarefas que não estejam no texto. Se não foi dito, retorne null.',
    '- Resolva expressões como "até sexta", "semana que vem", "dia 20" para formato ISO YYYY-MM-DD.',
    '- Cada tarefa deve ter título curto e claro (até 70 caracteres), descrição objetiva, prioridade (baixa/media/alta/urgente) e o trecho exato do texto que originou a tarefa.',
    '',
    'TEXTO:',
    texto
  ].join('\n');

  const timer = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Tempo limite da IA excedido (10s).')), EXTRACTION_TIMEOUT_MS)
  );

  const res = await Promise.race([model.generateContent(prompt), timer]);
  const parsed = JSON.parse(res.response.text());

  return {
    truncated,
    reuniao: {
      titulo: String(parsed?.reuniao?.titulo || 'Reunião').slice(0, 120),
      assunto: parsed?.reuniao?.assunto ? String(parsed.reuniao.assunto).slice(0, 120) : '',
      resumo: parsed?.reuniao?.resumo ? String(parsed.reuniao.resumo).slice(0, 400) : ''
    },
    tarefas: Array.isArray(parsed?.tarefas)
      ? parsed.tarefas.map((t) => ({
          titulo: String(t?.titulo || 'Tarefa').trim().slice(0, 70),
          descricao: String(t?.descricao || '').trim().slice(0, 1000),
          responsavelNome: t?.responsavelNome ? String(t.responsavelNome).trim() : null,
          prazo: t?.prazo && /^\d{4}-\d{2}-\d{2}$/.test(t.prazo) ? t.prazo : null,
          prioridade: ['baixa', 'media', 'alta', 'urgente'].includes(t?.prioridade) ? t.prioridade : 'media',
          trecho: String(t?.trecho || '').trim().slice(0, 300)
        }))
      : []
  };
}

/**
 * Salva as tarefas aprovadas (e opcionalmente a reunião/ata) em UM único writeBatch.
 */
export async function approveExtractedTasksBatch(wsId, user, { reuniaoExistenteId, saveMeeting, meetingData, tasks, isSharedWs }) {
  const uid = user.uid;
  const userName = user.displayName || user.email || 'Usuário';
  const batch = writeBatch(db);
  let writes = 0;

  let reuniaoId = reuniaoExistenteId || null;
  let reuniaoTitulo = meetingData?.titulo || null;

  if (saveMeeting && !reuniaoId && meetingData) {
    const rRef = doc(collection(db, 'workspaces', wsId, 'reunioes'));
    reuniaoId = rRef.id;
    reuniaoTitulo = String(meetingData.titulo || 'Reunião').trim().slice(0, 120);
    batch.set(rRef, {
      titulo: reuniaoTitulo,
      dataHora: meetingData.dataHora || new Date().toISOString().slice(0, 16),
      assunto: String(meetingData.assunto || '').slice(0, 120),
      participantes: Array.isArray(meetingData.participantes) ? meetingData.participantes.slice(0, 50) : [],
      ata: String(meetingData.ata || '').slice(0, 20000),
      origem: meetingData.origem || 'colado',
      qtdDemandas: tasks.length,
      criadoPorUid: uid,
      criadoPorNome: userName.slice(0, 120),
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });
    writes += 1;
  }

  for (const t of tasks) {
    const dRef = doc(collection(db, 'workspaces', wsId, 'demandas'));
    const responsaveis = Array.isArray(t.responsaveis) ? t.responsaveis : [];
    const nomes = responsaveis.map((r) => r.nome).join(', ').slice(0, 120) || (t.responsavelExterno || null);
    batch.set(dRef, {
      titulo: String(t.titulo || 'Tarefa').trim().slice(0, 120),
      descricao: String(t.descricao || '').trim().slice(0, 5000),
      prioridade: t.prioridade || 'media',
      prazo: t.prazo || null,
      categoria: t.categoria || null,
      status: 'pendente',
      origem: 'reuniao',
      textoOriginal: String(t.trecho || t.titulo || '').slice(0, 5000),
      subtarefas: [],
      adiadoAte: null,
      recorrencia: null,
      etiquetas: [],
      historico: [
        {
          acao: 'criada',
          em: new Date().toISOString(),
          detalhe: reuniaoTitulo ? `da reunião "${reuniaoTitulo}"` : 'extraída de reunião'
        }
      ],
      responsaveis,
      responsaveisUids: responsaveis.map((r) => r.uid),
      responsavelUid: responsaveis[0]?.uid ?? null,
      responsavelNome: nomes,
      reuniaoId,
      reuniaoTitulo,
      criadoPorUid: uid,
      criadoPorNome: userName,
      atualizadoPorUid: uid,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp(),
      concluidoEm: null
    });
    writes += 1;
  }

  if (isSharedWs && tasks.length > 0) {
    const actRef = doc(collection(db, 'workspaces', wsId, 'atividade'));
    batch.set(actRef, {
      tipo: 'reuniao_extraida',
      autorUid: uid,
      autorNome: userName.slice(0, 120),
      detalhe: `${tasks.length} demanda(s) extraída(s)${reuniaoTitulo ? ` em "${reuniaoTitulo}"` : ''}`,
      em: serverTimestamp()
    });
    writes += 1;
  }

  await batch.commit();
  trackWrites(writes);
  return { reuniaoId, reuniaoTitulo, createdCount: tasks.length };
}
