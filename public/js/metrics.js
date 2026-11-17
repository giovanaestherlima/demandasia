// ============================================================================
// Painel de Métricas (JS + SVG puro), Exportação CSV e Sugestão Local
// ============================================================================

import { toDate } from './alerts.js?v=5';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Calcula estatísticas gerais das demandas sem bibliotecas externas.
 * @param {Array<object>} demandas
 */
export function computeMetrics(demandas) {
  const concluidas = demandas.filter((d) => d.status === 'concluida');
  const pendentes = demandas.filter((d) => d.status !== 'concluida');

  // Tempo médio até concluir (em dias)
  let somaDias = 0;
  let countTempo = 0;
  let noPrazo = 0;
  let comPrazo = 0;

  for (const d of concluidas) {
    const ini = toDate(d.criadoEm);
    const fim = d.concluidoEm ? toDate(d.concluidoEm) : toDate(d.atualizadoEm);
    const dias = Math.max(0, (fim.getTime() - ini.getTime()) / (1000 * 60 * 60 * 24));
    somaDias += dias;
    countTempo += 1;

    if (d.prazo && /^\d{4}-\d{2}-\d{2}$/.test(d.prazo)) {
      comPrazo += 1;
      const fimISO = fim.toISOString().slice(0, 10);
      if (fimISO <= d.prazo) noPrazo += 1;
    }
  }

  const tempoMedioDias = countTempo > 0 ? (somaDias / countTempo).toFixed(1) : '—';
  const taxaNoPrazo = comPrazo > 0 ? `${Math.round((noPrazo / comPrazo) * 100)}%` : '—';

  // Concluídas por semana (últimas 4 semanas)
  const semanas = [0, 0, 0, 0];
  const agora = Date.now();
  const msSemana = 7 * 24 * 60 * 60 * 1000;
  for (const d of concluidas) {
    const fim = d.concluidoEm ? toDate(d.concluidoEm) : toDate(d.atualizadoEm);
    const diffSemanas = Math.floor((agora - fim.getTime()) / msSemana);
    if (diffSemanas >= 0 && diffSemanas < 4) {
      semanas[3 - diffSemanas] += 1;
    }
  }

  // Pendentes por prioridade
  const porPrioridade = {
    urgente: pendentes.filter((d) => d.prioridade === 'urgente').length,
    alta: pendentes.filter((d) => d.prioridade === 'alta').length,
    media: pendentes.filter((d) => d.prioridade === 'media').length,
    baixa: pendentes.filter((d) => d.prioridade === 'baixa').length
  };

  return {
    total: demandas.length,
    totalPendentes: pendentes.length,
    totalConcluidas: concluidas.length,
    tempoMedioDias,
    taxaNoPrazo,
    semanas,
    porPrioridade
  };
}

/**
 * Renderiza gráfico de barras em SVG puro para concluídas nas últimas 4 semanas.
 */
export function renderWeeklySvgChart(container, semanas) {
  container.replaceChildren();
  const maxVal = Math.max(1, ...semanas);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 280 110');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '110');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Demandas concluídas nas últimas 4 semanas');

  const labels = ['-3 sem', '-2 sem', '-1 sem', 'Atual'];
  semanas.forEach((val, idx) => {
    const barH = Math.round((val / maxVal) * 65);
    const x = 18 + idx * 64;
    const y = 82 - barH;

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', '40');
    rect.setAttribute('height', String(Math.max(3, barH)));
    rect.setAttribute('rx', '6');
    rect.setAttribute('fill', 'var(--primary)');

    const txtVal = document.createElementNS(SVG_NS, 'text');
    txtVal.setAttribute('x', String(x + 20));
    txtVal.setAttribute('y', String(y - 5));
    txtVal.setAttribute('text-anchor', 'middle');
    txtVal.setAttribute('font-size', '11');
    txtVal.setAttribute('fill', 'currentColor');
    txtVal.textContent = String(val);

    const txtLbl = document.createElementNS(SVG_NS, 'text');
    txtLbl.setAttribute('x', String(x + 20));
    txtLbl.setAttribute('y', '100');
    txtLbl.setAttribute('text-anchor', 'middle');
    txtLbl.setAttribute('font-size', '10');
    txtLbl.setAttribute('fill', 'var(--text-muted)');
    txtLbl.textContent = labels[idx];

    svg.append(rect, txtVal, txtLbl);
  });

  container.appendChild(svg);
}

/**
 * Sugere prioridade localmente (sem IA) com base no histórico de demandas parecidas.
 * @param {string} texto
 * @param {Array<object>} demandas
 */
export function suggestPriorityFromHistory(texto, demandas) {
  const tokens = new Set(
    String(texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\W+/)
      .filter((w) => w.length >= 4)
  );
  if (tokens.size === 0) return null;

  let urgentesSimilares = 0;
  let altasSimilares = 0;

  for (const d of demandas) {
    const alvo = `${d.titulo} ${d.descricao || ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    let hits = 0;
    for (const t of tokens) {
      if (alvo.includes(t)) hits += 1;
    }
    if (hits >= 2 || hits / tokens.size >= 0.4) {
      if (d.prioridade === 'urgente') urgentesSimilares += 1;
      if (d.prioridade === 'alta') altasSimilares += 1;
    }
  }

  if (urgentesSimilares >= 1) return 'urgente';
  if (altasSimilares >= 2) return 'alta';
  return null;
}

/**
 * Exporta a lista de demandas para arquivo CSV com BOM UTF-8 (compatível com Excel).
 */
export function exportDemandasToCSV(demandas) {
  const headers = ['Título', 'Descrição', 'Prioridade', 'Status', 'Prazo', 'Categoria', 'Etiquetas', 'Criado Em'];
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const rows = demandas.map((d) => [
    escape(d.titulo),
    escape(d.descricao),
    escape(d.prioridade),
    escape(d.status),
    escape(d.prazo || ''),
    escape(d.categoria || ''),
    escape((d.etiquetas || []).join('; ')),
    escape(toDate(d.criadoEm).toLocaleDateString('pt-BR'))
  ].join(','));

  const csv = `\uFEFF${headers.join(',')}\n${rows.join('\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pauta-demandas-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
