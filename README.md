# Pauta — Assistente de Demandas por Voz

O **Pauta** é um assistente calmo e objetivo para registrar e acompanhar demandas por **comando de voz** ou **texto livre**, usando **HTML, CSS e JavaScript puros (ES Modules)**, sem build e sem servidor próprio.

---

## Funcionalidades incluídas (Fase 1)

- **Entrada por voz (`pt-BR`) e texto:** botão de microfone com ondas animadas, transcrição em tempo real, botão de cancelar e fallback automático caso o navegador não suporte `SpeechRecognition`.
- **Organização com IA (Firebase AI Logic / Gemini):** transforma falas soltas em JSON validado (`titulo`, `descricao`, `prioridade`, `prazo`, `categoria`). Se a IA estiver indisponível, entra automaticamente o **modo simples** (`titulo` = primeiras palavras, `descricao` = texto completo).
- **Prévia editável:** revise título, descrição, prioridade e prazo antes de salvar (ou ative *"Salvar direto sem prévia"* nas configurações).
- **Painel "Atenção" + Resumo falado:** destaca demandas abertas há mais tempo (3+ dias amarelo, 7+ laranja, 14+ vermelho ou prazo vencido) e faz um resumo falado em `pt-BR` ao abrir (com opção de silenciar).
- **Lembretes periódicos:** alertas in-app e pela `Notification` API do navegador enquanto a aba estiver aberta.
- **Login Google + Firestore:** cada usuário acessa apenas as próprias demandas (`users/{uid}/demandas`), protegidas por `firestore.rules`.
- **Modo claro e escuro:** segue a preferência do sistema operacional com alternância manual no topo.

---

## Passo a passo de configuração no Firebase

### 1. Criar o projeto no Firebase
1. Acesse o [Firebase Console](https://console.firebase.google.com/).
2. Clique em **Adicionar projeto**, dê um nome (ex: `pauta-demandas`) e conclua a criação.
3. Na visão geral do projeto, clique no ícone **Web (`</>`)** para registrar um aplicativo web e copie o objeto `firebaseConfig`.

### 2. Ativar Authentication (Login com Google)
1. No menu lateral, acesse **Build → Authentication** e clique em **Vamos começar**.
2. Na aba **Sign-in method**, ative o provedor **Google**, escolha um e-mail de suporte e salve.
3. Em **Configurações → Domínios autorizados**, confirme que `localhost` e seu domínio `.web.app` estão listados.

### 3. Ativar o Cloud Firestore
1. Acesse **Build → Firestore Database** e clique em **Criar banco de dados**.
2. Escolha a região mais próxima (ex: `southamerica-east1` — São Paulo) e inicie no modo de produção.
3. As regras de segurança definitivas estão no arquivo `firestore.rules` deste repositório.

### 4. Ativar o Firebase AI Logic (Gemini)
1. No Firebase Console, acesse **Build → AI Logic** (ou execute `npx firebase-tools init ailogic` na pasta do projeto).
2. Selecione o provedor **Gemini Developer API** (possui camada gratuita para prototipagem e uso pessoal com o modelo `gemini-4-hydrogen`).
3. *(Recomendado para produção)* Ative o **Firebase App Check** (reCAPTCHA Enterprise) para evitar uso indevido da sua cota de IA por terceiros.

### 5. Colar a configuração no código
Abra o arquivo `public/js/firebase-config.js` e substitua o objeto `firebaseConfig` pelos dados copiados no passo 1:

```js
const firebaseConfig = {
  apiKey: 'SUA_API_KEY',
  authDomain: 'SEU_PROJETO.firebaseapp.com',
  projectId: 'SEU_PROJETO_ID',
  storageBucket: 'SEU_PROJETO.firebasestorage.app',
  messagingSenderId: 'SEU_SENDER_ID',
  appId: 'SEU_APP_ID'
};
```

---

## Testar localmente

> **Importante:** não abra o `index.html` diretamente via `file://`. ES Modules e a Web Speech API exigem `http://localhost` ou `https://`.

Com o Node.js instalado, rode na pasta `demandasia`:

```bash
npx firebase-tools login
npx firebase-tools use --add
npx firebase-tools serve --only hosting
```

Acesse `http://localhost:5000` no navegador.

---

## Fazer deploy (Hosting + Regras do Firestore)

Na raiz do projeto (`demandasia/`), execute:

```bash
npx firebase-tools deploy --only hosting,firestore:rules,firestore:indexes
```

Ao final, o terminal exibirá a URL pública (ex: `https://seu-projeto.web.app`). No celular, você pode abrir essa URL no Chrome/Safari e usar **"Adicionar à tela inicial"** para usar como aplicativo.

### Como subir atualizações depois

1. Salve e envie suas alterações para o GitHub:
   ```bash
   git add .
   git commit -m "Sua mensagem de atualização"
   git push origin main
   ```
2. Publique a nova versão no Firebase:
   ```bash
   npx firebase-tools deploy --only hosting,firestore:rules
   ```

---

## Fase 2 (Opcional / Próximos passos)

Os itens abaixo foram deixados intencionalmente fora da Fase 1 para manter o projeto enxuto e sem complexidade extra agora:

1. **Notificações com o site fechado (Push / FCM):** implementar *Firebase Cloud Messaging* com Service Worker (`firebase-messaging-sw.js`) e agendamento em Cloud Functions/Cloud Scheduler para disparar lembretes mesmo quando o navegador estiver fechado.
2. **Comandos de voz de gestão:** permitir frases como *"o que está pendente?"*, *"qual a demanda mais antiga?"* ou *"conclui a demanda do relatório"*, interpretadas pela IA com confirmação explícita antes de alterar ou excluir registros.
3. **Integração com o sistema Python local:** criar um script Python usando `firebase-admin` (ou exportação JSON) para sincronizar automaticamente as demandas do Pauta com o seu programa local.
