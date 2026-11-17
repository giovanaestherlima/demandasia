// ============================================================================
// Persistência no Cloud Firestore (demandas, histórico, recorrência e prefs)
// ============================================================================

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  setDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { db } from './firebase-config.js?v=5';

export const DEFAULT_PREFERENCES = {
  salvarDiretoSemPrevia: false,
  silenciarResumoFalado: false,
  intervaloLembreteMinutos: 30,
  diasAvisoAmarelo: 3,
  diasAvisoLaranja: 7,
  diasAvisoVermelho: 14,
  tema: 'sistema',
  horarioSilencioInicio: '22:00',
  horarioSilencioFim: '08:00',
  limiteLembretesHora: 4
};

function demandasCollection(uid) {
  return collection(db, 'users', uid, 'demandas');
}

function nowISO() {
  return new Date().toISOString();
}

function normalizeSubtarefas(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s.texto === 'string' && s.texto.trim())
    .slice(0, 50)
    .map((s, idx) => ({
      id: String(s.id || `sub-${Date.now()}-${idx}`),
      texto: s.texto.trim().slice(0, 200),
      concluida: Boolean(s.concluida)
    }));
}

function normalizeEtiquetas(list) {
  if (!Array.isArray(list)) return [];
  const unicas = new Set();
  for (const tag of list) {
    const limpa = String(tag || '').trim().toLowerCase().slice(0, 30);
    if (limpa) unicas.add(limpa);
    if (unicas.size >= 20) break;
  }
  return Array.from(unicas);
}

function normalizeRecorrencia(rec) {
  if (!rec || typeof rec !== 'object' || !rec.tipo || rec.tipo === 'nenhuma') {
    return null;
  }
  const tiposValidos = new Set(['diaria', 'semanal', 'mensal', 'dia_mes']);
  if (!tiposValidos.has(rec.tipo)) return null;
  const out = { tipo: rec.tipo };
  if (rec.tipo === 'dia_mes' && rec.diaMes) {
    out.diaMes = Math.min(31, Math.max(1, Number(rec.diaMes) || 1));
  }
  return out;
}

function appendHistorico(atual, acao, detalhe = '') {
  const base = Array.isArray(atual) ? [...atual] : [];
  base.push({
    acao,
    em: nowISO(),
    ...(detalhe ? { detalhe: String(detalhe).slice(0, 120) } : {})
  });
  return base.slice(-100);
}

/**
 * Inscreve um listener em tempo real nas demandas do usuário (mais antigas primeiro).
 */
export function subscribeDemandas(uid, onData, onError) {
  const q = query(demandasCollection(uid), orderBy('criadoEm', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const lista = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data()
      }));
      onData(lista);
    },
    onError
  );
}

/**
 * Cria uma nova demanda no Firestore com suporte a subtarefas, etiquetas, recorrência e histórico.
 */
export async function createDemanda(uid, dados) {
  const payload = {
    titulo: String(dados.titulo || '').trim().slice(0, 120),
    descricao: String(dados.descricao || '').trim().slice(0, 5000),
    prioridade: dados.prioridade || 'media',
    prazo: dados.prazo ? String(dados.prazo).slice(0, 25) : null,
    categoria: dados.categoria ? String(dados.categoria).trim().slice(0, 80) : null,
    status: dados.status || 'pendente',
    origem: dados.origem === 'voz' ? 'voz' : 'texto',
    textoOriginal: String(dados.textoOriginal || '').slice(0, 5000),
    subtarefas: normalizeSubtarefas(dados.subtarefas),
    adiadoAte: dados.adiadoAte ? String(dados.adiadoAte).slice(0, 25) : null,
    recorrencia: normalizeRecorrencia(dados.recorrencia),
    etiquetas: normalizeEtiquetas(dados.etiquetas),
    historico: appendHistorico(dados.historico, 'criada', dados.origem === 'voz' ? 'por voz' : 'por texto'),
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp(),
    concluidoEm: dados.status === 'concluida' ? serverTimestamp() : null
  };

  return addDoc(demandasCollection(uid), payload);
}

/**
 * Atualiza uma demanda existente mantendo criadoEm intacto.
 */
export async function updateDemanda(uid, demandaId, dados, historicoAcao = 'editada', detalhe = '') {
  const ref = doc(db, 'users', uid, 'demandas', demandaId);
  const concluida = dados.status === 'concluida';

  const payload = {
    titulo: String(dados.titulo || '').trim().slice(0, 120),
    descricao: String(dados.descricao || '').trim().slice(0, 5000),
    prioridade: dados.prioridade || 'media',
    prazo: dados.prazo ? String(dados.prazo).slice(0, 25) : null,
    categoria: dados.categoria ? String(dados.categoria).trim().slice(0, 80) : null,
    status: dados.status || 'pendente',
    atualizadoEm: serverTimestamp(),
    concluidoEm: concluida ? (dados.concluidoEm || serverTimestamp()) : null
  };

  if (dados.subtarefas !== undefined) {
    payload.subtarefas = normalizeSubtarefas(dados.subtarefas);
  }
  if (dados.adiadoAte !== undefined) {
    payload.adiadoAte = dados.adiadoAte ? String(dados.adiadoAte).slice(0, 25) : null;
  }
  if (dados.recorrencia !== undefined) {
    payload.recorrencia = normalizeRecorrencia(dados.recorrencia);
  }
  if (dados.etiquetas !== undefined) {
    payload.etiquetas = normalizeEtiquetas(dados.etiquetas);
  }
  if (dados.historico !== undefined || historicoAcao) {
    payload.historico = appendHistorico(dados.historico, historicoAcao, detalhe);
  }

  return updateDoc(ref, payload);
}

/**
 * Calcula a próxima data ISO (YYYY-MM-DD) para uma demanda recorrente.
 */
export function computeNextRecurrenceDate(prazoAtual, recorrencia) {
  if (!recorrencia || !recorrencia.tipo) return null;
  const base = prazoAtual && /^\d{4}-\d{2}-\d{2}$/.test(prazoAtual)
    ? new Date(`${prazoAtual}T12:00:00`)
    : new Date();

  const hoje = new Date();
  if (base < new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) {
    base.setFullYear(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  }

  if (recorrencia.tipo === 'diaria') {
    base.setDate(base.getDate() + 1);
  } else if (recorrencia.tipo === 'semanal') {
    base.setDate(base.getDate() + 7);
  } else if (recorrencia.tipo === 'mensal') {
    base.setMonth(base.getMonth() + 1);
  } else if (recorrencia.tipo === 'dia_mes') {
    const dia = Math.min(31, Math.max(1, Number(recorrencia.diaMes) || 1));
    base.setMonth(base.getMonth() + 1, dia);
  }

  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Alterna entre pendente e concluída; se recorrente e concluída, gera próxima ocorrência.
 */
export async function toggleDemandaStatus(uid, demanda) {
  const ref = doc(db, 'users', uid, 'demandas', demanda.id);
  const vaiConcluir = demanda.status !== 'concluida';

  await updateDoc(ref, {
    status: vaiConcluir ? 'concluida' : 'pendente',
    atualizadoEm: serverTimestamp(),
    concluidoEm: vaiConcluir ? serverTimestamp() : null,
    historico: appendHistorico(demanda.historico, vaiConcluir ? 'concluida' : 'reaberta')
  });

  if (vaiConcluir && demanda.recorrencia && demanda.recorrencia.tipo) {
    const proximoPrazo = computeNextRecurrenceDate(demanda.prazo, demanda.recorrencia);
    const subtarefasReset = (demanda.subtarefas || []).map((s) => ({ ...s, concluida: false }));
    await createDemanda(uid, {
      titulo: demanda.titulo,
      descricao: demanda.descricao,
      prioridade: demanda.prioridade,
      prazo: proximoPrazo,
      categoria: demanda.categoria,
      status: 'pendente',
      origem: demanda.origem || 'texto',
      textoOriginal: demanda.textoOriginal || demanda.titulo,
      subtarefas: subtarefasReset,
      recorrencia: demanda.recorrencia,
      etiquetas: demanda.etiquetas || [],
      historico: []
    });
    return { generatedNext: true, proximoPrazo };
  }

  return { generatedNext: false };
}

/**
 * Adia (soneca) os alertas de uma demanda até uma data ISO sem alterar criadoEm.
 */
export async function snoozeDemanda(uid, demanda, novaDataISO) {
  const ref = doc(db, 'users', uid, 'demandas', demanda.id);
  return updateDoc(ref, {
    adiadoAte: novaDataISO,
    atualizadoEm: serverTimestamp(),
    historico: appendHistorico(demanda.historico, 'adiada', `até ${novaDataISO}`)
  });
}

/**
 * Exclui uma demanda permanentemente.
 */
export async function deleteDemanda(uid, demandaId) {
  const ref = doc(db, 'users', uid, 'demandas', demandaId);
  return deleteDoc(ref);
}

/**
 * Restaura uma demanda (usado pelo botão "Desfazer").
 */
export async function restoreDemanda(uid, snapshot) {
  if (!snapshot) return;
  const ref = doc(db, 'users', uid, 'demandas', snapshot.id);
  const payload = {
    titulo: snapshot.titulo || 'Demanda restaurada',
    descricao: snapshot.descricao || '',
    prioridade: snapshot.prioridade || 'media',
    prazo: snapshot.prazo || null,
    categoria: snapshot.categoria || null,
    status: snapshot.status || 'pendente',
    origem: snapshot.origem === 'voz' ? 'voz' : 'texto',
    textoOriginal: snapshot.textoOriginal || snapshot.titulo || '',
    subtarefas: normalizeSubtarefas(snapshot.subtarefas),
    adiadoAte: snapshot.adiadoAte || null,
    recorrencia: normalizeRecorrencia(snapshot.recorrencia),
    etiquetas: normalizeEtiquetas(snapshot.etiquetas),
    historico: appendHistorico(snapshot.historico, 'editada', 'desfeito'),
    criadoEm: snapshot.criadoEm || serverTimestamp(),
    atualizadoEm: serverTimestamp(),
    concluidoEm: snapshot.concluidoEm || null
  };
  return setDoc(ref, payload);
}

export async function loadPreferences(uid) {
  const ref = doc(db, 'users', uid, 'configuracoes', 'preferencias');
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return { ...DEFAULT_PREFERENCES };
  }
  return { ...DEFAULT_PREFERENCES, ...snap.data() };
}

export async function savePreferences(uid, prefs) {
  const ref = doc(db, 'users', uid, 'configuracoes', 'preferencias');
  const merged = { ...DEFAULT_PREFERENCES, ...prefs };
  return setDoc(ref, merged, { merge: true });
}
