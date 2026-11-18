# Pauta — Assistente de Demandas por Voz e Texto

Aplicação web progressiva (PWA) feita em **HTML, CSS e JavaScript puros (ES Modules)**, sem build obrigatório, persistida no **Cloud Firestore** com **Firebase Auth (Google)**, **Firebase Hosting** e **Firebase AI Logic (Gemini)**.

URL em produção: https://pauta-demandas-gi.web.app

---

## Os 3 Modos do Pauta

1. **Simples (padrão)**: nenhum modo extra ativo. Captura por voz e texto, prazos, recorrência, subtarefas, alertas, métricas e espaços compartilhados. Zero módulos extras baixados.
2. **Estudante** (`?estudante=1`): planner em PDF (Semanal, Diário, Mensal multi-mês, Provas), disciplinas, grade horária, calculadora de notas (provas + final), controle de faltas digitável, captura por plano de ensino e modo foco.
3. **Corporativo** (`?trabalho=1`): reuniões e atas, extração de tarefas por voz ou texto/e-mail com prévia, histórico detalhado e atividade recente do espaço, relatório semanal em texto e links diretos para demandas.

Você pode ativar **Estudante** e **Corporativo** juntos ou separadamente pelo menu **Modos do Pauta** (no cabeçalho ou em *Configurações*), e desativar a qualquer momento sem perder seus dados salvos.

---

## Colaboração em Espaços Compartilhados

- **Espaços**: cada usuário possui seu espaço *Pessoal* e pode criar espaços compartilhados (`equipe`).
- **Convites**:
  - **Por link** (`?convite=TOKEN`) com papel `Editor` ou `Leitor` e limite de usos.
  - **Por e-mail**: envia via `mailto:` e exibe banner automático quando o convidado faz login.
- **Permissões**:
  - `admin`: gerencia membros, papéis, convites e demandas.
  - `editor`: cria, edita, conclui, atribui múltiplos responsáveis e comenta.
  - `leitor`: visualiza em tempo real e comenta (sem editar/excluir).

---

## Recursos do Modo Corporativo

- **Reuniões e atas**: lista paginada (`limit(15)`), ditado por voz incremental (acrescenta ao texto), rascunho local automático em `localStorage` e vínculo com as demandas geradas.
- **Extração de tarefas**:
  - *Voz* ("Falar a reunião") ou *Colar ata/e-mail* (até 15.000 caracteres).
  - Prévia obrigatória com casamento local de membros (tratando ambiguidade e nomes externos), detecção de duplicatas e criação em lote (`writeBatch`).
- **Histórico e Atividade recente**: registro de quem concluiu (`concluidoPorNome` / `concluidoPorUid`) e feed de atividade recente (`limit(30)`) carregado sob demanda.
- **Relatório semanal**: geração local (sem IA) em texto simples, WhatsApp/Teams ou Markdown, com opção de copiar, compartilhar, abrir no e-mail e *Melhorar redação com IA*.
- **Links diretos** (`?espaco=WSID&demanda=ID`): qualquer membro do espaço (mesmo no Modo Simples) abre diretamente a demanda com apenas 1 leitura; quem não é membro recebe aviso sem vazar dados.

---

## Deploy (Firebase Spark)

```powershell
npx.cmd -y firebase-tools@latest deploy --only hosting,firestore:rules,firestore:indexes --project pauta-demandas-gi
```

---

## Estimativa de Consumo de Cota (Spark — ~10 usuários)

- Limite gratuito Spark: **50.000 leituras/dia** e **20.000 gravações/dia**.
- Listener único apenas do espaço ativo (pausado automaticamente após 5 min com a aba em segundo plano).
- Comentários escutados apenas enquanto o modal da demanda está aberto.
- Reuniões (`limit(15)`) e Atividade recente (`limit(30)`) carregadas sob demanda, sem listeners permanentes.
- Relatórios e planners gerados 100% em memória a partir das demandas já carregadas.
- **Estimativa para 10 usuários ativos/dia**: ~1.500 a 3.500 leituras/dia (~7% da cota) e ~200 a 500 gravações/dia (~2,5% da cota).

---

## Fora do Escopo (Sem Servidor / Sem Cloud Functions)

- Notificações push com o navegador/app totalmente fechado.
- Envio automático de e-mails pelo servidor (convites por e-mail e relatórios usam `mailto:` no dispositivo do usuário).
