// ============================================================================
// Reconhecimento de Voz (Web Speech API) e Síntese de Fala (SpeechSynthesis)
// ============================================================================

const SpeechRecognitionClass =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

/**
 * Indica se o navegador atual suporta reconhecimento de voz.
 * @returns {boolean}
 */
export function isSpeechRecognitionSupported() {
  return Boolean(SpeechRecognitionClass);
}

/**
 * Cria um controlador de ditado em pt-BR com transcrição em tempo real.
 * @param {{
 *   onInterim: (texto: string) => void,
 *   onFinal: (texto: string) => void,
 *   onError: (mensagem: string) => void,
 *   onEnd: () => void
 * }} handlers
 */
export function createVoiceRecognizer(handlers) {
  if (!SpeechRecognitionClass) {
    return null;
  }

  let recognition = null;
  let cancelled = false;
  let finalTranscript = '';

  function start() {
    cancelled = false;
    finalTranscript = '';

    recognition = new SpeechRecognitionClass();
    recognition.lang = 'pt-BR';
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += `${piece} `;
        } else {
          interim += piece;
        }
      }
      const combinado = `${finalTranscript}${interim}`.trim();
      handlers.onInterim?.(combinado);
    };

    recognition.onerror = (event) => {
      if (cancelled) return;
      const mapaErros = {
        'not-allowed': 'Permissão de microfone negada. Habilite o microfone no navegador.',
        'no-speech': 'Não ouvi nenhuma fala. Tente falar mais perto do microfone.',
        'audio-capture': 'Nenhum microfone encontrado neste dispositivo.',
        network: 'Erro de rede no reconhecimento de voz.'
      };
      handlers.onError?.(mapaErros[event.error] || `Erro de voz: ${event.error}`);
    };

    recognition.onend = () => {
      const textoFinal = finalTranscript.trim();
      if (!cancelled && textoFinal) {
        handlers.onFinal?.(textoFinal);
      }
      handlers.onEnd?.();
    };

    recognition.start();
  }

  function stop() {
    if (recognition) {
      recognition.stop();
    }
  }

  function cancel() {
    cancelled = true;
    finalTranscript = '';
    if (recognition) {
      recognition.abort();
    }
  }

  return { start, stop, cancel };
}

/**
 * Lê um texto em voz alta usando SpeechSynthesis em português (pt-BR).
 * @param {string} text
 */
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

/**
 * Interrompe qualquer fala em andamento.
 */
export function stopSpeaking() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
