window.iniciarDigisacContar = async function () {
    'use strict';
    console.log("[Digisac Unified] Iniciando módulos de forma assíncrona...");

    // ========================================================================
    // MÓDULO 1: NOTIFICAÇÕES (Fila e Chats Aguardando)
    // ========================================================================
    async function iniciarModuloMonitor() {
        console.log("[Módulo] Monitor de Chats e Fila inicializado.");

        const INTERVALO = 30000;
        const INTERVALO_RESPOSTA = 120000; // 2 minutos
        const INTERVALO_ABERTOS = 240000; // 4 minutos
        const INTERVALO_FILA = 120000; // 2 minutos

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

        function quantidadeChats() {
            const abaChats = document.querySelector('[data-testid="chat-tab-mine"]');
            if (!abaChats) return 0;

            const badge =
                abaChats.querySelector('.badge.badge-primary.badge-pill') ||
                abaChats.querySelector('.badge.badge-primary');

            const totalChats = badge ? parseInt(badge.textContent.trim(), 10) : 0;

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

                const checkOperador = wrapper.querySelector('svg');
                if (!checkOperador) {
                    aguardandoResposta++;
                }
            });

            return aguardandoResposta;
        }

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

            console.log(`[Digisac Monitor] ${new Date().toLocaleTimeString()} | Chats comigo: ${chatsComigo} | Aguardando resposta: ${chatsAguardando} | Fila: ${fila}`);

            const agora = Date.now();

            if (chatsAguardando > 0 && agora - ultimaResposta >= INTERVALO_RESPOSTA) {
                notificar(`• ${chatsAguardando} atendimento(s) aguardando sua resposta`);
                ultimaResposta = agora;
            }

            if (chatsComigo > 0 && agora - ultimoAberto >= INTERVALO_ABERTOS) {
                notificar(`• ${chatsComigo} atendimento(s) com você`);
                ultimoAberto = agora;
            }

            if (fila > 0 && agora - ultimaFila >= INTERVALO_FILA) {
                notificar(`• ${fila} chamado(s) na fila`);
                ultimaFila = agora;
            }
        }

        setTimeout(verificar, 500);
        setInterval(verificar, INTERVALO);
    }

    // ========================================================================
    // MÓDULO 2: TAGS (Injeção de CSS - Protegido contra o React)
    // ========================================================================
    async function iniciarModuloTags() {
        console.log("[Módulo] Tags (Inadimplentes e Interno) inicializado.");

        const css = `
            .card-script-inadimplente {
                background-color: #ffe6e6 !important;
                border-left: 5px solid #ff0000 !important;
            }
            .card-script-inadimplente span {
                color: #ff0000 !important;
                font-weight: bold !important;
            }
            
            .card-script-interno {
                background-color: #e6ffec !important;
                border-left: 5px solid #00b33c !important;
            }
            .card-script-interno span {
                color: #00b33c !important;
                font-weight: bold !important;
            }
        `;

        if (typeof GM_addStyle !== "undefined") {
            GM_addStyle(css);
        } else {
            const styleSheet = document.createElement("style");
            styleSheet.innerText = css;
            document.head.appendChild(styleSheet);
        }

        const TAG_INADIMPLENTE = "inadimplente";
        const TAG_INTERNO = "interno";
        const statusClientes = new Map();

        function processarContatos(data) {
            let lista = Array.isArray(data) ? data : (data.data ? data.data : []);
            let atualizouTela = false;

            lista.forEach(contato => {
                if (contato.tags && Array.isArray(contato.tags)) {
                    let temInadimplente = false;
                    let temInterno = false;

                    contato.tags.forEach(tag => {
                        let nomeTag = typeof tag === 'string' ? tag : (tag.name || tag.title || tag.label || "");
                        nomeTag = nomeTag.toLowerCase().trim();

                        if (nomeTag.includes(TAG_INADIMPLENTE) || nomeTag.includes("inadiplente")) temInadimplente = true;
                        if (nomeTag.includes(TAG_INTERNO)) temInterno = true;
                    });

                    let statusAtual = null;
                    if (temInadimplente) statusAtual = 'inadimplente';
                    else if (temInterno) statusAtual = 'interno';

                    if (statusAtual) {
                        if (contato.name) statusClientes.set(contato.name.trim(), statusAtual);
                        if (contato.internalName) statusClientes.set(contato.internalName.trim(), statusAtual);
                        atualizouTela = true;
                    }
                }
            });

            if (atualizouTela) destacarNaTela();
        }

        const originalFetch = window.fetch;
        window.fetch = async function (...args) {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
            const response = await originalFetch.apply(this, args);

            if (url.includes('/api/v1/contacts/list') || url.includes('/api/v1/contacts')) {
                response.clone().json().then(processarContatos).catch(() => {});
            }
            return response;
        };

        const originalXHR = window.XMLHttpRequest;
        function newXHR() {
            const xhr = new originalXHR();
            xhr.addEventListener('load', function () {
                if (xhr.responseURL && (xhr.responseURL.includes('/api/v1/contacts/list') || xhr.responseURL.includes('/api/v1/contacts'))) {
                    try { processarContatos(JSON.parse(xhr.responseText)); } catch (e) { }
                }
            });
            return xhr;
        }
        window.XMLHttpRequest = newXHR;

        function destacarNaTela() {
            if (statusClientes.size === 0) return;
            const cards = document.querySelectorAll('.chatContactDiv');

            cards.forEach(card => {
                let nomeDoCliente = "";
                const testId = card.getAttribute('data-testid');

                if (testId && testId.startsWith('contact_internalName-')) {
                    nomeDoCliente = testId.replace('contact_internalName-', '').trim();
                } else {
                    const spanName = card.querySelector('span[title]');
                    if (spanName) nomeDoCliente = (spanName.getAttribute('title') || spanName.innerText).trim();
                }

                if (!nomeDoCliente) return;

                const status = statusClientes.get(nomeDoCliente);

                if (status === 'inadimplente') {
                    if (!card.classList.contains('card-script-inadimplente')) {
                        card.classList.remove('card-script-interno');
                        card.classList.add('card-script-inadimplente');
                    }
                } else if (status === 'interno') {
                    if (!card.classList.contains('card-script-interno')) {
                        card.classList.remove('card-script-inadimplente');
                        card.classList.add('card-script-interno');
                    }
                } else {
                    card.classList.remove('card-script-inadimplente', 'card-script-interno');
                }
            });
        }

        const observer = new MutationObserver(() => destacarNaTela());
        observer.observe(document.body, { childList: true, subtree: true });
        setInterval(destacarNaTela, 2000);
    }

    // ========================================================================
    // ORQUESTRADOR: Executa os dois módulos simultaneamente (Promises)
    // ========================================================================
    try {
        await Promise.all([
            iniciarModuloTags(),
            iniciarModuloMonitor()
        ]);
        console.log("[Digisac Unified] Todos os módulos carregados e operantes!");
    } catch (erro) {
        console.error("[Digisac Unified] Falha crítica ao carregar módulos:", erro);
    }

};
