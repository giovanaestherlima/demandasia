// ============================================================================
// Lógica de Alertas, Criticidade, Resumo e Lembretes Periódicos
// ============================================================================

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Converte timestamp do Firestore ou Date para Date JS.
 * @param {any} ts
 * @returns {Date}
 */
export function toDate(ts) {
  if (!ts) return new Date();
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

/**
 * Calcula há quantos dias a demanda foi criada.
 * @param {object} demanda
 * @returns {number}
 */
export function getDaysOpen(demanda) {
  const created = toDate(demanda.criadoEm);
  const diff = Date.now() - created.getTime();
  return Math.max(0, Math.floor(diff / MS_PER_DAY));
}

/**
 * Verifica se a demanda pendente está com o prazo vencido.
 * @param {object} demanda
 * @returns {boolean}
 */
export function isOverdue(demanda) {
  if (!demanda.prazo || demanda.status === 'concluida') return false;
  const hojeISO = new Date().toISOString().slice(0, 10);
  return demanda.prazo < hojeISO;
}

/**
 * Determina o nível de alerta de uma demanda pendente:
 * 'critical' (vermelho), 'attention' (laranja), 'warn' (amarelo) ou 'normal'.
 * @param {object} demanda
 * @param {object} prefs
 */
export function getUrgencyLevel(demanda, prefs) {
  if (demanda.status === 'concluida') return 'normal';
  if (isOverdue(demanda)) return 'critical';

  const dias = getDaysOpen(demanda);
  if (dias >= (prefs.diasAvisoVermelho ?? 14)) return 'critical';
  if (dias >= (prefs.diasAvisoLaranja ?? 7)) return 'attention';
  if (dias >= (prefs.diasAvisoAmarelo ?? 3)) return 'warn';
  return 'normal';
}

/**
 * Retorna as demandas pendentes (inclui 'pendente' e 'em_andamento') ordenadas da mais antiga para a mais nova.
 * @param {Array<object>} demandas
 */
export function getPendingOldestFirst(demandas) {
  return demandas
    .filter((d) => d.status !== 'concluida')
    .sort((a, b) => toDate(a.criadoEm).getTime() - toDate(b.criadoEm).getTime());
}

/**
 * Gera o texto do resumo de abertura para exibição e leitura falada.
 * @param {Array<object>} demandas
 * @returns {{ text: string, pendingCount: number, oldest: object | null }}
 */
export function buildSummaryMessage(demandas) {
  const pendentes = getPendingOldestFirst(demandas);
  if (pendentes.length === 0) {
    return {
      text: 'Você não tem demandas pendentes no momento. Tudo em ordem.',
      pendingCount: 0,
      oldest: null
    };
  }

  const oldest = pendentes[0];
  const dias = getDaysOpen(oldest);
  const pluralDemanda = pendentes.length === 1 ? 'demanda pendente' : 'demandas pendentes';
  const pluralDia = dias === 1 ? 'dia' : 'dias';

  return {
    text: `Você tem ${pendentes.length} ${pluralDemanda}. A mais antiga está aberta há ${dias} ${pluralDia}: ${oldest.titulo}.`,
    pendingCount: pendentes.length,
    oldest
  };
}

/**
 * Solicita permissão para notificações nativas do navegador.
 * @returns {Promise<NotificationPermission | 'unsupported'>}
 */
export async function requestBrowserNotificationPermission() {
  if (!('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') {
    return 'granted';
  }
  return Notification.requestPermission();
}

/**
 * Gerencia o timer de lembretes periódicos enquanto a aba estiver aberta.
 */
export function createReminderScheduler(getDemandas, getPrefs, onInAppReminder) {
  let timerId = null;

  function trigger() {
    const demandas = getDemandas();
    const prefs = getPrefs();
    const { text, pendingCount } = buildSummaryMessage(demandas);
    if (pendingCount === 0) return;

    const attentionItems = getPendingOldestFirst(demandas).filter(
      (d) => getUrgencyLevel(d, prefs) !== 'normal'
    );

    const mensagem = attentionItems.length > 0
      ? `Lembrete Pauta: ${attentionItems.length} demanda(s) pedindo atenção. ${text}`
      : `Lembrete Pauta: ${text}`;

    onInAppReminder?.(mensagem);

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Pauta — Lembrete de Demandas', {
        body: mensagem
      });
    }
  }

  function restart() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    const minutos = Math.max(1, Number(getPrefs().intervaloLembreteMinutos || 30));
    timerId = setInterval(trigger, minutos * 60 * 1000);
  }

  function stop() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  return { restart, stop };
}
