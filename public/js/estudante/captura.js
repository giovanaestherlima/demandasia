// ============================================================================
// Etapa E4: Captura por Foto (Canvas + Gemini), Plano de Ensino e Export .ics
// ============================================================================

import { getGenerativeModel, Schema } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js';
import { ai } from '../firebase-config.js?v=5';
import { validateAiDemandJson, splitLocalBatchFallback } from '../ai.js?v=5';
import { matchDisciplineByName } from './disciplinas.js?v=5';

const MODELO_GEMINI = 'gemini-3.5-flash-lite';

/**
 * Redimensiona imagem no navegador via Canvas (~1280px, JPEG 0.7) antes de enviar à IA.
 * Nunca salva a imagem no Firestore.
 */
export function compressImageToBase64(file, maxDim = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve({
        base64: dataUrl.split(',')[1],
        mimeType: 'image/jpeg'
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a imagem selecionada.'));
    };
    img.src = url;
  });
}

function attachDisciplineAndType(item, disciplinas) {
  const { exact } = item.disciplinaNome
    ? matchDisciplineByName(item.disciplinaNome, disciplinas)
    : { exact: null };
  return {
    ...item,
    disciplinaId: exact ? exact.id : null,
    disciplinaSugerida: exact ? null : (item.disciplinaNome || null),
    tipo: item.tipo || 'outro'
  };
}

/**
 * Extrai demandas de uma foto do quadro, agenda ou aviso usando Gemini multimodal.
 */
export async function extractDemandsFromImageWithAI(file, disciplinas = []) {
  if (!ai) {
    throw new Error('IA indisponível no momento para leitura de imagem.');
  }
  const { base64, mimeType } = await compressImageToBase64(file);
  const model = getGenerativeModel(ai, {
    model: MODELO_GEMINI,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 800,
      responseMimeType: 'application/json',
      responseSchema: Schema.object({
        properties: {
          demandas: Schema.array({
            items: Schema.object({
              properties: {
                titulo: Schema.string(),
                descricao: Schema.string(),
                prioridade: Schema.enumString({ enum: ['baixa', 'media', 'alta', 'urgente'] }),
                prazo: Schema.string({ nullable: true }),
                disciplinaNome: Schema.string({ nullable: true }),
                tipo: Schema.enumString({ enum: ['prova', 'trabalho', 'leitura', 'seminario', 'lista', 'estudo', 'outro'] })
              },
              optionalProperties: ['prazo', 'disciplinaNome']
            })
          })
        }
      })
    }
  });

  const hojeISO = new Date().toISOString().slice(0, 10);
  const prompt = `Leia a imagem (quadro de aula, agenda ou aviso acadêmico) e extraia todas as tarefas, provas ou entregas em pt-BR. Hoje: ${hojeISO}.`;

  const res = await model.generateContent([
    prompt,
    { inlineData: { data: base64, mimeType } }
  ]);

  const parsed = JSON.parse(res.response.text());
  const lista = Array.isArray(parsed?.demandas) ? parsed.demandas : [];
  return lista.slice(0, 10).map((it) => ({
    ...validateAiDemandJson(it, it.titulo || 'Demanda da foto'),
    ...attachDisciplineAndType(it, disciplinas)
  }));
}

/**
 * Extrai provas, trabalhos e datas de um plano de ensino ou calendário acadêmico colado.
 */
export async function extractSyllabusWithAI(textoPlano, disciplinas = []) {
  const texto = String(textoPlano || '').trim();
  if (!texto) throw new Error('Cole o texto do plano de ensino.');

  if (!ai) {
    return splitLocalBatchFallback(texto).map((d) => ({ ...d, tipo: 'estudo', disciplinaId: null }));
  }

  const model = getGenerativeModel(ai, {
    model: MODELO_GEMINI,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 900,
      responseMimeType: 'application/json',
      responseSchema: Schema.object({
        properties: {
          demandas: Schema.array({
            items: Schema.object({
              properties: {
                titulo: Schema.string(),
                descricao: Schema.string(),
                prioridade: Schema.enumString({ enum: ['baixa', 'media', 'alta', 'urgente'] }),
                prazo: Schema.string({ nullable: true }),
                disciplinaNome: Schema.string({ nullable: true }),
                tipo: Schema.enumString({ enum: ['prova', 'trabalho', 'leitura', 'seminario', 'lista', 'estudo', 'outro'] })
              },
              optionalProperties: ['prazo', 'disciplinaNome']
            })
          })
        }
      })
    }
  });

  const hojeISO = new Date().toISOString().slice(0, 10);
  const prompt = `Extraia provas, trabalhos, seminários e entregas do plano de ensino/calendário abaixo (pt-BR). Hoje: ${hojeISO}. Máximo 12 itens.
Texto: """${texto.slice(0, 4500)}"""`;

  try {
    const res = await model.generateContent(prompt);
    const parsed = JSON.parse(res.response.text());
    const lista = Array.isArray(parsed?.demandas) ? parsed.demandas : [];
    return lista.slice(0, 12).map((it) => ({
      ...validateAiDemandJson(it, it.titulo || 'Entrega acadêmica'),
      ...attachDisciplineAndType(it, disciplinas)
    }));
  } catch {
    return splitLocalBatchFallback(texto).map((d) => ({ ...d, tipo: 'estudo', disciplinaId: null }));
  }
}

/**
 * Gera arquivo .ics (RFC 5545) no navegador para demandas com prazo e/ou grade semanal.
 */
export function exportToICS({ demandas = [], grade = [], disciplinas = [], filename = 'pauta-academico.ics' }) {
  const discMap = new Map(disciplinas.map((d) => [d.id, d]));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pauta//Modo Estudante//PT-BR',
    'CALSCALE:GREGORIAN'
  ];

  const sanitize = (s) => String(s || '').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

  for (const d of demandas) {
    if (!d.prazo || !/^\d{4}-\d{2}-\d{2}$/.test(d.prazo)) continue;
    const dateCompact = d.prazo.replace(/-/g, '');
    const disc = d.disciplinaId ? discMap.get(d.disciplinaId) : null;
    const prefix = d.tipo ? `[${d.tipo.toUpperCase()}] ` : '';
    lines.push(
      'BEGIN:VEVENT',
      `UID:pauta-${d.id || Math.random().toString(36).slice(2)}@pauta.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateCompact}`,
      `SUMMARY:${sanitize(`${prefix}${d.titulo}${disc ? ` (${disc.nome})` : ''}`)}`,
      `DESCRIPTION:${sanitize(d.descricao || '')}`,
      'END:VEVENT'
    );
  }

  const byDayCode = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const hoje = new Date();
  for (const aula of grade) {
    const disc = discMap.get(aula.disciplinaId);
    const dow = Number(aula.diaSemana || 0);
    const diff = (dow - hoje.getDay() + 7) % 7;
    const firstDate = new Date(hoje);
    firstDate.setDate(hoje.getDate() + diff);
    const ymd = firstDate.toISOString().slice(0, 10).replace(/-/g, '');
    const hIni = (aula.inicio || '08:00').replace(':', '') + '00';
    const hFim = (aula.fim || '10:00').replace(':', '') + '00';

    lines.push(
      'BEGIN:VEVENT',
      `UID:pauta-aula-${aula.id || Math.random().toString(36).slice(2)}@pauta.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${ymd}T${hIni}`,
      `DTEND:${ymd}T${hFim}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${byDayCode[dow]};COUNT=20`,
      `SUMMARY:${sanitize(`Aula: ${disc?.nome || 'Disciplina'}`)}`,
      `LOCATION:${sanitize(aula.local || disc?.sala || '')}`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
