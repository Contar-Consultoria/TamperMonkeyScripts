window.iniciarDigisacContar = async function () {
    'use strict';
    console.log("[Digisac Unified] Iniciando módulos de forma assíncrona...");

    // ========================================================================
    // MÓDULO 1: NOTIFICAÇÕES (Fila e Chats Aguardando)
    // ========================================================================
    async function iniciarModuloMonitor() {
        console.log("[Módulo] Monitor de Chats e Fila inicializado.");
        const INTERVALO = 30000;
        const INTERVALO_RESPOSTA = 120000;
        const INTERVALO_ABERTOS = 240000;
        const INTERVALO_FILA = 120000;

        let ultimaResposta = 0;
        let ultimoAberto = 0;
        let ultimaFila = 0;

        if (Notification.permission !== 'granted') {
            Notification.requestPermission();
        }

        function notificar(mensagem) {
            if (Notification.permission !== 'granted') return;
            const notificacao = new Notification('DIGISAC', { body: mensagem });
            setTimeout(() => { notificacao.close(); }, 10000);
        }

        function quantidadeFila() {
            const abaFila = document.querySelector('[data-testid="chat-tab-queue_calls"]') || document.querySelector('[data-testid*="queue-calls"]');
            if (!abaFila) return 0;
            const badge = abaFila.querySelector('.badge.badge-primary.badge-pill') || abaFila.querySelector('.badge.badge-primary');
            return badge ? parseInt(badge.textContent.trim(), 10) || 0 : 0;
        }

        function quantidadeChats() {
            const abaChats = document.querySelector('[data-testid="chat-tab-mine"]');
            if (!abaChats) return 0;
            const badge = abaChats.querySelector('.badge.badge-primary.badge-pill') || abaChats.querySelector('.badge.badge-primary');
            const totalChats = badge ? parseInt(badge.textContent.trim(), 10) : 0;
            if (isNaN(totalChats) || totalChats === 0) return 0;

            const contatos = document.querySelectorAll('.chatContactDiv');
            if (!contatos.length) return totalChats;

            let aguardandoResposta = 0;
            contatos.forEach(contato => {
                const wrapper = contato.querySelector('.last-message-wrapper');
                if (wrapper && !wrapper.querySelector('svg')) aguardandoResposta++;
            });
            return aguardandoResposta;
        }

        function verificar() {
            const chatsComigo = (() => {
                const abaChats = document.querySelector('[data-testid="chat-tab-mine"]');
                if (!abaChats) return 0;
                const badge = abaChats.querySelector('.badge.badge-primary.badge-pill') || abaChats.querySelector('.badge.badge-primary');
                return badge ? parseInt(badge.textContent.trim(), 10) || 0 : 0;
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
        setTimeout(verificar, 1000);
        setInterval(verificar, INTERVALO);
    }

    // ========================================================================
    // MÓDULO 2: TAGS (Injeção de CSS e Escuta de Rede Blindada)
    // ========================================================================
    async function iniciarModuloTags() {
        console.log("[Módulo] Tags (Inadimplentes e Interno) inicializado.");

        const css = `
            .card-script-inadimplente { background-color: #ffe6e6 !important; border-left: 5px solid #ff0000 !important; }
            .card-script-inadimplente span { color: #ff0000 !important; font-weight: bold !important; }
            .card-script-interno { background-color: #e6ffec !important; border-left: 5px solid #00b33c !important; }
            .card-script-interno span { color: #00b33c !important; font-weight: bold !important; }
        `;

        if (typeof GM_addStyle !== "undefined") {
            GM_addStyle(css);
        } else {
            const styleSheet = document.createElement("style");
            styleSheet.innerText = css;
            if(document.head) document.head.appendChild(styleSheet);
            else document.addEventListener('DOMContentLoaded', () => document.head.appendChild(styleSheet));
        }

        const TAG_INADIMPLENTE = "inadimplente";
        const TAG_INTERNO = "interno";
        const statusClientes = new Map();

        function processarContatos(data) {
            let lista = Array.isArray(data) ? data : (data.data ? data.data : []);
            
            if (lista.length > 0) {
                console.log(`[Módulo Tags] Analisando pacote com ${lista.length} contatos da API...`);
            } else {
                console.log(`[Módulo Tags] Pacote recebido, mas parecia vazio. Dados brutos:`, data);
            }

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

            if (atualizouTela) {
                console.log("[Módulo Tags] CLIENTES MARCADOS:", Array.from(statusClientes.entries()));
                destacarNaTela();
            }
        }

        // 1. Interceptor de Fetch Blindado
        const originalFetch = window.fetch;
        window.fetch = async function (...args) {
            let url = '';
            if (args[0] instanceof Request) url = args[0].url;
            else if (typeof args[0] === 'string') url = args[0];

            const response = await originalFetch.apply(this, args);
            if (url && (url.includes('/api/v1/contacts/list') || url.includes('/api/v1/contacts'))) {
                try {
                    response.clone().json().then(data => {
                        console.log("[Módulo Tags] API interceptada via Fetch!");
                        processarContatos(data);
                    }).catch(() => {});
                } catch(e) {}
            }
            return response;
        };

        // 2. Interceptor de XHR (Axios) Blindado na Raiz (Prototype)
        const XHR = XMLHttpRequest.prototype;
        const originalOpen = XHR.open;
        const originalSend = XHR.send;

        XHR.open = function(method, url) {
            this._requestUrl = url;
            return originalOpen.apply(this, arguments);
        };

        XHR.send = function() {
            this.addEventListener('load', function() {
                if (this._requestUrl && (this._requestUrl.includes('/api/v1/contacts/list') || this._requestUrl.includes('/api/v1/contacts'))) {
                    try {
                        console.log("[Módulo Tags] API interceptada via XHR!");
                        processarContatos(JSON.parse(this.responseText));
                    } catch(e) {}
                }
            });
            return originalSend.apply(this, arguments);
        };

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
        
        setInterval(destacarNaTela, 2000);
        document.addEventListener('DOMContentLoaded', () => {
            const observer = new MutationObserver(() => destacarNaTela());
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    try {
        await Promise.all([ iniciarModuloTags(), iniciarModuloMonitor() ]);
        console.log("[Digisac Unified] Todos os módulos carregados e operantes!");
    } catch (erro) {
        console.error("[Digisac Unified] Falha crítica ao carregar módulos:", erro);
    }
};
