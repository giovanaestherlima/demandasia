// ============================================================================
// Orquestrador de Interface do Modo Estudante (Etapas E1 a E5)
// Carregado exclusivamente via import() dinâmico quando modoEstudanteAtivo() === true.
// ============================================================================

import {
  CORES_DISCIPLINAS,
  DIAS_SEMANA,
  TIPOS_ACADEMICOS,
  computeWeightedGrade,
  createAulaGrade,
  createDisciplina,
  createSemestre,
  deleteAulaGrade,
  deleteDisciplina,
  detectDisciplineInText,
  loadAcademicData,
  toggleArchiveSemestre,
  updateDisciplina
} from './disciplinas.js?v=5';
import {
  applyPlannerPageCss,
  loadPlannerOpts,
  renderPlannerPreview,
  savePlannerOpts
} from './planner.js?v=5';
import {
  detectOverloadedDays,
  generateStudyPlanWithAI,
  loadFocusSessions,
  playGentleChime,
  renderStudySvgChart,
  saveFocusSession
} from './estudo.js?v=5';
import {
  exportToICS,
  extractDemandsFromImageWithAI,
  extractSyllabusWithAI
} from './captura.js?v=5';
import {
  buildTodayStudentData,
  generateStudentWeeklySummary,
  loadGentleGoals,
  saveGentleGoals
} from './hoje-bemestar.js?v=5';
import { moduloAtivo, saveStudentConfig, getStudentConfig } from '../modo-estudante.js?v=5';
import { createDemanda, updateDemanda } from '../db.js?v=5';
import { showToast } from '../ui.js?v=5';

const studentState = {
  semestres: [],
  disciplinas: [],
  grade: [],
  sessoes: [],
  activeSemestreId: 'geral',
  pomodoroTimer: null,
  pomodoroSeconds: 25 * 60,
  pomodoroMinutesTarget: 25,
  pomodoroRunning: false,
  pomodoroDemandId: null,
  pomodoroDiscId: null
};

let hostCtx = null;
let mountedRoot = null;

export function getStudentAcademicState() {
  return studentState;
}

/**
 * Desmonta completamente toda a interface de estudante ao desativar (sem recarregar).
 */
export function unmountStudentUI() {
  if (studentState.pomodoroTimer) {
    clearInterval(studentState.pomodoroTimer);
    studentState.pomodoroTimer = null;
  }
  document.querySelectorAll('.student-injected').forEach((el) => el.remove());
  mountedRoot = null;
}

/**
 * Inicializa e monta os recursos de estudante habilitados.
 */
export async function mountStudentUI(ctx) {
  hostCtx = ctx;
  unmountStudentUI();

  const wsId = ctx.getWsId();
  const user = ctx.getUser();
  if (!wsId || !user) return;

  // Carrega dados acadêmicos do espaço ativo
  try {
    const [acad, sessoes] = await Promise.all([
      (moduloAtivo('disciplinas') || moduloAtivo('notas') || moduloAtivo('planner'))
        ? loadAcademicData(wsId)
        : Promise.resolve({ semestres: [], disciplinas: [], grade: [] }),
      moduloAtivo('foco')
        ? loadFocusSessions(wsId, user.uid)
        : Promise.resolve([])
    ]);
    studentState.semestres = acad.semestres;
    studentState.disciplinas = acad.disciplinas;
    studentState.grade = acad.grade;
    studentState.sessoes = sessoes;
    const ativoSem = acad.semestres.find((s) => !s.arquivado);
    studentState.activeSemestreId = ativoSem ? ativoSem.id : 'geral';
  } catch (err) {
    console.warn('[Pauta Estudante] Falha ao carregar dados acadêmicos:', err);
  }

  injectSubbarButtons();
  injectPreviewAcademicFields();
  injectStudentDialogs();
  checkOverloadBanner();

  // Onboarding 3 passos na primeira ativação
  const cfg = getStudentConfig();
  if (!cfg.onboardingConcluido) {
    openOnboardingDialog();
  }
}

function createEl(tag, className = '', text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function injectSubbarButtons() {
  const subbar = document.querySelector('.header-subbar');
  if (!subbar) return;

  const addBtn = (id, label, onClick) => {
    const btn = createEl('button', 'subbar-pill student-injected', label);
    btn.type = 'button';
    btn.id = id;
    btn.addEventListener('click', onClick);
    subbar.appendChild(btn);
  };

  addBtn('stu-today-btn', 'Hoje', openTodayDialog);
  if (moduloAtivo('planner')) addBtn('stu-planner-btn', 'Planner PDF', openPlannerDialog);
  if (moduloAtivo('disciplinas') || moduloAtivo('notas')) addBtn('stu-disc-btn', 'Disciplinas', openDisciplinesDialog);
  if (moduloAtivo('foco')) addBtn('stu-focus-btn', 'Foco', openFocusDialog);
  if (moduloAtivo('captura')) addBtn('stu-capture-btn', 'Foto / Plano', openCaptureDialog);
  addBtn('stu-privacy-btn', 'Privacidade', openPrivacyDialog);
}

function injectPreviewAcademicFields() {
  if (!moduloAtivo('disciplinas')) return;
  const formBody = document.querySelector('#preview-form .dialog-body');
  if (!formBody) return;

  const wrap = createEl('div', 'form-grid-2 student-injected');
  wrap.id = 'stu-preview-fields';

  const fDisc = createEl('div', 'form-field');
  const lDisc = createEl('label', '', 'Disciplina');
  lDisc.htmlFor = 'stu-edit-disciplina';
  const sDisc = createEl('select', 'select-control');
  sDisc.id = 'stu-edit-disciplina';
  fDisc.append(lDisc, sDisc);

  const fTipo = createEl('div', 'form-field');
  const lTipo = createEl('label', '', 'Tipo acadêmico');
  lTipo.htmlFor = 'stu-edit-tipo';
  const sTipo = createEl('select', 'select-control');
  sTipo.id = 'stu-edit-tipo';
  const optEmpty = createEl('option', '', 'Geral');
  optEmpty.value = '';
  sTipo.appendChild(optEmpty);
  for (const t of TIPOS_ACADEMICOS) {
    const o = createEl('option', '', t.label);
    o.value = t.value;
    sTipo.appendChild(o);
  }
  sTipo.addEventListener('change', () => {
    if (sTipo.value === 'prova') {
      formatTitleAsExam();
    }
  });
  fTipo.append(lTipo, sTipo);

  wrap.append(fDisc, fTipo);
  formBody.insertBefore(wrap, formBody.children[3] || null);

  // Botão "Gerar plano de estudo (IA)" dentro da prévia/edição
  if (moduloAtivo('foco')) {
    const planBtn = createEl('button', 'btn btn-secondary btn-sm student-injected', 'Gerar plano de estudo (IA)');
    planBtn.type = 'button';
    planBtn.id = 'stu-gen-plan-btn';
    planBtn.addEventListener('click', async () => {
      const titulo = document.getElementById('edit-titulo').value.trim();
      if (!titulo) return;
      planBtn.disabled = true;
      planBtn.textContent = 'Gerando passos…';
      const passos = await generateStudyPlanWithAI({
        titulo,
        descricao: document.getElementById('edit-descricao').value,
        prazo: document.getElementById('edit-prazo').value
      });
      hostCtx.appendSubtasksToPreview?.(passos);
      planBtn.disabled = false;
      planBtn.textContent = 'Gerar plano de estudo (IA)';
      showToast(`${passos.length} passos de estudo adicionados! Revise antes de salvar.`);
    });
    formBody.appendChild(planBtn);
  }
}

function formatTitleAsExam() {
  const tituloEl = document.getElementById('edit-titulo');
  if (!tituloEl) return;
  const atual = tituloEl.value.trim();
  if (!atual) {
    tituloEl.value = 'Prova de ';
    return;
  }
  if (!/^prova\b/i.test(atual)) {
    const limpo = atual.replace(/^(?:fazer|estudar(?:\s+para)?|revisar)\s+/i, '').trim();
    tituloEl.value = `Prova de ${limpo}`.slice(0, 70);
  }
}

/**
 * Detecta automaticamente disciplina cadastrada e tipo acadêmico na fala/texto.
 */
export function autoDetectAcademicFields(texto) {
  const disc = detectDisciplineInText(texto, studentState.disciplinas);
  const lower = String(texto || '').toLowerCase();
  let tipo = null;
  if (/\b(prova|avalia[çc][ãa]o|exame|simulado)\b/.test(lower)) tipo = 'prova';
  else if (/\b(trabalho|projeto|redação|redacao)\b/.test(lower)) tipo = 'trabalho';
  else if (/\b(semin[áa]rio|apresenta[çc][ãa]o)\b/.test(lower)) tipo = 'seminario';
  else if (/\b(lista|exerc[íi]cios?)\b/.test(lower)) tipo = 'lista';
  else if (/\b(leitura|ler|cap[íi]tulo)\b/.test(lower)) tipo = 'leitura';

  return {
    disciplinaId: disc ? disc.id : null,
    tipo
  };
}

export function syncPreviewAcademicSelects(demanda) {
  const sDisc = document.getElementById('stu-edit-disciplina');
  const sTipo = document.getElementById('stu-edit-tipo');
  if (!sDisc || !sTipo) return;

  sDisc.replaceChildren();
  const noneOpt = createEl('option', '', 'Sem disciplina');
  noneOpt.value = '';
  sDisc.appendChild(noneOpt);
  for (const d of studentState.disciplinas) {
    const o = createEl('option', '', d.nome);
    o.value = d.id;
    sDisc.appendChild(o);
  }
  sDisc.value = demanda?.disciplinaId || '';
  sTipo.value = demanda?.tipo || '';
  if (sTipo.value === 'prova') {
    formatTitleAsExam();
  }
}

export function readPreviewAcademicFields() {
  const sDisc = document.getElementById('stu-edit-disciplina');
  const sTipo = document.getElementById('stu-edit-tipo');
  if (!sDisc || !sTipo) return {};
  return {
    disciplinaId: sDisc.value || null,
    semestreId: studentState.activeSemestreId || null,
    tipo: sTipo.value || null
  };
}

function checkOverloadBanner() {
  if (!moduloAtivo('foco')) return;
  const alertas = detectOverloadedDays(hostCtx.getDemandas());
  if (alertas.length > 0) {
    const primeiro = alertas[0];
    showToast(`Semana cheia em ${primeiro.data}: ${primeiro.count} entregas. Considere redistribuir.`, 6500);
  }
}

function injectStudentDialogs() {
  mountedRoot = createEl('div', 'student-injected');
  mountedRoot.id = 'student-dialogs-root';
  document.body.appendChild(mountedRoot);
}

function createModal(id, title) {
  const existing = document.getElementById(id);
  if (existing) existing.remove();

  const dlg = document.createElement('dialog');
  dlg.id = id;
  dlg.className = 'student-injected';
  dlg.setAttribute('aria-labelledby', `${id}-title`);

  const header = createEl('div', 'dialog-header');
  const h2 = createEl('h2', '', title);
  h2.id = `${id}-title`;
  const closeX = createEl('button', 'btn btn-ghost btn-sm', '✕');
  closeX.type = 'button';
  closeX.setAttribute('aria-label', 'Fechar');
  closeX.addEventListener('click', () => dlg.close());
  header.append(h2, closeX);

  const body = createEl('div', 'dialog-body');
  const footer = createEl('div', 'dialog-footer');

  dlg.append(header, body, footer);
  (mountedRoot || document.body).appendChild(dlg);
  return { dlg, body, footer };
}

// ----------------------------------------------------------------------------
// 1. Disciplinas, Semestres, Grade, Notas e Faltas (Etapas E1 & E3)
// ----------------------------------------------------------------------------
function openDisciplinesDialog() {
  const { dlg, body, footer } = createModal('stu-disc-dialog', 'Disciplinas, Grade, Notas e Faltas');

  const renderContent = () => {
    body.replaceChildren();
    const wsId = hostCtx.getWsId();

    // Semestres
    const semRow = createEl('div', 'form-grid-2');
    const semSel = createEl('select', 'select-control');
    const optGeral = createEl('option', '', 'Todos os semestres');
    optGeral.value = 'geral';
    semSel.appendChild(optGeral);
    for (const s of studentState.semestres) {
      const o = createEl('option', '', `${s.nome}${s.arquivado ? ' (arquivado)' : ''}`);
      o.value = s.id;
      semSel.appendChild(o);
    }
    semSel.value = studentState.activeSemestreId;
    semSel.addEventListener('change', () => {
      studentState.activeSemestreId = semSel.value;
      renderContent();
    });

    const newSemWrap = createEl('div');
    newSemWrap.style.display = 'flex';
    newSemWrap.style.gap = '0.35rem';
    const newSemInp = createEl('input', 'input-control');
    newSemInp.placeholder = 'Novo semestre (ex: 2026.2)';
    const newSemBtn = createEl('button', 'btn btn-secondary btn-sm', '+');
    newSemBtn.type = 'button';
    newSemBtn.addEventListener('click', async () => {
      if (!newSemInp.value.trim()) return;
      const criado = await createSemestre(wsId, newSemInp.value.trim());
      studentState.semestres.push(criado);
      studentState.activeSemestreId = criado.id;
      renderContent();
    });
    newSemWrap.append(newSemInp, newSemBtn);
    semRow.append(semSel, newSemWrap);
    body.appendChild(semRow);

    if (studentState.activeSemestreId !== 'geral') {
      const semObj = studentState.semestres.find((s) => s.id === studentState.activeSemestreId);
      if (semObj) {
        const archBtn = createEl('button', 'btn btn-ghost btn-sm', semObj.arquivado ? 'Desarquivar semestre' : 'Arquivar semestre');
        archBtn.type = 'button';
        archBtn.addEventListener('click', async () => {
          await toggleArchiveSemestre(wsId, semObj.id, !semObj.arquivado);
          semObj.arquivado = !semObj.arquivado;
          renderContent();
        });
        body.appendChild(archBtn);
      }
    }

    // Nova disciplina (com qtdProvas, média mínima e prova final)
    const formDisc = createEl('div', 'form-grid-2');
    const inpNome = createEl('input', 'input-control');
    inpNome.placeholder = 'Nome da disciplina';
    const inpProf = createEl('input', 'input-control');
    inpProf.placeholder = 'Professor / Sala (opcional)';
    const inpQtdProvas = createEl('input', 'input-control');
    inpQtdProvas.type = 'number';
    inpQtdProvas.min = '1';
    inpQtdProvas.max = '12';
    inpQtdProvas.placeholder = 'Qtd. de provas (ex: 4)';
    const inpNotaMin = createEl('input', 'input-control');
    inpNotaMin.type = 'number';
    inpNotaMin.step = '0.5';
    inpNotaMin.placeholder = 'Média p/ passar (padrão 7)';
    const inpFaltasMax = createEl('input', 'input-control');
    inpFaltasMax.type = 'number';
    inpFaltasMax.placeholder = 'Máx. faltas (opcional)';
    const selCor = createEl('select', 'select-control');
    CORES_DISCIPLINAS.forEach((c, i) => {
      const o = createEl('option', '', `Cor ${i + 1}`);
      o.value = c;
      selCor.appendChild(o);
    });
    const chkFinalLbl = createEl('label', 'switch-row');
    const chkFinal = createEl('input');
    chkFinal.type = 'checkbox';
    chkFinal.checked = true;
    chkFinalLbl.append(createEl('span', '', 'Tem prova final?'), chkFinal);

    const addDiscBtn = createEl('button', 'btn btn-primary btn-sm', 'Adicionar disciplina');
    addDiscBtn.type = 'button';
    addDiscBtn.addEventListener('click', async () => {
      if (!inpNome.value.trim()) return;
      const nova = await createDisciplina(wsId, {
        nome: inpNome.value.trim(),
        cor: selCor.value,
        professor: inpProf.value.trim(),
        qtdProvas: Number(inpQtdProvas.value) || 2,
        temFinal: chkFinal.checked,
        notaMinima: Number(inpNotaMin.value) || 7,
        faltasMax: Number(inpFaltasMax.value) || 0,
        semestreId: studentState.activeSemestreId
      });
      studentState.disciplinas.push(nova);
      renderContent();
    });
    formDisc.append(inpNome, inpProf, inpQtdProvas, inpNotaMin, inpFaltasMax, selCor);
    body.append(formDisc, chkFinalLbl, addDiscBtn);

    // Lista de disciplinas com Notas (provas + final) e Faltas
    const discsVisiveis = studentState.disciplinas.filter(
      (d) => studentState.activeSemestreId === 'geral' || d.semestreId === studentState.activeSemestreId
    );
    for (const d of discsVisiveis) {
      const card = createEl('div', 'demand-card');
      card.style.borderLeft = `5px solid ${d.cor || 'var(--primary)'}`;
      const title = createEl('strong', '', `${d.nome}${d.professor ? ` • ${d.professor}` : ''}`);
      card.appendChild(title);

      if (moduloAtivo('notas')) {
        const calc = computeWeightedGrade(d.avaliacoes, {
          notaMinima: d.notaMinima ?? 7,
          qtdProvas: d.qtdProvas ?? 2,
          temFinal: d.temFinal !== undefined ? d.temFinal : true,
          notaMinimaFinal: d.notaMinimaFinal ?? 5
        });

        let notaTxt = `Configurado: ${calc.qtdProvas} prova(s)${calc.temFinal ? ' + Final' : ''} (média ${d.notaMinima ?? 7}). Nenhuma nota lançada.`;
        if (calc.mediaAtual !== null) {
          notaTxt = `Média atual: ${calc.mediaAtual} (${calc.preenchidas}/${calc.qtdProvas} provas). `;
          if (calc.situacao === 'aprovado_direto') {
            notaTxt += 'Aprovado direto!';
          } else if (calc.faltamProvas > 0) {
            notaTxt += calc.precisaNasRestantes <= 10
              ? `Faltam ${calc.faltamProvas}: precisa de média ${calc.precisaNasRestantes} nas restantes para passar direto.`
              : `Faltam ${calc.faltamProvas}: média >10 para passar direto${calc.precisaNaFinal !== null ? ` (na final precisaria de ~${calc.precisaNaFinal})` : ''}.`;
          } else if (calc.situacao === 'vai_para_final') {
            notaTxt += `Vai para a Final: precisa tirar ${calc.precisaNaFinal} na prova final.`;
          } else {
            notaTxt += 'Abaixo da média configurada.';
          }
        }

        const notaRow = createEl('div', 'info-note', notaTxt);
        const addNotaBtn = createEl('button', 'btn btn-ghost btn-sm', '+ Lançar nota');
        addNotaBtn.type = 'button';
        addNotaBtn.addEventListener('click', async () => {
          const n = window.prompt(`Nota da prova ${(d.avaliacoes?.length || 0) + 1} (ex: 8.5):`);
          const p = window.prompt('Peso da avaliação (ex: 1):', '1');
          if (n === null || n === '') return;
          const avals = [...(d.avaliacoes || []), { nota: Number(n), peso: Number(p) || 1 }];
          await updateDisciplina(wsId, d.id, { avaliacoes: avals });
          d.avaliacoes = avals;
          renderContent();
        });

        const faltasMax = d.faltasMax || 0;
        const faltas = d.faltasAtuais || 0;
        const perto = faltasMax > 0 && faltas >= faltasMax * 0.75;
        const faltaWrap = createEl('div');
        faltaWrap.style.cssText = 'display:inline-flex;align-items:center;gap:0.35rem;flex-wrap:wrap;';
        const faltaLbl = createEl('span', perto ? 'badge badge-critical' : 'badge', `Faltas: ${faltas}${faltasMax ? `/${faltasMax}` : ''}`);
        const inpFalta = createEl('input', 'input-control');
        inpFalta.type = 'number';
        inpFalta.min = '0';
        inpFalta.max = '999';
        inpFalta.value = String(faltas);
        inpFalta.ariaLabel = `Quantidade de faltas em ${d.nome}`;
        inpFalta.style.cssText = 'width:72px;padding:0.25rem 0.45rem;font-size:0.84rem;';
        const saveFaltaBtn = createEl('button', 'btn btn-ghost btn-sm', 'Salvar faltas');
        saveFaltaBtn.type = 'button';
        const commitFalta = async () => {
          const val = Math.max(0, Math.floor(Number(inpFalta.value) || 0));
          if (val === d.faltasAtuais) return;
          await updateDisciplina(wsId, d.id, { faltasAtuais: val });
          d.faltasAtuais = val;
          renderContent();
        };
        saveFaltaBtn.addEventListener('click', commitFalta);
        inpFalta.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitFalta();
          }
        });
        faltaWrap.append(faltaLbl, inpFalta, saveFaltaBtn);
        card.append(notaRow, addNotaBtn, faltaWrap);
      }

      const delBtn = createEl('button', 'btn btn-ghost btn-sm', 'Remover');
      delBtn.type = 'button';
      delBtn.addEventListener('click', async () => {
        await deleteDisciplina(wsId, d.id);
        studentState.disciplinas = studentState.disciplinas.filter((x) => x.id !== d.id);
        renderContent();
      });
      card.appendChild(delBtn);
      body.appendChild(card);
    }

    // Grade horária semanal (múltiplos dias da semana por disciplina)
    const hGrade = createEl('h3', '', 'Grade horária semanal');
    const gradeForm = createEl('div', 'form-grid-2');
    const gDisc = createEl('select', 'select-control');
    for (const d of studentState.disciplinas) {
      const o = createEl('option', '', d.nome);
      o.value = d.id;
      gDisc.appendChild(o);
    }
    const gIni = createEl('input', 'input-control');
    gIni.type = 'time';
    gIni.value = '08:00';
    const gFim = createEl('input', 'input-control');
    gFim.type = 'time';
    gFim.value = '10:00';

    const diasWrap = createEl('div', 'tag-filter-row');
    const selectedDays = new Set();
    DIAS_SEMANA.forEach((nome, idx) => {
      const chip = createEl('button', 'tag-chip', nome.slice(0, 3));
      chip.type = 'button';
      chip.setAttribute('aria-pressed', 'false');
      chip.addEventListener('click', () => {
        if (selectedDays.has(idx)) selectedDays.delete(idx);
        else selectedDays.add(idx);
        chip.setAttribute('aria-pressed', String(selectedDays.has(idx)));
      });
      diasWrap.appendChild(chip);
    });

    const addAulaBtn = createEl('button', 'btn btn-secondary btn-sm', 'Adicionar aulas nos dias selecionados');
    addAulaBtn.type = 'button';
    addAulaBtn.addEventListener('click', async () => {
      if (!gDisc.value || selectedDays.size === 0) {
        showToast('Selecione a disciplina e pelo menos um dia da semana.');
        return;
      }
      for (const diaSemana of selectedDays) {
        const novaAula = await createAulaGrade(wsId, {
          disciplinaId: gDisc.value,
          diaSemana,
          inicio: gIni.value,
          fim: gFim.value
        });
        studentState.grade.push(novaAula);
      }
      renderContent();
    });
    gradeForm.append(gDisc, gIni, gFim);
    body.append(hGrade, gradeForm, diasWrap, addAulaBtn);

    const discMap = new Map(studentState.disciplinas.map((d) => [d.id, d]));
    for (const aula of studentState.grade) {
      const row = createEl('div', 'subtask-row');
      const span = createEl('span', '', `${DIAS_SEMANA[aula.diaSemana]} ${aula.inicio}-${aula.fim}: ${discMap.get(aula.disciplinaId)?.nome || 'Aula'}`);
      const rm = createEl('button', 'btn btn-ghost btn-sm', '✕');
      rm.type = 'button';
      rm.addEventListener('click', async () => {
        await deleteAulaGrade(wsId, aula.id);
        studentState.grade = studentState.grade.filter((x) => x.id !== aula.id);
        renderContent();
      });
      row.append(span, rm);
      body.appendChild(row);
    }
  };

  renderContent();
  const closeBtn = createEl('button', 'btn btn-primary', 'Fechar');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => dlg.close());
  footer.appendChild(closeBtn);
  dlg.showModal();
}

// ----------------------------------------------------------------------------
// 2. Planner em PDF (Etapa E2)
// ----------------------------------------------------------------------------
function openPlannerDialog() {
  const { dlg, body, footer } = createModal('planner-dialog', 'Planner em PDF');
  dlg.style.width = 'min(96vw, 860px)';

  const opts = loadPlannerOpts();
  const controls = createEl('div', 'planner-controls form-grid-2');

  const mkSelect = (label, key, options) => {
    const f = createEl('div', 'form-field');
    const l = createEl('label', '', label);
    const s = createEl('select', 'select-control');
    for (const [val, txt] of options) {
      const o = createEl('option', '', txt);
      o.value = val;
      s.appendChild(o);
    }
    s.value = opts[key];
    s.addEventListener('change', () => {
      opts[key] = s.value;
      savePlannerOpts(opts);
      refresh();
    });
    f.append(l, s);
    return f;
  };

  controls.append(
    mkSelect('Layout', 'layout', [
      ['semanal', 'Semanal (7 colunas)'],
      ['diario', 'Diário (horários)'],
      ['mensal', 'Mensal (calendário)'],
      ['provas', 'Semana de Provas'],
      ['pacote', 'Pacote Completo (Capa + Mês + Semanas)']
    ]),
    mkSelect('Tamanho do papel', 'tamanho', [['A4', 'A4'], ['A5', 'A5'], ['letter', 'Carta']]),
    mkSelect('Orientação', 'orientacao', [['portrait', 'Retrato'], ['landscape', 'Paisagem']]),
    mkSelect('Cores', 'modoCor', [['colorido', 'Colorido por disciplina'], ['pb', 'Preto e branco econômico']]),
    mkSelect('Margem para encadernação', 'margemEncadernacao', [['nenhuma', 'Padrão'], ['esquerda', 'Esquerda (fichário)'], ['topo', 'Topo']]),
    mkSelect('Folha de anotações', 'folhaNotas', [['pautada', 'Pautada'], ['quadriculada', 'Quadriculada'], ['pontilhada', 'Pontilhada'], ['branco', 'Em branco']])
  );

  const capaInp = createEl('input', 'input-control');
  capaInp.placeholder = 'Seu nome / curso para capa e rodapé';
  capaInp.value = opts.capaNome;
  capaInp.addEventListener('input', () => {
    opts.capaNome = capaInp.value;
    savePlannerOpts(opts);
    refresh();
  });

  const tip = createEl('p', 'info-note', 'Dica para salvar em PDF (PC, Chrome ou Safari no iPhone): toque em "Imprimir / Salvar como PDF" e marque "Gráficos de segundo plano" se quiser manter as cores.');
  const previewSheet = createEl('div', 'planner-preview-sheet');

  const refresh = () => {
    applyPlannerPageCss(opts);
    renderPlannerPreview(previewSheet, {
      demandas: hostCtx.getDemandas(),
      disciplinas: studentState.disciplinas,
      grade: studentState.grade,
      uid: hostCtx.getUser().uid,
      opts
    });
  };

  body.append(controls, capaInp, tip, previewSheet);
  refresh();

  const printBtn = createEl('button', 'btn btn-primary', 'Imprimir / Salvar como PDF');
  printBtn.type = 'button';
  printBtn.addEventListener('click', () => {
    let mount = document.getElementById('planner-print-mount');
    if (mount) mount.remove();
    mount = createEl('div');
    mount.id = 'planner-print-mount';
    mount.appendChild(previewSheet.cloneNode(true));
    document.body.appendChild(mount);

    const cleanup = () => {
      document.body.classList.remove('is-printing-planner');
      mount?.remove();
    };
    window.addEventListener('afterprint', cleanup, { once: true });

    // Chamada síncrona para compatibilidade com Safari iOS
    document.body.classList.add('is-printing-planner');
    window.print();
    setTimeout(cleanup, 1500);
  });

  const closeBtn = createEl('button', 'btn btn-secondary', 'Fechar');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => dlg.close());
  footer.append(closeBtn, printBtn);
  dlg.showModal();
}

// ----------------------------------------------------------------------------
// 3. Foco / Pomodoro e Painel de Estudo (Etapa E3)
// ----------------------------------------------------------------------------
function openFocusDialog() {
  const { dlg, body, footer } = createModal('stu-focus-dialog', 'Modo Foco (Pomodoro)');

  const selDemand = createEl('select', 'select-control');
  const optNone = createEl('option', '', 'Estudo livre (sem demanda vinculada)');
  optNone.value = '';
  selDemand.appendChild(optNone);
  for (const d of hostCtx.getDemandas().filter((x) => x.status !== 'concluida')) {
    const o = createEl('option', '', d.titulo);
    o.value = d.id;
    selDemand.appendChild(o);
  }

  const selMins = createEl('select', 'select-control');
  [15, 25, 40, 50].forEach((m) => {
    const o = createEl('option', '', `${m} minutos`);
    o.value = String(m);
    selMins.appendChild(o);
  });
  selMins.value = String(studentState.pomodoroMinutesTarget);
  selMins.addEventListener('change', () => {
    if (!studentState.pomodoroRunning) {
      studentState.pomodoroMinutesTarget = Number(selMins.value);
      studentState.pomodoroSeconds = studentState.pomodoroMinutesTarget * 60;
      updateClock();
    }
  });

  const clock = createEl('div', 'metric-value', '25:00');
  clock.style.fontSize = '2.4rem';
  clock.style.textAlign = 'center';

  const updateClock = () => {
    const mm = String(Math.floor(studentState.pomodoroSeconds / 60)).padStart(2, '0');
    const ss = String(studentState.pomodoroSeconds % 60).padStart(2, '0');
    clock.textContent = `${mm}:${ss}`;
  };
  updateClock();

  const btnRow = createEl('div');
  btnRow.style.display = 'flex';
  btnRow.style.gap = '0.5rem';
  btnRow.style.justifyContent = 'center';

  const startBtn = createEl('button', 'btn btn-primary', studentState.pomodoroRunning ? 'Pausar' : 'Iniciar');
  startBtn.type = 'button';
  startBtn.addEventListener('click', () => {
    if (studentState.pomodoroRunning) {
      clearInterval(studentState.pomodoroTimer);
      studentState.pomodoroRunning = false;
      startBtn.textContent = 'Retomar';
      return;
    }
    studentState.pomodoroRunning = true;
    startBtn.textContent = 'Pausar';
    studentState.pomodoroTimer = setInterval(async () => {
      studentState.pomodoroSeconds -= 1;
      updateClock();
      if (studentState.pomodoroSeconds <= 0) {
        clearInterval(studentState.pomodoroTimer);
        studentState.pomodoroRunning = false;
        playGentleChime();
        const dem = hostCtx.getDemandas().find((d) => d.id === selDemand.value);
        await saveFocusSession(
          hostCtx.getWsId(),
          hostCtx.getUser().uid,
          dem?.disciplinaId || null,
          dem?.id || null,
          studentState.pomodoroMinutesTarget
        );
        studentState.sessoes.push({
          disciplinaId: dem?.disciplinaId || null,
          minutos: studentState.pomodoroMinutesTarget
        });
        showToast(`Ciclo de ${studentState.pomodoroMinutesTarget} min concluído e salvo!`);
        studentState.pomodoroSeconds = studentState.pomodoroMinutesTarget * 60;
        startBtn.textContent = 'Iniciar';
        updateClock();
        renderStudySvgChart(chartBox, studentState.sessoes, studentState.disciplinas);
      }
    }, 1000);
  });

  const resetBtn = createEl('button', 'btn btn-secondary', 'Reiniciar');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => {
    clearInterval(studentState.pomodoroTimer);
    studentState.pomodoroRunning = false;
    studentState.pomodoroSeconds = studentState.pomodoroMinutesTarget * 60;
    startBtn.textContent = 'Iniciar';
    updateClock();
  });

  btnRow.append(startBtn, resetBtn);

  const chartBox = createEl('div');
  renderStudySvgChart(chartBox, studentState.sessoes, studentState.disciplinas);

  body.append(selDemand, selMins, clock, btnRow, chartBox);
  const closeBtn = createEl('button', 'btn btn-secondary', 'Fechar');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => dlg.close());
  footer.appendChild(closeBtn);
  dlg.showModal();
}

// ----------------------------------------------------------------------------
// 4. Captura por Foto / Plano de Ensino / Export .ics (Etapa E4)
// ----------------------------------------------------------------------------
function openCaptureDialog() {
  const { dlg, body, footer } = createModal('stu-capture-dialog', 'Foto do Quadro, Plano de Ensino e .ics');

  const photoLbl = createEl('label', '', 'Foto do quadro, agenda ou aviso (reduzida no navegador; não é salva no banco):');
  const photoInp = createEl('input', 'input-control');
  photoInp.type = 'file';
  photoInp.accept = 'image/*';
  photoInp.setAttribute('capture', 'environment');

  photoInp.addEventListener('change', async () => {
    const file = photoInp.files?.[0];
    if (!file) return;
    showToast('Analisando imagem com IA…');
    try {
      const items = await extractDemandsFromImageWithAI(file, studentState.disciplinas);
      dlg.close();
      hostCtx.openBatchPreview?.(items, 'texto');
    } catch (err) {
      showToast(err.message || 'Erro ao analisar foto.');
    }
  });

  const sylLbl = createEl('label', '', 'Colar texto do plano de ensino ou calendário acadêmico:');
  const sylTxt = createEl('textarea', 'textarea-control');
  sylTxt.rows = 4;
  sylTxt.placeholder = 'Cole aqui datas de provas, trabalhos e seminários...';
  const sylBtn = createEl('button', 'btn btn-primary btn-sm', 'Extrair datas e entregas');
  sylBtn.type = 'button';
  sylBtn.addEventListener('click', async () => {
    if (!sylTxt.value.trim()) return;
    sylBtn.disabled = true;
    sylBtn.textContent = 'Extraindo…';
    try {
      const items = await extractSyllabusWithAI(sylTxt.value, studentState.disciplinas);
      dlg.close();
      hostCtx.openBatchPreview?.(items, 'texto');
    } finally {
      sylBtn.disabled = false;
      sylBtn.textContent = 'Extrair datas e entregas';
    }
  });

  const icsBtn = createEl('button', 'btn btn-secondary btn-sm', 'Exportar calendário (.ics)');
  icsBtn.type = 'button';
  icsBtn.addEventListener('click', () => {
    exportToICS({
      demandas: hostCtx.getDemandas(),
      grade: studentState.grade,
      disciplinas: studentState.disciplinas
    });
    showToast('Arquivo .ics baixado! No Google Calendar ou Apple Calendar, use "Importar".');
  });

  const icsTip = createEl('p', 'info-note', 'Para importar o .ics: no Google Calendar (web) vá em Configurações > Importar e exportar; no iPhone, toque no arquivo baixado para adicionar ao Calendário.');

  body.append(photoLbl, photoInp, sylLbl, sylTxt, sylBtn, icsBtn, icsTip);
  const closeBtn = createEl('button', 'btn btn-secondary', 'Fechar');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => dlg.close());
  footer.appendChild(closeBtn);
  dlg.showModal();
}

// ----------------------------------------------------------------------------
// 5. Tela "Hoje", Metas Gentis, Onboarding e Privacidade (Etapa E5)
// ----------------------------------------------------------------------------
function openTodayDialog() {
  const { dlg, body, footer } = createModal('stu-today-dialog', 'Hoje nos Estudos');
  const data = buildTodayStudentData({
    demandas: hostCtx.getDemandas(),
    grade: studentState.grade,
    disciplinas: studentState.disciplinas,
    sessoes: studentState.sessoes
  });
  const goals = loadGentleGoals();

  const aulasBox = createEl('div', 'info-note');
  aulasBox.textContent = data.aulasHoje.length > 0
    ? `Aulas de hoje: ${data.aulasHoje.map((a) => `${a.inicio} ${a.disciplinaNome}`).join(' | ')}`
    : 'Nenhuma aula cadastrada para hoje.';

  const entregasBox = createEl('div', 'info-note');
  entregasBox.textContent = data.entregasHoje.length > 0
    ? `Entregas de hoje: ${data.entregasHoje.map((d) => d.titulo).join(', ')}`
    : 'Nenhuma entrega vencendo hoje.';

  const provaBox = createEl('div', 'info-note');
  provaBox.textContent = data.proximaProva
    ? `Próxima prova: ${data.proximaProva.titulo} (${data.proximaProva.prazo})`
    : 'Nenhuma prova futura cadastrada.';

  const focoBox = createEl('div', 'info-note');
  focoBox.textContent = data.focoSugerido
    ? `Sugestão calma para começar: "${data.focoSugerido.titulo}"`
    : 'Tudo em dia! Aproveite para descansar.';

  const metasBox = createEl('div', 'info-note');
  metasBox.textContent = `Metas gentis: ${data.horasFoco}h / ${goals.horasSemana}h de foco • ${data.concluidasTotal} / ${goals.demandasSemana} tarefas concluídas.`;

  const resumoBtn = createEl('button', 'btn btn-secondary btn-sm', 'Gerar resumo semanal (IA)');
  resumoBtn.type = 'button';
  const resumoTxt = createEl('p', 'info-note hidden');
  resumoBtn.addEventListener('click', async () => {
    resumoBtn.disabled = true;
    resumoBtn.textContent = 'Gerando…';
    resumoTxt.textContent = await generateStudentWeeklySummary(hostCtx.getDemandas(), studentState.sessoes);
    resumoTxt.classList.remove('hidden');
    resumoBtn.disabled = false;
    resumoBtn.textContent = 'Gerar resumo semanal (IA)';
  });

  body.append(aulasBox, entregasBox, provaBox, focoBox, metasBox, resumoBtn, resumoTxt);
  const closeBtn = createEl('button', 'btn btn-primary', 'Vamos lá');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => dlg.close());
  footer.appendChild(closeBtn);
  dlg.showModal();
}

function openOnboardingDialog() {
  const { dlg, body, footer } = createModal('stu-onboard-dialog', 'Bem-vindo ao Pauta Estudante!');
  const p = createEl('p', '', 'Em 3 passos rápidos você deixa tudo pronto (ou pode pular e configurar depois):');
  const step1 = createEl('p', 'info-note', '1. Crie seu semestre e suas disciplinas no botão "Disciplinas" no topo.');
  const step2 = createEl('p', 'info-note', '2. Cadastre sua grade semanal ou importe um plano de ensino em "Foto / Plano".');
  const step3 = createEl('p', 'info-note', '3. Gere seu Planner em PDF personalizado no botão "Planner PDF".');
  body.append(p, step1, step2, step3);

  const skipBtn = createEl('button', 'btn btn-secondary', 'Pular por enquanto');
  skipBtn.type = 'button';
  skipBtn.addEventListener('click', async () => {
    await saveStudentConfig(hostCtx.getUser().uid, { onboardingConcluido: true });
    dlg.close();
  });

  const goBtn = createEl('button', 'btn btn-primary', 'Abrir Disciplinas agora');
  goBtn.type = 'button';
  goBtn.addEventListener('click', async () => {
    await saveStudentConfig(hostCtx.getUser().uid, { onboardingConcluido: true });
    dlg.close();
    openDisciplinesDialog();
  });

  footer.append(skipBtn, goBtn);
  dlg.showModal();
}

function openPrivacyDialog() {
  const { dlg, body, footer } = createModal('stu-privacy-dialog', 'Privacidade e Dados (LGPD)');
  const p1 = createEl('p', 'info-note', 'Seus dados ficam armazenados na sua conta Google/Firebase (Firestore) e só você tem acesso a eles no espaço Pessoal. Em espaços compartilhados, membros veem apenas os itens daquele espaço.');
  const p2 = createEl('p', 'info-note', 'Fotos enviadas para leitura por IA são reduzidas no seu dispositivo e não são armazenadas no banco de dados.');
  const p3 = createEl('p', 'info-note', 'Se você for menor de 18 anos, recomendamos usar o Pauta com ciência dos seus pais ou responsáveis (LGPD). Você pode excluir seus dados a qualquer momento.');

  const delBtn = createEl('button', 'btn btn-danger btn-sm', 'Desativar Modo Estudante');
  delBtn.type = 'button';
  delBtn.addEventListener('click', async () => {
    await saveStudentConfig(hostCtx.getUser().uid, { ativo: false });
    dlg.close();
    unmountStudentUI();
    showToast('Modo Estudante desativado. Seus dados foram mantidos em segurança.');
  });

  body.append(p1, p2, p3, delBtn);
  const closeBtn = createEl('button', 'btn btn-primary', 'Fechar');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => dlg.close());
  footer.appendChild(closeBtn);
  dlg.showModal();
}
