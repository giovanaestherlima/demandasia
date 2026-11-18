// ============================================================================
// Etapa C1: Links Diretos para Demandas (?espaco=WSID&demanda=ID)
// ============================================================================

import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { db } from '../firebase-config.js?v=5';
import { trackReads } from '../workspaces.js?v=5';

export function buildDirectDemandUrl(wsId, demandaId) {
  return `${window.location.origin}/?espaco=${encodeURIComponent(wsId)}&demanda=${encodeURIComponent(demandaId)}`;
}

export async function copyDemandLink(wsId, demanda, { withTitle = false, isPersonal = false } = {}) {
  const url = buildDirectDemandUrl(wsId, demanda.id);
  const text = withTitle ? `${demanda.titulo}\n${url}` : url;
  await navigator.clipboard?.writeText(text);
  if (isPersonal) {
    return 'Link copiado! Aviso: este espaço é só seu; outras pessoas não conseguirão abrir.';
  }
  return withTitle ? 'Título e link copiados!' : 'Link da demanda copiado!';
}

export async function shareDemandLink(wsId, demanda) {
  if (!navigator.share) return false;
  const url = buildDirectDemandUrl(wsId, demanda.id);
  await navigator.share({
    title: demanda.titulo || 'Demanda no Pauta',
    text: `Demanda no Pauta: ${demanda.titulo}`,
    url
  });
  return true;
}

/**
 * Busca apenas 1 documento de demanda (1 leitura) ao abrir um link direto.
 */
export async function fetchSingleDemandByLink(wsId, demandaId) {
  try {
    const snap = await getDoc(doc(db, 'workspaces', wsId, 'demandas', demandaId));
    trackReads(1);
    if (!snap.exists()) {
      return { ok: false, reason: 'not-found', message: 'Esta demanda não foi encontrada ou foi excluída.' };
    }
    return { ok: true, demanda: { id: snap.id, ...snap.data() } };
  } catch (err) {
    const code = err?.code || '';
    if (code === 'permission-denied') {
      return {
        ok: false,
        reason: 'permission-denied',
        message: 'Você não tem acesso a esta demanda. Peça um convite ao administrador do espaço.'
      };
    }
    if (code === 'unavailable' || !navigator.onLine) {
      return {
        ok: false,
        reason: 'offline',
        message: 'Sem conexão no momento para abrir esta demanda.'
      };
    }
    return {
      ok: false,
      reason: 'error',
      message: 'Link inválido ou erro ao carregar a demanda.'
    };
  }
}
