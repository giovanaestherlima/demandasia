// ============================================================================
// Persistência no Cloud Firestore (demandas e preferências do usuário)
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
import { db } from './firebase-config.js';

export const DEFAULT_PREFERENCES = {
  salvarDiretoSemPrevia: false,
  silenciarResumoFalado: false,
  intervaloLembreteMinutos: 30,
  diasAvisoAmarelo: 3,
  diasAvisoLaranja: 7,
  diasAvisoVermelho: 14,
  tema: 'sistema'
};

/**
 * Retorna a referência da coleção de demandas do usuário.
 * @param {string} uid
 */
function demandasCollection(uid) {
  return collection(db, 'users', uid, 'demandas');
}

/**
 * Inscreve um listener em tempo real nas demandas do usuário (mais antigas primeiro).
 * @param {string} uid
 * @param {(demandas: Array<object>) => void} onData
 * @param {(err: Error) => void} onError
 * @returns {() => void}
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
 * Cria uma nova demanda no Firestore seguindo o schema validado pelas regras.
 * @param {string} uid
 * @param {object} dados
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
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp(),
    concluidoEm: dados.status === 'concluida' ? serverTimestamp() : null
  };

  return addDoc(demandasCollection(uid), payload);
}

/**
 * Atualiza os campos editáveis de uma demanda existente.
 * Mantém criadoEm intacto (exigido pelas regras de segurança).
 * @param {string} uid
 * @param {string} demandaId
 * @param {object} dados
 */
export async function updateDemanda(uid, demandaId, dados) {
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

  return updateDoc(ref, payload);
}

/**
 * Alterna rapidamente entre pendente e concluída.
 * @param {string} uid
 * @param {object} demanda
 */
export async function toggleDemandaStatus(uid, demanda) {
  const ref = doc(db, 'users', uid, 'demandas', demanda.id);
  const vaiConcluir = demanda.status !== 'concluida';

  return updateDoc(ref, {
    status: vaiConcluir ? 'concluida' : 'pendente',
    atualizadoEm: serverTimestamp(),
    concluidoEm: vaiConcluir ? serverTimestamp() : null
  });
}

/**
 * Exclui uma demanda permanentemente.
 * @param {string} uid
 * @param {string} demandaId
 */
export async function deleteDemanda(uid, demandaId) {
  const ref = doc(db, 'users', uid, 'demandas', demandaId);
  return deleteDoc(ref);
}

/**
 * Carrega as preferências do usuário ou retorna os padrões.
 * @param {string} uid
 * @returns {Promise<typeof DEFAULT_PREFERENCES>}
 */
export async function loadPreferences(uid) {
  const ref = doc(db, 'users', uid, 'configuracoes', 'preferencias');
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return { ...DEFAULT_PREFERENCES };
  }
  return { ...DEFAULT_PREFERENCES, ...snap.data() };
}

/**
 * Salva as preferências do usuário no Firestore.
 * @param {string} uid
 * @param {Partial<typeof DEFAULT_PREFERENCES>} prefs
 */
export async function savePreferences(uid, prefs) {
  const ref = doc(db, 'users', uid, 'configuracoes', 'preferencias');
  const merged = { ...DEFAULT_PREFERENCES, ...prefs };
  return setDoc(ref, merged, { merge: true });
}
