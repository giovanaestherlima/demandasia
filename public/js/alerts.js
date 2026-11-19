// ============================================================================
// Lógica de Alertas, Soneca, Horário de Silêncio, Bom Dia e Lembretes Locais
// ============================================================================

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function toDate(ts) {
  if (!ts) return new Date();
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

export function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getDaysOpen(demanda) {
  const created = toDate(demanda.criadoEm);
  const diff = Date.now() - created.getTime();
  return Math.max(0, Math.floor(diff / MS_PER_DAY));
}

export function isSnoozed(demanda) {
  if (!demanda.adiadoAte || demanda.status === 'concluida') return false;
  return demanda.adiadoAte > todayLocalISO();
}

export function isOverdue(demanda) {
  if (!demanda.prazo || demanda.status === 'concluida') return false;
  return demanda.prazo < todayLocalISO();
}

export function isDueToday(demanda) {
  if (!demanda.prazo || demanda.status === 'concluida') return false;
  return demanda.prazo === todayLocalISO();
}

export function getUrgencyLevel(demanda, prefs) {
  if (demanda.status === 'concluida' || isSnoozed(demanda)) return 'normal';
  if (isOverdue(demanda)) return 'critical';

  const dias = getDaysOpen(demanda);
  if (dias >= (prefs.diasAvisoVermelho ?? 14)) return 'critical';
  if (dias >= (prefs.diasAvisoLaranja ?? 7)) return 'attention';
  if (dias >= (prefs.diasAvisoAmarelo ?? 3)) return 'warn';
  return 'normal';
}

export function getPendingOldestFirst(demandas) {
  return demandas
    .filter((d) => d.status !== 'concluida')
    .sort((a, b) => toDate(a.criadoEm).getTime() - toDate(b.criadoEm).getTime());
}

export function buildSummaryMessage(demandas) {
  const pendentes = getPendingOldestFirst(demandas).filter((d) => !isSnoozed(d));
  if (pendentes.length === 0) {
    return {
      text: 'Você não tem demandas pendentes ativas no momento. Tudo em ordem.',
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
 * Monta o resumo diário "Bom dia" (vence hoje, atrasadas e mais antiga).
 */
export function buildMorningSummary(demandas) {
  const pendentes = getPendingOldestFirst(demandas).filter((d) => !isSnoozed(d));
  const hoje = pendentes.filter(isDueToday);
  const atrasadas = pendentes.filter(isOverdue);
  const maisAntiga = pendentes[0] || null;

  const partes = [];
  if (pendentes.length === 0) {
    partes.push('Olá! Nenhuma pendência ativa no momento. Respire tranquilo.');
  } else {
    partes.push(`Olá! Você tem ${pendentes.length} pendência(s) ativa(s).`);
    if (hoje.length > 0) {
      partes.push(`${hoje.length} vence(m) hoje.`);
    }
    if (atrasadas.length > 0) {
      partes.push(`${atrasadas.length} está(ão) atrasada(s).`);
    }
    if (maisAntiga) {
      const dias = getDaysOpen(maisAntiga);
      partes.push(`A mais antiga é "${maisAntiga.titulo}" (há ${dias} dia${dias === 1 ? '' : 's'}).`);
    }
  }

  return {
    text: partes.join(' '),
    pendentes,
    hoje,
    atrasadas,
    maisAntiga
  };
}

export function isInQuietHours(prefs) {
  const inicio = prefs.horarioSilencioInicio;
  const fim = prefs.horarioSilencioFim;
  if (!inicio || !fim) return false;

  const agora = new Date();
  const hhmm = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;

  if (inicio <= fim) {
    return hhmm >= inicio && hhmm < fim;
  }
  // Atravessa a meia-noite (ex: 22:00 até 08:00)
  return hhmm >= inicio || hhmm < fim;
}

export async function requestBrowserNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}

/**
 * Gerenciador de lembretes locais com respeito à soneca, horário de silêncio e limite/hora.
 */
export function createReminderScheduler(getDemandas, getPrefs, onInAppReminder) {
  let timerId = null;
  let sentTimestamps = [];

  function trigger() {
    const prefs = getPrefs();
    if (isInQuietHours(prefs)) return;

    const umaHoraAtras = Date.now() - 60 * 60 * 1000;
    sentTimestamps = sentTimestamps.filter((ts) => ts > umaHoraAtras);
    const limite = Math.max(1, Number(prefs.limiteLembretesHora || 4));
    if (sentTimestamps.length >= limite) return;

    const demandas = getDemandas();
    const { text, pendingCount } = buildSummaryMessage(demandas);
    if (pendingCount === 0) return;

    const attentionItems = getPendingOldestFirst(demandas).filter(
      (d) => getUrgencyLevel(d, prefs) !== 'normal'
    );

    const mensagem = attentionItems.length > 0
      ? `Lembrete Pauta: ${attentionItems.length} demanda(s) pedindo atenção. ${text}`
      : `Lembrete Pauta: ${text}`;

    sentTimestamps.push(Date.now());
    onInAppReminder?.(mensagem);

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Pauta — Lembrete de Demandas', { body: mensagem });
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
