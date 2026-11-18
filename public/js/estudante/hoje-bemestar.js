// ============================================================================
// Etapa E5: Tela "Hoje", Metas Gentis, Resumo Semanal IA e Privacidade/LGPD
// ============================================================================

import { getGenerativeModel } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js';
import { ai } from '../firebase-config.js?v=5';

const MODELO_GEMINI = 'gemini-3.5-flash-lite';
const LS_GOALS = 'pauta_student_goals';

export function loadGentleGoals() {
  try {
    const raw = localStorage.getItem(LS_GOALS);
    return raw ? JSON.parse(raw) : { horasSemana: 8, demandasSemana: 5 };
  } catch {
    return { horasSemana: 8, demandasSemana: 5 };
  }
}

export function saveGentleGoals(goals) {
  try {
    localStorage.setItem(LS_GOALS, JSON.stringify(goals));
  } catch {
    // Ignora
  }
}

/**
 * Monta os dados da tela "Hoje" para estudantes a partir do estado já carregado.
 */
export function buildTodayStudentData({ demandas, grade, disciplinas, sessoes }) {
  const hoje = new Date();
  const hojeISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  const dow = hoje.getDay();
  const discMap = new Map(disciplinas.map((d) => [d.id, d]));

  const aulasHoje = grade
    .filter((a) => Number(a.diaSemana) === dow)
    .sort((a, b) => (a.inicio || '').localeCompare(b.inicio || ''))
    .map((a) => ({ ...a, disciplinaNome: discMap.get(a.disciplinaId)?.nome || 'Aula' }));

  const pendentes = demandas.filter((d) => d.status !== 'concluida');
  const entregasHoje = pendentes.filter((d) => d.prazo === hojeISO);
  const provasProximas = pendentes
    .filter((d) => d.tipo === 'prova' && d.prazo && d.prazo >= hojeISO)
    .sort((a, b) => a.prazo.localeCompare(b.prazo));

  const focoSugerido = pendentes.find((d) => d.prioridade === 'urgente') || entregasHoje[0] || provasProximas[0] || pendentes[0] || null;

  const minsFoco = sessoes.reduce((acc, s) => acc + Number(s.minutos || 0), 0);
  const concluidasTotal = demandas.filter((d) => d.status === 'concluida').length;

  return {
    aulasHoje,
    entregasHoje,
    proximaProva: provasProximas[0] || null,
    focoSugerido,
    horasFoco: (minsFoco / 60).toFixed(1),
    concluidasTotal
  };
}

/**
 * Gera resumo semanal de estudos sob demanda com tom gentil.
 */
export async function generateStudentWeeklySummary(demandas, sessoes) {
  const pendentes = demandas.filter((d) => d.status !== 'concluida');
  const concluidas = demandas.filter((d) => d.status === 'concluida').length;
  const mins = sessoes.reduce((acc, s) => acc + Number(s.minutos || 0), 0);
  const provas = pendentes.filter((d) => d.tipo === 'prova').slice(0, 4).map((d) => d.titulo);

  if (!ai) {
    return `Você concluiu ${concluidas} tarefa(s) e acumulou ${Math.round(mins / 60 * 10) / 10}h de foco. Próximas provas: ${provas.join(', ') || 'nenhuma cadastrada'}.`;
  }

  const model = getGenerativeModel(ai, {
    model: MODELO_GEMINI,
    generationConfig: { temperature: 0.3, maxOutputTokens: 240 }
  });

  const prompt = `Escreva um resumo semanal gentil e motivador para um estudante (máx. 4 frases, sem cobrança punitiva):
- Tarefas concluídas: ${concluidas}
- Pendências abertas: ${pendentes.length}
- Minutos de foco registrados: ${mins}
- Próximas provas: ${provas.join(', ') || 'nenhuma'}`;

  try {
    const res = await model.generateContent(prompt);
    return res.response.text().trim();
  } catch {
    return `Você concluiu ${concluidas} tarefa(s) e registrou ${mins} min de foco. Continue no seu ritmo!`;
  }
}
