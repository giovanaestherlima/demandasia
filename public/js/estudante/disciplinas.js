// ============================================================================
// Etapa E1 & E3: Disciplinas, Semestres, Grade Semanal, Notas e Faltas
// Carregado sob demanda apenas quando Modo Estudante está ativo.
// ============================================================================

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  limit,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { db } from '../firebase-config.js?v=5';
import { trackReads, trackWrites } from '../workspaces.js?v=5';

export const CORES_DISCIPLINAS = [
  '#1F6F78', '#FF6B5B', '#4F9D69', '#E9B44C',
  '#6C5CE7', '#0984E3', '#D63031', '#00B894'
];

export const DIAS_SEMANA = [
  'Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'
];

export const TIPOS_ACADEMICOS = [
  { value: 'prova', label: 'Prova' },
  { value: 'trabalho', label: 'Trabalho' },
  { value: 'lista', label: 'Lista / Exercício' },
  { value: 'leitura', label: 'Leitura' },
  { value: 'seminario', label: 'Seminário' },
  { value: 'estudo', label: 'Estudo' },
  { value: 'outro', label: 'Outro' }
];

/**
 * Carrega semestres, disciplinas e grade horária do espaço ativo (1 leitura por coleção, com limit).
 */
export async function loadAcademicData(wsId) {
  const [semSnap, discSnap, gradeSnap] = await Promise.all([
    getDocs(query(collection(db, 'workspaces', wsId, 'semestres'), limit(30))),
    getDocs(query(collection(db, 'workspaces', wsId, 'disciplinas'), limit(60))),
    getDocs(query(collection(db, 'workspaces', wsId, 'grade'), limit(100)))
  ]);

  trackReads(Math.max(1, semSnap.size) + Math.max(1, discSnap.size) + Math.max(1, gradeSnap.size));

  return {
    semestres: semSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    disciplinas: discSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    grade: gradeSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  };
}

// ---------- Semestres ----------
export async function createSemestre(wsId, nome) {
  trackWrites(1);
  const ref = await addDoc(collection(db, 'workspaces', wsId, 'semestres'), {
    nome: String(nome || '').trim().slice(0, 60),
    arquivado: false,
    criadoEm: serverTimestamp()
  });
  return { id: ref.id, nome: String(nome || '').trim().slice(0, 60), arquivado: false };
}

export async function toggleArchiveSemestre(wsId, semId, arquivado) {
  trackWrites(1);
  return updateDoc(doc(db, 'workspaces', wsId, 'semestres', semId), {
    arquivado: Boolean(arquivado)
  });
}

// ---------- Disciplinas ----------
export async function createDisciplina(wsId, dados) {
  const payload = {
    nome: String(dados.nome || '').trim().slice(0, 80),
    cor: String(dados.cor || CORES_DISCIPLINAS[0]).slice(0, 20),
    professor: String(dados.professor || '').trim().slice(0, 80),
    sala: String(dados.sala || '').trim().slice(0, 40),
    faltasMax: dados.faltasMax ? Number(dados.faltasMax) : 0,
    faltasAtuais: Number(dados.faltasAtuais || 0),
    qtdProvas: Math.min(12, Math.max(1, Number(dados.qtdProvas) || 2)),
    temFinal: dados.temFinal !== undefined ? Boolean(dados.temFinal) : true,
    notaMinima: dados.notaMinima !== undefined ? Number(dados.notaMinima) : 7,
    notaMinimaFinal: dados.notaMinimaFinal !== undefined ? Number(dados.notaMinimaFinal) : 5,
    avaliacoes: Array.isArray(dados.avaliacoes) ? dados.avaliacoes : [],
    semestreId: String(dados.semestreId || 'geral').slice(0, 60),
    criadoEm: serverTimestamp()
  };
  trackWrites(1);
  const ref = await addDoc(collection(db, 'workspaces', wsId, 'disciplinas'), payload);
  return { id: ref.id, ...payload };
}

export async function updateDisciplina(wsId, discId, patch) {
  trackWrites(1);
  return updateDoc(doc(db, 'workspaces', wsId, 'disciplinas', discId), patch);
}

export async function deleteDisciplina(wsId, discId) {
  trackWrites(1);
  return deleteDoc(doc(db, 'workspaces', wsId, 'disciplinas', discId));
}

// ---------- Grade Horária ----------
export async function createAulaGrade(wsId, dados) {
  const payload = {
    disciplinaId: String(dados.disciplinaId),
    diaSemana: Math.min(6, Math.max(0, Number(dados.diaSemana))),
    inicio: String(dados.inicio || '08:00').slice(0, 10),
    fim: String(dados.fim || '10:00').slice(0, 10),
    local: String(dados.local || '').trim().slice(0, 40)
  };
  trackWrites(1);
  const ref = await addDoc(collection(db, 'workspaces', wsId, 'grade'), payload);
  return { id: ref.id, ...payload };
}

export async function deleteAulaGrade(wsId, aulaId) {
  trackWrites(1);
  return deleteDoc(doc(db, 'workspaces', wsId, 'grade', aulaId));
}

// ---------- Cálculo Assertivo de Notas (Provas + Final) ----------
export function computeWeightedGrade(avaliacoes = [], config = {}) {
  const notaMinima = Number(config.notaMinima ?? 7);
  const qtdProvas = Math.max(1, Number(config.qtdProvas ?? 2));
  const temFinal = config.temFinal !== undefined ? Boolean(config.temFinal) : true;
  const notaMinimaFinal = Number(config.notaMinimaFinal ?? 5);

  let somaNotas = 0;
  let somaPesos = 0;
  let preenchidas = 0;

  for (const av of avaliacoes) {
    const n = Number(av.nota);
    const p = Number(av.peso || 1);
    if (!Number.isNaN(n) && p > 0) {
      somaNotas += n * p;
      somaPesos += p;
      preenchidas += 1;
    }
  }

  if (preenchidas === 0) {
    return {
      mediaAtual: null,
      preenchidas: 0,
      qtdProvas,
      faltamProvas: qtdProvas,
      precisaNasRestantes: notaMinima,
      precisaNaFinal: null,
      situacao: 'sem_notas'
    };
  }

  const mediaAtual = Number((somaNotas / somaPesos).toFixed(2));
  const faltamProvas = Math.max(0, qtdProvas - preenchidas);

  // Quanto precisa tirar de média nas provas restantes (considerando peso 1 por prova restante)
  let precisaNasRestantes = null;
  if (faltamProvas > 0) {
    const totalPesosEsperado = somaPesos + faltamProvas;
    const pontosNecessarios = notaMinima * totalPesosEsperado - somaNotas;
    precisaNasRestantes = Number(Math.max(0, pontosNecessarios / faltamProvas).toFixed(2));
  }

  // Se já fechou todas as provas ou se nem tirando 10 nas restantes atinge a média direta:
  let precisaNaFinal = null;
  let situacao = 'em_andamento';

  if (faltamProvas === 0) {
    if (mediaAtual >= notaMinima) {
      situacao = 'aprovado_direto';
    } else if (temFinal) {
      situacao = 'vai_para_final';
      // Média final padrão: (mediaParcial + notaFinal) / 2 >= notaMinimaFinal
      precisaNaFinal = Number(Math.max(0, 2 * notaMinimaFinal - mediaAtual).toFixed(2));
    } else {
      situacao = 'abaixo_media';
    }
  } else if (precisaNasRestantes > 10 && temFinal) {
    // Estimativa caso tire 0 ou mantenha média atual e vá para final
    precisaNaFinal = Number(Math.max(0, 2 * notaMinimaFinal - mediaAtual).toFixed(2));
  }

  return {
    mediaAtual,
    preenchidas,
    qtdProvas,
    faltamProvas,
    precisaNasRestantes,
    precisaNaFinal,
    situacao,
    temFinal,
    notaMinima,
    notaMinimaFinal
  };
}

/**
 * Casa localmente um nome de disciplina falado/extraído pela IA com as cadastradas.
 */
export function matchDisciplineByName(nomeSugerido, disciplinas) {
  if (!nomeSugerido || !Array.isArray(disciplinas)) return { exact: null, matches: [] };
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  const alvo = norm(nomeSugerido);
  const matches = disciplinas.filter((d) => {
    const dn = norm(d.nome);
    return dn === alvo || dn.includes(alvo) || alvo.includes(dn);
  });

  if (matches.length === 1) return { exact: matches[0], matches };
  return { exact: null, matches };
}

/**
 * Procura qualquer disciplina cadastrada citada dentro de um texto livre (voz ou digitado).
 */
export function detectDisciplineInText(texto, disciplinas) {
  if (!texto || !Array.isArray(disciplinas) || disciplinas.length === 0) return null;
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const textoNorm = norm(texto);
  // Ordena por nome mais longo primeiro para evitar falsos positivos curtos
  const ordenadas = [...disciplinas].sort((a, b) => (b.nome || '').length - (a.nome || '').length);
  for (const disc of ordenadas) {
    const nomeNorm = norm(disc.nome).trim();
    if (nomeNorm.length >= 2 && textoNorm.includes(nomeNorm)) {
      return disc;
    }
  }
  return null;
}
