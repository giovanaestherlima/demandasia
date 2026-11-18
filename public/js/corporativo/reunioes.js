// ============================================================================
// Etapa C2: Reuniões e Atas (workspaces/{wsId}/reunioes/{id})
// Carregamento paginado com limit() para economia de cota Spark.
// ============================================================================

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { db } from '../firebase-config.js?v=5';
import { trackReads, trackWrites } from '../workspaces.js?v=5';

const DRAFT_PREFIX = 'pauta_ata_draft_';

function reunioesCol(wsId) {
  return collection(db, 'workspaces', wsId, 'reunioes');
}

export function saveMeetingDraftLocal(wsId, keyId, ataText) {
  try {
    localStorage.setItem(`${DRAFT_PREFIX}${wsId}_${keyId || 'nova'}`, String(ataText || ''));
  } catch {}
}

export function readMeetingDraftLocal(wsId, keyId) {
  try {
    return localStorage.getItem(`${DRAFT_PREFIX}${wsId}_${keyId || 'nova'}`) || '';
  } catch {
    return '';
  }
}

export function clearMeetingDraftLocal(wsId, keyId) {
  try {
    localStorage.removeItem(`${DRAFT_PREFIX}${wsId}_${keyId || 'nova'}`);
  } catch {}
}

export async function listReunioes(wsId, pageSize = 15, lastSnap = null) {
  const constraints = [orderBy('criadoEm', 'desc'), limit(pageSize)];
  if (lastSnap) constraints.push(startAfter(lastSnap));
  const snap = await getDocs(query(reunioesCol(wsId), ...constraints));
  trackReads(snap.size || 1);
  return {
    items: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    lastDoc: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
    hasMore: snap.docs.length === pageSize
  };
}

export async function getReuniao(wsId, reuniaoId) {
  const snap = await getDoc(doc(db, 'workspaces', wsId, 'reunioes', reuniaoId));
  trackReads(1);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createReuniao(wsId, user, dados) {
  const uid = typeof user === 'string' ? user : user.uid;
  const nome = typeof user === 'string' ? 'Usuário' : user.displayName || user.email || 'Usuário';
  const payload = {
    titulo: String(dados.titulo || 'Reunião').trim().slice(0, 120),
    dataHora: dados.dataHora ? String(dados.dataHora).slice(0, 30) : new Date().toISOString().slice(0, 16),
    assunto: String(dados.assunto || '').trim().slice(0, 120),
    participantes: Array.isArray(dados.participantes) ? dados.participantes.slice(0, 50) : [],
    ata: String(dados.ata || '').slice(0, 20000),
    origem: ['voz', 'colado', 'digitada'].includes(dados.origem) ? dados.origem : 'digitada',
    qtdDemandas: Number(dados.qtdDemandas || 0),
    criadoPorUid: uid,
    criadoPorNome: String(nome).slice(0, 120),
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp()
  };
  trackWrites(1);
  const ref = await addDoc(reunioesCol(wsId), payload);
  return { id: ref.id, ...payload };
}

export async function updateReuniao(wsId, reuniaoId, dados) {
  const payload = {
    titulo: String(dados.titulo || 'Reunião').trim().slice(0, 120),
    dataHora: dados.dataHora ? String(dados.dataHora).slice(0, 30) : '',
    assunto: String(dados.assunto || '').trim().slice(0, 120),
    participantes: Array.isArray(dados.participantes) ? dados.participantes.slice(0, 50) : [],
    ata: String(dados.ata || '').slice(0, 20000),
    atualizadoEm: serverTimestamp()
  };
  if (dados.qtdDemandas !== undefined) {
    payload.qtdDemandas = Number(dados.qtdDemandas || 0);
  }
  trackWrites(1);
  await updateDoc(doc(db, 'workspaces', wsId, 'reunioes', reuniaoId), payload);
}

export async function deleteReuniao(wsId, reuniaoId) {
  trackWrites(1);
  await deleteDoc(doc(db, 'workspaces', wsId, 'reunioes', reuniaoId));
}
