// ============================================================================
// Configuração e inicialização do Firebase (SDK modular v13.4.0 via CDN)
// ============================================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { getAI, GoogleAIBackend } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js';
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app-check.js';

/**
 * Configuração do projeto Firebase (pauta-demandas-gi).
 * Nota: a apiKey do Firebase Web é um identificador público do projeto;
 * a segurança real é garantida pelo Firebase Auth + Firestore Rules + App Check.
 */
const firebaseConfig = {
  apiKey: 'AIzaSyA9Wp0BPA6UDmdASuLOxJ8TlTro3fGfOvE',
  authDomain: 'pauta-demandas-gi.firebaseapp.com',
  projectId: 'pauta-demandas-gi',
  storageBucket: 'pauta-demandas-gi.firebasestorage.app',
  messagingSenderId: '473966606619',
  appId: '1:473966606619:web:af1059f52e54cb6258bbbe',
  measurementId: 'G-P1XQH88Y1H'
};

/**
 * Chave do site reCAPTCHA Enterprise para ativar o Firebase App Check.
 */
const RECAPTCHA_ENTERPRISE_SITE_KEY = '6LdieiUuAAAAAAihy4D4iS5ftCglRouGHbE-lxT5';

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

  const isPreviewChannel = window.location.hostname.includes('--');
  if (RECAPTCHA_ENTERPRISE_SITE_KEY && !isPreviewChannel) {
    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    if (isLocalhost) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
      isTokenAutoRefreshEnabled: true
    });
  }

  auth = getAuth(app);

  // No iPhone/iPad em modo PWA (Tela de Início), IndexedDB multi-aba do WebKit trava o Firestore.
  // Usamos memoryLocalCache + auto-detect long polling no iOS/standalone para resposta instantânea.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches;

  try {
    if (isIOS && isStandalone) {
      db = initializeFirestore(app, {
        localCache: memoryLocalCache(),
        experimentalAutoDetectLongPolling: true
      });
    } else if (isIOS) {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache(),
        experimentalAutoDetectLongPolling: true
      });
    } else {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        }),
        experimentalAutoDetectLongPolling: true
      });
    }
  } catch (err) {
    console.warn('[Pauta] Persistência offline indisponível, usando Firestore padrão:', err);
    db = getFirestore(app);
  }

  ai = getAI(app, { backend: new GoogleAIBackend() });
}

export { app, auth, db, ai };
