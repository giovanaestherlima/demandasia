// ============================================================================
// Espaços de Trabalho (Workspaces), Migração V2 e Contador de Cota Spark
// ============================================================================

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  query,
  orderBy,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { db } from './firebase-config.js?v=5';

// Contador de leituras e gravações da sessão (visível no modo debug)
const quotaStats = {
  reads: 0,
  writes: 0
};

export function trackReads(count = 1) {
  quotaStats.reads += count;
}

export function trackWrites(count = 1) {
  quotaStats.writes += count;
}

export function getQuotaStats() {
  return { ...quotaStats };
}

/**
 * Garante que o perfil users/{uid} e o espaço "Pessoal" existam.
 * Usa users/{uid}/meusEspacos como índice leve (1 leitura de lista por sessão).
 */
export async function ensureUserAndPersonalWorkspace(user) {
  const userRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);
  trackReads(1);

  const emailLower = (user.email || '').trim().toLowerCase();
  const baseProfile = {
    nome: user.displayName || user.email || 'Usuário',
    email: user.email || '',
    emailLower,
    foto: user.photoURL || ''
  };

  let profileData = userSnap.exists() ? userSnap.data() : null;
  if (!profileData) {
    await setDoc(userRef, {
      ...baseProfile,
      espacoAtivo: null,
      migradoV2: false,
      criadoEm: serverTimestamp()
    });
    trackWrites(1);
    profileData = { ...baseProfile, espacoAtivo: null, migradoV2: false };
  }

  // Lista espaços pelo índice leve meusEspacos
  const meusRef = collection(db, 'users', user.uid, 'meusEspacos');
  const meusSnap = await getDocs(query(meusRef, orderBy('entradoEm', 'asc')));
  trackReads(Math.max(1, meusSnap.size));

  let meusEspacos = meusSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Todo usuário novo ganha automaticamente um espaço "Pessoal"
  if (meusEspacos.length === 0) {
    const wsRef = doc(collection(db, 'workspaces'));
    const wsId = wsRef.id;
    const batch = writeBatch(db);

    batch.set(wsRef, {
      nome: 'Pessoal',
      criadoPor: user.uid,
      criadoEm: serverTimestamp(),
      tipo: 'pessoal'
    });

    batch.set(doc(db, 'workspaces', wsId, 'membros', user.uid), {
      papel: 'admin',
      nome: baseProfile.nome,
      email: baseProfile.email,
      foto: baseProfile.foto,
      entradoEm: serverTimestamp(),
      conviteId: null,
      ultimaVisita: serverTimestamp()
    });

    batch.set(doc(db, 'users', user.uid, 'meusEspacos', wsId), {
      nome: 'Pessoal',
      papel: 'admin',
      tipo: 'pessoal',
      entradoEm: serverTimestamp()
    });

    batch.update(userRef, { espacoAtivo: wsId });
    await batch.commit();
    trackWrites(4);

    const novoEspaco = { id: wsId, nome: 'Pessoal', papel: 'admin', tipo: 'pessoal' };
    meusEspacos = [novoEspaco];
    profileData.espacoAtivo = wsId;
  }

  const espacoAtivo =
    (profileData.espacoAtivo && meusEspacos.some((e) => e.id === profileData.espacoAtivo))
      ? profileData.espacoAtivo
      : meusEspacos[0].id;

  return {
    profile: profileData,
    meusEspacos,
    espacoAtivo
  };
}

/**
 * Verifica se há demandas antigas em users/{uid}/demandas.
 */
export async function checkLegacyDemandsCount(uid) {
  const legacySnap = await getDocs(collection(db, 'users', uid, 'demandas'));
  trackReads(Math.max(1, legacySnap.size));
  return legacySnap.docs;
}

/**
 * Migra demandas antigas (users/{uid}/demandas -> workspaces/{wsId}/demandas)
 * mantendo os mesmos IDs (idempotente) em lotes de até 400 operações.
 * Só marca users/{uid}.migradoV2 = true após conferir contagem origem == destino.
 */
export async function migrateLegacyDemands(user, personalWsId, onProgress) {
  const legacyDocs = await checkLegacyDemandsCount(user.uid);
  const total = legacyDocs.length;

  if (total === 0) {
    await updateDoc(doc(db, 'users', user.uid), { migradoV2: true });
    trackWrites(1);
    return { total: 0, migrated: 0, verified: true };
  }

  const CHUNK_SIZE = 400;
  let processed = 0;

  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const chunk = legacyDocs.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);

    for (const d of chunk) {
      const data = d.data();
      const targetRef = doc(db, 'workspaces', personalWsId, 'demandas', d.id);
      batch.set(targetRef, {
        ...data,
        responsavelUid: data.responsavelUid ?? null,
        responsavelNome: data.responsavelNome ?? null,
        criadoPorUid: data.criadoPorUid || user.uid,
        criadoPorNome: data.criadoPorNome || user.displayName || user.email || 'Usuário',
        atualizadoPorUid: data.atualizadoPorUid || user.uid,
        atualizadoEm: data.atualizadoEm || data.criadoEm || serverTimestamp()
      }, { merge: true });
    }

    await batch.commit();
    trackWrites(chunk.length);
    processed += chunk.length;
    onProgress?.(Math.round((processed / total) * 100), processed, total);
  }

  // Conferência de contagem antes de marcar migradoV2
  const destSnap = await getDocs(collection(db, 'workspaces', personalWsId, 'demandas'));
  trackReads(Math.max(1, destSnap.size));
  const destIds = new Set(destSnap.docs.map((d) => d.id));
  const allCopied = legacyDocs.every((d) => destIds.has(d.id));

  if (allCopied) {
    await updateDoc(doc(db, 'users', user.uid), { migradoV2: true });
    trackWrites(1);
  }

  return { total, migrated: processed, verified: allCopied };
}

/**
 * Apaga as demandas antigas de users/{uid}/demandas em lotes de até 400.
 * Deve ser chamado apenas após confirmação explícita do usuário.
 */
export async function deleteLegacyDemands(uid) {
  const legacyDocs = await checkLegacyDemandsCount(uid);
  const CHUNK_SIZE = 400;
  for (let i = 0; i < legacyDocs.length; i += CHUNK_SIZE) {
    const chunk = legacyDocs.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const d of chunk) {
      batch.delete(d.ref);
    }
    await batch.commit();
    trackWrites(chunk.length);
  }
  return legacyDocs.length;
}
