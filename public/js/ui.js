// ============================================================================
// Renderização da Interface (DOM seguro), Filtros, Subtarefas, Etiquetas e Toasts
// ============================================================================

import {
  buildSummaryMessage,
  getDaysOpen,
  getPendingOldestFirst,
  getUrgencyLevel,
  isDueToday,
  isOverdue,
  isSnoozed,
  toDate,
  todayLocalISO
} from './alerts.js?v=5';

const PESO_PRIORIDADE = {
  urgente: 4,
  alta: 3,
  media: 2,
  baixa: 1
};

const LABEL_PRIORIDADE = {
  urgente: 'Urgente',
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa'
};

const LABEL_RECORRENCIA = {
  diaria: 'Diária',
  semanal: 'Semanal',
  mensal: 'Mensal',
  dia_mes: 'Mensal (dia fixo)'
};

const TAG_PALETTE = [
  { bg: 'rgba(31, 111, 120, 0.14)', fg: 'var(--primary)' },
  { bg: 'rgba(240, 138, 60, 0.16)', fg: 'var(--attention-text)' },
  { bg: 'rgba(79, 157, 105, 0.16)', fg: 'var(--done-text)' },
  { bg: 'rgba(233, 180, 76, 0.18)', fg: 'var(--warn-text)' }
];

function getTagColors(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

export function applyTheme(tema) {
  if (tema === 'claro' || tema === 'escuro') {
    document.documentElement.dataset.theme = tema;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

export function formatDateBR(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatDaysLabel(dias) {
  if (dias === 0) return 'criada hoje';
  if (dias === 1) return 'há 1 dia';
  return `há ${dias} dias`;
}

function createBadge(texto, classeExtra = '') {
  const span = document.createElement('span');
  span.className = `badge ${classeExtra}`.trim();
  span.textContent = texto;
  return span;
}

export function renderLoadingSkeletons(container) {
  container.replaceChildren();
  for (let i = 0; i < 3; i += 1) {
    const card = document.createElement('div');
    card.className = 'skeleton-card';
    card.setAttribute('aria-hidden', 'true');
    const l1 = document.createElement('div');
    l1.className = 'skeleton-line';
    l1.style.width = '65%';
    const l2 = document.createElement('div');
    l2.className = 'skeleton-line';
    l2.style.width = '90%';
    const l3 = document.createElement('div');
    l3.className = 'skeleton-line';
    l3.style.width = '40%';
    card.append(l1, l2, l3);
    container.appendChild(card);
  }
}

export function renderAttentionPanel(demandas, prefs) {
  const toggleBtn = document.getElementById('attention-toggle-btn');
  const toggleLabel = document.getElementById('attention-toggle-label');
  const panel = document.getElementById('attention-panel');
  const summaryEl = document.getElementById('attention-summary');
  const listEl = document.getElementById('attention-list');

  const { text, pendingCount } = buildSummaryMessage(demandas);
  summaryEl.textContent = text;
  listEl.replaceChildren();

  if (pendingCount === 0) {
    toggleBtn?.classList.remove('is-critical');
    toggleBtn?.classList.add('is-calm');
    if (toggleLabel) toggleLabel.textContent = 'Atenção • Tudo em ordem';
    panel.classList.remove('is-critical');
    panel.classList.add('is-calm');
    listEl.classList.add('hidden');
    return;
  }

  toggleBtn?.classList.remove('is-calm');
  panel.classList.remove('is-calm');

  const pendentesAtivas = getPendingOldestFirst(demandas).filter((d) => !isSnoozed(d));
  const alertas = pendentesAtivas.filter((d) => getUrgencyLevel(d, prefs) !== 'normal');
  const hasCritical = alertas.some((d) => getUrgencyLevel(d, prefs) === 'critical');

  toggleBtn?.classList.toggle('is-critical', hasCritical);
  panel.classList.toggle('is-critical', hasCritical);
  if (toggleLabel) {
    toggleLabel.textContent = `Atenção • ${pendingCount} pendente${pendingCount > 1 ? 's' : ''}`;
  }

  const destaque = (alertas.length > 0 ? alertas : pendentesAtivas).slice(0, 4);
  listEl.classList.remove('hidden');

  for (const item of destaque) {
    const li = document.createElement('li');
    li.className = 'attention-item';

    const title = document.createElement('span');
    title.className = 'attention-item-title';
    title.textContent = item.titulo;

    const level = getUrgencyLevel(item, prefs);
    const dias = getDaysOpen(item);
    const badgeClass =
      level === 'critical'
        ? 'badge-critical'
        : level === 'attention'
          ? 'badge-attention'
          : level === 'warn'
            ? 'badge-warn'
            : '';

    const badgeText = isOverdue(item)
      ? `Vencida (${formatDateBR(item.prazo)})`
      : formatDaysLabel(dias);

    li.append(title, createBadge(badgeText, badgeClass));
    listEl.appendChild(li);
  }
}

function endOfWeekISO() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeSearchText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function buildSearchableDates(d) {
  const partes = [];
  if (d.prazo) {
    partes.push(d.prazo, formatDateBR(d.prazo));
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.prazo)) {
      const dtPrazo = new Date(`${d.prazo}T12:00:00`);
      partes.push(dtPrazo.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' }));
    }
  }
  const criado = toDate(d.criadoEm);
  partes.push(
    criado.toLocaleDateString('pt-BR'),
    criado.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })
  );
  if (d.adiadoAte) {
    partes.push(d.adiadoAte, formatDateBR(d.adiadoAte));
  }
  if (isOverdue(d)) partes.push('vencida atrasada');
  if (isDueToday(d)) partes.push('hoje');
  return partes.join(' ');
}

export function getDemandAssignees(d) {
  if (Array.isArray(d?.responsaveis) && d.responsaveis.length > 0) {
    return d.responsaveis.filter((r) => r && r.uid);
  }
  if (d?.responsavelUid) {
    return [{ uid: d.responsavelUid, nome: d.responsavelNome || 'Membro' }];
  }
  return [];
}

export function filterAndSortDemandas(demandas, { filter, search, sort, tag, assignee, currentUid }) {
  const termo = normalizeSearchText(String(search || '').trim());
  const hoje = todayLocalISO();
  const fimSemana = endOfWeekISO();

  const filtradas = demandas.filter((d) => {
    const isDone = d.status === 'concluida';
    if (filter === 'pendentes' && isDone) return false;
    if (filter === 'concluidas' && !isDone) return false;
    if (filter === 'hoje' && (isDone || !isDueToday(d))) return false;
    if (filter === 'semana' && (isDone || !d.prazo || d.prazo < hoje || d.prazo > fimSemana)) return false;
    if (filter === 'atrasadas' && (isDone || !isOverdue(d))) return false;
    if (filter === 'sem_prazo' && (isDone || Boolean(d.prazo))) return false;

    if (tag && !(d.etiquetas || []).includes(tag)) return false;

    const assignees = getDemandAssignees(d);
    if (assignee && assignee !== 'todos') {
      if (assignee === 'minhas') {
        if (!currentUid || !assignees.some((a) => a.uid === currentUid)) return false;
      } else if (assignee === 'sem_responsavel') {
        if (assignees.length > 0) return false;
      } else if (!assignees.some((a) => a.uid === assignee)) {
        return false;
      }
    }

    if (termo) {
      const tagsTxt = (d.etiquetas || []).join(' ');
      const prioLabel = LABEL_PRIORIDADE[d.prioridade] || '';
      const datasTxt = buildSearchableDates(d);
      const respTxt = assignees.map((a) => a.nome || '').join(' ');
      const reuniaoTxt = d.reuniaoTitulo ? `reuniao ${d.reuniaoTitulo}` : '';
      const alvo = normalizeSearchText(
        `${d.titulo} ${d.descricao} ${d.categoria || ''} ${respTxt} ${reuniaoTxt} ${d.prioridade || ''} ${prioLabel} ${tagsTxt} ${datasTxt}`
      );
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });

  filtradas.sort((a, b) => {
    if (sort === 'recentes') {
      return toDate(b.criadoEm).getTime() - toDate(a.criadoEm).getTime();
    }
    if (sort === 'prioridade') {
      const diff = (PESO_PRIORIDADE[b.prioridade] || 2) - (PESO_PRIORIDADE[a.prioridade] || 2);
      return diff !== 0 ? diff : toDate(a.criadoEm).getTime() - toDate(b.criadoEm).getTime();
    }
    if (sort === 'prazo') {
      if (!a.prazo && !b.prazo) return toDate(a.criadoEm).getTime() - toDate(b.criadoEm).getTime();
      if (!a.prazo) return 1;
      if (!b.prazo) return -1;
      return a.prazo.localeCompare(b.prazo);
    }
    return toDate(a.criadoEm).getTime() - toDate(b.criadoEm).getTime();
  });

  return filtradas;
}

export function renderTagFilterChips(container, demandas, activeTag, onSelectTag) {
  container.replaceChildren();
  const tags = new Set();
  for (const d of demandas) {
    for (const t of d.etiquetas || []) {
      tags.add(t);
    }
  }
  if (tags.size === 0) {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'tag-chip';
  allBtn.textContent = 'Todas etiquetas';
  allBtn.setAttribute('aria-pressed', String(!activeTag));
  allBtn.addEventListener('click', () => onSelectTag(null));
  container.appendChild(allBtn);

  for (const t of Array.from(tags).sort()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-chip';
    btn.textContent = `#${t}`;
    btn.setAttribute('aria-pressed', String(activeTag === t));
    btn.addEventListener('click', () => onSelectTag(activeTag === t ? null : t));
    container.appendChild(btn);
  }
}

export function renderDemandsList(container, demandas, prefs, handlers, options = {}) {
  container.replaceChildren();
  const readOnly = Boolean(options.readOnly ?? handlers?.readOnly);

  if (demandas.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-bottom:0.5rem;opacity:0.7;">
        <circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
      </svg>
    `;
    const msg = document.createElement('p');
    msg.textContent = 'Nenhuma pendência. Respire.';
    empty.appendChild(msg);
    container.appendChild(empty);
    return;
  }

  const closeAllMenus = () => {
    container.querySelectorAll('.demand-menu-popover:not(.hidden)').forEach((el) => {
      el.classList.add('hidden');
      const btn = el.previousElementSibling;
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
    container.querySelectorAll('.demand-card.has-open-menu').forEach((c) => {
      c.classList.remove('has-open-menu');
    });
  };
  if (!container.dataset.menuOutsideBound) {
    container.dataset.menuOutsideBound = '1';
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.demand-menu-wrap')) {
        document.querySelectorAll('.demand-menu-popover:not(.hidden)').forEach((el) => {
          el.classList.add('hidden');
          const btn = el.previousElementSibling;
          if (btn) btn.setAttribute('aria-expanded', 'false');
        });
        document.querySelectorAll('.demand-card.has-open-menu').forEach((c) => {
          c.classList.remove('has-open-menu');
        });
      }
    });
  }

  for (const d of demandas) {
    const isDone = d.status === 'concluida';
    const card = document.createElement('article');
    card.className = `demand-card ${isDone ? 'is-done' : ''}`.trim();
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if (e.target.closest('button, .demand-menu-wrap, a, input, select')) return;
      handlers.onEdit(d);
    });

    const top = document.createElement('div');
    top.className = 'demand-top';

    const checkWrap = document.createElement('div');
    checkWrap.className = 'demand-check-wrap';

    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = `check-btn ${isDone ? 'is-checked' : ''}`.trim();
    checkBtn.setAttribute('aria-label', isDone ? `Reabrir demanda ${d.titulo}` : `Concluir demanda ${d.titulo}`);
    checkBtn.setAttribute('aria-pressed', String(isDone));
    checkBtn.innerHTML = isDone
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
      : '';
    if (readOnly) {
      checkBtn.disabled = true;
      checkBtn.style.opacity = '0.55';
      checkBtn.style.cursor = 'default';
      checkBtn.title = 'Modo leitor: apenas visualização';
    } else {
      checkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.onToggleDone(d);
      });
    }

    const titleEl = document.createElement('h3');
    titleEl.className = 'demand-title';
    titleEl.textContent = d.titulo;

    checkWrap.append(checkBtn, titleEl);

    const actions = document.createElement('div');
    actions.className = 'demand-actions demand-menu-wrap';

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'btn btn-ghost btn-sm demand-menu-btn';
    menuBtn.setAttribute('aria-label', `Ações para ${d.titulo}`);
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';

    const popover = document.createElement('div');
    popover.className = 'demand-menu-popover hidden';
    popover.setAttribute('role', 'menu');

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = popover.classList.contains('hidden');
      closeAllMenus();
      if (willOpen) {
        popover.classList.remove('hidden');
        card.classList.add('has-open-menu');
        menuBtn.setAttribute('aria-expanded', 'true');
      }
    });

    if (!readOnly && !isDone) {
      const snoozeBtn = document.createElement('button');
      snoozeBtn.type = 'button';
      snoozeBtn.className = 'demand-menu-item';
      snoozeBtn.setAttribute('role', 'menuitem');
      snoozeBtn.textContent = 'Adiar';
      snoozeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllMenus();
        handlers.onSnooze(d);
      });
      popover.appendChild(snoozeBtn);
    }

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'demand-menu-item';
    editBtn.setAttribute('role', 'menuitem');
    editBtn.textContent = readOnly ? 'Ver / Comentar' : 'Editar';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllMenus();
      handlers.onEdit(d);
    });
    popover.appendChild(editBtn);

    if (!readOnly) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'demand-menu-item is-danger';
      delBtn.setAttribute('role', 'menuitem');
      delBtn.textContent = 'Excluir';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllMenus();
        handlers.onDelete(d);
      });
      popover.appendChild(delBtn);
    }

    actions.append(menuBtn, popover);
    top.append(checkWrap, actions);
    card.appendChild(top);

    if (d.descricao) {
      const desc = document.createElement('p');
      desc.className = 'demand-desc';
      desc.textContent = d.descricao;
      card.appendChild(desc);
    }

    // Barra de progresso das subtarefas
    const subs = Array.isArray(d.subtarefas) ? d.subtarefas : [];
    if (subs.length > 0) {
      const doneSubs = subs.filter((s) => s.concluida).length;
      const pct = Math.round((doneSubs / subs.length) * 100);
      const prog = document.createElement('div');
      prog.className = 'subtasks-progress';
      const track = document.createElement('div');
      track.className = 'progress-track';
      const fill = document.createElement('div');
      fill.className = 'progress-fill';
      fill.style.width = `${pct}%`;
      track.appendChild(fill);
      const lbl = document.createElement('span');
      lbl.textContent = `${doneSubs}/${subs.length} subtarefas`;
      prog.append(track, lbl);
      card.appendChild(prog);
    }

    const meta = document.createElement('div');
    meta.className = 'demand-meta';

    const prioClass =
      d.prioridade === 'urgente'
        ? 'badge-critical'
        : d.prioridade === 'alta'
          ? 'badge-attention'
          : d.prioridade === 'media'
            ? 'badge-primary'
            : '';
    meta.appendChild(createBadge(LABEL_PRIORIDADE[d.prioridade] || 'Média', prioClass));

    if (d.status === 'em_andamento') {
      meta.appendChild(createBadge('Em andamento', 'badge-primary'));
    }

    if (d.prazo) {
      const vencida = isOverdue(d);
      meta.appendChild(
        createBadge(
          vencida ? `Prazo vencido: ${formatDateBR(d.prazo)}` : `Prazo: ${formatDateBR(d.prazo)}`,
          vencida ? 'badge-critical' : ''
        )
      );
    }

    if (d.categoria) {
      meta.appendChild(createBadge(d.categoria));
    }

    for (const a of getDemandAssignees(d)) {
      meta.appendChild(createBadge(`👤 ${a.nome || 'Membro'}`, 'badge-tag'));
    }

    if (options.showMeetingChip && d.reuniaoId) {
      const mBtn = document.createElement('button');
      mBtn.type = 'button';
      mBtn.className = 'badge badge-primary';
      mBtn.style.cursor = 'pointer';
      mBtn.textContent = `Reunião: ${d.reuniaoTitulo || 'abrir'}`;
      mBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.onOpenMeeting?.(d.reuniaoId);
      });
      meta.appendChild(mBtn);
    }

    if (options.showCompletedBy && isDone && d.concluidoPorNome) {
      meta.appendChild(createBadge(`Concluída por ${d.concluidoPorNome}`));
    }

    if (d.recorrencia?.tipo) {
      meta.appendChild(createBadge(`↻ ${LABEL_RECORRENCIA[d.recorrencia.tipo] || 'Recorrente'}`, 'badge-primary'));
    }

    if (isSnoozed(d)) {
      meta.appendChild(createBadge(`Soneca até ${formatDateBR(d.adiadoAte)}`));
    }

    for (const tag of d.etiquetas || []) {
      const colors = getTagColors(tag);
      const tagBadge = createBadge(`#${tag}`);
      tagBadge.style.backgroundColor = colors.bg;
      tagBadge.style.color = colors.fg;
      meta.appendChild(tagBadge);
    }

    if (isDone) {
      meta.appendChild(createBadge('Concluída', 'badge-done'));
    } else {
      const dias = getDaysOpen(d);
      const level = getUrgencyLevel(d, prefs);
      const ageClass =
        level === 'critical'
          ? 'badge-critical'
          : level === 'attention'
            ? 'badge-attention'
            : level === 'warn'
              ? 'badge-warn'
              : '';
      meta.appendChild(createBadge(formatDaysLabel(dias), ageClass));
    }

    card.appendChild(meta);
    container.appendChild(card);
  }
}

/**
 * Exibe toast com botão opcional de "Desfazer" (~6 segundos).
 */
export function showToast(message, durationMs = 5000, onUndo = null) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');

  const span = document.createElement('span');
  span.textContent = message;

  const actions = document.createElement('div');
  actions.className = 'toast-actions';

  if (typeof onUndo === 'function') {
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'btn btn-primary btn-sm';
    undoBtn.textContent = 'Desfazer';
    undoBtn.addEventListener('click', () => {
      toast.remove();
      onUndo();
    });
    actions.appendChild(undoBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-ghost btn-sm';
  closeBtn.style.color = 'inherit';
  closeBtn.textContent = 'Fechar';
  closeBtn.addEventListener('click', () => toast.remove());
  actions.appendChild(closeBtn);

  toast.append(span, actions);
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.isConnected) toast.remove();
  }, durationMs);
}
