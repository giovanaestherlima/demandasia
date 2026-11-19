// ============================================================================
// Autenticação com Google via Firebase Authentication
// ============================================================================

import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import { auth } from './firebase-config.js?v=5';

const provider = new GoogleAuthProvider();

// Processa retorno de login por redirect (quando popup foi bloqueado ou em PWA iOS)
if (auth) {
  getRedirectResult(auth).catch((err) => {
    console.warn('[Pauta Auth] Erro no retorno do redirect:', err?.code || err);
  });
}

/**
 * Inicia o fluxo de login com conta Google (popup com fallback automático para redirect).
 * @returns {Promise<import('firebase/auth').UserCredential | void>}
 */
export async function loginWithGoogle() {
  if (!auth) {
    throw new Error('Firebase não configurado. Verifique js/firebase-config.js.');
  }
  try {
    return await signInWithPopup(auth, provider);
  } catch (err) {
    const code = err?.code || '';
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      return signInWithRedirect(auth, provider);
    }
    throw err;
  }
}

/**
 * Encerra a sessão atual do usuário.
 * @returns {Promise<void>}
 */
export async function logout() {
  if (!auth) return;
  return signOut(auth);
}

/**
 * Registra um observador para mudanças no estado de autenticação.
 * @param {(user: import('firebase/auth').User | null) => void} callback
 * @returns {() => void} Função para cancelar a inscrição
 */
export function observeAuth(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}
