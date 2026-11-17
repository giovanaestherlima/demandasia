// ============================================================================
// Configuração e inicialização do Firebase (SDK modular v13.4.0 via CDN)
// ============================================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { getAI, GoogleAIBackend } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js';

/**
 * SUBSTITUA os valores abaixo pela configuração do seu projeto no Firebase Console
 * (Configurações do Projeto -> Seus aplicativos -> Aplicativo da Web).
 * Nota: a apiKey do Firebase Web é um identificador público do projeto;
 * a segurança real é garantida pelo Firebase Auth + Firestore Rules + App Check.
 */
const firebaseConfig = {
  apiKey: 'COLE_SUA_API_KEY_AQUI',
  authDomain: 'SEU_PROJETO.firebaseapp.com',
  projectId: 'SEU_PROJETO_ID',
  storageBucket: 'SEU_PROJETO.firebasestorage.app',
  messagingSenderId: 'SEU_SENDER_ID',
  appId: 'SEU_APP_ID'
};

/**
 * Verifica se o usuário já preencheu a configuração do Firebase.
 * @returns {boolean}
 */
export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith('COLE_') &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.startsWith('SEU_')
  );
}

let app = null;
let auth = null;
let db = null;
let ai = null;

if (isFirebaseConfigured()) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  // Inicializa o Firebase AI Logic com o provedor Gemini Developer API
  ai = getAI(app, { backend: new GoogleAIBackend() });
}

export { app, auth, db, ai };
