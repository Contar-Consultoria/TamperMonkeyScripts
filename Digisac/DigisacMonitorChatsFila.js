(function () {
    'use strict';

    // Configurações de Intervalo de Verificação Geral
    const INTERVALO = 30000; //

// Intervalos específicos para cada tipo de notificação
    const INTERVALO_RESPOSTA = 120000; // 2 minutos
    const INTERVALO_ABERTOS = 1080000; // 18 minutos
    const INTERVALO_FILA = 120000; // 2 minutos

    // Controle de última notificação enviada
    let ultimaResposta = 0;
    let ultimoAberto = 0;
    let ultimaFila = 0;

    if (Notification.permission !== 'granted') {
        Notification.requestPermission();
    }

    function notificar(mensagem) {
        if (Notification.permission !== 'granted') return;
        const notificacao = new Notification('DIGISAC', {
            body: mensagem
        });
        setTimeout(() => {
            notificacao.close();
        }, 10000);
    }

    // ============================
    // FILA GERAL
    // ============================
    function quantidadeFila() {
        const abaFila =
            document.querySelector('[data-testid="chat-tab-queue_calls"]') ||
            document.querySelector('[data-testid*="queue-calls"]');
        if (!abaFila) return 0;
        const badge =
            abaFila.querySelector('.badge.badge-primary.badge-pill') ||
            abaFila.querySelector('.badge.badge-primary');
        if (!badge) return 0;
        const numero = parseInt(badge.textContent.trim(), 10);
        return isNaN(numero) ? 0 : numero;
    }

    // ============================
    // CHATS AGUARDANDO RESPOSTA
    // ============================
    function quantidadeChats() {
        const abaChats =
            document.querySelector('[data-testid="chat-tab-mine"]');
        if (!abaChats) return 0;
        const badge =
            abaChats.querySelector('.badge.badge-primary.badge-pill') ||
            abaChats.querySelector('.badge.badge-primary');
        const totalChats = badge
            ? parseInt(badge.textContent.trim(), 10)
            : 0;
        if (isNaN(totalChats) || totalChats === 0) {
            return 0;
        }
        const contatos = document.querySelectorAll('.chatContactDiv');
        if (!contatos.length) {
            return totalChats;
        }
        let aguardandoResposta = 0;
        contatos.forEach(contato => {
            const wrapper = contato.querySelector('.last-message-wrapper');
            if (!wrapper) return;
            // Se NÃO houver o ícone de confirmação,
            // entende que a última mensagem foi do cliente.
            const checkOperador = wrapper.querySelector('svg');
            if (!checkOperador) {
                aguardandoResposta++;
            }
        });
        return aguardandoResposta;
    }

    // ============================
    // VERIFICAÇÃO
    // ============================
    function verificar() {
        const chatsComigo = (() => {
            const abaChats = document.querySelector('[data-testid="chat-tab-mine"]');
            if (!abaChats) return 0;
            const badge =
                abaChats.querySelector('.badge.badge-primary.badge-pill') ||
                abaChats.querySelector('.badge.badge-primary');
            if (!badge) return 0;
            const numero = parseInt(badge.textContent.trim(), 10);
            return isNaN(numero) ? 0 : numero;
        })();

        const chatsAguardando = quantidadeChats();
        const fila = quantidadeFila();

        console.log(
            `[Digisac] ${new Date().toLocaleTimeString()} | Chats comigo: ${chatsComigo} | Aguardando resposta: ${chatsAguardando} | Fila: ${fila}`
        );

        const agora = Date.now();

        // Notificações baseadas em tempos independentes
        if (chatsAguardando > 0 && agora - ultimaResposta >= INTERVALO_RESPOSTA) {
            notificar(`• ${chatsAguardando} atendimento(s) aguardando sua resposta`);
            ultimaResposta = agora;
        }

        if (chatsComigo > 0 && agora - ultimoAberto >= INTERVALO_ABERTOS) {
            notificar(`• ${chatsComigo} ATENÇÃO! Atendimento se encerrando em 2 minutos!`);
            ultimoAberto = agora;
        }

        if (fila > 0 && agora - ultimaFila >= INTERVALO_FILA) {
            notificar(`• ${fila} chamado(s) na fila`);
            ultimaFila = agora;
        }
    }

    // Primeira verificação
    setTimeout(verificar, 500);

    // Verificações periódicas
    setInterval(verificar, INTERVALO);
})();