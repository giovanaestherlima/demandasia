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
  acceptInviteAtomic,
  addComment,
  captureInviteUrlParam,
  checkLegacyDemandsCount,
  clearInviteUrlParam,
  createInvite,
  createNewWorkspace,
  deleteLegacyDemands,
  deleteOwnedWorkspace,
  ensureUserAndPersonalWorkspace,
  findPendingEmailInvites,
  getInviteByToken,
  getQuotaStats,
  leaveWorkspace,
  listWorkspaceInvites,
  loadWorkspaceInfoAndMembers,
  migrateLegacyDemands,
  removeWorkspaceMember,
  revokeInvite,
  subscribeComments,
  switchActiveWorkspace,
  updateMemberRole,
  updateMyLastVisit
} from './workspaces.js?v=5';
import {
  captureStudentUrlParam,
  clearStudentUrlParam,
  getStudentConfig,
  loadEnabledStudentModules,
  modoEstudanteAtivo,
  saveStudentConfig,
  syncStudentConfigFromProfile
} from './modo-estudante.js?v=5';
import {
  captureDirectDemandUrlParams,
  captureWorkUrlParam,
  clearDirectDemandUrlParams,
  clearWorkUrlParam,
  dismissUnifiedInviteLocal,
  getCorpConfig,
  isUnifiedInviteDismissed,
  loadCorporativoModule,
  modoCorporativoAtivo,
  modoSimplesAtivo,
  moduloAtivo,
  saveCorpConfig,
  syncCorpConfigFromProfile
} from './modos.js?v=1';
import {
  applyTheme,
  filterAndSortDemandas,
  formatDateBR,
  getDemandAssignees,
  renderAttentionPanel,
  renderDemandsList,
  renderLoadingSkeletons,
  renderTagFilterChips,
  showToast
} from './ui.js?v=5';

const state = {
  user: null,
  activeWsId: null,
  activeWorkspace: null,
  meusEspacos: [],
  workspaceMembers: [],
  myRole: 'admin',
  hasLegacyDemands: false,
  demandas: [],
  loadedInitial: false,
  prefs: { ...DEFAULT_PREFERENCES },
  filter: 'pendentes',
  activeTag: null,
  assigneeFilter: 'todos',
  search: '',
  sort: 'antigas',
  captureMode: 'auto', // 'auto' | 'demanda' | 'comando' | 'lote'
  unsubscribeDemandas: null,
  unsubscribeComments: null,
  hiddenTabTimer: null,
  pendingInviteToken: captureInviteUrlParam(),
  pendingInviteData: null,
  currentInviteTab: 'link',
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
  tutorialBtn: document.getElementById('tutorial-btn'),
  tutorialDialog: document.getElementById('tutorial-dialog'),
  tutorialCloseX: document.getElementById('tutorial-close-x'),
  tutorialCloseBtn: document.getElementById('tutorial-close-btn'),
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
  editDiasSemanaWrap: document.getElementById('edit-dias-semana-wrap'),
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
  cfgTema: document.getElementById('cfg-tema'),
  cfgWorkspacesList: document.getElementById('cfg-workspaces-list'),
  cfgNotifBtn: document.getElementById('cfg-notif-btn'),
  cfgDeleteLegacyWrap: document.getElementById('cfg-delete-legacy-wrap'),
  cfgDeleteLegacyBtn: document.getElementById('cfg-delete-legacy-btn'),

  migrationDialog: document.getElementById('migration-dialog'),
  migrationStatusText: document.getElementById('migration-status-text'),
  migrationProgress: document.getElementById('migration-progress'),
  migrationDeleteLegacyBtn: document.getElementById('migration-delete-legacy-btn'),
  migrationCloseBtn: document.getElementById('migration-close-btn'),

  modesBtn: document.getElementById('modes-btn'),
  unifiedInviteBanner: document.getElementById('unified-invite-banner'),
  inviteModeSimples: document.getElementById('invite-mode-simples'),
  inviteModeEstudante: document.getElementById('invite-mode-estudante'),
  inviteModeCorporativo: document.getElementById('invite-mode-corporativo'),
  inviteModeLater: document.getElementById('invite-mode-later'),
  inviteModeNever: document.getElementById('invite-mode-never'),
  cfgModesBtn: document.getElementById('cfg-modes-btn'),
  demandLinkActions: document.getElementById('demand-link-actions'),
  modesDialog: document.getElementById('modes-dialog'),
  modesCloseX: document.getElementById('modes-close-x'),
  modesCloseBtn: document.getElementById('modes-close-btn'),
  modeSimplesBadge: document.getElementById('mode-simples-badge'),
  modeEstudanteBadge: document.getElementById('mode-estudante-badge'),
  modeCorpBadge: document.getElementById('mode-corp-badge'),
  modeEstudanteAction: document.getElementById('mode-estudante-action'),
  modeCorpAction: document.getElementById('mode-corp-action'),

  corpActivateDialog: document.getElementById('corp-activate-dialog'),
  corpActivateCloseX: document.getElementById('corp-activate-close-x'),
  corpActivateCancel: document.getElementById('corp-activate-cancel'),
  corpActivateSave: document.getElementById('corp-activate-save'),
  corpMasterToggle: document.getElementById('corp-master-toggle'),
  corpModulesBox: document.getElementById('corp-modules-box'),
  corpActivateError: document.getElementById('corp-activate-error'),

  studentActivateDialog: document.getElementById('student-activate-dialog'),
  studentActivateCloseX: document.getElementById('student-activate-close-x'),
  studentActivateCancel: document.getElementById('student-activate-cancel'),
  studentActivateSave: document.getElementById('student-activate-save'),
  stuMasterToggle: document.getElementById('stu-master-toggle'),
  stuModulesBox: document.getElementById('stu-modules-box'),
  stuActivateError: document.getElementById('stu-activate-error'),

  // Colaboração (espaços, membros, convites, responsável, comentários)
  captureCard: document.querySelector('.capture-card'),
  workspaceSelect: document.getElementById('workspace-select'),
  workspaceRoleBadge: document.getElementById('workspace-role-badge'),
  wsMembersBtn: document.getElementById('ws-members-btn'),
  wsNewBtn: document.getElementById('ws-new-btn'),
  emailInvitesBanner: document.getElementById('email-invites-banner'),
  assigneeFilterSelect: document.getElementById('assignee-filter-select'),

  editResponsavelWrap: document.getElementById('edit-responsavel-wrap'),
  editResponsaveisList: document.getElementById('edit-responsaveis-list'),
  previewSaveBtn: document.getElementById('preview-save-btn'),
  commentsSection: document.getElementById('comments-section'),
  commentsList: document.getElementById('comments-list'),
  newCommentInput: document.getElementById('new-comment-input'),
  addCommentBtn: document.getElementById('add-comment-btn'),

  wsCreateDialog: document.getElementById('ws-create-dialog'),
  wsCreateForm: document.getElementById('ws-create-form'),
  wsCreateCloseX: document.getElementById('ws-create-close-x'),
  wsCreateCancel: document.getElementById('ws-create-cancel'),
  wsCreateName: document.getElementById('ws-create-name'),
  wsCreateType: document.getElementById('ws-create-type'),

  wsMembersDialog: document.getElementById('ws-members-dialog'),
  wsMembersCloseX: document.getElementById('ws-members-close-x'),
  wsMembersCloseBtn: document.getElementById('ws-members-close-btn'),
  wsMembersMeta: document.getElementById('ws-members-meta'),
  wsMembersList: document.getElementById('ws-members-list'),
  wsInviteAdminSection: document.getElementById('ws-invite-admin-section'),
  inviteTabPills: document.querySelectorAll('[data-invite-tab]'),
  wsInviteRole: document.getElementById('ws-invite-role'),
  wsInviteEmailWrap: document.getElementById('ws-invite-email-wrap'),
  wsInviteEmail: document.getElementById('ws-invite-email'),
  wsInviteUsesWrap: document.getElementById('ws-invite-uses-wrap'),
  wsInviteUses: document.getElementById('ws-invite-uses'),
  wsInviteGenerateBtn: document.getElementById('ws-invite-generate-btn'),
  wsInviteResult: document.getElementById('ws-invite-result'),
  wsInviteLinkInput: document.getElementById('ws-invite-link-input'),
  wsInviteCopyBtn: document.getElementById('ws-invite-copy-btn'),
  wsInviteShareBtn: document.getElementById('ws-invite-share-btn'),
  wsInviteMailtoBtn: document.getElementById('ws-invite-mailto-btn'),
  wsInvitesList: document.getElementById('ws-invites-list'),
  wsLeaveBtn: document.getElementById('ws-leave-btn'),

  inviteAcceptDialog: document.getElementById('invite-accept-dialog'),
  inviteAcceptCloseX: document.getElementById('invite-accept-close-x'),
  inviteAcceptDesc: document.getElementById('invite-accept-desc'),
  inviteAcceptWarning: document.getElementById('invite-accept-warning'),
  inviteSwitchAccountBtn: document.getElementById('invite-switch-account-btn'),
  inviteLaterBtn: document.getElementById('invite-later-btn'),
  inviteConfirmBtn: document.getElementById('invite-confirm-btn')
};

let studentUiMod = null;
let corpUiMod = null;

async function syncCorporativoModeLifecycle() {
  if (!state.user) return;
  const ativo = modoCorporativoAtivo();
  if (!ativo) {
    if (corpUiMod) {
      corpUiMod.destroyCorporativoUI();
    }
    return;
  }
  els.unifiedInviteBanner?.classList.add('hidden');
  corpUiMod = await loadCorporativoModule();
  if (!corpUiMod) return;
  corpUiMod.initCorporativoUI({
    getUser: () => state.user,
    getActiveWsId: () => state.activeWsId,
    getActiveWorkspace: () => state.activeWorkspace,
    getMembers: () => state.workspaceMembers,
    getDemandas: () => state.demandas,
    isReadOnlyRole,
    showToast,
    openManualDraft: (titulo, descricao) => {
      openPreviewDialog({
        titulo,
        descricao,
        prioridade: 'media',
        prazo: null,
        categoria: null,
        status: 'pendente',
        origem: 'texto',
        textoOriginal: descricao
      });
    }
  });
}

function openModesDialog() {
  const simples = modoSimplesAtivo();
  const est = modoEstudanteAtivo();
  const corp = modoCorporativoAtivo();
  els.modeSimplesBadge.textContent = simples ? 'Atual' : 'Base';
  els.modeSimplesBadge.className = simples ? 'badge badge-primary' : 'badge';
  els.modeEstudanteBadge.textContent = est ? 'Ativo' : 'Desligado';
  els.modeEstudanteBadge.className = est ? 'badge badge-primary' : 'badge';
  els.modeCorpBadge.textContent = corp ? 'Ativo' : 'Desligado';
  els.modeCorpBadge.className = corp ? 'badge badge-primary' : 'badge';
  els.modesDialog.showModal();
}

function openCorpActivateDialog() {
  const cfg = getCorpConfig();
  els.corpMasterToggle.checked = true;
  els.corpModulesBox.querySelectorAll('input[data-corp-mod]').forEach((chk) => {
    chk.checked = cfg.modulos?.[chk.dataset.corpMod] ?? true;
  });
  els.corpActivateError.classList.add('hidden');
  els.corpActivateSave.textContent = cfg.ativo ? 'Salvar módulos' : 'Ativar';
  els.corpActivateDialog.showModal();
}

async function syncStudentModeLifecycle() {
  if (!state.user) return;
  const ativo = modoEstudanteAtivo();

  if (!ativo) {
    if (studentUiMod) {
      studentUiMod.unmountStudentUI();
    }
    return;
  }

  els.unifiedInviteBanner?.classList.add('hidden');
  await loadEnabledStudentModules();
  if (!studentUiMod) {
    studentUiMod = await import('./estudante/estudante-ui.js?v=5');
  }
  await studentUiMod.mountStudentUI({
    getWsId: () => state.activeWsId,
    getUser: () => state.user,
    getDemandas: () => state.demandas,
    appendSubtasksToPreview: (passos) => {
      state.editingSubtarefas = [...state.editingSubtarefas, ...passos];
      renderSubtasksEditor();
    },
    openBatchPreview: (items, origem) => {
      state.batchQueue = items.map((d) => ({
        ...d,
        status: 'pendente',
        origem,
        textoOriginal: d.titulo
      }));
      state.batchTotal = state.batchQueue.length;
      openNextBatchItem();
    }
  });
}

function openStudentActivateDialog() {
  const cfg = getStudentConfig();
  els.stuMasterToggle.checked = cfg.ativo ? true : true; // padrão marcado ao abrir para ativar
  els.stuModulesBox.querySelectorAll('input[data-stu-mod]').forEach((chk) => {
    chk.checked = cfg.modulos?.[chk.dataset.stuMod] ?? true;
  });
  els.stuActivateError.classList.add('hidden');
  els.studentActivateSave.textContent = cfg.ativo ? 'Salvar módulos' : 'Ativar';
  els.studentActivateDialog.showModal();
}

const reminderScheduler = createReminderScheduler(
  () => state.demandas,
  () => state.prefs,
  (msg) => showToast(msg, 7000)
);

let voiceRecognizer = null;

// ----------------------------------------------------------------------------
// Renderização geral
// ----------------------------------------------------------------------------
function isReadOnlyRole() {
  return state.myRole === 'leitor';
}

function applyRoleUI() {
  const roleLabels = { admin: 'Admin', editor: 'Editor', leitor: 'Leitor (só visualização)' };
  if (els.workspaceRoleBadge) {
    els.workspaceRoleBadge.textContent = roleLabels[state.myRole] || 'Membro';
  }
  if (els.captureCard) {
    els.captureCard.classList.toggle('hidden', isReadOnlyRole());
  }
}

function renderWorkspaceSelector() {
  if (!els.workspaceSelect) return;
  els.workspaceSelect.replaceChildren();
  for (const esp of state.meusEspacos) {
    const opt = document.createElement('option');
    opt.value = esp.id;
    opt.textContent = esp.nome || 'Espaço';
    els.workspaceSelect.appendChild(opt);
  }
  if (state.activeWsId) {
    els.workspaceSelect.value = state.activeWsId;
  }
}

function populateMemberSelects() {
  if (els.assigneeFilterSelect) {
    const prev = state.assigneeFilter || 'todos';
    els.assigneeFilterSelect.replaceChildren();
    const baseOpts = [
      { value: 'todos', label: 'Todos responsáveis' },
      { value: 'minhas', label: 'Minhas demandas' },
      { value: 'sem_responsavel', label: 'Sem responsável' }
    ];
    for (const o of baseOpts) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      els.assigneeFilterSelect.appendChild(opt);
    }
    for (const m of state.workspaceMembers) {
      const opt = document.createElement('option');
      opt.value = m.uid;
      opt.textContent = m.nome || m.email || 'Membro';
      els.assigneeFilterSelect.appendChild(opt);
    }
    els.assigneeFilterSelect.value = prev;
  }

  if (els.editResponsaveisList) {
    const prevChecked = new Set(
      Array.from(els.editResponsaveisList.querySelectorAll('input[type="checkbox"]:checked')).map((el) => el.value)
    );
    els.editResponsaveisList.replaceChildren();
    if (state.workspaceMembers.length === 0) {
      const emptyMsg = document.createElement('span');
      emptyMsg.style.cssText = 'font-size:0.82rem;color:var(--text-muted);';
      emptyMsg.textContent = 'Nenhum membro disponível.';
      els.editResponsaveisList.appendChild(emptyMsg);
    } else {
      for (const m of state.workspaceMembers) {
        const lbl = document.createElement('label');
        lbl.style.cssText = 'display:inline-flex;align-items:center;gap:0.35rem;padding:0.25rem 0.55rem;border:1px solid var(--border);border-radius:999px;font-size:0.82rem;cursor:pointer;background:var(--surface-card);';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.value = m.uid;
        chk.dataset.nome = m.nome || m.email || 'Membro';
        chk.checked = prevChecked.has(m.uid);
        chk.disabled = isReadOnlyRole();
        const span = document.createElement('span');
        span.textContent = `${m.nome || m.email}${m.uid === state.user?.uid ? ' (você)' : ''}`;
        lbl.append(chk, span);
        els.editResponsaveisList.appendChild(lbl);
      }
    }
  }
}

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
    tag: state.activeTag,
    assignee: state.assigneeFilter,
    currentUid: state.user?.uid
  });

  renderDemandsList(
    els.demandsList,
    visiveis,
    state.prefs,
    {
      onToggleDone: handleToggleDone,
      onEdit: openEditDialog,
      onDelete: openDeleteDialog,
      onSnooze: openSnoozeDialog,
      onOpenMeeting: (reuniaoId) => corpUiMod?.openReunioesModal(reuniaoId)
    },
    {
      readOnly: isReadOnlyRole(),
      showMeetingChip: moduloAtivo('reunioes'),
      showCompletedBy: moduloAtivo('historico')
    }
  );
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
  if (fields.status !== undefined && !state.dirtyFields.has('status')) {
    els.editStatus.value = fields.status || 'pendente';
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

  while (state.refineSessionId === sessionId && els.previewDialog.open) {
    const result = await parseDemandWithAIStream(texto, {
      timeoutMs: 30000,
      onPartial: (partialFields) => {
        if (state.refineSessionId !== sessionId || !els.previewDialog.open) return;
        applyAiFieldsIfClean(partialFields);
      }
    });

    if (state.refineSessionId !== sessionId || !els.previewDialog.open) return;

    recordPerf(localMs, result.elapsedMs, result.cached, result.usedFallback);

    if (!result.usedFallback) {
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
      return;
    }

    // Continua tentando silenciosamente sem exibir erro nem botão "Tentar de novo"
    setPreviewAiBar('refining', 'Refinando com IA…', false);
    await new Promise((r) => setTimeout(r, 2500));
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
    const pareceComando =
      /^(o que|qual|quais|conclui|concluir|conclua|finaliza|finalizar|finalize|adia|adiar|adie|muda|mudar|mude|altera|alterar|altere|coloca|colocar|coloque|passa|passar|passe|marca|marcar|marque|define|definir|defina|edita|editar|edite|troca|trocar|troque|exclui|excluir|exclua|apaga|apagar|apague|remove|remover|remova|deleta|deletar|delete)\b/i.test(texto) ||
      /\bdemanda\s+1[.,]\d+\b/i.test(texto);

    if (modoForcado === 'comando' || pareceComando) {
      const intent = await interpretVoiceCommandWithAI(texto, modoForcado);
      if (intent.tipo === 'comando' && intent.acao !== 'nenhuma') {
        await executeManagementCommand(intent);
        els.textInput.value = '';
        return;
      }
      if (modoForcado === 'comando') {
        replyCommand('Não entendi qual comando executar. Exemplos: "coloque a demanda 1.2 em andamento", "muda o prazo da 1.2 para sexta", "exclui a demanda 1.2".');
        return;
      }
    }
  }

  // Fluxo normal otimista (< 1s)
  const t0 = performance.now();
  const localDraft = buildFallbackDemand(texto);
  const localMs = Math.max(1, Math.round(performance.now() - t0));

  const acadDetect =
    modoEstudanteAtivo() && studentUiMod?.autoDetectAcademicFields
      ? studentUiMod.autoDetectAcademicFields(texto)
      : {};

  const rascunhoBase = {
    ...localDraft,
    ...acadDetect,
    status: localDraft.status || 'pendente',
    origem,
    textoOriginal: texto
  };

  if (state.prefs.salvarDiretoSemPrevia) {
    try {
      const docRef = await createDemanda(state.activeWsId, state.user, rascunhoBase);
      els.textInput.value = '';
      showToast('Demanda salva! Refinando com IA…');

      const result = await parseDemandWithAIStream(texto, { timeoutMs: 8000 });
      recordPerf(localMs, result.elapsedMs, result.cached, result.usedFallback);

      if (!result.usedFallback && state.user && state.activeWsId) {
        await updateDemanda(state.activeWsId, state.user.uid, docRef.id, {
          ...result.demanda,
          status: result.demanda.status || 'pendente'
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

function stopCommentsSubscription() {
  if (state.unsubscribeComments) {
    state.unsubscribeComments();
    state.unsubscribeComments = null;
  }
}

function renderCommentsList(comentarios) {
  if (!els.commentsList) return;
  els.commentsList.replaceChildren();
  if (!comentarios || comentarios.length === 0) {
    const empty = document.createElement('li');
    empty.style.fontSize = '0.82rem';
    empty.style.color = 'var(--text-muted)';
    empty.textContent = 'Nenhum comentário ainda.';
    els.commentsList.appendChild(empty);
    return;
  }
  for (const c of comentarios) {
    const li = document.createElement('li');
    li.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.45rem 0.6rem;font-size:0.85rem;';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-muted);margin-bottom:0.2rem;';
    const dt = c.criadoEm?.toDate ? c.criadoEm.toDate() : c.criadoEm ? new Date(c.criadoEm) : null;
    const dtStr = dt ? dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'agora';
    head.innerHTML = `<strong></strong><span></span>`;
    head.querySelector('strong').textContent = c.autorNome || 'Membro';
    head.querySelector('span').textContent = dtStr;
    const body = document.createElement('div');
    body.textContent = c.texto || '';
    li.append(head, body);
    els.commentsList.appendChild(li);
  }
}

function setPreviewReadOnlyMode(readOnly) {
  const fields = [
    els.editTitulo,
    els.editDescricao,
    els.editPrioridade,
    els.editPrazo,
    els.editCategoria,
    els.editStatus,
    els.editEtiquetas,
    els.editRecorrencia,
    els.editDiaMes,
    els.newSubtaskInput,
    els.addSubtaskBtn
  ];
  for (const f of fields) {
    if (f) f.disabled = readOnly;
  }
  if (els.editResponsaveisList) {
    els.editResponsaveisList.querySelectorAll('input[type="checkbox"]').forEach((chk) => {
      chk.disabled = readOnly;
    });
  }
  if (els.editDiasSemanaWrap) {
    els.editDiasSemanaWrap.querySelectorAll('input[data-rec-dow]').forEach((chk) => {
      chk.disabled = readOnly;
    });
  }
  if (els.previewSaveBtn) {
    els.previewSaveBtn.classList.toggle('hidden', readOnly);
    els.previewSaveBtn.disabled = false;
    els.previewSaveBtn.textContent = 'Salvar';
  }
}

function openPreviewDialog(rascunho, localMs = 0) {
  stopCommentsSubscription();
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
  els.commentsSection?.classList.add('hidden');
  els.demandLinkActions?.classList.add('hidden');
  setPreviewReadOnlyMode(false);

  fillPreviewFields(rascunho);
  checkDuplicateAndHistoryHints();
  els.previewDialog.showModal();

  runPreviewAiRefinement(rascunho.textoOriginal, sessionId, localMs);
}

function openEditDialog(demanda) {
  stopCommentsSubscription();
  state.editingDemand = demanda;
  state.pendingDraft = null;
  state.batchQueue = [];
  state.batchTotal = 0;
  state.dirtyFields.clear();
  state.editingSubtarefas = (demanda.subtarefas || []).map((s) => ({ ...s }));
  state.refineSessionId += 1;

  const readOnly = isReadOnlyRole();
  els.previewTitle.textContent = readOnly ? 'Visualizar e comentar demanda' : 'Editar demanda';
  els.previewDiscardBtn.textContent = readOnly ? 'Fechar' : 'Cancelar';
  els.batchSaveAllBtn.classList.add('hidden');
  setPreviewAiBar('hidden', '', false);
  setPreviewReadOnlyMode(readOnly);

  fillPreviewFields(demanda);
  checkDuplicateAndHistoryHints();

  if (corpUiMod && moduloAtivo('links')) {
    corpUiMod.renderDemandLinkControls(els.demandLinkActions, demanda);
  } else {
    els.demandLinkActions?.classList.add('hidden');
  }

  if (els.commentsSection && state.activeWsId && demanda.id) {
    els.commentsSection.classList.remove('hidden');
    els.commentsList.replaceChildren();
    state.unsubscribeComments = subscribeComments(state.activeWsId, demanda.id, renderCommentsList);
  }

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
  if (els.editResponsaveisList) {
    const selectedUids = new Set(getDemandAssignees(d).map((a) => a.uid));
    els.editResponsaveisList.querySelectorAll('input[type="checkbox"]').forEach((chk) => {
      chk.checked = selectedUids.has(chk.value);
    });
  }

  const recTipo = d.recorrencia?.tipo || 'nenhuma';
  els.editRecorrencia.value = recTipo;
  els.editDiaMesWrap.classList.toggle('hidden', recTipo !== 'dia_mes');
  els.editDiasSemanaWrap?.classList.toggle('hidden', recTipo !== 'dias_semana');
  els.editDiaMes.value = d.recorrencia?.diaMes || 1;
  if (els.editDiasSemanaWrap) {
    const setDias = new Set((d.recorrencia?.diasSemana || []).map(Number));
    els.editDiasSemanaWrap.querySelectorAll('input[data-rec-dow]').forEach((chk) => {
      chk.checked = setDias.has(Number(chk.dataset.recDow));
    });
  }

  renderSubtasksEditor();
  if (modoEstudanteAtivo() && studentUiMod) {
    studentUiMod.syncPreviewAcademicSelects(d);
  }

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
}

function getNextDemandCode() {
  let maxNum = state.demandas.length;
  for (const d of state.demandas) {
    const code = String(d._codigo || d.codigo || '');
    const m = code.match(/^1\.(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  return `1.${maxNum + 1}`;
}

function findMatchingDemands(alvo) {
  if (!alvo) return [];
  const raw = String(alvo).trim();
  const codeMatch = raw.match(/\b1[.,](\d+)\b/);
  if (codeMatch) {
    const codeNorm = `1.${codeMatch[1]}`;
    const byCode = state.demandas.filter((d) => (d._codigo || d.codigo) === codeNorm);
    if (byCode.length > 0) return byCode;
  }

  const termo = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return state.demandas.filter((d) => {
    if (d.status === 'concluida') return false;
    const texto = `${d._codigo || d.codigo || ''} ${d.titulo} ${d.descricao || ''} ${d.categoria || ''}`
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
      await snoozeDemanda(state.activeWsId, state.user.uid, alvoDemanda, data);
      replyCommand(`Demanda "${alvoDemanda.titulo}" adiada até ${formatDateBR(data)}.`);
    } else if (intent.acao === 'alterar_prazo') {
      const data = intent.novoPrazo || todayLocalISO();
      await updateDemanda(state.activeWsId, state.user.uid, alvoDemanda.id, {
        ...alvoDemanda,
        prazo: data
      }, 'editada', `prazo -> ${formatDateBR(data)}`);
      replyCommand(`Prazo de "${alvoDemanda.titulo}" alterado para ${formatDateBR(data)}.`);
    } else if (intent.acao === 'alterar_prioridade' && intent.novaPrioridade) {
      await updateDemanda(state.activeWsId, state.user.uid, alvoDemanda.id, {
        ...alvoDemanda,
        prioridade: intent.novaPrioridade
      }, 'editada', `prioridade -> ${intent.novaPrioridade}`);
      replyCommand(`Prioridade de "${alvoDemanda.titulo}" alterada para ${intent.novaPrioridade}.`);
    } else if (intent.acao === 'alterar_descricao' && intent.novaDescricao) {
      await updateDemanda(state.activeWsId, state.user.uid, alvoDemanda.id, {
        ...alvoDemanda,
        descricao: intent.novaDescricao
      }, 'editada', 'descrição atualizada');
      replyCommand(`Descrição da demanda ${alvoDemanda._codigo || alvoDemanda.titulo} atualizada.`);
    } else if (intent.acao === 'alterar_status' && intent.novoStatus) {
      const novo = intent.novoStatus;
      await updateDemanda(state.activeWsId, state.user.uid, alvoDemanda.id, {
        ...alvoDemanda,
        status: novo
      }, 'editada', `status -> ${novo}`);
      const labelSt = novo === 'em_andamento' ? 'Em andamento' : novo === 'concluida' ? 'Concluída' : 'Pendente';
      replyCommand(`Status de "${alvoDemanda.titulo}" alterado para ${labelSt}.`);
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
      await deleteDemanda(state.activeWsId, matches[0].id);
      replyCommand(`Demanda "${matches[0].titulo}" excluída.`);
    };
  }

  els.commandDialog.showModal();
}

// ----------------------------------------------------------------------------
// Ações nos Cards + Desfazer (~6s)
// ----------------------------------------------------------------------------
async function handleToggleDone(demanda) {
  if (!state.user || !state.activeWsId) return;
  const snapshot = { ...demanda };
  try {
    const res = await toggleDemandaStatus(state.activeWsId, state.user, demanda);
    const msg = res?.generatedNext
      ? `Concluída! Próxima ocorrência criada para ${formatDateBR(res.proximoPrazo)}.`
      : demanda.status === 'concluida'
        ? 'Demanda reaberta.'
        : 'Demanda concluída!';

    showToast(msg, 6000, () => restoreDemanda(state.activeWsId, state.user, snapshot));
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

  const attentionToggleBtn = document.getElementById('attention-toggle-btn');
  const attentionPanel = document.getElementById('attention-panel');
  attentionToggleBtn?.addEventListener('click', () => {
    const isHidden = attentionPanel.classList.toggle('hidden');
    attentionToggleBtn.setAttribute('aria-expanded', String(!isHidden));
  });

  els.logoutBtn.addEventListener('click', async () => {
    stopSpeaking();
    await logout();
  });

  els.tutorialBtn?.addEventListener('click', () => els.tutorialDialog?.showModal());
  els.tutorialCloseX?.addEventListener('click', () => els.tutorialDialog?.close());
  els.tutorialCloseBtn?.addEventListener('click', () => els.tutorialDialog?.close());

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

  els.assigneeFilterSelect?.addEventListener('change', (e) => {
    state.assigneeFilter = e.target.value;
    renderAll();
  });

  els.previewDialog.addEventListener('close', () => {
    stopCommentsSubscription();
    if (els.newCommentInput) els.newCommentInput.value = '';
  });

  const handleSendComment = async () => {
    if (!state.user || !state.activeWsId || !state.editingDemand?.id) return;
    const texto = els.newCommentInput.value.trim();
    if (!texto) return;
    els.addCommentBtn.disabled = true;
    try {
      await addComment(state.activeWsId, state.editingDemand.id, state.user, texto);
      els.newCommentInput.value = '';
    } catch (err) {
      showToast('Erro ao enviar comentário.');
      console.error(err);
    } finally {
      els.addCommentBtn.disabled = false;
    }
  };

  els.addCommentBtn?.addEventListener('click', handleSendComment);
  els.newCommentInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendComment();
    }
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
    els.editDiasSemanaWrap?.classList.toggle('hidden', els.editRecorrencia.value !== 'dias_semana');
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
    if (!state.user || !state.activeWsId || state.batchQueue.length === 0 || isReadOnlyRole()) return;
    try {
      for (const item of state.batchQueue) {
        await createDemanda(state.activeWsId, state.user, item);
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
    if (!state.user || !state.activeWsId || isReadOnlyRole()) return;

    const etiquetas = els.editEtiquetas.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const recTipo = els.editRecorrencia.value;
    const diasSemana = els.editDiasSemanaWrap
      ? Array.from(els.editDiasSemanaWrap.querySelectorAll('input[data-rec-dow]:checked'))
          .map((chk) => Number(chk.dataset.recDow))
          .sort((a, b) => a - b)
      : [];
    const recorrencia =
      recTipo === 'nenhuma' || (recTipo === 'dias_semana' && diasSemana.length === 0)
        ? null
        : {
            tipo: recTipo,
            ...(recTipo === 'dia_mes' ? { diaMes: Number(els.editDiaMes.value) || 1 } : {}),
            ...(recTipo === 'dias_semana' ? { diasSemana } : {})
          };

    const responsaveis = els.editResponsaveisList
      ? Array.from(els.editResponsaveisList.querySelectorAll('input[type="checkbox"]:checked')).map((chk) => {
          const m = state.workspaceMembers.find((x) => x.uid === chk.value);
          return {
            uid: chk.value,
            nome: m?.nome || m?.email || chk.dataset.nome || 'Membro'
          };
        })
      : [];

    const dados = {
      titulo: els.editTitulo.value.trim(),
      descricao: els.editDescricao.value.trim(),
      prioridade: els.editPrioridade.value,
      prazo: els.editPrazo.value || null,
      categoria: els.editCategoria.value.trim() || null,
      status: els.editStatus.value,
      etiquetas,
      recorrencia,
      subtarefas: state.editingSubtarefas,
      responsaveis,
      ...(modoEstudanteAtivo() && studentUiMod ? studentUiMod.readPreviewAcademicFields() : {})
    };

    if (!dados.titulo) {
      showToast('Informe um título para a demanda.');
      return;
    }

    const wsId = state.activeWsId;
    const user = state.user;

    if (els.previewSaveBtn) {
      els.previewSaveBtn.disabled = true;
      els.previewSaveBtn.textContent = 'Salvando…';
    }

    try {
      if (state.editingDemand) {
        const prevSnapshot = { ...state.editingDemand };
        const writePromise = updateDemanda(wsId, user.uid, state.editingDemand.id, {
          ...dados,
          historico: state.editingDemand.historico,
          concluidoEm: state.editingDemand.concluidoEm
        });
        writePromise.catch((err) => {
          showToast('Erro ao sincronizar edição com o Firestore.');
          console.error(err);
        });
        // Aguarda até 250ms para gravar no cache local do IndexedDB antes de fechar
        await Promise.race([writePromise, new Promise((r) => setTimeout(r, 250))]);
        showToast('Demanda atualizada.', 6000, () => restoreDemanda(wsId, user, prevSnapshot));
      } else if (state.pendingDraft) {
        const writePromise = createDemanda(wsId, user, {
          ...state.pendingDraft,
          ...dados,
          codigo: state.pendingDraft.codigo || getNextDemandCode()
        });
        writePromise.catch((err) => {
          showToast('Erro ao sincronizar demanda com o Firestore.');
          console.error(err);
        });
        await Promise.race([writePromise, new Promise((r) => setTimeout(r, 250))]);

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
    } finally {
      if (els.previewSaveBtn) {
        els.previewSaveBtn.disabled = false;
        els.previewSaveBtn.textContent = 'Salvar';
      }
    }
  });

  // Exclusão com Desfazer (~6s)
  els.deleteDialog.addEventListener('close', async () => {
    const action = els.deleteDialog.returnValue;
    els.deleteDialog.returnValue = '';

    if (action === 'delete' && state.deletingDemand && state.user && state.activeWsId) {
      const snapshot = { ...state.deletingDemand };
      try {
        await deleteDemanda(state.activeWsId, snapshot.id);
        showToast('Demanda excluída.', 6000, () => restoreDemanda(state.activeWsId, state.user, snapshot));
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
    if (!state.user || !state.activeWsId || !state.snoozingDemand || !els.snoozeCustomDate.value) return;
    try {
      await snoozeDemanda(state.activeWsId, state.user.uid, state.snoozingDemand, els.snoozeCustomDate.value);
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
    window.print();
  });

  // Atalhos de teclado (?)
  els.shortcutsBtn?.addEventListener('click', () => els.shortcutsDialog.showModal());
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
    if (els.cfgTema) els.cfgTema.value = state.prefs.tema || 'sistema';

    const quota = getQuotaStats();
    if (state.lastPerf || state.debugTempo) {
      const perfPart = state.lastPerf
        ? `Prévia local: ${state.lastPerf.localMs}ms | ${state.lastPerf.cached ? 'cache' : state.lastPerf.fallback ? 'fallback' : 'IA'}: ${state.lastPerf.aiMs}ms. `
        : '';
      els.cfgPerfSummary.textContent = `${perfPart}Cota sessão: ${quota.reads} leituras | ${quota.writes} gravações.`;
      els.cfgPerfSummary.classList.remove('hidden');
    } else {
      els.cfgPerfSummary.classList.add('hidden');
    }

    els.cfgDeleteLegacyWrap.classList.toggle('hidden', !state.hasLegacyDemands);
    renderSettingsWorkspacesList();

    updateNotifButtonText();
    els.settingsDialog.showModal();
  });

  function renderSettingsWorkspacesList() {
    if (!els.cfgWorkspacesList || !state.user) return;
    els.cfgWorkspacesList.replaceChildren();
    for (const esp of state.meusEspacos) {
      const li = document.createElement('li');
      li.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:0.5rem;padding:0.4rem 0.55rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.85rem;';
      const info = document.createElement('span');
      info.textContent = `${esp.nome || 'Espaço'} (${esp.papel || 'admin'})`;
      li.appendChild(info);

      if (esp.papel === 'admin' && state.meusEspacos.length > 1) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-danger btn-sm';
        delBtn.textContent = 'Excluir';
        delBtn.addEventListener('click', async () => {
          if (!window.confirm(`Excluir o espaço "${esp.nome}"? Apenas o criador original pode excluir.`)) return;
          delBtn.disabled = true;
          try {
            await deleteOwnedWorkspace(state.user, esp.id);
            state.meusEspacos = state.meusEspacos.filter((e) => e.id !== esp.id);
            if (state.activeWsId === esp.id && state.meusEspacos[0]) {
              await activateWorkspaceContext(state.meusEspacos[0].id, true);
            } else {
              renderWorkspaceSelector();
            }
            renderSettingsWorkspacesList();
            showToast(`Espaço "${esp.nome}" excluído.`);
          } catch (err) {
            showToast(err.message || 'Não foi possível excluir este espaço.');
            delBtn.disabled = false;
          }
        });
        li.appendChild(delBtn);
      }
      els.cfgWorkspacesList.appendChild(li);
    }
  }

  els.cfgTema?.addEventListener('change', () => {
    applyTheme(els.cfgTema.value);
  });

  const handleDeleteLegacy = async () => {
    if (!state.user) return;
    if (!window.confirm('Tem certeza que deseja apagar as demandas antigas de users/{uid}/demandas? Elas já foram copiadas para o seu espaço Pessoal.')) {
      return;
    }
    try {
      const qtd = await deleteLegacyDemands(state.user.uid);
      state.hasLegacyDemands = false;
      els.cfgDeleteLegacyWrap.classList.add('hidden');
      els.migrationDeleteLegacyBtn.classList.add('hidden');
      showToast(`${qtd} registro(s) antigo(s) apagado(s).`);
    } catch {
      showToast('Erro ao apagar dados antigos.');
    }
  };

  els.cfgDeleteLegacyBtn.addEventListener('click', handleDeleteLegacy);
  els.migrationDeleteLegacyBtn.addEventListener('click', handleDeleteLegacy);
  els.migrationCloseBtn.addEventListener('click', () => els.migrationDialog.close());

  els.settingsCloseX.addEventListener('click', () => {
    applyTheme(state.prefs.tema);
    els.settingsDialog.close('cancel');
  });

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
        tema: els.cfgTema?.value || state.prefs.tema || 'sistema',
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
      applyTheme(novasPrefs.tema);
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

  // Eventos dos 3 Modos (Simples, Estudante, Corporativo) — Etapa C0
  els.modesBtn?.addEventListener('click', openModesDialog);
  els.cfgModesBtn?.addEventListener('click', () => {
    els.settingsDialog.close('cancel');
    openModesDialog();
  });
  els.modesCloseX?.addEventListener('click', () => els.modesDialog.close());
  els.modesCloseBtn?.addEventListener('click', () => els.modesDialog.close());
  els.modeEstudanteAction?.addEventListener('click', () => {
    els.modesDialog.close();
    openStudentActivateDialog();
  });
  els.modeCorpAction?.addEventListener('click', () => {
    els.modesDialog.close();
    openCorpActivateDialog();
  });

  els.inviteModeSimples?.addEventListener('click', () => {
    els.unifiedInviteBanner.classList.add('hidden');
    dismissUnifiedInviteLocal();
  });
  els.inviteModeEstudante?.addEventListener('click', openStudentActivateDialog);
  els.inviteModeCorporativo?.addEventListener('click', openCorpActivateDialog);
  els.inviteModeLater?.addEventListener('click', () => {
    els.unifiedInviteBanner.classList.add('hidden');
  });
  els.inviteModeNever?.addEventListener('click', async () => {
    els.unifiedInviteBanner.classList.add('hidden');
    dismissUnifiedInviteLocal();
    if (state.user) {
      await saveStudentConfig(state.user.uid, { dispensaConvite: true }).catch(() => {});
      await saveCorpConfig(state.user.uid, { dispensaConvite: true }).catch(() => {});
    }
  });

  // Eventos do Ativador do Modo Corporativo (Etapa C0)
  els.corpActivateCloseX?.addEventListener('click', () => els.corpActivateDialog.close());
  els.corpActivateCancel?.addEventListener('click', () => els.corpActivateDialog.close());
  els.corpMasterToggle?.addEventListener('change', () => {
    const on = els.corpMasterToggle.checked;
    els.corpModulesBox.querySelectorAll('input').forEach((i) => {
      i.disabled = !on;
    });
    els.corpActivateSave.textContent = on ? (getCorpConfig().ativo ? 'Salvar módulos' : 'Ativar') : 'Desativar';
  });
  els.corpActivateSave?.addEventListener('click', async () => {
    if (!state.user) return;
    const ativo = els.corpMasterToggle.checked;
    const estavaAtivo = modoCorporativoAtivo();
    if (!ativo && estavaAtivo) {
      const ok = window.confirm('Os recursos corporativos serão escondidos. Seus dados ficam guardados e voltam se você reativar.');
      if (!ok) return;
    }
    const modulos = {};
    els.corpModulesBox.querySelectorAll('input[data-corp-mod]').forEach((chk) => {
      modulos[chk.dataset.corpMod] = chk.checked;
    });
    els.corpActivateError.classList.add('hidden');
    els.corpActivateSave.disabled = true;
    els.corpActivateSave.textContent = ativo ? 'Ativando…' : 'Salvando…';
    try {
      await saveCorpConfig(state.user.uid, { ativo, modulos });
      await syncCorporativoModeLifecycle();
      renderAll();
      els.corpActivateDialog.close();
      showToast(ativo ? 'Modo Corporativo ativado!' : 'Modo Corporativo desativado.');
      if (ativo && !getCorpConfig().onboardingConcluido && corpUiMod?.showCorpOnboarding) {
        corpUiMod.showCorpOnboarding(() => {
          saveCorpConfig(state.user.uid, { onboardingConcluido: true }).catch(() => {});
        });
      }
    } catch (err) {
      console.error(err);
      els.corpActivateError.textContent = 'Não foi possível carregar ou salvar o Modo Corporativo. Tente de novo.';
      els.corpActivateError.classList.remove('hidden');
    } finally {
      els.corpActivateSave.disabled = false;
      els.corpActivateSave.textContent = ativo ? 'Ativar' : 'Salvar';
    }
  });

  els.studentActivateCloseX.addEventListener('click', () => els.studentActivateDialog.close());
  els.studentActivateCancel.addEventListener('click', () => els.studentActivateDialog.close());
  els.stuMasterToggle.addEventListener('change', () => {
    const on = els.stuMasterToggle.checked;
    els.stuModulesBox.querySelectorAll('input').forEach((i) => {
      i.disabled = !on;
    });
  });

  els.studentActivateSave.addEventListener('click', async () => {
    if (!state.user) return;
    const ativo = els.stuMasterToggle.checked;
    if (!ativo && getStudentConfig().ativo) {
      const ok = window.confirm('Os recursos de estudante serão escondidos. Seus dados ficam guardados e voltam se você reativar.');
      if (!ok) return;
    }

    const modulos = {};
    els.stuModulesBox.querySelectorAll('input[data-stu-mod]').forEach((chk) => {
      modulos[chk.dataset.stuMod] = chk.checked;
    });

    els.studentActivateSave.disabled = true;
    els.studentActivateSave.textContent = ativo ? 'Ativando…' : 'Salvando…';
    els.stuActivateError.classList.add('hidden');

    try {
      await saveStudentConfig(state.user.uid, { ativo, modulos });
      await syncStudentModeLifecycle();
      els.studentActivateDialog.close();
      showToast(ativo ? 'Modo Estudante ativado!' : 'Modo Estudante desativado.');
    } catch (err) {
      els.stuActivateError.textContent = 'Não foi possível salvar agora (verifique sua conexão) e tente novamente.';
      els.stuActivateError.classList.remove('hidden');
      console.error(err);
    } finally {
      els.studentActivateSave.disabled = false;
      els.studentActivateSave.textContent = ativo ? 'Ativar' : 'Salvar';
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

  // --------------------------------------------------------------------------
  // Colaboração: Espaços, Membros, Convites e Economia de Cota
  // --------------------------------------------------------------------------
  function startWorkspaceDemandsSubscription() {
    if (state.unsubscribeDemandas) {
      state.unsubscribeDemandas();
      state.unsubscribeDemandas = null;
    }
    if (!state.activeWsId || !state.user) return;

    state.unsubscribeDemandas = subscribeDemandas(
      state.activeWsId,
      (demandas) => {
        state.demandas = demandas.map((d, idx) => ({
          ...d,
          _codigo: d.codigo || `1.${idx + 1}`
        }));
        state.loadedInitial = true;
        renderAll();

        if (!state.spokenOnOpen) {
          state.spokenOnOpen = true;
          const hoje = todayLocalISO();
          const jaViuBomDia = localStorage.getItem('pauta_bom_dia_date') === hoje;
          if (!jaViuBomDia && demandas.some((d) => d.status !== 'concluida')) {
            localStorage.setItem('pauta_bom_dia_date', hoje);
            openMorningDialog(false);
          }
        }
      },
      (err) => {
        showToast('Erro ao sincronizar demandas com o Firestore.');
        console.error(err);
      }
    );
  }

  async function activateWorkspaceContext(wsId, switchInDb = false) {
    if (!state.user || !wsId) return;
    if (switchInDb) {
      await switchActiveWorkspace(state.user.uid, wsId);
    }
    state.activeWsId = wsId;
    state.assigneeFilter = 'todos';
    if (els.assigneeFilterSelect) els.assigneeFilterSelect.value = 'todos';

    try {
      const { workspace, membros } = await loadWorkspaceInfoAndMembers(wsId);
      state.activeWorkspace = workspace;
      state.workspaceMembers = membros;
      const me = membros.find((m) => m.uid === state.user.uid);
      const espIndex = state.meusEspacos.find((e) => e.id === wsId);
      state.myRole = me?.papel || espIndex?.papel || 'admin';
      updateMyLastVisit(wsId, state.user.uid).catch(() => {});
    } catch (err) {
      console.error('Erro ao carregar espaço e membros:', err);
      state.workspaceMembers = [];
      state.myRole = 'admin';
    }

    renderWorkspaceSelector();
    populateMemberSelects();
    applyRoleUI();
    startWorkspaceDemandsSubscription();

    if (modoEstudanteAtivo() && studentUiMod?.onWorkspaceChanged) {
      studentUiMod.onWorkspaceChanged(wsId).catch(() => {});
    }
  }

  async function renderActiveInvitesList() {
    if (!els.wsInvitesList || !state.activeWsId || state.myRole !== 'admin') return;
    els.wsInvitesList.replaceChildren();
    try {
      const convites = await listWorkspaceInvites(state.activeWsId);
      if (convites.length === 0) {
        const li = document.createElement('li');
        li.style.fontSize = '0.8rem';
        li.style.color = 'var(--text-muted)';
        li.textContent = 'Nenhum convite ativo no momento.';
        els.wsInvitesList.appendChild(li);
        return;
      }
      for (const c of convites) {
        const li = document.createElement('li');
        li.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:0.5rem;padding:0.4rem 0.55rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.82rem;';
        const info = document.createElement('span');
        const tipoTxt = c.tipo === 'email' ? `E-mail (${c.emailAlvo})` : 'Link';
        info.textContent = `${tipoTxt} • ${c.papel} • ${c.usos || 0}/${c.usosMax || 1} usos`;

        const btns = document.createElement('div');
        btns.style.display = 'flex';
        btns.style.gap = '0.3rem';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'btn btn-ghost btn-sm';
        copyBtn.textContent = 'Copiar';
        copyBtn.addEventListener('click', async () => {
          const url = `${location.origin}/?convite=${c.token}`;
          await navigator.clipboard?.writeText(url).catch(() => {});
          showToast('Link do convite copiado!');
        });

        const revBtn = document.createElement('button');
        revBtn.type = 'button';
        revBtn.className = 'btn btn-ghost btn-sm';
        revBtn.textContent = 'Revogar';
        revBtn.addEventListener('click', async () => {
          await revokeInvite(c.token);
          showToast('Convite revogado.');
          renderActiveInvitesList();
        });

        btns.append(copyBtn, revBtn);
        li.append(info, btns);
        els.wsInvitesList.appendChild(li);
      }
    } catch (err) {
      console.error('Erro ao listar convites:', err);
    }
  }

  function renderMembersList() {
    if (!els.wsMembersList) return;
    els.wsMembersList.replaceChildren();
    const isAdmin = state.myRole === 'admin';
    const creatorUid = state.activeWorkspace?.criadoPor;

    for (const m of state.workspaceMembers) {
      const li = document.createElement('li');
      li.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;padding:0.45rem 0.6rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);';

      const left = document.createElement('div');
      left.style.cssText = 'display:flex;flex-direction:column;min-width:160px;';
      const nomeEl = document.createElement('strong');
      nomeEl.style.fontSize = '0.88rem';
      nomeEl.textContent = `${m.nome || 'Sem nome'}${m.uid === state.user?.uid ? ' (você)' : ''}${m.uid === creatorUid ? ' • Criador' : ''}`;
      const emailEl = document.createElement('span');
      emailEl.style.cssText = 'font-size:0.76rem;color:var(--text-muted);';
      emailEl.textContent = m.email || '';
      left.append(nomeEl, emailEl);

      const right = document.createElement('div');
      right.style.cssText = 'display:flex;align-items:center;gap:0.35rem;';

      if (isAdmin && m.uid !== creatorUid) {
        const sel = document.createElement('select');
        sel.className = 'select-control';
        sel.style.cssText = 'padding:0.25rem 0.45rem;font-size:0.8rem;';
        for (const [val, lbl] of [['admin', 'Admin'], ['editor', 'Editor'], ['leitor', 'Leitor']]) {
          const o = document.createElement('option');
          o.value = val;
          o.textContent = lbl;
          sel.appendChild(o);
        }
        sel.value = m.papel || 'editor';
        sel.addEventListener('change', async () => {
          try {
            await updateMemberRole(state.activeWsId, m.uid, sel.value);
            m.papel = sel.value;
            populateMemberSelects();
            showToast('Permissão atualizada.');
          } catch (err) {
            sel.value = m.papel;
            showToast('Não foi possível alterar a permissão.');
            console.error(err);
          }
        });
        right.appendChild(sel);

        if (m.uid !== state.user?.uid) {
          const remBtn = document.createElement('button');
          remBtn.type = 'button';
          remBtn.className = 'btn btn-ghost btn-sm';
          remBtn.textContent = 'Remover';
          remBtn.addEventListener('click', async () => {
            try {
              await removeWorkspaceMember(state.activeWsId, m.uid);
              state.workspaceMembers = state.workspaceMembers.filter((x) => x.uid !== m.uid);
              renderMembersList();
              populateMemberSelects();
              showToast('Membro removido.');
            } catch (err) {
              showToast('Erro ao remover membro.');
              console.error(err);
            }
          });
          right.appendChild(remBtn);
        }
      } else {
        const badge = document.createElement('span');
        badge.className = 'badge badge-tag';
        badge.textContent = m.papel === 'admin' ? 'Admin' : m.papel === 'leitor' ? 'Leitor' : 'Editor';
        right.appendChild(badge);
      }

      li.append(left, right);
      els.wsMembersList.appendChild(li);
    }
  }

  async function openMembersDialog() {
    if (!state.activeWsId || !state.user) return;
    try {
      const { workspace, membros } = await loadWorkspaceInfoAndMembers(state.activeWsId);
      state.activeWorkspace = workspace;
      state.workspaceMembers = membros;
      const me = membros.find((m) => m.uid === state.user.uid);
      state.myRole = me?.papel || state.myRole || 'admin';
      applyRoleUI();
    } catch (err) {
      console.error(err);
    }

    const wsName = state.activeWorkspace?.nome || 'Espaço';
    const isAdmin = state.myRole === 'admin';
    const isCreator = state.activeWorkspace?.criadoPor === state.user.uid;

    els.wsMembersMeta.textContent = `${wsName} • Seu papel: ${state.myRole}`;
    els.wsInviteAdminSection.classList.toggle('hidden', !isAdmin);
    els.wsLeaveBtn.classList.toggle('hidden', isCreator);
    els.wsInviteResult.classList.add('hidden');

    renderMembersList();
    if (isAdmin) {
      renderActiveInvitesList();
    }
    els.wsMembersDialog.showModal();
  }

  async function handlePendingInviteToken(token) {
    if (!token || !state.user) return;
    try {
      const inv = await getInviteByToken(token);
      if (!inv) {
        showToast('Convite inválido ou não encontrado.');
        clearInviteUrlParam();
        state.pendingInviteToken = null;
        return;
      }
      const exp = inv.expiraEm?.toDate ? inv.expiraEm.toDate() : new Date(inv.expiraEm);
      if (!inv.ativo || exp <= new Date() || (inv.usos || 0) >= (inv.usosMax || 1)) {
        showToast('Este convite expirou ou já atingiu o limite de usos.');
        clearInviteUrlParam();
        state.pendingInviteToken = null;
        return;
      }

      state.pendingInviteData = inv;
      const roleDesc = inv.papel === 'leitor' ? 'Leitor (apenas visualizar e comentar)' : 'Editor (criar, editar, concluir e comentar)';
      els.inviteAcceptDesc.textContent = `${inv.criadoPorNome || 'Alguém'} convidou você para o espaço "${inv.wsNome}" como ${roleDesc}.`;

      const userEmail = (state.user.email || '').toLowerCase();
      const emailMismatch = inv.tipo === 'email' && inv.emailAlvo && userEmail !== inv.emailAlvo;
      if (emailMismatch) {
        els.inviteAcceptWarning.textContent = `Este convite foi enviado para ${inv.emailAlvo}, mas você está logado como ${state.user.email}. Troque de conta para aceitar.`;
        els.inviteAcceptWarning.classList.remove('hidden');
        els.inviteSwitchAccountBtn.classList.remove('hidden');
        els.inviteConfirmBtn.classList.add('hidden');
      } else {
        els.inviteAcceptWarning.classList.add('hidden');
        els.inviteSwitchAccountBtn.classList.add('hidden');
        els.inviteConfirmBtn.classList.remove('hidden');
      }
      els.inviteAcceptDialog.showModal();
    } catch (err) {
      console.error('Erro ao verificar convite:', err);
      showToast('Não foi possível abrir o convite.');
    }
  }

  async function checkPendingEmailInvites() {
    if (!state.user?.email || !els.emailInvitesBanner) return;
    if (sessionStorage.getItem('pauta_email_invites_checked') === '1') return;
    sessionStorage.setItem('pauta_email_invites_checked', '1');

    try {
      const invites = await findPendingEmailInvites(state.user.email);
      const myIds = new Set(state.meusEspacos.map((e) => e.id));
      const pendentes = invites.filter((inv) => !myIds.has(inv.wsId));
      if (pendentes.length === 0) {
        els.emailInvitesBanner.classList.add('hidden');
        return;
      }

      const first = pendentes[0];
      els.emailInvitesBanner.replaceChildren();
      const msg = document.createElement('span');
      msg.textContent = `Você foi convidado para "${first.wsNome}" (${first.papel}) por ${first.criadoPorNome || 'um colega'}.`;
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:0.35rem;flex-wrap:wrap;';

      const acceptBtn = document.createElement('button');
      acceptBtn.type = 'button';
      acceptBtn.className = 'btn btn-primary btn-sm';
      acceptBtn.textContent = 'Entrar no espaço';
      acceptBtn.addEventListener('click', async () => {
        try {
          await acceptInviteAtomic(state.user, first);
          state.meusEspacos.push({ id: first.wsId, nome: first.wsNome, papel: first.papel });
          els.emailInvitesBanner.classList.add('hidden');
          await activateWorkspaceContext(first.wsId, true);
          showToast(`Você entrou em "${first.wsNome}"!`);
        } catch (err) {
          showToast('Não foi possível aceitar o convite.');
          console.error(err);
        }
      });

      const dismissBtn = document.createElement('button');
      dismissBtn.type = 'button';
      dismissBtn.className = 'btn btn-ghost btn-sm';
      dismissBtn.textContent = 'Depois';
      dismissBtn.addEventListener('click', () => els.emailInvitesBanner.classList.add('hidden'));

      actions.append(acceptBtn, dismissBtn);
      els.emailInvitesBanner.append(msg, actions);
      els.emailInvitesBanner.classList.remove('hidden');
    } catch (err) {
      console.error('Erro ao buscar convites por e-mail:', err);
    }
  }

  // Listeners dos controles de colaboração
  els.workspaceSelect?.addEventListener('change', async (e) => {
    const newWsId = e.target.value;
    if (!newWsId || newWsId === state.activeWsId) return;
    await activateWorkspaceContext(newWsId, true);
    showToast('Espaço alterado.');
  });

  els.wsNewBtn?.addEventListener('click', () => {
    els.wsCreateName.value = '';
    els.wsCreateType.value = 'equipe';
    els.wsCreateDialog.showModal();
  });
  els.wsCreateCloseX?.addEventListener('click', () => els.wsCreateDialog.close());
  els.wsCreateCancel?.addEventListener('click', () => els.wsCreateDialog.close());

  els.wsCreateForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.user) return;
    const nome = els.wsCreateName.value.trim();
    if (!nome) return;
    try {
      const created = await createNewWorkspace(state.user, nome, els.wsCreateType.value);
      state.meusEspacos.push(created);
      els.wsCreateDialog.close();
      await activateWorkspaceContext(created.id, true);
      showToast(`Espaço "${created.nome}" criado!`);
    } catch (err) {
      showToast('Erro ao criar espaço.');
      console.error(err);
    }
  });

  els.wsMembersBtn?.addEventListener('click', openMembersDialog);
  els.wsMembersCloseX?.addEventListener('click', () => els.wsMembersDialog.close());
  els.wsMembersCloseBtn?.addEventListener('click', () => els.wsMembersDialog.close());

  els.inviteTabPills?.forEach((pill) => {
    pill.addEventListener('click', () => {
      state.currentInviteTab = pill.dataset.inviteTab;
      els.inviteTabPills.forEach((p) => p.setAttribute('aria-pressed', String(p === pill)));
      const isEmail = state.currentInviteTab === 'email';
      els.wsInviteEmailWrap.classList.toggle('hidden', !isEmail);
      els.wsInviteUsesWrap.classList.toggle('hidden', isEmail);
      els.wsInviteResult.classList.add('hidden');
    });
  });

  els.wsInviteGenerateBtn?.addEventListener('click', async () => {
    if (!state.user || !state.activeWsId || state.myRole !== 'admin') return;
    const tipo = state.currentInviteTab || 'link';
    const papel = els.wsInviteRole.value;
    const emailAlvo = els.wsInviteEmail.value.trim();
    const usosMax = tipo === 'email' ? 1 : Number(els.wsInviteUses.value) || 1;

    if (tipo === 'email' && !emailAlvo.includes('@')) {
      showToast('Informe um e-mail válido.');
      return;
    }

    try {
      const inv = await createInvite({
        wsId: state.activeWsId,
        wsNome: state.activeWorkspace?.nome || 'Espaço',
        papel,
        tipo,
        emailAlvo,
        validadeDias: 7,
        usosMax,
        user: state.user
      });
      const url = `${location.origin}/?convite=${inv.token}`;
      els.wsInviteLinkInput.value = url;
      els.wsInviteResult.classList.remove('hidden');
      els.wsInviteShareBtn.classList.toggle('hidden', !navigator.share);

      if (tipo === 'email') {
        const subject = encodeURIComponent(`Convite para o espaço "${state.activeWorkspace?.nome || 'Pauta'}" no Pauta`);
        const body = encodeURIComponent(
          `Olá! Convidei você para colaborar no espaço "${state.activeWorkspace?.nome || 'Pauta'}" como ${papel}.\n\nAcesse pelo link: ${url}`
        );
        els.wsInviteMailtoBtn.href = `mailto:${encodeURIComponent(emailAlvo)}?subject=${subject}&body=${body}`;
        els.wsInviteMailtoBtn.classList.remove('hidden');
      } else {
        els.wsInviteMailtoBtn.classList.add('hidden');
      }

      renderActiveInvitesList();
      showToast('Convite criado!');
    } catch (err) {
      showToast('Erro ao gerar convite.');
      console.error(err);
    }
  });

  els.wsInviteCopyBtn?.addEventListener('click', async () => {
    if (!els.wsInviteLinkInput.value) return;
    await navigator.clipboard?.writeText(els.wsInviteLinkInput.value).catch(() => {});
    showToast('Link copiado!');
  });

  els.wsInviteShareBtn?.addEventListener('click', async () => {
    if (!navigator.share || !els.wsInviteLinkInput.value) return;
    try {
      await navigator.share({
        title: `Convite Pauta — ${state.activeWorkspace?.nome || 'Espaço'}`,
        text: 'Entre neste espaço compartilhado no Pauta:',
        url: els.wsInviteLinkInput.value
      });
    } catch {}
  });

  els.wsLeaveBtn?.addEventListener('click', async () => {
    if (!state.user || !state.activeWsId) return;
    try {
      await leaveWorkspace(state.activeWsId, state.user.uid);
      state.meusEspacos = state.meusEspacos.filter((e) => e.id !== state.activeWsId);
      els.wsMembersDialog.close();
      const nextWs = state.meusEspacos[0]?.id;
      if (nextWs) {
        await activateWorkspaceContext(nextWs, true);
      }
      showToast('Você saiu do espaço.');
    } catch (err) {
      showToast('Erro ao sair do espaço.');
      console.error(err);
    }
  });

  els.inviteAcceptCloseX?.addEventListener('click', () => els.inviteAcceptDialog.close());
  els.inviteLaterBtn?.addEventListener('click', () => {
    clearInviteUrlParam();
    state.pendingInviteToken = null;
    els.inviteAcceptDialog.close();
  });
  els.inviteSwitchAccountBtn?.addEventListener('click', async () => {
    els.inviteAcceptDialog.close();
    await logout();
  });
  els.inviteConfirmBtn?.addEventListener('click', async () => {
    const inv = state.pendingInviteData;
    if (!inv || !state.user) return;
    try {
      await acceptInviteAtomic(state.user, inv);
      if (!state.meusEspacos.some((e) => e.id === inv.wsId)) {
        state.meusEspacos.push({ id: inv.wsId, nome: inv.wsNome, papel: inv.papel });
      }
      clearInviteUrlParam();
      state.pendingInviteToken = null;
      state.pendingInviteData = null;
      els.inviteAcceptDialog.close();
      await activateWorkspaceContext(inv.wsId, true);
      showToast(`Você entrou no espaço "${inv.wsNome}"!`);
    } catch (err) {
      showToast('Não foi possível aceitar o convite.');
      console.error(err);
    }
  });

  // Economia de cota Spark e reconexão automática após longa inatividade / fim de semana
  let lastHiddenAt = 0;
  const safeReloadAfterLongIdle = () => {
    try {
      const lastReload = Number(sessionStorage.getItem('pauta_last_idle_reload') || 0);
      if (Date.now() - lastReload < 15000) return false;
      sessionStorage.setItem('pauta_last_idle_reload', String(Date.now()));
    } catch {}
    window.location.reload();
    return true;
  };

  const resumeConnectionIfNeeded = async () => {
    if (state.hiddenTabTimer) {
      clearTimeout(state.hiddenTabTimer);
      state.hiddenTabTimer = null;
    }
    if (!state.user || !state.activeWsId) return;

    const hiddenDurationMs = lastHiddenAt ? Date.now() - lastHiddenAt : 0;
    lastHiddenAt = 0;

    // Se ficou > 2 horas parado (ex.: fim de semana), recarrega de forma limpa
    if (hiddenDurationMs > 2 * 60 * 60 * 1000) {
      if (safeReloadAfterLongIdle()) return;
    }

    // Se ficou > 10 min parado/suspenso, renova token e reabre o listener
    if (hiddenDurationMs > 10 * 60 * 1000) {
      try {
        await state.user.getIdToken?.(true);
      } catch {
        safeReloadAfterLongIdle();
        return;
      }
      startWorkspaceDemandsSubscription();
    } else if (!state.unsubscribeDemandas) {
      startWorkspaceDemandsSubscription();
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      lastHiddenAt = Date.now();
      if (state.hiddenTabTimer) clearTimeout(state.hiddenTabTimer);
      state.hiddenTabTimer = setTimeout(() => {
        if (state.unsubscribeDemandas) {
          state.unsubscribeDemandas();
          state.unsubscribeDemandas = null;
        }
      }, 5 * 60 * 1000);
    } else {
      resumeConnectionIfNeeded();
    }
  });

  window.addEventListener('focus', resumeConnectionIfNeeded);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) resumeConnectionIfNeeded();
  });
  window.addEventListener('online', resumeConnectionIfNeeded);

  // Captura parâmetros de URL antes do login para retomar após autenticar
  const pendingStudentLink = captureStudentUrlParam();
  const pendingWorkLink = captureWorkUrlParam();
  let pendingDirectDemand = captureDirectDemandUrlParams();

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
      state.activeWsId = null;
      state.activeWorkspace = null;
      state.meusEspacos = [];
      state.workspaceMembers = [];
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
      els.modesBtn?.classList.add('hidden');
      els.unifiedInviteBanner?.classList.add('hidden');
      return;
    }

    els.authView.classList.add('hidden');
    els.appView.classList.remove('hidden');
    els.userMenu.classList.remove('hidden');
    els.settingsBtn.classList.remove('hidden');
    els.morningBtn.classList.remove('hidden');
    els.metricsBtn.classList.remove('hidden');
    els.modesBtn?.classList.remove('hidden');

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

    // Etapa 1: garante perfil, espaço "Pessoal" e migração idempotente V2
    try {
      const wsSetup = await ensureUserAndPersonalWorkspace(user);
      state.meusEspacos = wsSetup.meusEspacos;
      state.activeWsId = wsSetup.espacoAtivo;

      // Sincroniza Modos (Estudante e Corporativo) com o Firestore (Firestore vence localStorage)
      const stuCfg = syncStudentConfigFromProfile(wsSetup.profile);
      const corpCfg = syncCorpConfigFromProfile(wsSetup.profile);
      await syncStudentModeLifecycle();
      await syncCorporativoModeLifecycle();

      const wantsStudent = pendingStudentLink || captureStudentUrlParam();
      const wantsWork = pendingWorkLink || captureWorkUrlParam();
      if (wantsStudent && wantsWork) {
        clearStudentUrlParam();
        clearWorkUrlParam();
        openModesDialog();
      } else if (wantsWork) {
        clearWorkUrlParam();
        if (!corpCfg.ativo) openCorpActivateDialog();
      } else if (wantsStudent) {
        clearStudentUrlParam();
        if (!stuCfg.ativo) openStudentActivateDialog();
      } else if (
        !stuCfg.ativo &&
        !corpCfg.ativo &&
        !isUnifiedInviteDismissed() &&
        sessionStorage.getItem('pauta_unified_invite_shown') !== '1'
      ) {
        sessionStorage.setItem('pauta_unified_invite_shown', '1');
        els.unifiedInviteBanner?.classList.remove('hidden');
      }

      if (!wsSetup.profile.migradoV2) {
        const legacyDocs = await checkLegacyDemandsCount(user.uid);
        if (legacyDocs.length > 0) {
          els.migrationProgress.value = 0;
          els.migrationStatusText.textContent = `Copiando ${legacyDocs.length} demanda(s) para seu espaço Pessoal...`;
          els.migrationCloseBtn.classList.add('hidden');
          els.migrationDeleteLegacyBtn.classList.add('hidden');
          els.migrationDialog.showModal();

          const resMig = await migrateLegacyDemands(user, wsSetup.espacoAtivo, (pct, done, total) => {
            els.migrationProgress.value = pct;
            els.migrationStatusText.textContent = `Copiadas ${done} de ${total} demandas (${pct}%)...`;
          });

          if (resMig.verified) {
            state.hasLegacyDemands = true;
            els.migrationStatusText.textContent = `Migração concluída com sucesso! ${resMig.migrated} demanda(s) conferida(s).`;
            els.migrationDeleteLegacyBtn.classList.remove('hidden');
          } else {
            els.migrationStatusText.textContent = 'Algumas demandas não puderam ser conferidas. Tente recarregar.';
          }
          els.migrationCloseBtn.classList.remove('hidden');
        } else {
          await migrateLegacyDemands(user, wsSetup.espacoAtivo);
        }
      } else {
        const legacyDocs = await checkLegacyDemandsCount(user.uid);
        state.hasLegacyDemands = legacyDocs.length > 0;
      }
    } catch (err) {
      showToast('Erro ao inicializar seu espaço de trabalho.');
      console.error(err);
      return;
    }

    // Etapa C1: se veio por link direto (?espaco=WSID&demanda=ID), busca apenas 1 documento
    if (pendingDirectDemand) {
      const target = pendingDirectDemand;
      pendingDirectDemand = null;
      clearDirectDemandUrlParams();
      try {
        const { fetchSingleDemandByLink } = await import('./corporativo/links.js?v=1');
        const resLink = await fetchSingleDemandByLink(target.wsId, target.demandaId);
        if (resLink.ok) {
          await activateWorkspaceContext(target.wsId, true);
          openEditDialog(resLink.demanda);
        } else {
          await activateWorkspaceContext(state.activeWsId, false);
          showToast(resLink.message, 6000);
        }
      } catch {
        await activateWorkspaceContext(state.activeWsId, false);
        showToast('Não foi possível abrir o link da demanda.');
      }
    } else {
      await activateWorkspaceContext(state.activeWsId, false);
    }

    if (state.pendingInviteToken) {
      await handlePendingInviteToken(state.pendingInviteToken);
    } else {
      await checkPendingEmailInvites();
    }
  });
}

init();
