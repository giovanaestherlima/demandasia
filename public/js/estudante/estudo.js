// ============================================================================
// Etapa E3: Plano de Estudo por IA, Modo Foco (Pomodoro), Painel e Sobrecarga
// ============================================================================

import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  limit,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { getGenerativeModel, Schema } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js';
import { ai, db } from '../firebase-config.js?v=5';
import { trackReads, trackWrites } from '../workspaces.js?v=5';

const MODELO_GEMINI = 'gemini-3.5-flash-lite';
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Gera sugestão de subtarefas de estudo espaçadas até a data da prova/trabalho.
 * Retorna lista editável; nunca grava sem confirmação.
 */
export async function generateStudyPlanWithAI(demanda, horasPorDia = 2) {
  const hojeISO = new Date().toISOString().slice(0, 10);
  const fallback = [
    { id: `est-${Date.now()}-1`, texto: `Revisar teoria base: ${demanda.titulo}`, concluida: false },
    { id: `est-${Date.now()}-2`, texto: 'Resolver lista de exercícios práticos', concluida: false },
    { id: `est-${Date.now()}-3`, texto: 'Revisão espaçada + simulado rápido', concluida: false }
  ];

  if (!ai) return fallback;

  const model = getGenerativeModel(ai, {
    model: MODELO_GEMINI,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 350,
      responseMimeType: 'application/json',
      responseSchema: Schema.object({
        properties: {
          passos: Schema.array({ items: Schema.string() })
        }
      })
    }
  });

  const prompt = `Crie um plano de estudo enxuto em pt-BR (3 a 6 passos curtos com revisão espaçada).
Hoje: ${hojeISO}. Prazo: ${demanda.prazo || 'em 7 dias'}. Disponibilidade: ${horasPorDia}h/dia.
Demanda: "${demanda.titulo}". Detalhes: "${demanda.descricao || ''}".`;

  try {
    const res = await model.generateContent(prompt);
    const parsed = JSON.parse(res.response.text());
    if (!Array.isArray(parsed?.passos) || parsed.passos.length === 0) return fallback;
    return parsed.passos.slice(0, 8).map((txt, i) => ({
      id: `est-${Date.now()}-${i}`,
      texto: String(txt).trim().slice(0, 180),
      concluida: false
    }));
  } catch {
    return fallback;
  }
}

/**
 * Grava uma sessão de foco concluída (somente ao fim do ciclo, nunca em loop).
 */
export async function saveFocusSession(wsId, uid, disciplinaId, demandaId, minutos) {
  trackWrites(1);
  return addDoc(collection(db, 'workspaces', wsId, 'sessoesFoco'), {
    uid,
    disciplinaId: disciplinaId || null,
    demandaId: demandaId || null,
    minutos: Math.min(240, Math.max(1, Number(minutos) || 25)),
    criadoEm: serverTimestamp()
  });
}

/**
 * Carrega as últimas sessões de foco do usuário no espaço (com limit).
 */
export async function loadFocusSessions(wsId, uid) {
  const q = query(
    collection(db, 'workspaces', wsId, 'sessoesFoco'),
    where('uid', '==', uid),
    limit(50)
  );
  const snap = await getDocs(q);
  trackReads(Math.max(1, snap.size));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Alerta de semana sobrecarregada (cálculo 100% local sobre demandas carregadas).
 */
export function detectOverloadedDays(demandas) {
  const porDia = new Map();
  for (const d of demandas) {
    if (d.status === 'concluida' || !d.prazo) continue;
    const entry = porDia.get(d.prazo) || { count: 0, mins: 0, titulos: [] };
    entry.count += 1;
    entry.mins += Number(d.estimativaMin || 45);
    entry.titulos.push(d.titulo);
    porDia.set(d.prazo, entry);
  }

  const alertas = [];
  for (const [data, info] of porDia.entries()) {
    if (info.count >= 3 || info.mins >= 240) {
      alertas.push({ data, ...info });
    }
  }
  return alertas.sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * Gráfico SVG puro de minutos estudados por disciplina.
 */
export function renderStudySvgChart(container, sessoes, disciplinas) {
  container.replaceChildren();
  const discMap = new Map(disciplinas.map((d) => [d.id, d]));
  const totais = new Map();

  for (const s of sessoes) {
    const key = s.disciplinaId || 'geral';
    totais.set(key, (totais.get(key) || 0) + Number(s.minutos || 0));
  }

  if (totais.size === 0) {
    const p = document.createElement('p');
    p.className = 'info-note';
    p.textContent = 'Conclua seu primeiro ciclo Pomodoro para ver o tempo por disciplina.';
    container.appendChild(p);
    return;
  }

  const entries = Array.from(totais.entries()).slice(0, 5);
  const maxMin = Math.max(1, ...entries.map(([, m]) => m));

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 280 ${entries.length * 28 + 10}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Tempo estudado por disciplina');

  entries.forEach(([discId, mins], idx) => {
    const disc = discMap.get(discId);
    const nome = disc ? disc.nome : 'Geral';
    const cor = disc?.cor || 'var(--primary)';
    const y = 6 + idx * 28;
    const barW = Math.max(8, Math.round((mins / maxMin) * 140));

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', '0');
    label.setAttribute('y', String(y + 14));
    label.setAttribute('font-size', '11');
    label.setAttribute('fill', 'currentColor');
    label.textContent = nome.slice(0, 14);

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', '95');
    rect.setAttribute('y', String(y + 3));
    rect.setAttribute('width', String(barW));
    rect.setAttribute('height', '14');
    rect.setAttribute('rx', '4');
    rect.setAttribute('fill', cor);

    const val = document.createElementNS(SVG_NS, 'text');
    val.setAttribute('x', String(100 + barW));
    val.setAttribute('y', String(y + 14));
    val.setAttribute('font-size', '10');
    val.setAttribute('fill', 'var(--text-muted)');
    val.textContent = `${mins}m`;

    svg.append(label, rect, val);
  });

  container.appendChild(svg);
}

/**
 * Toca um aviso sonoro suave via Web Audio API + vibração ao fim do ciclo.
 */
export function playGentleChime() {
  try {
    if (navigator.vibrate) navigator.vibrate([180, 80, 180]);
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(528, ctx.currentTime);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // Ignora bloqueio de áudio
  }
}
