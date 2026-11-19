// ============================================================================
// Etapa C5: Gerador de Relatório Semanal em Texto (Local, sem IA por padrão)
// Opcionalmente oferece melhoria de redação com IA mantendo fatos e números.
// ============================================================================

import { getGenerativeModel } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js';
import { ai } from '../firebase-config.js?v=5';
import { buildDirectDemandUrl } from './links.js?v=1';

function toJsDate(val) {
  if (!val) return null;
  if (typeof val.toDate === 'function') return val.toDate();
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateShort(val) {
  if (!val) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split('-');
    return `${d}/${m}/${y}`;
  }
  const dt = toJsDate(val);
  return dt ? dt.toLocaleDateString('pt-BR') : '';
}

export function getPeriodRange(period, customStart, customEnd) {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (period === 'atual') {
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1; // segunda-feira
    start.setDate(start.getDate() - diff);
  } else if (period === 'passada') {
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - diff - 7);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } else if (period === '14d') {
    start.setDate(start.getDate() - 14);
  } else if (period === '30d') {
    start.setDate(start.getDate() - 30);
  } else if (period === 'custom' && customStart && customEnd) {
    return {
      start: new Date(`${customStart}T00:00:00`),
      end: new Date(`${customEnd}T23:59:59`)
    };
  } else {
    start.setDate(start.getDate() - 7);
  }

  return { start, end };
}

function bold(text, format) {
  if (format === 'mensagem') return `*${text}*`;
  if (format === 'markdown') return `**${text}**`;
  return text.toUpperCase();
}

export function generateWeeklyReportText(demandas, opts = {}) {
  const {
    wsId = '',
    wsNome = 'Espaço',
    period = '7d',
    customStart = '',
    customEnd = '',
    scope = 'espaco',
    scopeValue = '',
    currentUid = '',
    detail = 'resumido',
    format = 'texto',
    stalledDays = 7,
    includeLinks = false,
    includeDescriptions = false,
    includeUpcoming = true
  } = opts;

  const { start, end } = getPeriodRange(period, customStart, customEnd);
  const hoje = new Date();
  const hojeISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;

  // Filtro de escopo
  const scoped = (demandas || []).filter((d) => {
    if (scope === 'minhas') {
      const uids = Array.isArray(d.responsaveisUids) ? d.responsaveisUids : (d.responsavelUid ? [d.responsavelUid] : []);
      return uids.includes(currentUid);
    }
    if (scope === 'pessoa' && scopeValue) {
      const uids = Array.isArray(d.responsaveisUids) ? d.responsaveisUids : (d.responsavelUid ? [d.responsavelUid] : []);
      return uids.includes(scopeValue);
    }
    if (scope === 'reuniao' && scopeValue) {
      return d.reuniaoId === scopeValue;
    }
    if (scope === 'etiqueta' && scopeValue) {
      return (d.etiquetas || []).includes(scopeValue);
    }
    return true;
  });

  const concluidas = scoped.filter((d) => {
    if (d.status !== 'concluida') return false;
    const dt = toJsDate(d.concluidoEm) || toJsDate(d.atualizadoEm);
    return dt && dt >= start && dt <= end;
  });

  const pendentes = scoped.filter((d) => d.status !== 'concluida');
  const atrasadas = pendentes.filter((d) => d.prazo && d.prazo < hojeISO);

  const msStalled = Math.max(1, Number(stalledDays) || 7) * 86400000;
  const paradas = pendentes.filter((d) => {
    const upd = toJsDate(d.atualizadoEm) || toJsDate(d.criadoEm);
    return upd && (Date.now() - upd.getTime()) >= msStalled;
  });

  const proximos = pendentes
    .filter((d) => d.prazo && d.prazo >= hojeISO)
    .sort((a, b) => a.prazo.localeCompare(b.prazo));

  const formatLine = (d, extra = '') => {
    const prefix = format === 'markdown' ? '- ' : '• ';
    let line = `${prefix}${d.titulo}`;
    if (extra) line += ` (${extra})`;
    if (detail === 'detalhado' && d.responsavelNome) {
      line += ` — Resp.: ${d.responsavelNome}`;
    }
    if (includeDescriptions && d.descricao) {
      line += `\n  ${d.descricao.slice(0, 180)}`;
    }
    if (includeLinks && wsId && d.id) {
      line += `\n  ${buildDirectDemandUrl(wsId, d.id)}`;
    }
    return line;
  };

  const periodoTxt = `${start.toLocaleDateString('pt-BR')} a ${end.toLocaleDateString('pt-BR')}`;
  const lines = [
    `${bold(`Relatório — ${wsNome}`, format)}`,
    `Período: ${periodoTxt}`,
    ''
  ];

  lines.push(`${bold(`Concluídas (${concluidas.length})`, format)}`);
  if (concluidas.length === 0) {
    lines.push('Nenhuma demanda concluída neste período.');
  } else {
    for (const d of concluidas) {
      const quem = d.concluidoPorNome ? `por ${d.concluidoPorNome}` : '';
      const quando = formatDateShort(d.concluidoEm || d.atualizadoEm);
      const extra = [quem, quando].filter(Boolean).join(' em ');
      lines.push(formatLine(d, extra));
    }
  }
  lines.push('');

  lines.push(`${bold(`Atrasadas (${atrasadas.length})`, format)}`);
  if (atrasadas.length === 0) {
    lines.push('Nenhuma demanda atrasada.');
  } else {
    for (const d of atrasadas) {
      const dias = Math.max(1, Math.floor((new Date(`${hojeISO}T12:00:00`) - new Date(`${d.prazo}T12:00:00`)) / 86400000));
      lines.push(formatLine(d, `${dias} dia(s) de atraso`));
    }
  }
  lines.push('');

  lines.push(`${bold(`Paradas há +${stalledDays} dias (${paradas.length})`, format)}`);
  if (paradas.length === 0) {
    lines.push('Nenhuma demanda parada.');
  } else {
    for (const d of paradas) {
      const upd = toJsDate(d.atualizadoEm) || toJsDate(d.criadoEm);
      const dias = upd ? Math.floor((Date.now() - upd.getTime()) / 86400000) : stalledDays;
      lines.push(formatLine(d, `sem atualização há ${dias} dia(s)`));
    }
  }

  if (includeUpcoming) {
    lines.push('');
    lines.push(`${bold(`Próximos prazos (${proximos.length})`, format)}`);
    if (proximos.length === 0) {
      lines.push('Sem prazos futuros definidos.');
    } else {
      for (const d of proximos.slice(0, 15)) {
        lines.push(formatLine(d, `prazo ${formatDateShort(d.prazo)}`));
      }
    }
  }

  return lines.join('\n');
}

export async function polishReportWithAI(rawText) {
  if (!ai) throw new Error('IA indisponível.');
  const model = getGenerativeModel(ai, {
    model: 'gemini-3.8-flash',
    generationConfig: { maxOutputTokens: 1200 }
  });
  const prompt = [
    'Melhore a redação do relatório semanal abaixo mantendo TODOS os fatos, números, datas, nomes e links exatamente iguais, sem inventar nada.',
    'Deixe o texto claro, executivo e cordial em português do Brasil.',
    '',
    rawText
  ].join('\n');
  const res = await model.generateContent(prompt);
  return res.response.text().trim();
}
