// ============================================================================
// Reconhecimento de Voz (Web Speech API) e Síntese de Fala (SpeechSynthesis)
// Nunca encerra nem envia sozinho: aguarda o usuário clicar em "Organizar".
// ============================================================================

const SpeechRecognitionClass =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

export function isSpeechRecognitionSupported() {
  return Boolean(SpeechRecognitionClass);
}

/**
 * Cria um controlador de ditado em pt-BR que acumula falas continuamente
 * até o usuário clicar explicitamente em stop() ("Organizar") ou cancel().
 */
export function createVoiceRecognizer(handlers) {
  if (!SpeechRecognitionClass) {
    return null;
  }

  let recognition = null;
  let cancelled = false;
  let userStopped = false;
  let accumulatedFinal = '';

  function startInstance() {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    recognition = new SpeechRecognitionClass();
    recognition.lang = 'pt-BR';
    recognition.interimResults = true;
    recognition.continuous = !isMobile;

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          accumulatedFinal += `${piece} `;
        } else {
          interim += piece;
        }
      }
      const combinado = `${accumulatedFinal}${interim}`.trim();
      handlers.onInterim?.(combinado);
    };

    recognition.onerror = (event) => {
      if (cancelled) return;
      // 'no-speech' ou 'aborted' durante pausa não devem encerrar se o usuário não parou
      if (event.error === 'no-speech' && !userStopped) {
        return;
      }
      const mapaErros = {
        'not-allowed': 'Permissão de microfone negada. Habilite o microfone no navegador.',
        'service-not-allowed': 'Voz bloqueada por este navegador (comum no Safari/iOS). Dica: toque no campo abaixo e use o microfone do próprio teclado do celular!',
        'audio-capture': 'Nenhum microfone encontrado neste dispositivo.',
        network: 'Erro de rede no reconhecimento de voz.'
      };
      if (mapaErros[event.error]) {
        userStopped = true;
        handlers.onError?.(mapaErros[event.error]);
      }
    };

    recognition.onend = () => {
      if (cancelled) {
        handlers.onEnd?.();
        return;
      }

      // Se o usuário ainda não clicou em "Organizar", continua ouvindo sem cortar!
      if (!userStopped) {
        try {
          startInstance();
          return;
        } catch {
          // Se o navegador impedir reinício automático, mantém o texto na tela
        }
      }

      const textoFinal = accumulatedFinal.trim();
      if (userStopped && textoFinal) {
        handlers.onFinal?.(textoFinal);
      }
      handlers.onEnd?.();
    };

    recognition.start();
  }

  function start() {
    cancelled = false;
    userStopped = false;
    accumulatedFinal = '';
    startInstance();
  }

  function stop() {
    userStopped = true;
    if (recognition) {
      recognition.stop();
    } else if (accumulatedFinal.trim()) {
      handlers.onFinal?.(accumulatedFinal.trim());
      handlers.onEnd?.();
    }
  }

  function cancel() {
    cancelled = true;
    userStopped = true;
    accumulatedFinal = '';
    if (recognition) {
      recognition.abort();
    }
  }

  return { start, stop, cancel };
}

export function speakText(text) {
  if (!('speechSynthesis' in window) || !text) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'pt-BR';
  utterance.rate = 1.02;

  const voices = window.speechSynthesis.getVoices();
  const ptVoice = voices.find((v) => v.lang.toLowerCase().startsWith('pt-br'))
    || voices.find((v) => v.lang.toLowerCase().startsWith('pt'));
  if (ptVoice) {
    utterance.voice = ptVoice;
  }

  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
