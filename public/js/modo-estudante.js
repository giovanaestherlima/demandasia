// ============================================================================
// Etapa E0: Registro Central de Recursos (Feature Flags) e Modal do Modo Estudante
// Quando ativo === false, nenhum módulo em ./estudante/ ou planner.css é baixado.
// ============================================================================

import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { db } from './firebase-config.js?v=5';
import { trackWrites } from './workspaces.js?v=5';

const LS_KEY = 'pauta_modo_estudante';
const PENDING_PARAM_KEY = 'pauta_pending_student_modal';

export const DEFAULT_STUDENT_CONFIG = {
  ativo: false,
  modulos: {
    planner: true,
    disciplinas: true,
    foco: true,
    notas: true,
    captura: true
  },
  ativadoEm: null,
  onboardingConcluido: false,
  dispensaConvite: false
};

let currentConfig = readLocalStudentConfig();
const loadedModules = new Map();

function cloneDefault() {
  return {
    ...DEFAULT_STUDENT_CONFIG,
    modulos: { ...DEFAULT_STUDENT_CONFIG.modulos }
  };
}

export function readLocalStudentConfig() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return cloneDefault();
    const parsed = JSON.parse(raw);
    return {
      ...cloneDefault(),
      ...parsed,
      modulos: { ...DEFAULT_STUDENT_CONFIG.modulos, ...(parsed?.modulos || {}) }
    };
  } catch {
    return cloneDefault();
  }
}

export function writeLocalStudentConfig(cfg) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  } catch {
    // Ignora falhas de quota ou modo privado restrito
  }
}

export function getStudentConfig() {
  return currentConfig;
}

/**
 * Função central de feature flag: indica se o Modo Estudante está ativo.
 * @returns {boolean}
 */
export function modoEstudanteAtivo() {
  return Boolean(currentConfig?.ativo);
}

/**
 * Indica se um módulo específico do Modo Estudante está habilitado.
 * @param {'planner'|'disciplinas'|'foco'|'notas'|'captura'} nome
 * @returns {boolean}
 */
export function moduloAtivo(nome) {
  return Boolean(currentConfig?.ativo && currentConfig?.modulos?.[nome]);
}

/**
 * Sincroniza com o Firestore após o login (Firestore sempre vence em caso de divergência).
 * @param {object | null} userProfileData
 */
export function syncStudentConfigFromProfile(userProfileData) {
  const remote = userProfileData?.config?.modoEstudante;
  if (remote && typeof remote === 'object') {
    currentConfig = {
      ...cloneDefault(),
      ...remote,
      modulos: { ...DEFAULT_STUDENT_CONFIG.modulos, ...(remote.modulos || {}) }
    };
    writeLocalStudentConfig(currentConfig);
  }
  return currentConfig;
}

/**
 * Salva a configuração do Modo Estudante em users/{uid}.config.modoEstudante (1 gravação).
 * @param {string} uid
 * @param {Partial<typeof DEFAULT_STUDENT_CONFIG>} patch
 */
export async function saveStudentConfig(uid, patch) {
  const next = {
    ...currentConfig,
    ...patch,
    modulos: {
      ...currentConfig.modulos,
      ...(patch.modulos || {})
    }
  };
  if (patch.ativo === true && !next.ativadoEm) {
    next.ativadoEm = new Date().toISOString();
  }

  await setDoc(
    doc(db, 'users', uid),
    {
      config: { modoEstudante: next },
      atualizadoEm: serverTimestamp()
    },
    { merge: true }
  );
  trackWrites(1);

  currentConfig = next;
  writeLocalStudentConfig(next);
  return currentConfig;
}

/**
 * Captura ?estudante=1 antes/durante o login para abrir o modal após autenticar.
 */
export function captureStudentUrlParam() {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('estudante') === '1') {
      sessionStorage.setItem(PENDING_PARAM_KEY, '1');
      localStorage.setItem(PENDING_PARAM_KEY, '1');
      return true;
    }
    return (
      sessionStorage.getItem(PENDING_PARAM_KEY) === '1' ||
      localStorage.getItem(PENDING_PARAM_KEY) === '1'
    );
  } catch {
    return false;
  }
}

export function clearStudentUrlParam() {
  try {
    sessionStorage.removeItem(PENDING_PARAM_KEY);
    localStorage.removeItem(PENDING_PARAM_KEY);
    const url = new URL(window.location.href);
    if (url.searchParams.has('estudante')) {
      url.searchParams.delete('estudante');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
  } catch {
    // Ignora
  }
}

function injectPlannerCssIfNeeded() {
  if (document.getElementById('pauta-planner-css')) return;
  const link = document.createElement('link');
  link.id = 'pauta-planner-css';
  link.rel = 'stylesheet';
  link.href = './css/planner.css?v=5';
  document.head.appendChild(link);
}

/**
 * Carrega dinamicamente (import()) apenas os módulos de estudante habilitados.
 * Nunca executado quando modoEstudanteAtivo() === false.
 */
export async function loadEnabledStudentModules() {
  if (!modoEstudanteAtivo()) return {};

  const tasks = [];
  const result = {};

  const load = async (key, path) => {
    if (loadedModules.has(key)) {
      result[key] = loadedModules.get(key);
      return;
    }
    const mod = await import(path);
    loadedModules.set(key, mod);
    result[key] = mod;
  };

  if (moduloAtivo('disciplinas') || moduloAtivo('notas')) {
    tasks.push(load('disciplinas', './estudante/disciplinas.js?v=5'));
  }
  if (moduloAtivo('planner')) {
    injectPlannerCssIfNeeded();
    tasks.push(load('planner', './estudante/planner.js?v=5'));
  }
  if (moduloAtivo('foco')) {
    tasks.push(load('estudo', './estudante/estudo.js?v=5'));
  }
  if (moduloAtivo('captura')) {
    tasks.push(load('captura', './estudante/captura.js?v=5'));
  }
  tasks.push(load('bemestar', './estudante/hoje-bemestar.js?v=5'));

  await Promise.all(tasks);
  return result;
}
