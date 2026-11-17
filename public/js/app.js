// ============================================================================
// Pauta — Orquestrador Principal da Aplicação (ES Modules)
// ============================================================================

import { isFirebaseConfigured } from './firebase-config.js';
import { loginWithGoogle, logout, observeAuth } from './auth.js';
import {
  DEFAULT_PREFERENCES,
  createDemanda,
  deleteDemanda,
  loadPreferences,
  savePreferences,
  subscribeDemandas,
  toggleDemandaStatus,
  updateDemanda
} from './db.js';
import { parseDemandWithAI } from './ai.js';
import {
  createVoiceRecognizer,
  isSpeechRecognitionSupported,
  speakText,
  stopSpeaking
} from './speech.js';
import {
  buildSummaryMessage,
  createReminderScheduler,
  requestBrowserNotificationPermission
} from './alerts.js';
import {
  applyTheme,
  filterAndSortDemandas,
  renderAttentionPanel,
  renderDemandsList,
  showToast
} from './ui.js';

// Estado global em memória
const state = {
  user: null,
  demandas: [],
  prefs: { ...DEFAULT_PREFERENCES },
  filter: 'pendentes',
  search: '',
  sort: 'antigas',
  unsubscribeDemandas: null,
  spokenOnOpen: false,
  editingDemand: null,
  pendingDraft: null,
  deletingDemand: null,
  isListening: false
};

// Elementos do DOM
const els = {
  authView: document.getElementById('auth-view'),
  appView: document.getElementById('app-view'),
  loginBtn: document.getElementById('login-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  userMenu: document.getElementById('user-menu'),
  userAvatar: document.getElementById('user-avatar'),
  userName: document.getElementById('user-name'),
  settingsBtn: document.getElementById('settings-btn'),
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  configWarning: document.getElementById('firebase-config-warning'),

  speakSummaryBtn: document.getElementById('speak-summary-btn'),
  muteSummaryBtn: document.getElementById('mute-summary-btn'),

  voiceStage: document.getElementById('voice-stage'),
  micWrapper: document.getElementById('mic-wrapper'),
  micBtn: document.getElementById('mic-btn'),
  voiceStatus: document.getElementById('voice-status'),
  voiceLiveBox: document.getElementById('voice-live-box'),
  voiceLiveText: document.getElementById('voice-live-text'),
  voiceCancelBtn: document.getElementById('voice-cancel-btn'),
  voiceFinishBtn: document.getElementById('voice-finish-btn'),
  voiceUnsupported: document.getElementById('voice-unsupported'),

  textForm: document.getElementById('text-capture-form'),
  textInput: document.getElementById('demand-text-input'),
  textSubmitBtn: document.getElementById('text-submit-btn'),

  filterTabs: document.querySelectorAll('.tab-btn'),
  searchInput: document.getElementById('search-input'),
  sortSelect: document.getElementById('sort-select'),
  demandsList: document.getElementById('demands-list'),

  previewDialog: document.getElementById('preview-dialog'),
  previewTitle: document.getElementById('preview-dialog-title'),
  previewForm: document.getElementById('preview-form'),
  previewAiBadge: document.getElementById('preview-ai-badge'),
  previewCloseX: document.getElementById('preview-close-x'),
  previewDiscardBtn: document.getElementById('preview-discard-btn'),
  editTitulo: document.getElementById('edit-titulo'),
  editDescricao: document.getElementById('edit-descricao'),
  editPrioridade: document.getElementById('edit-prioridade'),
  editPrazo: document.getElementById('edit-prazo'),
  editCategoria: document.getElementById('edit-categoria'),
  editStatus: document.getElementById('edit-status'),

  deleteDialog: document.getElementById('confirm-delete-dialog'),
  deleteDialogDesc: document.getElementById('delete-dialog-desc'),

  settingsDialog: document.getElementById('settings-dialog'),
  settingsForm: document.getElementById('settings-form'),
  settingsCloseX: document.getElementById('settings-close-x'),
  cfgSalvarDireto: document.getElementById('cfg-salvar-direto'),
  cfgSilenciarFala: document.getElementById('cfg-silenciar-fala'),
  cfgIntervalo: document.getElementById('cfg-intervalo'),
  cfgAmarelo: document.getElementById('cfg-amarelo'),
  cfgLaranja: document.getElementById('cfg-laranja'),
  cfgVermelho: document.getElementById('cfg-vermelho'),
  cfgNotifBtn: document.getElementById('cfg-notif-btn')
};

const reminderScheduler = createReminderScheduler(
  () => state.demandas,
  () => state.prefs,
  (msg) => showToast(msg, 7000)
);

// ----------------------------------------------------------------------------
// Renderização geral
// ----------------------------------------------------------------------------
function renderAll() {
  renderAttentionPanel(state.demandas, state.prefs);

  const visiveis = filterAndSortDemandas(state.demandas, {
    filter: state.filter,
    search: state.search,
    sort: state.sort
  });

  renderDemandsList(els.demandsList, visiveis, state.prefs, {
    onToggleDone: handleToggleDone,
    onEdit: openEditDialog,
    onDelete: openDeleteDialog
  });
}

function updateMuteButtonUI() {
  const silenciado = Boolean(state.prefs.silenciarResumoFalado);
  els.muteSummaryBtn.setAttribute('aria-pressed', String(silenciado));
  els.muteSummaryBtn.textContent = silenciado ? 'Silenciado' : 'Som ativo';
}

// ----------------------------------------------------------------------------
// Fluxo de Captura (Voz e Texto -> IA/Fallback -> Prévia ou Salvar Direto)
// ----------------------------------------------------------------------------
async function processRawInput(textoLivre, origem) {
  const texto = String(textoLivre || '').trim();
  if (!texto || !state.user) return;

  els.textSubmitBtn.disabled = true;
  els.textSubmitBtn.textContent = 'Organizando...';

  try {
    const { demanda, usedFallback } = await parseDemandWithAI(texto);
    const rascunho = {
      ...demanda,
      status: 'pendente',
      origem,
      textoOriginal: texto
    };

    if (state.prefs.salvarDiretoSemPrevia) {
      await createDemanda(state.user.uid, rascunho);
      els.textInput.value = '';
      showToast(
        usedFallback
          ? 'Demanda salva no modo simples (IA indisponível).'
          : 'Demanda organizada e salva!'
      );
      return;
    }

    openPreviewDialog(rascunho, usedFallback);
  } catch (err) {
    showToast(err.message || 'Não foi possível processar a demanda.');
  } finally {
    els.textSubmitBtn.disabled = false;
    els.textSubmitBtn.textContent = 'Organizar';
  }
}

function openPreviewDialog(rascunho, usedFallback) {
  state.editingDemand = null;
  state.pendingDraft = rascunho;

  els.previewTitle.textContent = 'Revisar demanda';
  els.previewDiscardBtn.textContent = 'Descartar';

  if (usedFallback) {
    els.previewAiBadge.textContent = 'IA indisponível no momento — preenchido no modo simples. Você pode ajustar antes de salvar.';
    els.previewAiBadge.classList.remove('hidden');
  } else {
    els.previewAiBadge.classList.add('hidden');
  }

  fillPreviewFields(rascunho);
  els.previewDialog.showModal();
}

function openEditDialog(demanda) {
  state.editingDemand = demanda;
  state.pendingDraft = null;

  els.previewTitle.textContent = 'Editar demanda';
  els.previewDiscardBtn.textContent = 'Cancelar';
  els.previewAiBadge.classList.add('hidden');

  fillPreviewFields(demanda);
  els.previewDialog.showModal();
}

function fillPreviewFields(d) {
  els.editTitulo.value = d.titulo || '';
  els.editDescricao.value = d.descricao || '';
  els.editPrioridade.value = d.prioridade || 'media';
  els.editPrazo.value = d.prazo || '';
  els.editCategoria.value = d.categoria || '';
  els.editStatus.value = d.status || 'pendente';
}

// ----------------------------------------------------------------------------
// Ações nos Cards (Concluir, Reabrir, Excluir)
// ----------------------------------------------------------------------------
async function handleToggleDone(demanda) {
  if (!state.user) return;
  try {
    await toggleDemandaStatus(state.user.uid, demanda);
    showToast(
      demanda.status === 'concluida' ? 'Demanda reaberta.' : 'Demanda concluída!'
    );
  } catch (err) {
    showToast('Erro ao atualizar status.');
    console.error(err);
  }
}

function openDeleteDialog(demanda) {
  state.deletingDemand = demanda;
  els.deleteDialogDesc.textContent = `Tem certeza que deseja excluir "${demanda.titulo}"?`;
  els.deleteDialog.showModal();
}

// ----------------------------------------------------------------------------
// Reconhecimento de Voz (Web Speech API)
// ----------------------------------------------------------------------------
function setupVoiceRecognition() {
  if (!isSpeechRecognitionSupported()) {
    els.voiceStage.classList.add('hidden');
    els.voiceUnsupported.classList.remove('hidden');
    return;
  }

  let latestTranscript = '';

  const recognizer = createVoiceRecognizer({
    onInterim: (texto) => {
      latestTranscript = texto;
      els.voiceLiveText.textContent = texto || 'Ouvindo...';
    },
    onFinal: (texto) => {
      latestTranscript = texto;
      if (texto) {
        processRawInput(texto, 'voz');
      }
    },
    onError: (msg) => {
      showToast(msg);
      setListeningUI(false);
    },
    onEnd: () => {
      setListeningUI(false);
    }
  });

  function setListeningUI(listening) {
    state.isListening = listening;
    els.micBtn.setAttribute('aria-pressed', String(listening));
    els.micWrapper.classList.toggle('is-listening', listening);
    els.voiceLiveBox.classList.toggle('hidden', !listening);
    els.voiceStatus.textContent = listening
      ? 'Ouvindo em português... fale sua demanda'
      : 'Toque no microfone e fale naturalmente';
  }

  els.micBtn.addEventListener('click', () => {
    if (state.isListening) {
      recognizer.stop();
    } else {
      latestTranscript = '';
      els.voiceLiveText.textContent = 'Ouvindo...';
      setListeningUI(true);
      recognizer.start();
    }
  });

  els.voiceCancelBtn.addEventListener('click', () => {
    recognizer.cancel();
    setListeningUI(false);
    showToast('Gravação cancelada.');
  });

  els.voiceFinishBtn.addEventListener('click', () => {
    recognizer.stop();
  });
}

// ----------------------------------------------------------------------------
// Eventos de Interface
// ----------------------------------------------------------------------------
function bindEvents() {
  els.loginBtn.addEventListener('click', async () => {
    try {
      await loginWithGoogle();
    } catch (err) {
      showToast(err.message || 'Falha ao entrar com Google.');
    }
  });

  els.logoutBtn.addEventListener('click', async () => {
    stopSpeaking();
    await logout();
  });

  // Alternância manual de tema
  els.themeToggleBtn.addEventListener('click', async () => {
    const atual = document.documentElement.dataset.theme;
    const isDarkSystem = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const proximo =
      atual === 'escuro'
        ? 'claro'
        : atual === 'claro'
          ? 'escuro'
          : isDarkSystem
            ? 'claro'
            : 'escuro';

    applyTheme(proximo);
    state.prefs.tema = proximo;
    if (state.user) {
      await savePreferences(state.user.uid, { tema: proximo }).catch(() => {});
    }
  });

  // Resumo falado manual e silenciar
  els.speakSummaryBtn.addEventListener('click', () => {
    const { text } = buildSummaryMessage(state.demandas);
    speakText(text);
  });

  els.muteSummaryBtn.addEventListener('click', async () => {
    const novoValor = !state.prefs.silenciarResumoFalado;
    state.prefs.silenciarResumoFalado = novoValor;
    if (novoValor) stopSpeaking();
    updateMuteButtonUI();
    if (state.user) {
      await savePreferences(state.user.uid, { silenciarResumoFalado: novoValor }).catch(() => {});
    }
  });

  // Envio por texto
  els.textForm.addEventListener('submit', (e) => {
    e.preventDefault();
    processRawInput(els.textInput.value, 'texto');
  });

  // Filtros, busca e ordenação
  els.filterTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      els.filterTabs.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      renderAll();
    });
  });

  els.searchInput.addEventListener('input', (e) => {
    state.search = e.target.value;
    renderAll();
  });

  els.sortSelect.addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderAll();
  });

  // Diálogo de prévia / edição
  els.previewCloseX.addEventListener('click', () => els.previewDialog.close('cancel'));
  els.previewDiscardBtn.addEventListener('click', () => els.previewDialog.close('cancel'));

  els.previewForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.user) return;

    const dados = {
      titulo: els.editTitulo.value.trim(),
      descricao: els.editDescricao.value.trim(),
      prioridade: els.editPrioridade.value,
      prazo: els.editPrazo.value || null,
      categoria: els.editCategoria.value.trim() || null,
      status: els.editStatus.value
    };

    if (!dados.titulo) {
      showToast('Informe um título para a demanda.');
      return;
    }

    try {
      if (state.editingDemand) {
        await updateDemanda(state.user.uid, state.editingDemand.id, {
          ...dados,
          concluidoEm: state.editingDemand.concluidoEm
        });
        showToast('Demanda atualizada.');
      } else if (state.pendingDraft) {
        await createDemanda(state.user.uid, {
          ...state.pendingDraft,
          ...dados
        });
        els.textInput.value = '';
        showToast('Demanda salva!');
      }
      els.previewDialog.close('save');
    } catch (err) {
      showToast('Erro ao salvar demanda no Firestore.');
      console.error(err);
    }
  });

  // Diálogo de exclusão (seguindo padrão nativo e limpando returnValue)
  els.deleteDialog.addEventListener('close', async () => {
    const action = els.deleteDialog.returnValue;
    els.deleteDialog.returnValue = '';

    if (action === 'delete' && state.deletingDemand && state.user) {
      try {
        await deleteDemanda(state.user.uid, state.deletingDemand.id);
        showToast('Demanda excluída.');
      } catch (err) {
        showToast('Erro ao excluir demanda.');
        console.error(err);
      }
    }
    state.deletingDemand = null;
  });

  // Diálogo de configurações
  els.settingsBtn.addEventListener('click', () => {
    els.cfgSalvarDireto.checked = Boolean(state.prefs.salvarDiretoSemPrevia);
    els.cfgSilenciarFala.checked = Boolean(state.prefs.silenciarResumoFalado);
    els.cfgIntervalo.value = state.prefs.intervaloLembreteMinutos ?? 30;
    els.cfgAmarelo.value = state.prefs.diasAvisoAmarelo ?? 3;
    els.cfgLaranja.value = state.prefs.diasAvisoLaranja ?? 7;
    els.cfgVermelho.value = state.prefs.diasAvisoVermelho ?? 14;
    updateNotifButtonText();
    els.settingsDialog.showModal();
  });

  els.settingsCloseX.addEventListener('click', () => els.settingsDialog.close('cancel'));

  els.cfgNotifBtn.addEventListener('click', async () => {
    const perm = await requestBrowserNotificationPermission();
    updateNotifButtonText();
    if (perm === 'granted') {
      showToast('Notificações do navegador ativadas!');
    } else if (perm === 'denied') {
      showToast('Permissão negada no navegador. Você pode alterar nas configurações do site.');
    } else if (perm === 'unsupported') {
      showToast('Este navegador não suporta Notification API.');
    }
  });

  els.settingsDialog.addEventListener('close', async () => {
    const action = els.settingsDialog.returnValue;
    els.settingsDialog.returnValue = '';

    if (action === 'save' && state.user) {
      const novasPrefs = {
        ...state.prefs,
        salvarDiretoSemPrevia: els.cfgSalvarDireto.checked,
        silenciarResumoFalado: els.cfgSilenciarFala.checked,
        intervaloLembreteMinutos: Math.max(1, Number(els.cfgIntervalo.value) || 30),
        diasAvisoAmarelo: Math.max(1, Number(els.cfgAmarelo.value) || 3),
        diasAvisoLaranja: Math.max(1, Number(els.cfgLaranja.value) || 7),
        diasAvisoVermelho: Math.max(1, Number(els.cfgVermelho.value) || 14)
      };

      state.prefs = novasPrefs;
      updateMuteButtonUI();
      renderAll();
      reminderScheduler.restart();

      try {
        await savePreferences(state.user.uid, novasPrefs);
        showToast('Preferências salvas.');
      } catch (err) {
        showToast('Erro ao salvar preferências.');
        console.error(err);
      }
    }
  });
}

function updateNotifButtonText() {
  if (!('Notification' in window)) {
    els.cfgNotifBtn.textContent = 'Não suportado';
    els.cfgNotifBtn.disabled = true;
    return;
  }
  if (Notification.permission === 'granted') {
    els.cfgNotifBtn.textContent = 'Ativadas';
  } else if (Notification.permission === 'denied') {
    els.cfgNotifBtn.textContent = 'Bloqueadas';
  } else {
    els.cfgNotifBtn.textContent = 'Permitir';
  }
}

// ----------------------------------------------------------------------------
// Inicialização
// ----------------------------------------------------------------------------
function init() {
  if (!isFirebaseConfigured()) {
    els.configWarning.textContent =
      'Atenção: preencha suas credenciais em public/js/firebase-config.js antes de fazer login (veja o passo a passo no README.md).';
    els.configWarning.classList.remove('hidden');
    els.loginBtn.disabled = true;
  }

  setupVoiceRecognition();
  bindEvents();

  observeAuth(async (user) => {
    state.user = user;

    if (state.unsubscribeDemandas) {
      state.unsubscribeDemandas();
      state.unsubscribeDemandas = null;
    }

    if (!user) {
      state.demandas = [];
      state.spokenOnOpen = false;
      reminderScheduler.stop();
      els.authView.classList.remove('hidden');
      els.appView.classList.add('hidden');
      els.userMenu.classList.add('hidden');
      els.settingsBtn.classList.add('hidden');
      return;
    }

    // Usuário autenticado
    els.authView.classList.add('hidden');
    els.appView.classList.remove('hidden');
    els.userMenu.classList.remove('hidden');
    els.settingsBtn.classList.remove('hidden');

    els.userName.textContent = (user.displayName || user.email || 'Usuário').split(' ')[0];
    if (user.photoURL) {
      els.userAvatar.src = user.photoURL;
      els.userAvatar.classList.remove('hidden');
    } else {
      els.userAvatar.classList.add('hidden');
    }

    try {
      state.prefs = await loadPreferences(user.uid);
    } catch {
      state.prefs = { ...DEFAULT_PREFERENCES };
    }

    applyTheme(state.prefs.tema);
    updateMuteButtonUI();
    reminderScheduler.restart();

    state.unsubscribeDemandas = subscribeDemandas(
      user.uid,
      (demandas) => {
        state.demandas = demandas;
        renderAll();

        // Resumo falado na primeira carga após abrir o sistema
        if (!state.spokenOnOpen) {
          state.spokenOnOpen = true;
          if (!state.prefs.silenciarResumoFalado) {
            const { text } = buildSummaryMessage(demandas);
            speakText(text);
          }
        }
      },
      (err) => {
        showToast('Erro ao sincronizar demandas com o Firestore.');
        console.error(err);
      }
    );
  });
}

init();
