// ============================================================================
// Autenticação com Google via Firebase Authentication
// ============================================================================

import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import { auth } from './firebase-config.js?v=5';

const provider = new GoogleAuthProvider();

/**
 * Inicia o fluxo de login com conta Google em janela popup.
 * @returns {Promise<import('firebase/auth').UserCredential>}
 */
export async function loginWithGoogle() {
  if (!auth) {
    throw new Error('Firebase não configurado. Verifique js/firebase-config.js.');
  }
  return signInWithPopup(auth, provider);
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
