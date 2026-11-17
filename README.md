# Pauta — Assistente de Demandas por Voz e Texto

O **Pauta** é um assistente calmo e objetivo para registrar, organizar e acompanhar demandas por **comando de voz** ou **texto livre**, usando **HTML, CSS e JavaScript puros (ES Modules)**, sem build e sem servidor próprio.

---

## O que está implementado (Fases 1 a 6)

- **Fase 1 (Velocidade da IA):** prévia otimista instantânea (< 1s) por heurística local, refinamento em streaming com `gemini-3.5-flash-lite` sem sobrescrever campos editados manualmente, cache em memória, timeout de 8s com botão *"Tentar de novo"*, persistência offline do Firestore (IndexedDB) e medidor de velocidade em Configurações.
- **Fase 2 (PWA e UX):** `manifest.json`, Service Worker (`/sw.js`) para uso offline da interface, botão *"Instalar"* (`beforeinstallprompt`), instrução para iPhone, skeletons de carregamento, estados vazios, atalhos de teclado (`N`, `/`, `M`, `Esc`, `?`) e toast **"Desfazer"** (~6s) ao concluir, editar ou excluir.
- **Fase 3 (Gestão avançada):** subtarefas/checklist com barra de progresso, botão **Adiar (Soneca)**, demandas recorrentes (`diaria`, `semanal`, `mensal`, `dia_mes`), etiquetas com cores e filtro, visões por prazo (`Hoje`, `Esta semana`, `Atrasadas`, `Sem prazo`), histórico (linha do tempo), captura em lote e detecção local de duplicatas.
- **Fase 4 (Comandos de voz de gestão):** seletor de modo (`Automático`, `Nova demanda`, `Comando`), consultas e ações por voz/texto com JSON estruturado de intenção, desambiguação e confirmação obrigatória antes de excluir.
- **Fase 5 (Lembretes, resumos e métricas):** lembretes locais com respeito à soneca, horário de silêncio e limite por hora; tela **"Bom dia"**; resumo semanal pela IA; colar contexto (e-mail/mensagem); sugestão local de prioridade pelo histórico; painel de métricas em SVG puro; exportação **CSV** e **Imprimir / PDF**.
- **Fase 6 (Segurança e qualidade):** `firestore.rules` validando dono (`uid`), tipos e limites de todos os campos; `Content-Security-Policy` em `firebase.json`; sanitização via `textContent`; suporte a Firebase App Check (reCAPTCHA Enterprise); e [TESTING.md](TESTING.md).

> **Importante sobre lembretes:** os lembretes funcionam **apenas com o Pauta aberto ou instalado como PWA**. Notificações com o aplicativo totalmente fechado exigiriam um servidor de push (Firebase Cloud Messaging + backend), fora do escopo atual.

---

## Configuração no Firebase (passo a passo)

1. **Criar projeto e app Web** no [Firebase Console](https://console.firebase.google.com/) e copiar o `firebaseConfig` para `public/js/firebase-config.js`.
2. **Authentication:** ativar provedor **Google** em *Build → Authentication → Sign-in method*.
3. **Cloud Firestore:** criar o banco de dados em *Build → Firestore Database*.
4. **Firebase AI Logic:** ativar *Gemini Developer API* em *Build → AI Logic* (ou via `npx.cmd -y firebase-tools@latest init ailogic`).
5. **Firebase App Check (recomendado para proteger a cota de IA):**
   - Crie uma chave **reCAPTCHA Enterprise** (tipo Site) no Google Cloud Console com os domínios `seu-projeto.web.app`, `seu-projeto.firebaseapp.com` e `localhost`.
   - Vincule a chave em *Build → App Check → Apps* e cole a chave pública em `RECAPTCHA_ENTERPRISE_SITE_KEY` no `public/js/firebase-config.js`.

---

## Testar localmente

> **Importante:** não abra o `index.html` via `file://`. ES Modules, Service Worker e Web Speech API exigem `http://localhost` ou `https://`.

```powershell
npx.cmd -y firebase-tools@latest login
npx.cmd -y firebase-tools@latest use pauta-demandas-gi
npx.cmd -y firebase-tools@latest serve --only hosting
```

Acesse `http://localhost:5000`.

---

## Deploy e atualizações futuras

Para publicar **Hosting + Regras + Índices** juntos:

```powershell
npx.cmd -y firebase-tools@latest deploy --only hosting,firestore:rules,firestore:indexes
```

Para subir atualizações depois no GitHub e no Firebase:

```powershell
git add .
git commit -m "Sua mensagem"
git push origin main
npx.cmd -y firebase-tools@latest deploy --only hosting,firestore:rules,firestore:indexes
```
