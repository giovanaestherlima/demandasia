# Checklist de Teste Manual — Pauta

Use esta lista para validar todas as funcionalidades após o deploy em `https://pauta-demandas-gi.web.app`.

## 1. Autenticação e Tema
- [ ] Abrir o site deslogado e entrar com **Google**.
- [ ] Confirmar que o nome e a foto aparecem no topo e que demandas carregam (skeletons antes do carregamento).
- [ ] Alternar o tema claro/escuro pelo botão do sol no cabeçalho e recarregar para confirmar persistência.
- [ ] Fazer logout e confirmar que a lista some e volta para a tela de login.

## 2. Velocidade da IA (Fase 1)
- [ ] Ativar **"Modo debug: exibir medidor de velocidade"** em **Configurações (⚙️)**.
- [ ] Digitar uma demanda (ex: *"Revisar contrato da Ana até sexta, urgente"*) e clicar em **Organizar**.
- [ ] Confirmar que a prévia abre em **menos de 1 segundo** com título limpo, prioridade `Urgente` e prazo preenchido, enquanto *"Refinando com IA…"* aparece no topo.
- [ ] Editar o título manualmente enquanto a IA ainda está refinando e confirmar que ela **não** sobrescreve sua edição.
- [ ] Enviar exatamente o mesmo texto novamente e verificar retorno instantâneo via **cache**.
- [ ] Testar modo *"Salvar direto sem mostrar prévia"*: o card aparece na hora e refina em segundo plano.

## 3. Voz e Texto (Desktop e Mobile)
- [ ] **Desktop (Chrome):** clicar no microfone coral, ver ondas pulsando e transcrição em tempo real, testar **Cancelar** e **Enviar agora**.
- [ ] **Celular (Android Chrome / iPhone Safari):** testar campo de texto (e microfone nativo do teclado no iPhone caso o navegador bloqueie `SpeechRecognition`).

## 4. PWA e Offline (Fase 2)
- [ ] No Chrome/Edge (desktop ou Android), clicar em **Instalar** no cabeçalho e abrir como app standalone.
- [ ] No DevTools → Network → marcar **Offline**, criar uma demanda e confirmar que ela aparece localmente e sincroniza ao voltar online.
- [ ] Testar atalhos de teclado no desktop: `N` (nova demanda), `/` (buscar), `M` (microfone), `?` (ajuda) e `Esc` (fechar modal).
- [ ] Concluir, editar e excluir uma demanda e testar o botão **"Desfazer"** no toast (~6s).

## 5. Gestão Avançada (Fase 3)
- [ ] Adicionar subtarefas, reordenar (↑) e marcar uma subtarefa; confirmar a barra de progresso no card.
- [ ] Clicar em **Adiar** (Soneca) e escolher *Até amanhã*; confirmar que o card mostra o badge de soneca e sai do painel *Atenção*.
- [ ] Criar uma demanda **Recorrente** (ex: semanal) e marcá-la como concluída; confirmar que a próxima ocorrência é criada automaticamente.
- [ ] Adicionar etiquetas (ex: `contrato, financeiro`) e filtrar pelas chips de etiqueta.
- [ ] Testar as visões por prazo: **Hoje**, **Esta semana**, **Atrasadas**, **Sem prazo**.
- [ ] Abrir uma demanda editada e expandir **Histórico da demanda** para ver a linha do tempo.
- [ ] Testar **Colar texto / Lote** com 2 ou 3 tarefas e usar **Salvar todas**.
- [ ] Tentar criar demanda muito parecida com uma pendente e confirmar o aviso de duplicata (*"Parece com..."*).

## 6. Comandos de Voz (Fase 4)
- [ ] No modo **Automático** ou **Comando**, testar:
  - *"O que está pendente?"*
  - *"Qual a demanda mais antiga?"*
  - *"O que vence hoje?"*
  - *"Conclui a demanda [nome]"*
  - *"Exclui a demanda [nome]"* (deve pedir confirmação obrigatória).

## 7. Métricas, Bom Dia e Exportação (Fase 5)
- [ ] Clicar em **Bom dia** no cabeçalho e testar **Ouvir**.
- [ ] Clicar em **Métricas**, conferir os números, o gráfico SVG de 4 semanas e clicar em **Gerar resumo semanal com IA**.
- [ ] Testar **Exportar CSV** e **Imprimir / PDF**.
