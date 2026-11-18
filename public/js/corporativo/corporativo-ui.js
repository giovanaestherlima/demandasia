// ============================================================================
// Orquestrador da Interface do Modo Corporativo (Carregado sob demanda)
// Layout clean e mobile-first.
// ============================================================================

import { moduloAtivo } from '../modos.js?v=1';
import { createVoiceRecognizer, isSpeechRecognitionSupported } from '../speech.js?v=5';
import {
  clearMeetingDraftLocal,
  createReuniao,
  deleteReuniao,
  getReuniao,
  listReunioes,
  readMeetingDraftLocal,
  saveMeetingDraftLocal,
  updateReuniao
} from './reunioes.js?v=1';
import {
  approveExtractedTasksBatch,
  extractTasksFromMeetingText,
  matchMemberByName,
  MAX_EXTRACTION_CHARS
} from './extracao.js?v=1';
import { fetchRecentActivity } from './historico.js?v=1';
import { generateWeeklyReportText, polishReportWithAI } from './relatorio.js?v=1';
import { copyDemandLink, shareDemandLink } from './links.js?v=1';

let host = null;
let corpNavBar = null;
let loadedReunioes = [];
let reunioesLastDoc = null;
let reunioesHasMore = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createModal(id, titleText) {
  let dlg = document.getElementById(id);
  if (dlg) dlg.remove();
  dlg = document.createElement('dialog');
  dlg.id = id;
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');

  const header = el('div', 'dialog-header');
  const title = el('h2', '', titleText);
  title.id = `${id}-title`;
  dlg.setAttribute('aria-labelledby', title.id);
  const closeX = el('button', 'btn btn-ghost btn-sm', '✕');
  closeX.type = 'button';
  closeX.setAttribute('aria-label', 'Fechar');
  closeX.addEventListener('click', () => dlg.close());
  header.append(title, closeX);

  const body = el('div', 'dialog-body');
  const footer = el('div', 'dialog-footer');
  dlg.append(header, body, footer);
  document.body.appendChild(dlg);
  return { dlg, title, body, footer };
}

export function initCorporativoUI(hostApi) {
  host = hostApi;
  renderCorpNavBar();
}

export function destroyCorporativoUI() {
  if (corpNavBar) {
    corpNavBar.remove();
    corpNavBar = null;
  }
}

export function refreshCorporativoUI() {
  renderCorpNavBar();
}

function renderCorpNavBar() {
  if (!host) return;
  const appView = document.getElementById('app-view');
  if (!appView) return;

  if (!corpNavBar) {
    corpNavBar = document.createElement('nav');
    corpNavBar.id = 'corp-nav-bar';
    corpNavBar.setAttribute('aria-label', 'Recursos do Modo Corporativo');
    corpNavBar.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center;';
    const wsBar = document.getElementById('workspace-bar');
    if (wsBar && wsBar.nextSibling) {
      appView.insertBefore(corpNavBar, wsBar.nextSibling);
    } else {
      appView.prepend(corpNavBar);
    }
  }

  corpNavBar.replaceChildren();
  const isReadOnly = host.isReadOnlyRole();

  if (moduloAtivo('reunioes')) {
    const btnReunioes = el('button', 'subbar-pill', 'Reuniões e atas');
    btnReunioes.type = 'button';
    btnReunioes.addEventListener('click', () => openReunioesModal());
    corpNavBar.appendChild(btnReunioes);

    if (!isReadOnly) {
      const btnExtrair = el('button', 'subbar-pill subbar-pill-primary', 'Extrair tarefas');
      btnExtrair.type = 'button';
      btnExtrair.addEventListener('click', () => openExtracaoModal());
      corpNavBar.appendChild(btnExtrair);
    }
  }

  if (moduloAtivo('historico')) {
    const btnHist = el('button', 'subbar-pill', 'Atividade');
    btnHist.type = 'button';
    btnHist.addEventListener('click', () => openAtividadeModal());
    corpNavBar.appendChild(btnHist);
  }

  if (moduloAtivo('relatorio')) {
    const btnRel = el('button', 'subbar-pill', 'Relatório');
    btnRel.type = 'button';
    btnRel.addEventListener('click', () => openRelatorioModal());
    corpNavBar.appendChild(btnRel);
  }
}

export function showCorpOnboarding(onFinish) {
  const { dlg, body, footer } = createModal('corp-onboarding-dialog', 'Bem-vindo ao Modo Corporativo');
  let step = 1;

  const renderStep = () => {
    body.replaceChildren();
    footer.replaceChildren();
    if (step === 1) {
      body.append(
        el('p', '', 'Passo 1 de 2 — Reuniões e atas'),
        el('p', 'info-note', 'Registre atas por voz ou texto em "Reuniões e atas" e vincule todas as demandas geradas à reunião.')
      );
      const skip = el('button', 'btn btn-ghost', 'Pular');
      skip.type = 'button';
      skip.addEventListener('click', () => { dlg.close(); onFinish?.(); });
      const next = el('button', 'btn btn-primary', 'Próximo');
      next.type = 'button';
      next.addEventListener('click', () => { step = 2; renderStep(); });
      footer.append(skip, next);
    } else {
      body.append(
        el('p', '', 'Passo 2 de 2 — Extrair tarefas e Relatórios'),
        el('p', 'info-note', 'Use "Extrair tarefas" para transformar falas, atas ou e-mails em tarefas revisáveis, e "Relatório" para gerar o resumo semanal pronto para copiar.')
      );
      const testBtn = el('button', 'btn btn-secondary', 'Testar Extrair tarefas');
      testBtn.type = 'button';
      testBtn.addEventListener('click', () => { dlg.close(); onFinish?.(); openExtracaoModal(); });
      const done = el('button', 'btn btn-primary', 'Concluir');
      done.type = 'button';
      done.addEventListener('click', () => { dlg.close(); onFinish?.(); });
      footer.append(testBtn, done);
    }
  };

  renderStep();
  dlg.showModal();
}

// ============================================================================
// Etapa C1: Ações de Link Direto no Detalhe da Demanda
// ============================================================================
export function renderDemandLinkControls(container, demanda) {
  if (!container) return;
  container.replaceChildren();
  if (!moduloAtivo('links') || !demanda?.id || !host) {
    container.classList.add('hidden');
    return;
  }

  const wsId = host.getActiveWsId();
  const isPersonal = host.getActiveWorkspace()?.tipo === 'pessoal';
  container.classList.remove('hidden');

  const btnCopy = el('button', 'btn btn-secondary btn-sm', 'Copiar link');
  btnCopy.type = 'button';
  btnCopy.addEventListener('click', async () => {
    const msg = await copyDemandLink(wsId, demanda, { withTitle: false, isPersonal });
    host.showToast(msg);
  });

  const btnCopyTitle = el('button', 'btn btn-ghost btn-sm', 'Copiar com título');
  btnCopyTitle.type = 'button';
  btnCopyTitle.addEventListener('click', async () => {
    const msg = await copyDemandLink(wsId, demanda, { withTitle: true, isPersonal });
    host.showToast(msg);
  });

  container.append(btnCopy, btnCopyTitle);

  if (navigator.share) {
    const btnShare = el('button', 'btn btn-ghost btn-sm', 'Compartilhar');
    btnShare.type = 'button';
    btnShare.addEventListener('click', async () => {
      try {
        await shareDemandLink(wsId, demanda);
      } catch {}
    });
    container.appendChild(btnShare);
  }
}

// ============================================================================
// Etapa C2: Tela Reuniões e Atas
// ============================================================================
export async function openReunioesModal(openMeetingId = null) {
  if (!host) return;
  const wsId = host.getActiveWsId();
  const isReadOnly = host.isReadOnlyRole();
  const { dlg, body, footer } = createModal('corp-reunioes-dialog', 'Reuniões e atas');

  if (openMeetingId) {
    body.appendChild(el('p', 'info-note', 'Carregando reunião...'));
    dlg.showModal();
    try {
      const reuniao = await getReuniao(wsId, openMeetingId);
      dlg.close();
      if (!reuniao) {
        host.showToast('Esta reunião foi excluída.');
        return;
      }
      openMeetingEditorModal(reuniao);
    } catch {
      dlg.close();
      host.showToast('Erro ao abrir reunião.');
    }
    return;
  }

  const listWrap = el('div');
  listWrap.style.cssText = 'display:flex;flex-direction:column;gap:0.55rem;';
  const loadMoreBtn = el('button', 'btn btn-secondary btn-sm hidden', 'Carregar mais');
  loadMoreBtn.type = 'button';

  const renderList = () => {
    listWrap.replaceChildren();
    if (loadedReunioes.length === 0) {
      listWrap.appendChild(el('p', 'empty-state', 'Nenhuma reunião ainda. Fale ou cole uma ata para começar.'));
    } else {
      for (const r of loadedReunioes) {
        const card = el('div');
        card.style.cssText = 'padding:0.75rem;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);display:flex;justify-content:space-between;align-items:center;gap:0.5rem;cursor:pointer;';
        const info = el('div');
        info.append(
          el('strong', '', r.titulo || 'Reunião'),
          el('div', 'info-note', `${r.dataHora ? r.dataHora.replace('T', ' ') : ''} ${r.assunto ? `• ${r.assunto}` : ''}`)
        );
        const openBtn = el('button', 'btn btn-ghost btn-sm', 'Abrir');
        openBtn.type = 'button';
        card.addEventListener('click', () => {
          dlg.close();
          openMeetingEditorModal(r);
        });
        card.append(info, openBtn);
        listWrap.appendChild(card);
      }
    }
    loadMoreBtn.classList.toggle('hidden', !reunioesHasMore);
  };

  loadMoreBtn.addEventListener('click', async () => {
    const res = await listReunioes(wsId, 15, reunioesLastDoc);
    loadedReunioes = [...loadedReunioes, ...res.items];
    reunioesLastDoc = res.lastDoc;
    reunioesHasMore = res.hasMore;
    renderList();
  });

  if (!isReadOnly) {
    const newBtn = el('button', 'btn btn-primary', '+ Nova reunião');
    newBtn.type = 'button';
    newBtn.addEventListener('click', () => {
      dlg.close();
      openMeetingEditorModal(null);
    });
    footer.appendChild(newBtn);
  }
  const closeBtn = el('button', 'btn btn-secondary', 'Fechar');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => dlg.close());
  footer.appendChild(closeBtn);

  body.append(listWrap, loadMoreBtn);
  dlg.showModal();

  try {
    const res = await listReunioes(wsId, 15, null);
    loadedReunioes = res.items;
    reunioesLastDoc = res.lastDoc;
    reunioesHasMore = res.hasMore;
    renderList();
  } catch {
    listWrap.replaceChildren(el('p', 'info-note', 'Erro ao carregar reuniões.'));
  }
}

function openMeetingEditorModal(reuniao) {
  const wsId = host.getActiveWsId();
  const isReadOnly = host.isReadOnlyRole();
  const membros = host.getMembers();
  const isNew = !reuniao;
  const draftKey = reuniao?.id || 'nova';

  const { dlg, body, footer } = createModal(
    'corp-meeting-edit-dialog',
    isNew ? 'Nova reunião' : (isReadOnly ? 'Visualizar reunião' : 'Editar reunião')
  );

  const inpTitulo = el('input', 'input-control');
  inpTitulo.placeholder = 'Título da reunião';
  inpTitulo.value = reuniao?.titulo || '';
  inpTitulo.disabled = isReadOnly;

  const inpData = el('input', 'input-control');
  inpData.type = 'datetime-local';
  inpData.value = reuniao?.dataHora || new Date().toISOString().slice(0, 16);
  inpData.disabled = isReadOnly;

  const inpAssunto = el('input', 'input-control');
  inpAssunto.placeholder = 'Assunto / Cliente (opcional)';
  inpAssunto.value = reuniao?.assunto || '';
  inpAssunto.disabled = isReadOnly;

  const inpParticipantes = el('input', 'input-control');
  inpParticipantes.placeholder = 'Participantes (separados por vírgula)';
  inpParticipantes.value = (reuniao?.participantes || []).map((p) => p.nome).join(', ');
  inpParticipantes.disabled = isReadOnly;

  // Sugestões rápidas de membros do espaço
  const partWrap = el('div');
  partWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.3rem;';
  if (!isReadOnly && membros.length > 0) {
    for (const m of membros) {
      const chip = el('button', 'tag-chip', `+ ${m.nome || m.email}`);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        const current = inpParticipantes.value.split(',').map((s) => s.trim()).filter(Boolean);
        const nome = m.nome || m.email;
        if (!current.includes(nome)) {
          current.push(nome);
          inpParticipantes.value = current.join(', ');
        }
      });
      partWrap.appendChild(chip);
    }
  }

  const savedDraft = readMeetingDraftLocal(wsId, draftKey);
  const txtAta = el('textarea', 'textarea-control');
  txtAta.rows = 6;
  txtAta.maxLength = 20000;
  txtAta.placeholder = 'Escreva, cole ou dite a ata da reunião...';
  txtAta.value = savedDraft && (!reuniao?.ata || savedDraft !== reuniao.ata) ? savedDraft : (reuniao?.ata || '');
  txtAta.disabled = isReadOnly;

  let draftTimer = null;
  txtAta.addEventListener('input', () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveMeetingDraftLocal(wsId, draftKey, txtAta.value), 500);
  });

  // Botão de ditado incremental (acrescenta ao texto, nunca substitui)
  const ataTools = el('div');
  ataTools.style.cssText = 'display:flex;gap:0.4rem;flex-wrap:wrap;';
  const copyAtaBtn = el('button', 'btn btn-ghost btn-sm', 'Copiar ata');
  copyAtaBtn.type = 'button';
  copyAtaBtn.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(txtAta.value);
    host.showToast('Ata copiada!');
  });
  ataTools.appendChild(copyAtaBtn);

  let voiceRec = null;
  if (!isReadOnly && isSpeechRecognitionSupported()) {
    const dictBtn = el('button', 'btn btn-secondary btn-sm', 'Ditar (acrescentar)');
    dictBtn.type = 'button';
    let listening = false;
    dictBtn.addEventListener('click', () => {
      if (listening && voiceRec) {
        voiceRec.stop();
        listening = false;
        dictBtn.textContent = 'Ditar (acrescentar)';
        return;
      }
      const baseText = txtAta.value.trim();
      voiceRec = createVoiceRecognizer({
        onInterim: (t) => {
          txtAta.value = baseText ? `${baseText}\n${t}` : t;
        },
        onResult: (t) => {
          txtAta.value = baseText ? `${baseText}\n${t}` : t;
          saveMeetingDraftLocal(wsId, draftKey, txtAta.value);
        },
        onEnd: () => {
          listening = false;
          dictBtn.textContent = 'Ditar (acrescentar)';
        },
        onError: () => {
          listening = false;
          dictBtn.textContent = 'Ditar (acrescentar)';
        }
      });
      listening = true;
      dictBtn.textContent = 'Parar ditado';
      voiceRec.start();
    });
    ataTools.appendChild(dictBtn);
  }

  // Lista de demandas geradas ligadas a esta reunião
  const linkedDemands = reuniao?.id
    ? host.getDemandas().filter((d) => d.reuniaoId === reuniao.id)
    : [];
  const linkedWrap = el('div');
  if (linkedDemands.length > 0) {
    linkedWrap.appendChild(el('strong', '', `Demandas desta reunião (${linkedDemands.length}):`));
    const ul = el('ul');
    ul.style.cssText = 'margin:0.35rem 0 0;padding-left:1.1rem;font-size:0.85rem;';
    for (const d of linkedDemands) {
      const li = el('li', '', `${d.titulo} (${d.status === 'concluida' ? 'Concluída' : 'Pendente'})`);
      ul.appendChild(li);
    }
    linkedWrap.appendChild(ul);
  }

  body.append(
    inpTitulo,
    inpData,
    inpAssunto,
    inpParticipantes,
    partWrap,
    txtAta,
    ataTools,
    linkedWrap
  );

  if (!isReadOnly) {
    if (reuniao?.id) {
      const delBtn = el('button', 'btn btn-danger btn-sm', 'Excluir');
      delBtn.type = 'button';
      delBtn.addEventListener('click', async () => {
        if (!window.confirm('Excluir esta reunião? As demandas já geradas serão mantidas.')) return;
        await deleteReuniao(wsId, reuniao.id);
        clearMeetingDraftLocal(wsId, draftKey);
        dlg.close();
        host.showToast('Reunião excluída.');
      });
      footer.appendChild(delBtn);
    }

    const extractBtn = el('button', 'btn btn-secondary', 'Extrair tarefas');
    extractBtn.type = 'button';
    extractBtn.addEventListener('click', () => {
      dlg.close();
      openExtracaoModal({
        initialText: txtAta.value,
        reuniaoId: reuniao?.id || null,
        reuniaoTitulo: inpTitulo.value.trim(),
        dataHora: inpData.value
      });
    });

    const saveBtn = el('button', 'btn btn-primary', 'Salvar');
    saveBtn.type = 'button';
    saveBtn.addEventListener('click', async () => {
      const titulo = inpTitulo.value.trim() || 'Reunião';
      const participantes = inpParticipantes.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((nome) => {
          const m = membros.find((x) => (x.nome || '').toLowerCase() === nome.toLowerCase());
          return m ? { uid: m.uid, nome: m.nome } : { nome };
        });
      const dados = {
        titulo,
        dataHora: inpData.value,
        assunto: inpAssunto.value.trim(),
        participantes,
        ata: txtAta.value
      };
      if (isNew) {
        await createReuniao(wsId, host.getUser(), dados);
      } else {
        await updateReuniao(wsId, reuniao.id, dados);
      }
      clearMeetingDraftLocal(wsId, draftKey);
      dlg.close();
      host.showToast('Reunião salva!');
    });

    footer.append(extractBtn, saveBtn);
  } else {
    const closeBtn = el('button', 'btn btn-primary', 'Fechar');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => dlg.close());
    footer.appendChild(closeBtn);
  }

  dlg.showModal();
}

// ============================================================================
// Etapa C3: Extração de Tarefas (Voz pós-reunião ou Colar Ata/E-mail)
// ============================================================================
export function openExtracaoModal(opts = {}) {
  if (!host || host.isReadOnlyRole()) return;
  const wsId = host.getActiveWsId();
  const membros = host.getMembers();
  const { dlg, body, footer } = createModal('corp-extracao-dialog', 'Extrair tarefas de reunião ou e-mail');

  const privacyNote = el(
    'p',
    'info-note',
    'Aviso: o texto enviado para extração é processado pela IA do Google (Gemini). Nada do texto original é guardado, a menos que você salve como ata.'
  );

  const txtArea = el('textarea', 'textarea-control');
  txtArea.rows = 6;
  txtArea.placeholder = 'Cole uma ata, anotações ou e-mail — ou toque em "Falar a reunião"...';
  txtArea.value = opts.initialText || '';

  const toolsRow = el('div');
  toolsRow.style.cssText = 'display:flex;gap:0.45rem;flex-wrap:wrap;align-items:center;';

  let voiceRec = null;
  if (isSpeechRecognitionSupported()) {
    const voiceBtn = el('button', 'btn btn-secondary btn-sm', 'Falar a reunião');
    voiceBtn.type = 'button';
    let listening = false;
    voiceBtn.addEventListener('click', () => {
      if (listening && voiceRec) {
        voiceRec.stop();
        listening = false;
        voiceBtn.textContent = 'Falar a reunião';
        return;
      }
      const base = txtArea.value.trim();
      voiceRec = createVoiceRecognizer({
        onInterim: (t) => { txtArea.value = base ? `${base}\n${t}` : t; },
        onResult: (t) => { txtArea.value = base ? `${base}\n${t}` : t; },
        onEnd: () => { listening = false; voiceBtn.textContent = 'Falar a reunião'; },
        onError: () => { listening = false; voiceBtn.textContent = 'Falar a reunião'; }
      });
      listening = true;
      voiceBtn.textContent = 'Parar gravação';
      voiceRec.start();
    });
    toolsRow.appendChild(voiceBtn);
  }

  const previewBox = el('div');
  previewBox.style.cssText = 'display:flex;flex-direction:column;gap:0.6rem;';

  let extractedResult = null;
  let draftTasks = [];

  const runExtraction = async () => {
    const raw = txtArea.value.trim();
    if (!raw) {
      host.showToast('Cole ou fale o conteúdo da reunião primeiro.');
      return;
    }
    if (raw.length > MAX_EXTRACTION_CHARS) {
      host.showToast(`Texto longo: apenas os primeiros ${MAX_EXTRACTION_CHARS} caracteres serão analisados.`);
    }

    previewBox.replaceChildren(el('p', 'info-note', 'Analisando texto e identificando tarefas...'));
    footer.replaceChildren();

    try {
      extractedResult = await extractTasksFromMeetingText(raw, {
        dataReuniao: opts.dataHora ? opts.dataHora.slice(0, 10) : undefined
      });
      if (opts.reuniaoTitulo) {
        extractedResult.reuniao.titulo = opts.reuniaoTitulo;
      }

      draftTasks = extractedResult.tarefas.map((t) => {
        const match = matchMemberByName(t.responsavelNome, membros);
        const responsaveis = match.status === 'matched' ? [{ uid: match.member.uid, nome: match.member.nome }] : [];
        return {
          ...t,
          match,
          responsaveis,
          responsavelExterno: match.status === 'none' && t.responsavelNome ? t.responsavelNome : '',
          approved: true
        };
      });

      renderPreview();
    } catch (err) {
      console.error(err);
      // Falha ou timeout: salva rascunho local como ata sem perder nada
      saveMeetingDraftLocal(wsId, opts.reuniaoId || 'nova', raw);
      previewBox.replaceChildren(
        el('p', 'ai-status-bar is-warn', 'A IA demorou ou falhou. Seu texto foi guardado no rascunho da ata para não perder nada.')
      );
      const retryBtn = el('button', 'btn btn-primary', 'Tentar de novo');
      retryBtn.type = 'button';
      retryBtn.addEventListener('click', runExtraction);
      const manualBtn = el('button', 'btn btn-secondary', 'Criar demanda manualmente');
      manualBtn.type = 'button';
      manualBtn.addEventListener('click', () => {
        dlg.close();
        host.openManualDraft(raw.slice(0, 70), raw);
      });
      footer.replaceChildren(manualBtn, retryBtn);
    }
  };

  const renderPreview = () => {
    previewBox.replaceChildren();
    footer.replaceChildren();

    const headerInfo = el('div', 'info-note');
    headerInfo.textContent = `Reunião sugerida: "${extractedResult.reuniao.titulo}" • ${draftTasks.length} tarefa(s) identificada(s)`;
    previewBox.appendChild(headerInfo);

    const saveAtaChkWrap = el('label', 'switch-row');
    const saveAtaChk = el('input');
    saveAtaChk.type = 'checkbox';
    saveAtaChk.checked = !opts.reuniaoId;
    saveAtaChk.disabled = Boolean(opts.reuniaoId);
    saveAtaChkWrap.append(el('span', '', 'Salvar a ata na reunião'), saveAtaChk);
    previewBox.appendChild(saveAtaChkWrap);

    const existingPending = host.getDemandas().filter((d) => d.status !== 'concluida');

    draftTasks.forEach((task, idx) => {
      if (!task.approved) return;
      const card = el('div');
      card.style.cssText = 'border:1px solid var(--border);border-radius:var(--radius-md);padding:0.65rem;background:var(--surface);display:flex;flex-direction:column;gap:0.45rem;';

      if (task.trecho) {
        card.appendChild(el('div', 'info-note', `Trecho: "${task.trecho}"`));
      }

      // Alerta de possível duplicata
      const normTitle = task.titulo.toLowerCase();
      const dup = existingPending.find((d) => d.titulo.toLowerCase().includes(normTitle.slice(0, 18)));
      if (dup) {
        card.appendChild(el('div', 'ai-status-bar is-warn', `Possível duplicata de: "${dup.titulo}"`));
      }

      const inpTit = el('input', 'input-control');
      inpTit.value = task.titulo;
      inpTit.maxLength = 70;
      inpTit.addEventListener('input', () => { task.titulo = inpTit.value; });

      const row2 = el('div', 'form-grid-2');
      const inpPrazo = el('input', 'input-control');
      inpPrazo.type = 'date';
      inpPrazo.value = task.prazo || '';
      inpPrazo.addEventListener('change', () => { task.prazo = inpPrazo.value || null; });

      const selPrio = el('select', 'select-control');
      for (const p of ['baixa', 'media', 'alta', 'urgente']) {
        const o = el('option', '', p.charAt(0).toUpperCase() + p.slice(1));
        o.value = p;
        selPrio.appendChild(o);
      }
      selPrio.value = task.prioridade;
      selPrio.addEventListener('change', () => { task.prioridade = selPrio.value; });
      row2.append(inpPrazo, selPrio);

      // Responsável com tratamento de ambiguidade / inexistente
      const respRow = el('div');
      respRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center;';
      const selResp = el('select', 'select-control');
      selResp.appendChild(el('option', '', 'Sem responsável'));
      selResp.firstChild.value = '';
      for (const m of membros) {
        const o = el('option', '', m.nome || m.email);
        o.value = m.uid;
        selResp.appendChild(o);
      }
      if (task.responsaveis[0]) selResp.value = task.responsaveis[0].uid;
      selResp.addEventListener('change', () => {
        const m = membros.find((x) => x.uid === selResp.value);
        task.responsaveis = m ? [{ uid: m.uid, nome: m.nome }] : [];
        if (m) task.responsavelExterno = '';
      });
      respRow.appendChild(selResp);

      if (task.match.status === 'ambiguous') {
        respRow.appendChild(el('span', 'badge badge-attention', `Nome "${task.responsavelNome}" ambíguo — escolha acima`));
      } else if (task.match.status === 'none' && task.responsavelNome) {
        respRow.appendChild(el('span', 'badge', `Externo: ${task.responsavelNome}`));
      }

      const cardBtns = el('div');
      cardBtns.style.cssText = 'display:flex;justify-content:flex-end;gap:0.4rem;';
      const discBtn = el('button', 'btn btn-ghost btn-sm', 'Descartar');
      discBtn.type = 'button';
      discBtn.addEventListener('click', () => {
        task.approved = false;
        renderPreview();
      });
      cardBtns.appendChild(discBtn);

      card.append(inpTit, row2, respRow, cardBtns);
      previewBox.appendChild(card);
    });

    const ativos = draftTasks.filter((t) => t.approved);
    const approveAllBtn = el('button', 'btn btn-primary', `Aprovar todas (${ativos.length})`);
    approveAllBtn.type = 'button';
    approveAllBtn.disabled = ativos.length === 0;
    approveAllBtn.addEventListener('click', async () => {
      approveAllBtn.disabled = true;
      try {
        const res = await approveExtractedTasksBatch(wsId, host.getUser(), {
          reuniaoExistenteId: opts.reuniaoId || null,
          saveMeeting: saveAtaChk.checked,
          meetingData: {
            titulo: extractedResult.reuniao.titulo,
            assunto: extractedResult.reuniao.assunto,
            ata: txtArea.value.trim(),
            origem: 'colado',
            dataHora: opts.dataHora || new Date().toISOString().slice(0, 16)
          },
          tasks: ativos,
          isSharedWs: host.getActiveWorkspace()?.tipo === 'equipe' || membros.length > 1
        });
        dlg.close();
        host.showToast(`${res.createdCount} demanda(s) criada(s)!`);
      } catch (err) {
        console.error(err);
        approveAllBtn.disabled = false;
        host.showToast('Erro ao salvar demandas extraídas.');
      }
    });

    const backBtn = el('button', 'btn btn-secondary', 'Voltar');
    backBtn.type = 'button';
    backBtn.addEventListener('click', () => {
      previewBox.replaceChildren();
      setupInitialFooter();
    });
    footer.append(backBtn, approveAllBtn);
  };

  const setupInitialFooter = () => {
    footer.replaceChildren();
    const cancelBtn = el('button', 'btn btn-secondary', 'Cancelar');
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => dlg.close());
    const analyzeBtn = el('button', 'btn btn-primary', 'Analisar e extrair');
    analyzeBtn.type = 'button';
    analyzeBtn.addEventListener('click', runExtraction);
    footer.append(cancelBtn, analyzeBtn);
  };

  body.append(privacyNote, txtArea, toolsRow, previewBox);
  setupInitialFooter();
  dlg.showModal();
}

// ============================================================================
// Etapa C4: Atividade Recente do Espaço (Sob Demanda, limit 30)
// ============================================================================
export async function openAtividadeModal() {
  if (!host) return;
  const wsId = host.getActiveWsId();
  const { dlg, body, footer } = createModal('corp-atividade-dialog', 'Atividade recente do espaço');
  body.appendChild(el('p', 'info-note', 'Carregando últimos eventos...'));
  const closeBtn = el('button', 'btn btn-primary', 'Fechar');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => dlg.close());
  footer.appendChild(closeBtn);
  dlg.showModal();

  try {
    const items = await fetchRecentActivity(wsId, 30);
    body.replaceChildren();
    if (items.length === 0) {
      body.appendChild(el('p', 'empty-state', 'Nenhuma atividade registrada neste espaço ainda.'));
      return;
    }
    const ul = el('ul', 'timeline-list');
    for (const ev of items) {
      const dt = ev.em?.toDate ? ev.em.toDate().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
      const li = el('li', '', `${ev.autorNome || 'Membro'}: ${ev.detalhe || ev.tipo}${ev.demandaTitulo ? ` — "${ev.demandaTitulo}"` : ''} (${dt})`);
      ul.appendChild(li);
    }
    body.appendChild(ul);
  } catch {
    body.replaceChildren(el('p', 'info-note', 'Erro ao carregar atividade recente.'));
  }
}

// ============================================================================
// Etapa C5: Relatório Semanal em Texto
// ============================================================================
export function openRelatorioModal() {
  if (!host) return;
  const wsId = host.getActiveWsId();
  const wsNome = host.getActiveWorkspace()?.nome || 'Espaço';
  const membros = host.getMembers();
  const { dlg, body, footer } = createModal('corp-relatorio-dialog', 'Relatório semanal');

  const grid = el('div', 'form-grid-2');

  const selPeriod = el('select', 'select-control');
  for (const [v, l] of [
    ['7d', 'Últimos 7 dias'],
    ['atual', 'Semana atual'],
    ['passada', 'Semana passada'],
    ['14d', 'Últimos 14 dias'],
    ['30d', 'Últimos 30 dias']
  ]) {
    const o = el('option', '', l);
    o.value = v;
    selPeriod.appendChild(o);
  }

  const selScope = el('select', 'select-control');
  for (const [v, l] of [
    ['espaco', 'Todo o espaço'],
    ['minhas', 'Minhas demandas']
  ]) {
    const o = el('option', '', l);
    o.value = v;
    selScope.appendChild(o);
  }
  for (const m of membros) {
    const o = el('option', '', `Pessoa: ${m.nome || m.email}`);
    o.value = `pessoa:${m.uid}`;
    selScope.appendChild(o);
  }

  const selFormat = el('select', 'select-control');
  for (const [v, l] of [
    ['texto', 'Texto simples (e-mail)'],
    ['mensagem', 'WhatsApp / Teams (*negrito*)'],
    ['markdown', 'Markdown (**negrito**)']
  ]) {
    const o = el('option', '', l);
    o.value = v;
    selFormat.appendChild(o);
  }

  const inpStalled = el('input', 'input-control');
  inpStalled.type = 'number';
  inpStalled.min = '1';
  inpStalled.max = '90';
  inpStalled.value = '7';
  inpStalled.title = 'Dias sem atualização para considerar parada';

  grid.append(selPeriod, selScope, selFormat, inpStalled);

  const optsRow = el('div');
  optsRow.style.cssText = 'display:flex;gap:0.8rem;flex-wrap:wrap;';
  const chkLinks = el('input');
  chkLinks.type = 'checkbox';
  const lblLinks = el('label', '', ' Incluir links diretos');
  lblLinks.prepend(chkLinks);

  const chkDesc = el('input');
  chkDesc.type = 'checkbox';
  const lblDesc = el('label', '', ' Incluir descrições');
  lblDesc.prepend(chkDesc);
  optsRow.append(lblLinks, lblDesc);

  const txtPreview = el('textarea', 'textarea-control');
  txtPreview.rows = 10;

  let originalReportText = '';
  const rebuild = () => {
    const rawScope = selScope.value;
    const isPerson = rawScope.startsWith('pessoa:');
    originalReportText = generateWeeklyReportText(host.getDemandas(), {
      wsId,
      wsNome,
      period: selPeriod.value,
      scope: isPerson ? 'pessoa' : rawScope,
      scopeValue: isPerson ? rawScope.slice(7) : '',
      currentUid: host.getUser()?.uid || '',
      format: selFormat.value,
      stalledDays: Number(inpStalled.value) || 7,
      includeLinks: chkLinks.checked,
      includeDescriptions: chkDesc.checked
    });
    txtPreview.value = originalReportText;
  };

  [selPeriod, selScope, selFormat, inpStalled, chkLinks, chkDesc].forEach((ctrl) =>
    ctrl.addEventListener('change', rebuild)
  );
  rebuild();

  const revertBtn = el('button', 'btn btn-ghost btn-sm hidden', 'Voltar ao original');
  revertBtn.type = 'button';
  revertBtn.addEventListener('click', () => {
    txtPreview.value = originalReportText;
    revertBtn.classList.add('hidden');
  });

  const aiBtn = el('button', 'btn btn-secondary btn-sm', 'Melhorar redação com IA');
  aiBtn.type = 'button';
  aiBtn.addEventListener('click', async () => {
    aiBtn.disabled = true;
    aiBtn.textContent = 'Melhorando...';
    try {
      const improved = await polishReportWithAI(txtPreview.value);
      txtPreview.value = improved;
      revertBtn.classList.remove('hidden');
    } catch {
      host.showToast('Não foi possível melhorar a redação agora.');
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = 'Melhorar redação com IA';
    }
  });

  const aiRow = el('div');
  aiRow.style.cssText = 'display:flex;gap:0.45rem;flex-wrap:wrap;';
  aiRow.append(aiBtn, revertBtn);

  body.append(grid, optsRow, txtPreview, aiRow);

  const copyBtn = el('button', 'btn btn-primary', 'Copiar');
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(txtPreview.value);
    host.showToast('Relatório copiado!');
  });

  const mailBtn = el('button', 'btn btn-secondary', 'Abrir no e-mail');
  mailBtn.type = 'button';
  mailBtn.addEventListener('click', () => {
    const subj = encodeURIComponent(`Relatório semanal — ${wsNome}`);
    let bodyTxt = txtPreview.value;
    if (bodyTxt.length > 1800) {
      bodyTxt = `${bodyTxt.slice(0, 1750)}\n\n[Texto truncado pelo limite do link de e-mail — use "Copiar" para o relatório completo]`;
      host.showToast('Relatório longo: truncado para e-mail. Use "Copiar" se preferir completo.');
    }
    window.location.href = `mailto:?subject=${subj}&body=${encodeURIComponent(bodyTxt)}`;
  });

  footer.append(mailBtn, copyBtn);
  if (navigator.share) {
    const shareBtn = el('button', 'btn btn-secondary', 'Compartilhar');
    shareBtn.type = 'button';
    shareBtn.addEventListener('click', async () => {
      try {
        await navigator.share({ title: `Relatório — ${wsNome}`, text: txtPreview.value });
      } catch {}
    });
    footer.appendChild(shareBtn);
  }

  dlg.showModal();
}
