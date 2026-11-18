// ============================================================================
// Etapa C0: Registro Central dos 3 Modos (Simples, Estudante, Corporativo)
// Quando Corporativo está desligado, nenhum módulo em ./corporativo/ é baixado.
// ============================================================================

import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { db } from './firebase-config.js?v=5';
import { trackWrites } from './workspaces.js?v=5';
import { modoEstudanteAtivo, moduloAtivo as studentModuloAtivo } from './modo-estudante.js?v=5';

const LS_CORP_KEY = 'pauta_modo_corporativo';
const LS_UNIFIED_DISMISS_KEY = 'pauta_modos_convite_dispensado';
const PENDING_WORK_PARAM_KEY = 'pauta_pending_work_modal';
const PENDING_DIRECT_LINK_KEY = 'pauta_pending_direct_demand';

export const DEFAULT_CORP_CONFIG = {
  ativo: false,
  modulos: {
    reunioes: true,
    historico: true,
    relatorio: true,
    links: true
  },
  ativadoEm: null,
  onboardingConcluido: false,
  dispensaConvite: false
};

let currentCorpConfig = readLocalCorpConfig();
let loadedCorpUiMod = null;

function cloneDefaultCorp() {
  return {
    ...DEFAULT_CORP_CONFIG,
    modulos: { ...DEFAULT_CORP_CONFIG.modulos }
  };
}

export function readLocalCorpConfig() {
  try {
    const raw = localStorage.getItem(LS_CORP_KEY);
    if (!raw) return cloneDefaultCorp();
    const parsed = JSON.parse(raw);
    return {
      ...cloneDefaultCorp(),
      ...parsed,
      modulos: { ...DEFAULT_CORP_CONFIG.modulos, ...(parsed?.modulos || {}) }
    };
  } catch {
    return cloneDefaultCorp();
  }
}

export function writeLocalCorpConfig(cfg) {
  try {
    localStorage.setItem(LS_CORP_KEY, JSON.stringify(cfg));
  } catch {
    // Ignora falhas de quota ou modo privado restrito
  }
}

export function getCorpConfig() {
  return currentCorpConfig;
}

export function modoCorporativoAtivo() {
  return Boolean(currentCorpConfig?.ativo);
}

export function modoSimplesAtivo() {
  return !modoEstudanteAtivo() && !modoCorporativoAtivo();
}

/**
 * Registro central de feature flags para ambos os modos.
 * @param {string} nome
 */
export function moduloAtivo(nome) {
  if (['reunioes', 'historico', 'relatorio', 'links'].includes(nome)) {
    return Boolean(currentCorpConfig?.ativo && currentCorpConfig?.modulos?.[nome]);
  }
  return studentModuloAtivo(nome);
}

export function syncCorpConfigFromProfile(userProfileData) {
  const remote = userProfileData?.config?.modoCorporativo;
  if (remote && typeof remote === 'object') {
    currentCorpConfig = {
      ...cloneDefaultCorp(),
      ...remote,
      modulos: { ...DEFAULT_CORP_CONFIG.modulos, ...(remote.modulos || {}) }
    };
    writeLocalCorpConfig(currentCorpConfig);
  }
  return currentCorpConfig;
}

export async function saveCorpConfig(uid, patch) {
  const next = {
    ...currentCorpConfig,
    ...patch,
    modulos: {
      ...currentCorpConfig.modulos,
      ...(patch.modulos || {})
    }
  };
  if (patch.ativo === true && !next.ativadoEm) {
    next.ativadoEm = new Date().toISOString();
  }

  await setDoc(
    doc(db, 'users', uid),
    {
      config: { modoCorporativo: next },
      atualizadoEm: serverTimestamp()
    },
    { merge: true }
  );
  trackWrites(1);

  currentCorpConfig = next;
  writeLocalCorpConfig(next);
  return currentCorpConfig;
}

export function isUnifiedInviteDismissed() {
  try {
    return localStorage.getItem(LS_UNIFIED_DISMISS_KEY) === '1' || currentCorpConfig?.dispensaConvite === true;
  } catch {
    return Boolean(currentCorpConfig?.dispensaConvite);
  }
}

export function dismissUnifiedInviteLocal() {
  try {
    localStorage.setItem(LS_UNIFIED_DISMISS_KEY, '1');
  } catch {}
}

/**
 * Captura ?trabalho=1 antes/durante o login para abrir o modal após autenticar.
 */
export function captureWorkUrlParam() {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('trabalho') === '1') {
      sessionStorage.setItem(PENDING_WORK_PARAM_KEY, '1');
      localStorage.setItem(PENDING_WORK_PARAM_KEY, '1');
      return true;
    }
    return (
      sessionStorage.getItem(PENDING_WORK_PARAM_KEY) === '1' ||
      localStorage.getItem(PENDING_WORK_PARAM_KEY) === '1'
    );
  } catch {
    return false;
  }
}

export function clearWorkUrlParam() {
  try {
    sessionStorage.removeItem(PENDING_WORK_PARAM_KEY);
    localStorage.removeItem(PENDING_WORK_PARAM_KEY);
    const url = new URL(window.location.href);
    if (url.searchParams.has('trabalho')) {
      url.searchParams.delete('trabalho');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
  } catch {}
}

/**
 * Etapa C1: Captura ?espaco=WSID&demanda=ID antes/durante o login (funciona até no Modo Simples).
 */
export function captureDirectDemandUrlParams() {
  try {
    const url = new URL(window.location.href);
    const wsId = url.searchParams.get('espaco');
    const demandaId = url.searchParams.get('demanda');
    if (wsId && demandaId) {
      const payload = JSON.stringify({ wsId, demandaId });
      sessionStorage.setItem(PENDING_DIRECT_LINK_KEY, payload);
      localStorage.setItem(PENDING_DIRECT_LINK_KEY, payload);
      return { wsId, demandaId };
    }
    const raw = sessionStorage.getItem(PENDING_DIRECT_LINK_KEY) || localStorage.getItem(PENDING_DIRECT_LINK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearDirectDemandUrlParams() {
  try {
    sessionStorage.removeItem(PENDING_DIRECT_LINK_KEY);
    localStorage.removeItem(PENDING_DIRECT_LINK_KEY);
    const url = new URL(window.location.href);
    let changed = false;
    if (url.searchParams.has('espaco')) {
      url.searchParams.delete('espaco');
      changed = true;
    }
    if (url.searchParams.has('demanda')) {
      url.searchParams.delete('demanda');
      changed = true;
    }
    if (changed) {
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
  } catch {}
}

/**
 * Carregamento dinâmico sob demanda da interface corporativa.
 */
export async function loadCorporativoModule() {
  if (!modoCorporativoAtivo()) return null;
  if (!loadedCorpUiMod) {
    loadedCorpUiMod = await import('./corporativo/corporativo-ui.js?v=1');
  }
  return loadedCorpUiMod;
}
