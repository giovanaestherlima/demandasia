// ============================================================================
// Pauta — Orquestrador Principal (Fases 1 a 6)
// ============================================================================

import { isFirebaseConfigured } from './firebase-config.js?v=5';
import { loginWithGoogle, logout, observeAuth } from './auth.js?v=5';
import {
  DEFAULT_PREFERENCES,
  createDemanda,
  deleteDemanda,
  loadPreferences,
  restoreDemanda,
  savePreferences,
  snoozeDemanda,
  subscribeDemandas,
  toggleDemandaStatus,
  updateDemanda
} from './db.js?v=5';
import {
  buildFallbackDemand,
  findSimilarPendingDemand,
  generateWeeklySummaryWithAI,
  interpretVoiceCommandWithAI,
  parseBatchDemandsWithAI,
  parseDemandWithAIStream,
  warmUpAiModel
} from './ai.js?v=5';
import {
  createVoiceRecognizer,
  isSpeechRecognitionSupported,
  speakText,
  stopSpeaking
} from './speech.js?v=5';
import {
  buildMorningSummary,
  buildSummaryMessage,
  createReminderScheduler,
  requestBrowserNotificationPermission,
  todayLocalISO
} from './alerts.js?v=5';
import {
  computeMetrics,
  exportDemandasToCSV,
  renderWeeklySvgChart,
  suggestPriorityFromHistory
} from './metrics.js?v=5';
import {
  applyTheme,
  filterAndSortDemandas,
  formatDateBR,
  renderAttentionPanel,
  renderDemandsList,
  renderLoadingSkeletons,
  renderTagFilterChips,
  showToast
} from './ui.js?v=5';

const state = {
  user: null,
  demandas: [],
  loadedInitial: false,
  prefs: { ...DEFAULT_PREFERENCES },
  filter: 'pendentes',
  activeTag: null,
  search: '',
  sort: 'antigas',
  captureMode: 'auto', // 'auto' | 'demanda' | 'comando' | 'lote'
  unsubscribeDemandas: null,
  spokenOnOpen: false,
  editingDemand: null,
  pendingDraft: null,
  batchQueue: [],
  batchTotal: 0,
  editingSubtarefas: [],
  deletingDemand: null,
  snoozingDemand: null,
  isListening: false,
  dirtyFields: new Set(),
  refineSessionId: 0,
  debugTempo: localStorage.getItem('pauta_debug_tempo') === '1',
  lastPerf: null,
  deferredInstallPrompt: null
};

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
  installAppBtn: document.getElementById('install-app-btn'),
  iosInstallBanner: document.getElementById('ios-install-banner'),
  iosInstallDismiss: document.getElementById('ios-install-dismiss'),
  morningBtn: document.getElementById('morning-btn'),
  metricsBtn: document.getElementById('metrics-btn'),
  shortcutsBtn: document.getElementById('shortcuts-btn'),
  configWarning: document.getElementById('firebase-config-warning'),

  speakSummaryBtn: document.getElementById('speak-summary-btn'),
  muteSummaryBtn: document.getElementById('mute-summary-btn'),

  modePills: document.querySelectorAll('.mode-pill'),
  voiceStage: document.getElementById('voice-stage'),
  micWrapper: document.getElementById('mic-wrapper'),
  micBtn: document.getElementById('mic-btn'),
  voiceStatus: document.getElementById('voice-status'),
  voiceLiveBox: document.getElementById('voice-live-box'),
  voiceLiveText: document.getElementById('voice-live-text'),
  voiceCancelBtn: document.getElementById('voice-cancel-btn'),
  voiceFinishBtn: document.getElementById('voice-finish-btn'),
  voiceUnsupported: document.getElementById('voice-unsupported'),
  commandReplyBox: document.getElementById('command-reply-box'),

  textForm: document.getElementById('text-capture-form'),
  textInput: document.getElementById('demand-text-input'),
  textSubmitBtn: document.getElementById('text-submit-btn'),

  filterTabs: document.querySelectorAll('.tab-btn'),
  tagFilterRow: document.getElementById('tag-filter-row'),
  searchInput: document.getElementById('search-input'),
  sortSelect: document.getElementById('sort-select'),
  demandsList: document.getElementById('demands-list'),

  previewDialog: document.getElementById('preview-dialog'),
  previewTitle: document.getElementById('preview-dialog-title'),
  previewForm: document.getElementById('preview-form'),
  previewAiBar: document.getElementById('preview-ai-bar'),
  previewAiStatusText: document.getElementById('preview-ai-status-text'),
  previewRetryAiBtn: document.getElementById('preview-retry-ai-btn'),
  duplicateWarning: document.getElementById('duplicate-warning'),
  duplicateWarningText: document.getElementById('duplicate-warning-text'),
  openDuplicateBtn: document.getElementById('open-duplicate-btn'),
  historyPrioHint: document.getElementById('history-prio-hint'),
  previewCloseX: document.getElementById('preview-close-x'),
  previewDiscardBtn: document.getElementById('preview-discard-btn'),
  batchSaveAllBtn: document.getElementById('batch-save-all-btn'),
  editTitulo: document.getElementById('edit-titulo'),
  editDescricao: document.getElementById('edit-descricao'),
  editPrioridade: document.getElementById('edit-prioridade'),
  editPrazo: document.getElementById('edit-prazo'),
  editCategoria: document.getElementById('edit-categoria'),
  editStatus: document.getElementById('edit-status'),
  editEtiquetas: document.getElementById('edit-etiquetas'),
  editRecorrencia: document.getElementById('edit-recorrencia'),
  editDiaMesWrap: document.getElementById('edit-dia-mes-wrap'),
  editDiaMes: document.getElementById('edit-dia-mes'),
  newSubtaskInput: document.getElementById('new-subtask-input'),
  addSubtaskBtn: document.getElementById('add-subtask-btn'),
  subtasksEditor: document.getElementById('subtasks-editor'),
  historyDetails: document.getElementById('history-details'),
  editTimeline: document.getElementById('edit-timeline'),

  snoozeDialog: document.getElementById('snooze-dialog'),
  snoozeDemandName: document.getElementById('snooze-demand-name'),
  snoozeCustomDate: document.getElementById('snooze-custom-date'),
  snoozeCloseX: document.getElementById('snooze-close-x'),
  snoozeCancelBtn: document.getElementById('snooze-cancel-btn'),
  snoozeConfirmBtn: document.getElementById('snooze-confirm-btn'),

  commandDialog: document.getElementById('command-dialog'),
  commandDialogDesc: document.getElementById('command-dialog-desc'),
  commandChoices: document.getElementById('command-choices'),
  commandCancelBtn: document.getElementById('command-cancel-btn'),
  commandConfirmBtn: document.getElementById('command-confirm-btn'),

  morningDialog: document.getElementById('morning-dialog'),
  morningSummaryText: document.getElementById('morning-summary-text'),
  morningDetails: document.getElementById('morning-details'),
  morningSpeakBtn: document.getElementById('morning-speak-btn'),
  morningOkBtn: document.getElementById('morning-ok-btn'),
  morningCloseX: document.getElementById('morning-close-x'),

  metricsDialog: document.getElementById('metrics-dialog'),
  metricsCloseX: document.getElementById('metrics-close-x'),
  metricsOkBtn: document.getElementById('metrics-ok-btn'),
  mPendentes: document.getElementById('m-pendentes'),
  mConcluidas: document.getElementById('m-concluidas'),
  mTempoMedio: document.getElementById('m-tempo-medio'),
  mNoPrazo: document.getElementById('m-no-prazo'),
  metricsWeeklyChart: document.getElementById('metrics-weekly-chart'),
  weeklyAiBtn: document.getElementById('weekly-ai-btn'),
  weeklyAiText: document.getElementById('weekly-ai-text'),
  exportCsvBtn: document.getElementById('export-csv-btn'),
  exportPdfBtn: document.getElementById('export-pdf-btn'),

  shortcutsDialog: document.getElementById('shortcuts-dialog'),
  shortcutsCloseX: document.getElementById('shortcuts-close-x'),
  shortcutsOkBtn: document.getElementById('shortcuts-ok-btn'),

  deleteDialog: document.getElementById('confirm-delete-dialog'),
  deleteDialogDesc: document.getElementById('delete-dialog-desc'),

  settingsDialog: document.getElementById('settings-dialog'),
  settingsForm: document.getElementById('settings-form'),
  settingsCloseX: document.getElementById('settings-close-x'),
  cfgSalvarDireto: document.getElementById('cfg-salvar-direto'),
  cfgSilenciarFala: document.getElementById('cfg-silenciar-fala'),
  cfgDebugTempo: document.getElementById('cfg-debug-tempo'),
  cfgPerfSummary: document.getElementById('cfg-perf-summary'),
  cfgIntervalo: document.getElementById('cfg-intervalo'),
  cfgLimiteHora: document.getElementById('cfg-limite-hora'),
  cfgSilencioInicio: document.getElementById('cfg-silencio-inicio'),
  cfgSilencioFim: document.getElementById('cfg-silencio-fim'),
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

let voiceRecognizer = null;

// ----------------------------------------------------------------------------
// Renderização geral
// ----------------------------------------------------------------------------
function renderAll() {
  renderAttentionPanel(state.demandas, state.prefs);
  renderTagFilterChips(els.tagFilterRow, state.demandas, state.activeTag, (tag) => {
    state.activeTag = tag;
    renderAll();
  });

  const visiveis = filterAndSortDemandas(state.demandas, {
    filter: state.filter,
    search: state.search,
    sort: state.sort,
    tag: state.activeTag
  });

  renderDemandsList(els.demandsList, visiveis, state.prefs, {
    onToggleDone: handleToggleDone,
    onEdit: openEditDialog,
    onDelete: openDeleteDialog,
    onSnooze: openSnoozeDialog
  });
}

function updateMuteButtonUI() {
  const silenciado = Boolean(state.prefs.silenciarResumoFalado);
  els.muteSummaryBtn.setAttribute('aria-pressed', String(silenciado));
  els.muteSummaryBtn.textContent = silenciado ? 'Silenciado' : 'Som ativo';
}

// ----------------------------------------------------------------------------
// PWA e Atalhos (Fase 2)
// ----------------------------------------------------------------------------
function registerPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    els.installAppBtn.classList.remove('hidden');
  });

  els.installAppBtn.addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    els.installAppBtn.classList.add('hidden');
  });

  const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isIos && !isStandalone && localStorage.getItem('pauta_ios_tip_dismissed') !== '1') {
    els.iosInstallBanner.classList.remove('hidden');
  }
  els.iosInstallDismiss.addEventListener('click', () => {
    els.iosInstallBanner.classList.add('hidden');
    localStorage.setItem('pauta_ios_tip_dismissed', '1');
  });
}

function handleUrlShortcuts() {
  const params = new URLSearchParams(window.location.search);
  const acao = params.get('acao');
  if (acao === 'nova') {
    setTimeout(() => els.textInput.focus(), 200);
  } else if (acao === 'falar' && voiceRecognizer) {
    setTimeout(() => els.micBtn.click(), 300);
  }
}

// ----------------------------------------------------------------------------
// Barra IA, Campos editados, Duplicatas e Subtarefas
// ----------------------------------------------------------------------------
function setPreviewAiBar(mode, text, showRetry = false) {
  els.previewAiBar.classList.remove('hidden', 'is-refining', 'is-warn');
  if (mode === 'hidden') {
    els.previewAiBar.classList.add('hidden');
    els.previewRetryAiBtn.classList.add('hidden');
    return;
  }
  if (mode === 'refining') els.previewAiBar.classList.add('is-refining');
  else if (mode === 'warn') els.previewAiBar.classList.add('is-warn');

  els.previewAiStatusText.textContent = text;
  els.previewRetryAiBtn.classList.toggle('hidden', !showRetry);
}

function applyAiFieldsIfClean(fields) {
  if (fields.titulo !== undefined && !state.dirtyFields.has('titulo')) {
    els.editTitulo.value = fields.titulo || '';
  }
  if (fields.descricao !== undefined && !state.dirtyFields.has('descricao')) {
    els.editDescricao.value = fields.descricao || '';
  }
  if (fields.prioridade !== undefined && !state.dirtyFields.has('prioridade')) {
    els.editPrioridade.value = fields.prioridade || 'media';
  }
  if (fields.prazo !== undefined && !state.dirtyFields.has('prazo')) {
    els.editPrazo.value = fields.prazo || '';
  }
  if (fields.categoria !== undefined && !state.dirtyFields.has('categoria')) {
    els.editCategoria.value = fields.categoria || '';
  }
  checkDuplicateAndHistoryHints();
}

function checkDuplicateAndHistoryHints() {
  const titulo = els.editTitulo.value.trim();
  const desc = els.editDescricao.value.trim();

  if (!state.editingDemand && titulo) {
    const similar = findSimilarPendingDemand(titulo, desc, state.demandas);
    if (similar) {
      els.duplicateWarningText.textContent = `Parece com demanda pendente: "${similar.titulo}"`;
      els.openDuplicateBtn.onclick = () => {
        els.previewDialog.close('cancel');
        openEditDialog(similar);
      };
      els.duplicateWarning.classList.remove('hidden');
    } else {
      els.duplicateWarning.classList.add('hidden');
    }
  } else {
    els.duplicateWarning.classList.add('hidden');
  }

  if (!state.editingDemand && (titulo || desc)) {
    const sugPrio = suggestPriorityFromHistory(`${titulo} ${desc}`, state.demandas);
    if (sugPrio && els.editPrioridade.value !== sugPrio) {
      els.historyPrioHint.textContent = `Dica do seu histórico: demandas parecidas costumam ser marcadas como "${sugPrio}".`;
      els.historyPrioHint.classList.remove('hidden');
    } else {
      els.historyPrioHint.classList.add('hidden');
    }
  } else {
    els.historyPrioHint.classList.add('hidden');
  }
}

function renderSubtasksEditor() {
  els.subtasksEditor.replaceChildren();
  state.editingSubtarefas.forEach((sub, idx) => {
    const row = document.createElement('div');
    row.className = `subtask-row ${sub.concluida ? 'is-checked' : ''}`.trim();

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = Boolean(sub.concluida);
    chk.setAttribute('aria-label', `Marcar subtarefa ${sub.texto}`);
    chk.addEventListener('change', () => {
      sub.concluida = chk.checked;
      renderSubtasksEditor();
    });

    const span = document.createElement('span');
    span.textContent = sub.texto;

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'btn btn-ghost btn-sm';
    upBtn.textContent = '↑';
    upBtn.disabled = idx === 0;
    upBtn.setAttribute('aria-label', 'Mover subtarefa para cima');
    upBtn.addEventListener('click', () => {
      const tmp = state.editingSubtarefas[idx - 1];
      state.editingSubtarefas[idx - 1] = sub;
      state.editingSubtarefas[idx] = tmp;
      renderSubtasksEditor();
    });

    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'btn btn-ghost btn-sm';
    rmBtn.textContent = '✕';
    rmBtn.setAttribute('aria-label', `Remover subtarefa ${sub.texto}`);
    rmBtn.addEventListener('click', () => {
      state.editingSubtarefas.splice(idx, 1);
      renderSubtasksEditor();
    });

    row.append(chk, span, upBtn, rmBtn);
    els.subtasksEditor.appendChild(row);
  });
}

function recordPerf(localMs, aiMs, cached, fallback) {
  state.lastPerf = { localMs, aiMs, cached, fallback };
  console.info(
    `[Pauta Perf] Prévia local: ${localMs}ms | IA (${cached ? 'cache' : fallback ? 'fallback' : 'stream'}): ${aiMs}ms`
  );
}

async function runPreviewAiRefinement(texto, sessionId, localMs) {
  setPreviewAiBar('refining', 'Refinando com IA…', false);

  const result = await parseDemandWithAIStream(texto, {
    timeoutMs: 8000,
    onPartial: (partialFields) => {
      if (state.refineSessionId !== sessionId || !els.previewDialog.open) return;
      applyAiFieldsIfClean(partialFields);
    }
  });

  if (state.refineSessionId !== sessionId || !els.previewDialog.open) return;

  recordPerf(localMs, result.elapsedMs, result.cached, result.usedFallback);

  if (result.usedFallback) {
    const motivo = result.timedOut ? 'IA demorou mais de 8s' : (result.reason || 'IA indisponível');
    const perfTxt = state.debugTempo ? ` [${localMs}ms local | ${result.elapsedMs}ms IA]` : '';
    setPreviewAiBar('warn', `Versão local mantida (${motivo}).${perfTxt}`, true);
    return;
  }

  applyAiFieldsIfClean(result.demanda);
  if (state.pendingDraft) {
    state.pendingDraft = { ...state.pendingDraft, ...result.demanda };
  }

  if (state.debugTempo) {
    const origemTxt = result.cached ? 'cache' : `${result.elapsedMs}ms`;
    setPreviewAiBar('done', `Refinado pela IA (${origemTxt} | prévia local: ${localMs}ms).`, false);
  } else {
    setPreviewAiBar('hidden', '', false);
  }
}

// ----------------------------------------------------------------------------
// Captura Principal (Demanda, Lote, Comando)
// ----------------------------------------------------------------------------
async function processRawInput(textoLivre, origem) {
  const texto = String(textoLivre || '').trim();
  if (!texto || !state.user) return;
  els.commandReplyBox.classList.add('hidden');

  // Modo Lote / Colar contexto
  if (state.captureMode === 'lote') {
    els.textSubmitBtn.disabled = true;
    els.textSubmitBtn.textContent = 'Extraindo…';
    try {
      const { demandas } = await parseBatchDemandsWithAI(texto);
      state.batchQueue = demandas.map((d) => ({
        ...d,
        status: 'pendente',
        origem,
        textoOriginal: texto
      }));
      state.batchTotal = state.batchQueue.length;
      openNextBatchItem();
    } catch (err) {
      showToast(err.message || 'Erro ao extrair lote.');
    } finally {
      els.textSubmitBtn.disabled = false;
      els.textSubmitBtn.textContent = 'Organizar';
    }
    return;
  }

  // Modo Comando ou Automático (verifica se é comando)
  if (state.captureMode === 'comando' || state.captureMode === 'auto') {
    const modoForcado = state.captureMode === 'comando' ? 'comando' : 'auto';
    if (modoForcado === 'comando' || /^(o que|qual|quais|conclui|concluir|finaliza|adia|adiar|muda|altera|exclui|excluir|apaga)/i.test(texto)) {
      const intent = await interpretVoiceCommandWithAI(texto, modoForcado);
      if (intent.tipo === 'comando' && intent.acao !== 'nenhuma') {
        await executeManagementCommand(intent);
        els.textInput.value = '';
        return;
      }
    }
  }

  // Fluxo normal otimista (< 1s)
  const t0 = performance.now();
  const localDraft = buildFallbackDemand(texto);
  const localMs = Math.max(1, Math.round(performance.now() - t0));

  const rascunhoBase = {
    ...localDraft,
    status: 'pendente',
    origem,
    textoOriginal: texto
  };

  if (state.prefs.salvarDiretoSemPrevia) {
    try {
      const docRef = await createDemanda(state.user.uid, rascunhoBase);
      els.textInput.value = '';
      showToast('Demanda salva! Refinando com IA…');

      const result = await parseDemandWithAIStream(texto, { timeoutMs: 8000 });
      recordPerf(localMs, result.elapsedMs, result.cached, result.usedFallback);

      if (!result.usedFallback && state.user) {
        await updateDemanda(state.user.uid, docRef.id, {
          ...result.demanda,
          status: 'pendente'
        }, 'editada', 'refinamento IA');
      }
    } catch (err) {
      showToast(err.message || 'Erro ao salvar demanda.');
    }
    return;
  }

  openPreviewDialog(rascunhoBase, localMs);
}

function openNextBatchItem() {
  if (state.batchQueue.length === 0) return;
  const item = state.batchQueue[0];
  const idxAtual = state.batchTotal - state.batchQueue.length + 1;

  state.editingDemand = null;
  state.pendingDraft = item;
  state.dirtyFields.clear();
  state.editingSubtarefas = [];
  state.refineSessionId += 1;

  els.previewTitle.textContent =
    state.batchTotal > 1 ? `Revisar lote (${idxAtual} de ${state.batchTotal})` : 'Revisar demanda';
  els.previewDiscardBtn.textContent = state.batchQueue.length > 1 ? 'Pular esta' : 'Descartar';
  els.batchSaveAllBtn.classList.toggle('hidden', state.batchQueue.length <= 1);
  setPreviewAiBar('hidden', '', false);

  fillPreviewFields(item);
  checkDuplicateAndHistoryHints();
  if (!els.previewDialog.open) els.previewDialog.showModal();
}

function openPreviewDialog(rascunho, localMs = 0) {
  state.editingDemand = null;
  state.pendingDraft = rascunho;
  state.batchQueue = [];
  state.batchTotal = 0;
  state.dirtyFields.clear();
  state.editingSubtarefas = [];
  state.refineSessionId += 1;
  const sessionId = state.refineSessionId;

  els.previewTitle.textContent = 'Revisar demanda';
  els.previewDiscardBtn.textContent = 'Descartar';
  els.batchSaveAllBtn.classList.add('hidden');

  fillPreviewFields(rascunho);
  checkDuplicateAndHistoryHints();
  els.previewDialog.showModal();

  runPreviewAiRefinement(rascunho.textoOriginal, sessionId, localMs);
}

function openEditDialog(demanda) {
  state.editingDemand = demanda;
  state.pendingDraft = null;
  state.batchQueue = [];
  state.batchTotal = 0;
  state.dirtyFields.clear();
  state.editingSubtarefas = (demanda.subtarefas || []).map((s) => ({ ...s }));
  state.refineSessionId += 1;

  els.previewTitle.textContent = 'Editar demanda';
  els.previewDiscardBtn.textContent = 'Cancelar';
  els.batchSaveAllBtn.classList.add('hidden');
  setPreviewAiBar('hidden', '', false);

  fillPreviewFields(demanda);
  checkDuplicateAndHistoryHints();
  els.previewDialog.showModal();
}

function fillPreviewFields(d) {
  els.editTitulo.value = d.titulo || '';
  els.editDescricao.value = d.descricao || '';
  els.editPrioridade.value = d.prioridade || 'media';
  els.editPrazo.value = d.prazo || '';
  els.editCategoria.value = d.categoria || '';
  els.editStatus.value = d.status || 'pendente';
  els.editEtiquetas.value = (d.etiquetas || []).join(', ');

  const recTipo = d.recorrencia?.tipo || 'nenhuma';
  els.editRecorrencia.value = recTipo;
  els.editDiaMesWrap.classList.toggle('hidden', recTipo !== 'dia_mes');
  els.editDiaMes.value = d.recorrencia?.diaMes || 1;

  renderSubtasksEditor();

  // Linha do tempo
  const hist = Array.isArray(d.historico) ? d.historico : [];
  if (state.editingDemand && hist.length > 0) {
    els.editTimeline.replaceChildren();
    for (const h of hist.slice().reverse()) {
      const li = document.createElement('li');
      const dataFmt = h.em ? new Date(h.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
      li.textContent = `${h.acao}${h.detalhe ? ` (${h.detalhe})` : ''} — ${dataFmt}`;
      els.editTimeline.appendChild(li);
    }
    els.historyDetails.classList.remove('hidden');
  } else {
    els.historyDetails.classList.add('hidden');
  }
}

// ----------------------------------------------------------------------------
// Fase 4: Execução Local dos Comandos de Voz
// ----------------------------------------------------------------------------
function replyCommand(msg) {
  els.commandReplyBox.textContent = msg;
  els.commandReplyBox.classList.remove('hidden');
  if (!state.prefs.silenciarResumoFalado) {
    speakText(msg);
  }
}

function findMatchingDemands(alvo) {
  if (!alvo) return [];
  const termo = alvo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return state.demandas.filter((d) => {
    if (d.status === 'concluida') return false;
    const texto = `${d.titulo} ${d.descricao || ''} ${d.categoria || ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return texto.includes(termo);
  });
}

async function executeManagementCommand(intent) {
  const pendentes = state.demandas.filter((d) => d.status !== 'concluida');

  if (intent.acao === 'listar_pendentes') {
    const titulos = pendentes.slice(0, 4).map((d) => d.titulo).join('; ');
    replyCommand(
      pendentes.length === 0
        ? 'Você não tem demandas pendentes.'
        : `Você tem ${pendentes.length} demanda(s) pendente(s): ${titulos}${pendentes.length > 4 ? '...' : ''}.`
    );
    return;
  }

  if (intent.acao === 'mais_antiga') {
    const { text } = buildSummaryMessage(state.demandas);
    replyCommand(text);
    return;
  }

  if (intent.acao === 'vence_hoje') {
    const hoje = todayLocalISO();
    const doDia = pendentes.filter((d) => d.prazo === hoje);
    replyCommand(
      doDia.length === 0
        ? 'Nenhuma demanda vence hoje.'
        : `Vencem hoje (${doDia.length}): ${doDia.map((d) => d.titulo).join('; ')}.`
    );
    return;
  }

  const matches = findMatchingDemands(intent.alvo);
  if (matches.length === 0) {
    replyCommand(`Não encontrei nenhuma demanda pendente parecida com "${intent.alvo || ''}".`);
    return;
  }

  const runActionOnTarget = async (alvoDemanda) => {
    if (intent.acao === 'concluir') {
      await handleToggleDone(alvoDemanda);
      replyCommand(`Demanda "${alvoDemanda.titulo}" marcada como concluída.`);
    } else if (intent.acao === 'adiar') {
      const data = intent.novoPrazo || todayLocalISO();
      await snoozeDemanda(state.user.uid, alvoDemanda, data);
      replyCommand(`Demanda "${alvoDemanda.titulo}" adiada até ${formatDateBR(data)}.`);
    } else if (intent.acao === 'alterar_prioridade' && intent.novaPrioridade) {
      await updateDemanda(state.user.uid, alvoDemanda.id, {
        ...alvoDemanda,
        prioridade: intent.novaPrioridade
      }, 'editada', `prioridade -> ${intent.novaPrioridade}`);
      replyCommand(`Prioridade de "${alvoDemanda.titulo}" alterada para ${intent.novaPrioridade}.`);
    } else if (intent.acao === 'excluir') {
      openDeleteDialog(alvoDemanda);
    }
  };

  if (matches.length === 1 && intent.acao !== 'excluir') {
    await runActionOnTarget(matches[0]);
    return;
  }

  // Desambiguação ou confirmação obrigatória para exclusão
  els.commandChoices.replaceChildren();
  els.commandConfirmBtn.classList.add('hidden');
  els.commandDialogDesc.textContent =
    matches.length > 1
      ? `Encontrei ${matches.length} demandas parecidas com "${intent.alvo}". Escolha qual deseja alterar:`
      : `Confirmar exclusão da demanda "${matches[0].titulo}"?`;

  if (matches.length > 1) {
    for (const m of matches.slice(0, 6)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary';
      btn.textContent = m.titulo;
      btn.addEventListener('click', async () => {
        els.commandDialog.close();
        await runActionOnTarget(m);
      });
      els.commandChoices.appendChild(btn);
    }
  } else {
    els.commandConfirmBtn.classList.remove('hidden');
    els.commandConfirmBtn.onclick = async () => {
      els.commandDialog.close();
      await deleteDemanda(state.user.uid, matches[0].id);
      replyCommand(`Demanda "${matches[0].titulo}" excluída.`);
    };
  }

  els.commandDialog.showModal();
}

// ----------------------------------------------------------------------------
// Ações nos Cards + Desfazer (~6s)
// ----------------------------------------------------------------------------
async function handleToggleDone(demanda) {
  if (!state.user) return;
  const snapshot = { ...demanda };
  try {
    const res = await toggleDemandaStatus(state.user.uid, demanda);
    const msg = res?.generatedNext
      ? `Concluída! Próxima ocorrência criada para ${formatDateBR(res.proximoPrazo)}.`
      : demanda.status === 'concluida'
        ? 'Demanda reaberta.'
        : 'Demanda concluída!';

    showToast(msg, 6000, () => restoreDemanda(state.user.uid, snapshot));
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

function openSnoozeDialog(demanda) {
  state.snoozingDemand = demanda;
  els.snoozeDemandName.textContent = demanda.titulo;
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  els.snoozeCustomDate.value = amanha.toISOString().slice(0, 10);
  els.snoozeDialog.showModal();
}

// ----------------------------------------------------------------------------
// Bom Dia & Métricas
// ----------------------------------------------------------------------------
function openMorningDialog(autoSpeak = false) {
  const resumo = buildMorningSummary(state.demandas);
  els.morningSummaryText.textContent = resumo.text;
  els.morningDetails.replaceChildren();

  const addGroup = (label, items) => {
    if (items.length === 0) return;
    const p = document.createElement('p');
    p.className = 'info-note';
    p.textContent = `${label}: ${items.slice(0, 4).map((d) => d.titulo).join(', ')}`;
    els.morningDetails.appendChild(p);
  };
  addGroup('Vencem hoje', resumo.hoje);
  addGroup('Atrasadas', resumo.atrasadas);

  els.morningDialog.showModal();
  if (autoSpeak && !state.prefs.silenciarResumoFalado) {
    speakText(resumo.text);
  }
}

function openMetricsDialog() {
  const m = computeMetrics(state.demandas);
  els.mPendentes.textContent = String(m.totalPendentes);
  els.mConcluidas.textContent = String(m.totalConcluidas);
  els.mTempoMedio.textContent = m.tempoMedioDias;
  els.mNoPrazo.textContent = m.taxaNoPrazo;
  renderWeeklySvgChart(els.metricsWeeklyChart, m.semanas);
  els.weeklyAiText.classList.add('hidden');
  els.metricsDialog.showModal();
}

// ----------------------------------------------------------------------------
// Voz
// ----------------------------------------------------------------------------
function setupVoiceRecognition() {
  if (!isSpeechRecognitionSupported()) {
    els.voiceStage.classList.add('hidden');
    els.voiceUnsupported.classList.remove('hidden');
    return;
  }

  voiceRecognizer = createVoiceRecognizer({
    onInterim: (texto) => {
      els.voiceLiveText.textContent = texto || 'Ouvindo...';
    },
    onFinal: (texto) => {
      if (texto) processRawInput(texto, 'voz');
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
      ? 'Ouvindo em português... fale sua demanda ou comando'
      : 'Toque no microfone e fale naturalmente';
  }

  els.micBtn.addEventListener('click', () => {
    if (state.isListening) {
      voiceRecognizer.stop();
    } else {
      els.voiceLiveText.textContent = 'Ouvindo...';
      setListeningUI(true);
      voiceRecognizer.start();
    }
  });

  els.voiceCancelBtn.addEventListener('click', () => {
    voiceRecognizer.cancel();
    setListeningUI(false);
    showToast('Gravação cancelada.');
  });

  els.voiceFinishBtn.addEventListener('click', () => voiceRecognizer.stop());
}

// ----------------------------------------------------------------------------
// Eventos Gerais e Atalhos de Teclado
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

  els.themeToggleBtn.addEventListener('click', async () => {
    const atual = document.documentElement.dataset.theme;
    const isDarkSystem = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const proximo =
      atual === 'escuro' ? 'claro' : atual === 'claro' ? 'escuro' : isDarkSystem ? 'claro' : 'escuro';
    applyTheme(proximo);
    state.prefs.tema = proximo;
    if (state.user) {
      await savePreferences(state.user.uid, { tema: proximo }).catch(() => {});
    }
  });

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

  // Seletor de modo (Auto / Demanda / Comando / Lote)
  els.modePills.forEach((pill) => {
    pill.addEventListener('click', () => {
      state.captureMode = pill.dataset.mode;
      els.modePills.forEach((p) => p.setAttribute('aria-pressed', String(p === pill)));
      els.textInput.rows = state.captureMode === 'lote' ? 4 : 2;
      els.textInput.placeholder =
        state.captureMode === 'lote'
          ? 'Cole um e-mail, mensagem do WhatsApp ou liste várias demandas...'
          : state.captureMode === 'comando'
            ? 'Ex: "O que vence hoje?", "Conclui a do relatório", "Adia a do contrato para sexta"'
            : 'Ex: "Revisar contrato da Ana até sexta, urgente" ou "O que vence hoje?"';
    });
  });

  els.textForm.addEventListener('submit', (e) => {
    e.preventDefault();
    processRawInput(els.textInput.value, 'texto');
  });

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

  // Campos sujos + duplicatas + recorrência + subtarefas
  [
    [els.editTitulo, 'titulo', 'input'],
    [els.editDescricao, 'descricao', 'input'],
    [els.editPrioridade, 'prioridade', 'change'],
    [els.editPrazo, 'prazo', 'change'],
    [els.editCategoria, 'categoria', 'input']
  ].forEach(([el, nome, evt]) => {
    el.addEventListener(evt, () => {
      state.dirtyFields.add(nome);
      if (nome === 'titulo' || nome === 'descricao') checkDuplicateAndHistoryHints();
    });
  });

  els.editRecorrencia.addEventListener('change', () => {
    els.editDiaMesWrap.classList.toggle('hidden', els.editRecorrencia.value !== 'dia_mes');
  });

  els.addSubtaskBtn.addEventListener('click', () => {
    const txt = els.newSubtaskInput.value.trim();
    if (!txt) return;
    state.editingSubtarefas.push({ id: `sub-${Date.now()}`, texto: txt, concluida: false });
    els.newSubtaskInput.value = '';
    renderSubtasksEditor();
  });

  els.previewRetryAiBtn.addEventListener('click', () => {
    if (!state.pendingDraft?.textoOriginal) return;
    state.refineSessionId += 1;
    runPreviewAiRefinement(state.pendingDraft.textoOriginal, state.refineSessionId, 0);
  });

  els.previewCloseX.addEventListener('click', () => {
    state.refineSessionId += 1;
    state.batchQueue = [];
    els.previewDialog.close('cancel');
  });

  els.previewDiscardBtn.addEventListener('click', () => {
    state.refineSessionId += 1;
    if (state.batchQueue.length > 1) {
      state.batchQueue.shift();
      openNextBatchItem();
      return;
    }
    state.batchQueue = [];
    els.previewDialog.close('cancel');
  });

  els.batchSaveAllBtn.addEventListener('click', async () => {
    if (!state.user || state.batchQueue.length === 0) return;
    try {
      for (const item of state.batchQueue) {
        await createDemanda(state.user.uid, item);
      }
      const qtd = state.batchQueue.length;
      state.batchQueue = [];
      els.textInput.value = '';
      els.previewDialog.close('save');
      showToast(`${qtd} demandas salvas!`);
    } catch {
      showToast('Erro ao salvar lote.');
    }
  });

  els.previewForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.user) return;

    const etiquetas = els.editEtiquetas.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const recTipo = els.editRecorrencia.value;
    const recorrencia =
      recTipo === 'nenhuma'
        ? null
        : {
            tipo: recTipo,
            ...(recTipo === 'dia_mes' ? { diaMes: Number(els.editDiaMes.value) || 1 } : {})
          };

    const dados = {
      titulo: els.editTitulo.value.trim(),
      descricao: els.editDescricao.value.trim(),
      prioridade: els.editPrioridade.value,
      prazo: els.editPrazo.value || null,
      categoria: els.editCategoria.value.trim() || null,
      status: els.editStatus.value,
      etiquetas,
      recorrencia,
      subtarefas: state.editingSubtarefas
    };

    if (!dados.titulo) {
      showToast('Informe um título para a demanda.');
      return;
    }

    try {
      if (state.editingDemand) {
        const prevSnapshot = { ...state.editingDemand };
        await updateDemanda(state.user.uid, state.editingDemand.id, {
          ...dados,
          historico: state.editingDemand.historico,
          concluidoEm: state.editingDemand.concluidoEm
        });
        showToast('Demanda atualizada.', 6000, () => restoreDemanda(state.user.uid, prevSnapshot));
      } else if (state.pendingDraft) {
        await createDemanda(state.user.uid, {
          ...state.pendingDraft,
          ...dados
        });
        if (state.batchQueue.length > 1) {
          state.batchQueue.shift();
          openNextBatchItem();
          showToast('Salva! Próxima do lote…');
          return;
        }
        state.batchQueue = [];
        els.textInput.value = '';
        showToast('Demanda salva!');
      }
      state.refineSessionId += 1;
      els.previewDialog.close('save');
    } catch (err) {
      showToast('Erro ao salvar demanda no Firestore.');
      console.error(err);
    }
  });

  // Exclusão com Desfazer (~6s)
  els.deleteDialog.addEventListener('close', async () => {
    const action = els.deleteDialog.returnValue;
    els.deleteDialog.returnValue = '';

    if (action === 'delete' && state.deletingDemand && state.user) {
      const snapshot = { ...state.deletingDemand };
      try {
        await deleteDemanda(state.user.uid, snapshot.id);
        showToast('Demanda excluída.', 6000, () => restoreDemanda(state.user.uid, snapshot));
      } catch (err) {
        showToast('Erro ao excluir demanda.');
        console.error(err);
      }
    }
    state.deletingDemand = null;
  });

  // Soneca
  els.snoozeDialog.querySelectorAll('[data-snooze-days]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const days = Number(btn.dataset.snoozeDays);
      const d = new Date();
      d.setDate(d.getDate() + days);
      els.snoozeCustomDate.value = d.toISOString().slice(0, 10);
    });
  });
  els.snoozeCloseX.addEventListener('click', () => els.snoozeDialog.close());
  els.snoozeCancelBtn.addEventListener('click', () => els.snoozeDialog.close());
  els.snoozeConfirmBtn.addEventListener('click', async () => {
    if (!state.user || !state.snoozingDemand || !els.snoozeCustomDate.value) return;
    try {
      await snoozeDemanda(state.user.uid, state.snoozingDemand, els.snoozeCustomDate.value);
      showToast(`Alertas adiados até ${formatDateBR(els.snoozeCustomDate.value)}.`);
      els.snoozeDialog.close();
    } catch {
      showToast('Erro ao adiar demanda.');
    }
  });

  // Comando desambiguação
  els.commandCancelBtn.addEventListener('click', () => els.commandDialog.close());

  // Bom dia
  els.morningBtn.addEventListener('click', () => openMorningDialog(false));
  els.morningCloseX.addEventListener('click', () => els.morningDialog.close());
  els.morningOkBtn.addEventListener('click', () => els.morningDialog.close());
  els.morningSpeakBtn.addEventListener('click', () => speakText(els.morningSummaryText.textContent));

  // Métricas e Exportação
  els.metricsBtn.addEventListener('click', openMetricsDialog);
  els.metricsCloseX.addEventListener('click', () => els.metricsDialog.close());
  els.metricsOkBtn.addEventListener('click', () => els.metricsDialog.close());
  els.weeklyAiBtn.addEventListener('click', async () => {
    els.weeklyAiBtn.disabled = true;
    els.weeklyAiBtn.textContent = 'Gerando…';
    const m = computeMetrics(state.demandas);
    const resumo = await generateWeeklySummaryWithAI(m, state.demandas);
    els.weeklyAiText.textContent = resumo;
    els.weeklyAiText.classList.remove('hidden');
    els.weeklyAiBtn.disabled = false;
    els.weeklyAiBtn.textContent = 'Gerar resumo semanal com IA';
  });
  els.exportCsvBtn.addEventListener('click', () => exportDemandasToCSV(state.demandas));
  els.exportPdfBtn.addEventListener('click', () => {
    els.metricsDialog.close();
    setTimeout(() => window.print(), 120);
  });

  // Atalhos de teclado (?)
  els.shortcutsBtn.addEventListener('click', () => els.shortcutsDialog.showModal());
  els.shortcutsCloseX.addEventListener('click', () => els.shortcutsDialog.close());
  els.shortcutsOkBtn.addEventListener('click', () => els.shortcutsDialog.close());

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.querySelector('dialog[open]')) return;

    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      els.textInput.focus();
    } else if (e.key === '/') {
      e.preventDefault();
      els.searchInput.focus();
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      if (!els.micBtn.closest('.hidden')) els.micBtn.click();
    } else if (e.key === '?') {
      e.preventDefault();
      els.shortcutsDialog.showModal();
    }
  });

  // Configurações
  els.settingsBtn.addEventListener('click', () => {
    els.cfgSalvarDireto.checked = Boolean(state.prefs.salvarDiretoSemPrevia);
    els.cfgSilenciarFala.checked = Boolean(state.prefs.silenciarResumoFalado);
    els.cfgDebugTempo.checked = Boolean(state.debugTempo);
    els.cfgIntervalo.value = state.prefs.intervaloLembreteMinutos ?? 30;
    els.cfgLimiteHora.value = state.prefs.limiteLembretesHora ?? 4;
    els.cfgSilencioInicio.value = state.prefs.horarioSilencioInicio || '22:00';
    els.cfgSilencioFim.value = state.prefs.horarioSilencioFim || '08:00';
    els.cfgAmarelo.value = state.prefs.diasAvisoAmarelo ?? 3;
    els.cfgLaranja.value = state.prefs.diasAvisoLaranja ?? 7;
    els.cfgVermelho.value = state.prefs.diasAvisoVermelho ?? 14;

    if (state.lastPerf) {
      const modo = state.lastPerf.cached ? 'cache' : state.lastPerf.fallback ? 'fallback' : 'IA';
      els.cfgPerfSummary.textContent =
        `Última medição: prévia local em ${state.lastPerf.localMs}ms | ${modo} em ${state.lastPerf.aiMs}ms.`;
      els.cfgPerfSummary.classList.remove('hidden');
    } else {
      els.cfgPerfSummary.classList.add('hidden');
    }

    updateNotifButtonText();
    els.settingsDialog.showModal();
  });

  els.settingsCloseX.addEventListener('click', () => els.settingsDialog.close('cancel'));

  els.cfgNotifBtn.addEventListener('click', async () => {
    const perm = await requestBrowserNotificationPermission();
    updateNotifButtonText();
    if (perm === 'granted') showToast('Notificações do navegador ativadas!');
    else if (perm === 'denied') showToast('Permissão negada no navegador.');
    else if (perm === 'unsupported') showToast('Navegador sem suporte à Notification API.');
  });

  els.settingsDialog.addEventListener('close', async () => {
    const action = els.settingsDialog.returnValue;
    els.settingsDialog.returnValue = '';

    if (action === 'save' && state.user) {
      state.debugTempo = els.cfgDebugTempo.checked;
      localStorage.setItem('pauta_debug_tempo', state.debugTempo ? '1' : '0');

      const novasPrefs = {
        ...state.prefs,
        salvarDiretoSemPrevia: els.cfgSalvarDireto.checked,
        silenciarResumoFalado: els.cfgSilenciarFala.checked,
        intervaloLembreteMinutos: Math.max(1, Number(els.cfgIntervalo.value) || 30),
        limiteLembretesHora: Math.min(60, Math.max(1, Number(els.cfgLimiteHora.value) || 4)),
        horarioSilencioInicio: els.cfgSilencioInicio.value || '22:00',
        horarioSilencioFim: els.cfgSilencioFim.value || '08:00',
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
  if (Notification.permission === 'granted') els.cfgNotifBtn.textContent = 'Ativadas';
  else if (Notification.permission === 'denied') els.cfgNotifBtn.textContent = 'Bloqueadas';
  else els.cfgNotifBtn.textContent = 'Permitir';
}

// ----------------------------------------------------------------------------
// Inicialização
// ----------------------------------------------------------------------------
function init() {
  if (!isFirebaseConfigured()) {
    els.configWarning.textContent =
      'Atenção: preencha suas credenciais em public/js/firebase-config.js antes de fazer login.';
    els.configWarning.classList.remove('hidden');
    els.loginBtn.disabled = true;
  }

  registerPWA();
  warmUpAiModel();
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
      state.loadedInitial = false;
      state.spokenOnOpen = false;
      reminderScheduler.stop();
      els.authView.classList.remove('hidden');
      els.appView.classList.add('hidden');
      els.userMenu.classList.add('hidden');
      els.settingsBtn.classList.add('hidden');
      els.morningBtn.classList.add('hidden');
      els.metricsBtn.classList.add('hidden');
      return;
    }

    els.authView.classList.add('hidden');
    els.appView.classList.remove('hidden');
    els.userMenu.classList.remove('hidden');
    els.settingsBtn.classList.remove('hidden');
    els.morningBtn.classList.remove('hidden');
    els.metricsBtn.classList.remove('hidden');

    if (!state.loadedInitial) {
      renderLoadingSkeletons(els.demandsList);
    }

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
    handleUrlShortcuts();

    state.unsubscribeDemandas = subscribeDemandas(
      user.uid,
      (demandas) => {
        state.demandas = demandas;
        state.loadedInitial = true;
        renderAll();

        if (!state.spokenOnOpen) {
          state.spokenOnOpen = true;
          const hoje = todayLocalISO();
          const jaViuBomDia = localStorage.getItem('pauta_bom_dia_date') === hoje;
          if (!jaViuBomDia && demandas.some((d) => d.status !== 'concluida')) {
            localStorage.setItem('pauta_bom_dia_date', hoje);
            openMorningDialog(true);
          } else if (!state.prefs.silenciarResumoFalado) {
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
