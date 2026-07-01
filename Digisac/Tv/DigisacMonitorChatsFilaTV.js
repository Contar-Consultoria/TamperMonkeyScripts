// @author Tiago Debossan <tiagodebossan@contarconsultoria.com>
// @author Gabriel Silveira <gabrielsilveira@contarconsultoria.com>

(function () {
    'use strict';

    // Intervalo entre verificações (10 segundos)
    const INTERVALO_MONITORAMENTO = 10000;

    // Solicita permissão para notificações
    if (Notification.permission !== 'granted') {
        Notification.requestPermission();
    }

    // ==========================
    // SOM
    // ==========================

    function tocarSom() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.value = 900;

            osc.connect(gain);
            gain.connect(ctx.destination);

            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(
                0.001,
                ctx.currentTime + 0.5
            );

            osc.start();
            osc.stop(ctx.currentTime + 0.5);

        } catch (e) {
            console.error('[Digisac] Erro ao tocar som:', e);
        }
    }

    // ==========================
    // NOTIFICAÇÃO
    // ==========================

    function notificar(qtd) {

        tocarSom();

        if (Notification.permission === 'granted') {

            const notificacao = new Notification('DIGISAC', {
                body: `Há ${qtd} chamado(s) aguardando na fila.`
            });

            setTimeout(() => {
                notificacao.close();
            }, 10000);

        }

    }

    // ==========================
    // OBTÉM QUANTIDADE DA FILA
    // ==========================

    function obterQuantidadeFila() {

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

    // ==========================
    // SELECIONA ABA FILA
    // ==========================

    function clicarAbaFila() {

        const aba =
            document.querySelector('[data-testid="chat-tab-queue_calls"]');

        if (!aba) {
            return false;
        }

        const ativa =
            aba.getAttribute('aria-selected') === 'true' ||
            aba.classList.contains('active') ||
            aba.getAttribute('data-state') === 'active';

        if (!ativa) {
            aba.click();
            console.log('[Digisac] Aba Fila selecionada automaticamente.');
        }

        return true;
    }

    // ==========================
    // MONITORAMENTO
    // ==========================

    function monitorarFila() {

        const qtd = obterQuantidadeFila();

        console.log(
            `[Digisac] ${new Date().toLocaleTimeString()} | Chamados na fila: ${qtd}`
        );

        if (qtd > 0) {
            notificar(qtd);
        }

    }

    function iniciarMonitoramento() {

        if (window.__digisacMonitorandoFila) {
            return;
        }

        window.__digisacMonitorandoFila = true;

        monitorarFila();

        setInterval(
            monitorarFila,
            INTERVALO_MONITORAMENTO
        );

        console.log('[Digisac] Monitoramento iniciado.');

    }

    // ==========================
    // OBSERVER
    // ==========================

    function iniciarObserver() {

        if (clicarAbaFila()) {
            iniciarMonitoramento();
            return;
        }

        const observer = new MutationObserver(() => {

            if (clicarAbaFila()) {

                observer.disconnect();

                iniciarMonitoramento();

            }

        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Segurança: encerra após 30 segundos
        setTimeout(() => {
            observer.disconnect();
        }, 30000);

    }

    // ==========================
    // INÍCIO
    // ==========================

    window.addEventListener('load', iniciarObserver);

})();