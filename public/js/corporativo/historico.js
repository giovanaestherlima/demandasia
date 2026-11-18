// ============================================================================
// Etapa C4: Histórico Detalhado e Atividade Recente do Espaço (Sob Demanda)
// ============================================================================

import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { db } from '../firebase-config.js?v=5';
import { trackReads, trackWrites } from '../workspaces.js?v=5';

export async function recordWorkspaceActivity(wsId, user, { tipo, detalhe = '', demandaId = null, demandaTitulo = null }) {
  if (!wsId || !user?.uid) return;
  const nome = user.displayName || user.email || 'Usuário';
  trackWrites(1);
  return addDoc(collection(db, 'workspaces', wsId, 'atividade'), {
    tipo: String(tipo || 'editada').slice(0, 40),
    autorUid: user.uid,
    autorNome: String(nome).slice(0, 120),
    detalhe: String(detalhe || '').slice(0, 200),
    demandaId: demandaId ? String(demandaId).slice(0, 60) : null,
    demandaTitulo: demandaTitulo ? String(demandaTitulo).slice(0, 120) : null,
    em: serverTimestamp()
  });
}

/**
 * Busca os últimos ~30 eventos de atividade recente do espaço (sem listener permanente).
 */
export async function fetchRecentActivity(wsId, maxItems = 30) {
  const q = query(
    collection(db, 'workspaces', wsId, 'atividade'),
    orderBy('em', 'desc'),
    limit(maxItems)
  );
  const snap = await getDocs(q);
  trackReads(snap.size || 1);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
