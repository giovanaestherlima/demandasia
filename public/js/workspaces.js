// ============================================================================
// Espaços de Trabalho (Workspaces), Membros, Convites, Comentários e Migração V2
// ============================================================================

import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { db } from './firebase-config.js?v=5';

const PENDING_INVITE_KEY = 'pauta_pending_invite_token';

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
 * Gera token criptográfico aleatório URL-safe (>= 24 caracteres).
 */
export function generateSecureToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function captureInviteUrlParam() {
  try {
    const url = new URL(window.location.href);
    const tok = url.searchParams.get('convite');
    if (tok) {
      sessionStorage.setItem(PENDING_INVITE_KEY, tok);
      localStorage.setItem(PENDING_INVITE_KEY, tok);
      return tok;
    }
    return sessionStorage.getItem(PENDING_INVITE_KEY) || localStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    return null;
  }
}

export function clearInviteUrlParam() {
  try {
    sessionStorage.removeItem(PENDING_INVITE_KEY);
    localStorage.removeItem(PENDING_INVITE_KEY);
    const url = new URL(window.location.href);
    if (url.searchParams.has('convite')) {
      url.searchParams.delete('convite');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
  } catch {
    // Ignora
  }
}

export async function ensureUserAndPersonalWorkspace(user) {
  const userRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);
  trackReads(1);

  const emailLower = (user.email || '').trim().toLowerCase();
  const baseProfile = {
    nome: user.displayName || user.email || 'Usuário',
    email: user.email || '',
    emailLower,
    fotoURL: user.photoURL || ''
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

  const meusRef = collection(db, 'users', user.uid, 'meusEspacos');
  const meusSnap = await getDocs(query(meusRef, orderBy('entradoEm', 'asc')));
  trackReads(Math.max(1, meusSnap.size));

  let meusEspacos = meusSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

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
      fotoURL: baseProfile.fotoURL,
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

    meusEspacos = [{ id: wsId, nome: 'Pessoal', papel: 'admin', tipo: 'pessoal' }];
    profileData.espacoAtivo = wsId;
  }

  const espacoAtivo =
    (profileData.espacoAtivo && meusEspacos.some((e) => e.id === profileData.espacoAtivo))
      ? profileData.espacoAtivo
      : meusEspacos[0].id;

  return { profile: profileData, meusEspacos, espacoAtivo };
}

export async function createNewWorkspace(user, nome, tipo = 'equipe') {
  const wsRef = doc(collection(db, 'workspaces'));
  const wsId = wsRef.id;
  const nomeLimpo = String(nome || '').trim().slice(0, 80);
  const batch = writeBatch(db);

  batch.set(wsRef, {
    nome: nomeLimpo,
    criadoPor: user.uid,
    criadoEm: serverTimestamp(),
    tipo
  });

  batch.set(doc(db, 'workspaces', wsId, 'membros', user.uid), {
    papel: 'admin',
    nome: user.displayName || user.email || 'Usuário',
    email: user.email || '',
    fotoURL: user.photoURL || '',
    entradoEm: serverTimestamp(),
    conviteId: null,
    ultimaVisita: serverTimestamp()
  });

  batch.set(doc(db, 'users', user.uid, 'meusEspacos', wsId), {
    nome: nomeLimpo,
    papel: 'admin',
    tipo,
    entradoEm: serverTimestamp()
  });

  batch.update(doc(db, 'users', user.uid), { espacoAtivo: wsId });
  await batch.commit();
  trackWrites(4);

  return { id: wsId, nome: nomeLimpo, papel: 'admin', tipo };
}

export async function switchActiveWorkspace(uid, wsId) {
  trackWrites(1);
  return updateDoc(doc(db, 'users', uid), { espacoAtivo: wsId });
}

export async function loadWorkspaceInfoAndMembers(wsId) {
  const [wsSnap, memSnap] = await Promise.all([
    getDoc(doc(db, 'workspaces', wsId)),
    getDocs(query(collection(db, 'workspaces', wsId, 'membros'), limit(50)))
  ]);
  trackReads(1 + Math.max(1, memSnap.size));
  return {
    workspace: wsSnap.exists() ? { id: wsSnap.id, ...wsSnap.data() } : null,
    membros: memSnap.docs.map((d) => ({ uid: d.id, ...d.data() }))
  };
}

export async function updateMyLastVisit(wsId, uid) {
  try {
    trackWrites(1);
    await updateDoc(doc(db, 'workspaces', wsId, 'membros', uid), {
      ultimaVisita: serverTimestamp()
    });
  } catch {
    // Ignora se sem permissão ou offline
  }
}

export async function updateMemberRole(wsId, memberUid, papel) {
  trackWrites(1);
  return updateDoc(doc(db, 'workspaces', wsId, 'membros', memberUid), { papel });
}

export async function removeWorkspaceMember(wsId, memberUid) {
  trackWrites(1);
  return deleteDoc(doc(db, 'workspaces', wsId, 'membros', memberUid));
}

export async function leaveWorkspace(wsId, uid) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'workspaces', wsId, 'membros', uid));
  batch.delete(doc(db, 'users', uid, 'meusEspacos', wsId));
  await batch.commit();
  trackWrites(2);
}

// ---------- Convites (Link e E-mail) ----------
export async function createInvite({ wsId, wsNome, papel, tipo, emailAlvo, validadeDias = 7, usosMax = 10, user }) {
  const token = generateSecureToken();
  const expira = new Date();
  expira.setDate(expira.getDate() + Number(validadeDias || 7));

  const payload = {
    wsId,
    wsNome: String(wsNome || 'Espaço').slice(0, 80),
    papel: papel === 'leitor' ? 'leitor' : 'editor',
    tipo: tipo === 'email' ? 'email' : 'link',
    ...(tipo === 'email' && emailAlvo ? { emailAlvo: emailAlvo.trim().toLowerCase() } : {}),
    criadoPorUid: user.uid,
    criadoPorNome: user.displayName || user.email || 'Admin',
    criadoEm: serverTimestamp(),
    expiraEm: Timestamp.fromDate(expira),
    ativo: true,
    usos: 0,
    usosMax: tipo === 'email' ? 1 : Math.max(1, Number(usosMax) || 10)
  };

  trackWrites(1);
  await setDoc(doc(db, 'convites', token), payload);
  return { token, ...payload };
}

export async function listWorkspaceInvites(wsId) {
  const q = query(collection(db, 'convites'), where('wsId', '==', wsId), limit(30));
  const snap = await getDocs(q);
  trackReads(Math.max(1, snap.size));
  return snap.docs.map((d) => ({ token: d.id, ...d.data() }));
}

export async function revokeInvite(token) {
  trackWrites(1);
  return updateDoc(doc(db, 'convites', token), { ativo: false });
}

export async function getInviteByToken(token) {
  const snap = await getDoc(doc(db, 'convites', token));
  trackReads(1);
  return snap.exists() ? { token: snap.id, ...snap.data() } : null;
}

export async function findPendingEmailInvites(email) {
  if (!email) return [];
  const q = query(
    collection(db, 'convites'),
    where('emailAlvo', '==', email.trim().toLowerCase()),
    where('ativo', '==', true),
    limit(10)
  );
  const snap = await getDocs(q);
  trackReads(Math.max(1, snap.size));
  const agora = Date.now();
  return snap.docs
    .map((d) => ({ token: d.id, ...d.data() }))
    .filter((c) => c.expiraEm?.toMillis() > agora && c.usos < c.usosMax);
}

/**
 * Entrada segura e atômica via convite (executada pelo próprio usuário entrante).
 */
export async function acceptInviteAtomic(user, invite) {
  const batch = writeBatch(db);
  const novosUsos = Number(invite.usos || 0) + 1;
  const desativar = invite.tipo === 'email' || novosUsos >= Number(invite.usosMax || 1);

  batch.set(doc(db, 'workspaces', invite.wsId, 'membros', user.uid), {
    papel: invite.papel,
    nome: user.displayName || user.email || 'Usuário',
    email: user.email || '',
    fotoURL: user.photoURL || '',
    entradoEm: serverTimestamp(),
    conviteId: invite.token,
    ultimaVisita: serverTimestamp()
  });

  batch.update(doc(db, 'convites', invite.token), {
    usos: novosUsos,
    ativo: !desativar
  });

  batch.set(doc(db, 'users', user.uid, 'meusEspacos', invite.wsId), {
    nome: invite.wsNome,
    papel: invite.papel,
    tipo: 'equipe',
    entradoEm: serverTimestamp()
  });

  batch.update(doc(db, 'users', user.uid), { espacoAtivo: invite.wsId });

  await batch.commit();
  trackWrites(4);
}

// ---------- Comentários sob demanda ----------
export function subscribeComments(wsId, demandaId, onData) {
  const q = query(
    collection(db, 'workspaces', wsId, 'demandas', demandaId, 'comentarios'),
    orderBy('criadoEm', 'asc'),
    limit(50)
  );
  return onSnapshot(q, (snap) => {
    trackReads(Math.max(1, snap.docChanges().length));
    onData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function addComment(wsId, demandaId, user, texto) {
  trackWrites(1);
  return addDoc(collection(db, 'workspaces', wsId, 'demandas', demandaId, 'comentarios'), {
    texto: String(texto || '').trim().slice(0, 2000),
    autorUid: user.uid,
    autorNome: user.displayName || user.email || 'Usuário',
    criadoEm: serverTimestamp()
  });
}

// ---------- Migração Legada ----------
export async function checkLegacyDemandsCount(uid) {
  const legacySnap = await getDocs(collection(db, 'users', uid, 'demandas'));
  trackReads(Math.max(1, legacySnap.size));
  return legacySnap.docs;
}

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
