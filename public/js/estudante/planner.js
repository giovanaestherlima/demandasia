// ============================================================================
// Etapa E2: Planner Imprimível / Exportável em PDF (sem bibliotecas)
// Ponto de extensão futuro: para download direto de PDF via biblioteca (ex: jsPDF),
// basta consumir `buildPlannerPrintHtml(...)` ou os dados preparados abaixo.
// ============================================================================

import { DIAS_SEMANA } from './disciplinas.js?v=5';

const LS_PLANNER_OPTS = 'pauta_planner_opts';

export const DEFAULT_PLANNER_OPTS = {
  layout: 'semanal', // 'semanal' | 'diario' | 'mensal' | 'provas' | 'pacote'
  periodo: 'semana_atual', // 'semana_atual' | 'mes_atual' | 'proximas_2_semanas'
  tamanho: 'A4', // 'A4' | 'A5' | 'letter'
  orientacao: 'portrait', // 'portrait' | 'landscape'
  modoCor: 'colorido', // 'colorido' | 'pb'
  margemEncadernacao: 'nenhuma', // 'nenhuma' | 'esquerda' | 'topo'
  incluirConcluidas: false,
  soMinhas: false,
  folhaNotas: 'pautada', // 'pautada' | 'quadriculada' | 'pontilhada' | 'branco'
  habitos: 'Água, Sono, Exercício, Leitura',
  horaInicio: 7,
  horaFim: 21,
  capaNome: '',
  capaCurso: '',
  capaInstituicao: '',
  capaSemestre: '',
  capaFrase: 'Um passo de cada vez.'
};

export function loadPlannerOpts() {
  try {
    const raw = localStorage.getItem(LS_PLANNER_OPTS);
    return raw ? { ...DEFAULT_PLANNER_OPTS, ...JSON.parse(raw) } : { ...DEFAULT_PLANNER_OPTS };
  } catch {
    return { ...DEFAULT_PLANNER_OPTS };
  }
}

export function savePlannerOpts(opts) {
  try {
    localStorage.setItem(LS_PLANNER_OPTS, JSON.stringify(opts));
  } catch {
    // Ignora
  }
}

function formatISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekDates(baseDate = new Date()) {
  const start = new Date(baseDate);
  start.setDate(start.getDate() - start.getDay()); // Domingo
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

function escapeElText(parent, tag, text, className = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function buildTaskNode(d, discMap, isBW) {
  const box = document.createElement('div');
  box.className = 'planner-task-item';
  const disc = d.disciplinaId ? discMap.get(d.disciplinaId) : null;
  if (!isBW && disc?.cor) {
    box.style.borderLeftColor = disc.cor;
  }
  const check = d.status === 'concluida' ? '☑' : '☐';
  const tipoLbl = d.tipo ? `[${d.tipo.toUpperCase()}] ` : '';
  const discLbl = disc ? `${disc.nome} • ` : '';
  const tituloCurto = d.titulo.length > 52 ? `${d.titulo.slice(0, 49)}...` : d.titulo;

  escapeElText(box, 'div', `${check} ${tipoLbl}${tituloCurto}`);
  if (discLbl || d.prioridade === 'urgente') {
    escapeElText(box, 'div', `${discLbl}${d.prioridade === 'urgente' ? 'Urgente' : ''}`.trim()).style.opacity = '0.75';
  }

  if (Array.isArray(d.subtarefas) && d.subtarefas.length > 0) {
    for (const sub of d.subtarefas.slice(0, 4)) {
      escapeElText(box, 'div', `  ${sub.concluida ? '☑' : '☐'} ${sub.texto}`).style.fontSize = '0.68rem';
    }
  }
  return box;
}

function buildFooter(pageEl, opts, periodoLabel, pageNum) {
  const footer = document.createElement('div');
  footer.className = 'planner-footer';
  escapeElText(footer, 'span', `Pauta Planner • ${opts.capaNome || 'Estudos'} • ${periodoLabel}`);
  escapeElText(footer, 'span', `Pág. ${pageNum}`);
  pageEl.appendChild(footer);
}

/**
 * Atualiza a regra @page dinâmica para tamanho, orientação e margem de encadernação.
 */
export function applyPlannerPageCss(opts) {
  let styleEl = document.getElementById('planner-page-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'planner-page-style';
    document.head.appendChild(styleEl);
  }
  const mLeft = opts.margemEncadernacao === 'esquerda' ? '22mm' : '12mm';
  const mTop = opts.margemEncadernacao === 'topo' ? '22mm' : '12mm';
  const sizeStr = `${opts.tamanho || 'A4'} ${opts.orientacao || 'portrait'}`;
  const fontScale = opts.tamanho === 'A5' ? '11px' : '12px';

  styleEl.textContent = `
    @page { size: ${sizeStr}; margin: ${mTop} 12mm 12mm ${mLeft}; }
    @media print { .planner-preview-sheet { font-size: ${fontScale}; } }
  `;
}

/**
 * Renderiza a prévia completa do Planner dentro de `container` (zero leituras extras).
 */
export function renderPlannerPreview(container, { demandas, disciplinas, grade, uid, opts }) {
  container.replaceChildren();
  const isBW = opts.modoCor === 'pb';
  container.classList.toggle('is-bw', isBW);

  const discMap = new Map(disciplinas.map((d) => [d.id, d]));
  const filtradas = demandas.filter((d) => {
    if (!opts.incluirConcluidas && d.status === 'concluida') return false;
    if (opts.soMinhas && d.responsavelUid && d.responsavelUid !== uid) return false;
    return true;
  });

  let pageNum = 1;
  const hoje = new Date();
  const habitosList = String(opts.habitos || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const addCover = () => {
    const page = document.createElement('div');
    page.className = 'planner-page';
    const cover = document.createElement('div');
    cover.className = 'planner-cover';
    escapeElText(cover, 'h2', opts.capaNome || 'Meu Planner de Estudos');
    if (opts.capaCurso || opts.capaInstituicao) {
      escapeElText(cover, 'p', `${opts.capaCurso}${opts.capaInstituicao ? ` • ${opts.capaInstituicao}` : ''}`);
    }
    if (opts.capaSemestre) escapeElText(cover, 'p', opts.capaSemestre);
    if (opts.capaFrase) escapeElText(cover, 'p', `"${opts.capaFrase}"`).style.fontStyle = 'italic';
    page.appendChild(cover);
    buildFooter(page, opts, 'Capa', pageNum++);
    container.appendChild(page);
  };

  const addWeeklyPage = (weekBaseDate) => {
    const page = document.createElement('div');
    page.className = 'planner-page';
    const weekDays = getWeekDates(weekBaseDate);
    const label = `${weekDays[0].toLocaleDateString('pt-BR')} – ${weekDays[6].toLocaleDateString('pt-BR')}`;

    escapeElText(page, 'h3', `Planner Semanal (${label})`);

    const grid = document.createElement('div');
    grid.className = 'planner-week-grid';
    for (const dayDate of weekDays) {
      const iso = formatISO(dayDate);
      const col = document.createElement('div');
      col.className = 'planner-day-col';
      escapeElText(
        col,
        'div',
        `${DIAS_SEMANA[dayDate.getDay()].slice(0, 3)} ${dayDate.getDate()}/${dayDate.getMonth() + 1}`,
        'planner-day-header'
      );

      // Aulas da grade nesse dia
      const aulasDia = grade
        .filter((a) => Number(a.diaSemana) === dayDate.getDay())
        .sort((a, b) => (a.inicio || '').localeCompare(b.inicio || ''));
      for (const aula of aulasDia) {
        const disc = discMap.get(aula.disciplinaId);
        const aEl = escapeElText(col, 'div', `${aula.inicio} ${disc?.nome || 'Aula'}`);
        aEl.style.fontSize = '0.68rem';
        aEl.style.color = '#475569';
      }

      const dayTasks = filtradas.filter((d) => d.prazo === iso);
      for (const task of dayTasks.slice(0, 5)) {
        col.appendChild(buildTaskNode(task, discMap, isBW));
      }
      if (dayTasks.length > 5) {
        escapeElText(col, 'div', `+${dayTasks.length - 5} demandas adicionais`).style.fontSize = '0.68rem';
      }
      grid.appendChild(col);
    }
    page.appendChild(grid);

    if (habitosList.length > 0) {
      const habBox = document.createElement('div');
      habBox.style.fontSize = '0.76rem';
      escapeElText(habBox, 'strong', 'Hábitos da semana: ');
      habBox.appendChild(document.createTextNode(habitosList.map((h) => `${h}: ☐☐☐☐☐☐☐`).join('  |  ')));
      page.appendChild(habBox);
    }

    const notes = document.createElement('div');
    notes.className = `planner-notes-box is-${opts.folhaNotas || 'pautada'}`;
    escapeElText(notes, 'div', 'Prioridades da semana & Anotações').style.fontSize = '0.74rem';
    page.appendChild(notes);

    buildFooter(page, opts, label, pageNum++);
    container.appendChild(page);
  };

  const addDailyPage = () => {
    const page = document.createElement('div');
    page.className = 'planner-page';
    const hojeISO = formatISO(hoje);
    escapeElText(page, 'h3', `Planner Diário — ${hoje.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}`);

    const doDia = filtradas.filter((d) => d.prazo === hojeISO || !d.prazo).slice(0, 8);
    const prios = filtradas.filter((d) => d.prioridade === 'urgente' || d.prioridade === 'alta').slice(0, 3);
    const prioBox = document.createElement('div');
    escapeElText(prioBox, 'strong', '3 Prioridades do dia:').style.fontSize = '0.82rem';
    for (const p of prios) prioBox.appendChild(buildTaskNode(p, discMap, isBW));
    page.appendChild(prioBox);

    const hours = document.createElement('div');
    hours.style.fontSize = '0.74rem';
    for (let h = Number(opts.horaInicio || 7); h <= Number(opts.horaFim || 21); h += 2) {
      const aulasH = grade.filter((a) => Number(a.diaSemana) === hoje.getDay() && Number((a.inicio || '00').slice(0, 2)) === h);
      const aulaTxt = aulasH.map((a) => discMap.get(a.disciplinaId)?.nome || 'Aula').join(', ');
      escapeElText(hours, 'div', `${String(h).padStart(2, '0')}:00 — ${aulaTxt || '______________________________'}`);
    }
    page.appendChild(hours);

    for (const t of doDia) page.appendChild(buildTaskNode(t, discMap, isBW));
    const notes = document.createElement('div');
    notes.className = `planner-notes-box is-${opts.folhaNotas || 'pautada'}`;
    page.appendChild(notes);

    buildFooter(page, opts, hojeISO, pageNum++);
    container.appendChild(page);
  };

  const addMonthlyPage = () => {
    const page = document.createElement('div');
    page.className = 'planner-page';
    const mesNome = hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    escapeElText(page, 'h3', `Calendário Mensal — ${mesNome}`);

    const grid = document.createElement('div');
    grid.className = 'planner-month-grid';
    const year = hoje.getFullYear();
    const month = hoje.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const cell = document.createElement('div');
      cell.className = 'planner-month-cell';
      escapeElText(cell, 'strong', String(day));
      const items = filtradas.filter((d) => d.prazo === iso);
      for (const it of items.slice(0, 2)) {
        const line = escapeElText(cell, 'div', `• ${it.titulo.slice(0, 18)}`);
        const disc = it.disciplinaId ? discMap.get(it.disciplinaId) : null;
        if (!isBW && disc?.cor) line.style.color = disc.cor;
      }
      if (items.length > 2) escapeElText(cell, 'div', `+${items.length - 2}`);
      grid.appendChild(cell);
    }
    page.appendChild(grid);
    buildFooter(page, opts, mesNome, pageNum++);
    container.appendChild(page);
  };

  const addExamsPage = () => {
    const page = document.createElement('div');
    page.className = 'planner-page';
    escapeElText(page, 'h3', 'Semana de Provas e Trabalhos');
    const provas = filtradas
      .filter((d) => d.tipo === 'prova' || d.tipo === 'trabalho' || d.tipo === 'seminario')
      .sort((a, b) => (a.prazo || '9999').localeCompare(b.prazo || '9999'));

    if (provas.length === 0) {
      escapeElText(page, 'p', 'Nenhuma prova ou trabalho cadastrado para o período.');
    } else {
      for (const p of provas) {
        const node = buildTaskNode(p, discMap, isBW);
        if (p.prazo) {
          const diff = Math.ceil((new Date(`${p.prazo}T12:00:00`) - hoje) / (1000 * 60 * 60 * 24));
          escapeElText(node, 'div', diff >= 0 ? `Faltam ${diff} dia(s) (${p.prazo})` : `Prazo: ${p.prazo}`).style.fontWeight = '600';
        }
        page.appendChild(node);
      }
    }
    buildFooter(page, opts, 'Semana de Provas', pageNum++);
    container.appendChild(page);
  };

  if (opts.layout === 'pacote') {
    addCover();
    addMonthlyPage();
    addWeeklyPage(hoje);
    const nextWeek = new Date(hoje);
    nextWeek.setDate(nextWeek.getDate() + 7);
    addWeeklyPage(nextWeek);
  } else if (opts.layout === 'diario') {
    addDailyPage();
  } else if (opts.layout === 'mensal') {
    addMonthlyPage();
  } else if (opts.layout === 'provas') {
    addExamsPage();
  } else {
    addWeeklyPage(hoje);
  }
}
