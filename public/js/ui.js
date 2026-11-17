// ============================================================================
// Renderização da Interface, Filtros, Busca, Tema e Notificações In-App
// ============================================================================

import {
  buildSummaryMessage,
  getDaysOpen,
  getPendingOldestFirst,
  getUrgencyLevel,
  isOverdue,
  toDate
} from './alerts.js';

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

/**
 * Aplica o tema ('sistema' | 'claro' | 'escuro') no elemento raiz.
 * @param {string} tema
 */
export function applyTheme(tema) {
  if (tema === 'claro' || tema === 'escuro') {
    document.documentElement.dataset.theme = tema;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

/**
 * Formata data ISO (YYYY-MM-DD) para DD/MM/AAAA.
 * @param {string} iso
 */
function formatDateBR(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Formata texto de idade da demanda ("hoje", "há 1 dia", "há X dias").
 * @param {number} dias
 */
function formatDaysLabel(dias) {
  if (dias === 0) return 'criada hoje';
  if (dias === 1) return 'há 1 dia';
  return `há ${dias} dias`;
}

/**
 * Cria um badge seguro (sem innerHTML).
 * @param {string} texto
 * @param {string} classeExtra
 */
function createBadge(texto, classeExtra = '') {
  const span = document.createElement('span');
  span.className = `badge ${classeExtra}`.trim();
  span.textContent = texto;
  return span;
}

/**
 * Renderiza o painel "Atenção" no topo com as demandas pendentes mais críticas/antigas.
 * @param {Array<object>} demandas
 * @param {object} prefs
 */
export function renderAttentionPanel(demandas, prefs) {
  const panel = document.getElementById('attention-panel');
  const summaryEl = document.getElementById('attention-summary');
  const listEl = document.getElementById('attention-list');

  const { text, pendingCount } = buildSummaryMessage(demandas);
  summaryEl.textContent = text;
  listEl.replaceChildren();

  if (pendingCount === 0) {
    panel.classList.remove('is-critical');
    panel.classList.add('is-calm');
    listEl.classList.add('hidden');
    return;
  }

  panel.classList.remove('is-calm');

  const pendentes = getPendingOldestFirst(demandas);
  const alertas = pendentes.filter((d) => getUrgencyLevel(d, prefs) !== 'normal');
  const hasCritical = alertas.some((d) => getUrgencyLevel(d, prefs) === 'critical');

  panel.classList.toggle('is-critical', hasCritical);

  const destaque = (alertas.length > 0 ? alertas : pendentes).slice(0, 4);
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

/**
 * Filtra e ordena a lista de demandas conforme os controles atuais.
 */
export function filterAndSortDemandas(demandas, { filter, search, sort }) {
  const termo = String(search || '').trim().toLowerCase();

  const filtradas = demandas.filter((d) => {
    if (filter === 'pendentes' && d.status === 'concluida') return false;
    if (filter === 'concluidas' && d.status !== 'concluida') return false;

    if (termo) {
      const alvo = `${d.titulo} ${d.descricao} ${d.categoria || ''}`.toLowerCase();
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
    // Padrão: mais antigas primeiro
    return toDate(a.criadoEm).getTime() - toDate(b.criadoEm).getTime();
  });

  return filtradas;
}

/**
 * Renderiza os cards de demandas na tela.
 */
export function renderDemandsList(container, demandas, prefs, handlers) {
  container.replaceChildren();

  if (demandas.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nenhuma demanda encontrada para este filtro.';
    container.appendChild(empty);
    return;
  }

  for (const d of demandas) {
    const isDone = d.status === 'concluida';
    const card = document.createElement('article');
    card.className = `demand-card ${isDone ? 'is-done' : ''}`.trim();

    // Linha superior: botão de concluir + título + ações
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
    checkBtn.addEventListener('click', () => handlers.onToggleDone(d));

    const titleEl = document.createElement('h3');
    titleEl.className = 'demand-title';
    titleEl.textContent = d.titulo;

    checkWrap.append(checkBtn, titleEl);

    const actions = document.createElement('div');
    actions.className = 'demand-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-ghost btn-sm';
    editBtn.textContent = 'Editar';
    editBtn.setAttribute('aria-label', `Editar demanda ${d.titulo}`);
    editBtn.addEventListener('click', () => handlers.onEdit(d));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-ghost btn-sm';
    delBtn.textContent = 'Excluir';
    delBtn.setAttribute('aria-label', `Excluir demanda ${d.titulo}`);
    delBtn.addEventListener('click', () => handlers.onDelete(d));

    actions.append(editBtn, delBtn);
    top.append(checkWrap, actions);
    card.appendChild(top);

    // Descrição resumida
    if (d.descricao) {
      const desc = document.createElement('p');
      desc.className = 'demand-desc';
      desc.textContent = d.descricao;
      card.appendChild(desc);
    }

    // Metadados (prioridade, prazo, categoria, idade)
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
 * Exibe uma notificação temporária (toast) na tela.
 * @param {string} message
 * @param {number} durationMs
 */
export function showToast(message, durationMs = 4500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');

  const span = document.createElement('span');
  span.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-ghost btn-sm';
  closeBtn.style.color = 'inherit';
  closeBtn.textContent = 'Fechar';
  closeBtn.addEventListener('click', () => toast.remove());

  toast.append(span, closeBtn);
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.isConnected) toast.remove();
  }, durationMs);
}
