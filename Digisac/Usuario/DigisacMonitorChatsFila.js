// ==UserScript==
// @name         Digisac - Monitor Chats + Fila
// @namespace    http://tampermonkey.net/
// @version      8.0
// @description  Monitora fila, chats aguardando resposta e atendimentos prestes a encerrar por inatividade (compatível com o layout novo e o antigo do Digisac)
// @author       Gabriel Silveira e Tiago Debossan
// @match        https://contarconsultoria.digisac.io/*
// @grant        GM_notification
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==
(function () {
    'use strict';

    // ============================
    // CONFIGURAÇÕES
    // ============================
    const CHECAGEM_INICIAL_MS = 1000;
    const RETRY_DOM_NAO_PRONTO_MS = 2000;
    // Verifica o DOM a cada 30s, como o script original. Os tempos abaixo
    // controlam só a repetição de cada aviso, para não notificar a cada ciclo.
    const INTERVALO_RECORRENTE_MS = 30000; // 30 segundos
    const INTERVALO_FILA = 120000; // 2 minutos
    const INTERVALO_RESPOSTA = 120000; // 2 minutos
    const INTERVALO_INATIVIDADE = 300000; // 5 minutos

    let ultimaFila = 0;
    let ultimaResposta = 0;
    let ultimaInatividade = 0;

    // Último total já notificado de cada aviso. Quando o número SOBE
    // (fila 0 -> 1, 1 -> 2; cliente novo mandando mensagem; chat entrando na
    // janela de encerramento), o aviso sai na hora, sem esperar o tempo de
    // repetição — é fato novo. O tempo de repetição continua valendo enquanto
    // o número só se mantém, para não repetir o mesmo caso parado.
    let notificadoFila = 0;
    let notificadoResposta = 0;
    let notificadoInatividade = 0;

    function deveAvisar(total, jaNotificado, ultimaVez, intervalo, agora) {
        if (total <= 0) return false;
        if (total > jaNotificado) return true; // fato novo
        return agora - ultimaVez >= intervalo;
    }

    const MINUTOS_INATIVIDADE_MIN = 18;
    const MINUTOS_INATIVIDADE_MAX = 21;

    const MAX_NOMES_NOTIFICACAO = 4;
    const MAX_CARACTERES_NOME = 45;

    const TEXTO_LISTA_VAZIA = 'não existem chamados';

    // ============================
    // MENSAGENS DE SISTEMA / FLUXO AUTOMÁTICO
    // ============================
    // Conversas encerradas ou em fluxo de bot ficam na lista com ícone de
    // check (o Bot envia como "de mim") e horário parado.
    const PADROES_CONVERSA_INATIVA = [
        'finalizando o seu atendimento por falta de interação',
        'pesquisa de satisfação',
        'como você classifica nosso atendimento',
        'agradecemos o seu contato e sua avaliação',
        'informe o *número* do departamento',
        'informe o número do departamento',
        'digite um número entre 1 e 5',
        'aguarde um instante, em breve um atendente entrará em contato',
        'digite *0* para retornar ao menu inicial'
    ];

    // Ícones de status de envio (layout novo). A presença de qualquer um
    // significa que a última mensagem partiu do operador/bot; a ausência
    // significa que o cliente falou por último.
    const ICONES_ENVIO = [
        'svg.lucide-check-check', // entregue / lido
        'svg.lucide-check',       // enviado
        'svg.lucide-clock',       // pendente de envio
        'svg.lucide-x'            // falha no envio
    ].join(', ');

    // ============================
    // BLOQUEIO DA NOTIFICATION NATIVA
    // ============================
    function NotificacaoNativaBloqueada() {}
    NotificacaoNativaBloqueada.prototype.close = function () {};
    NotificacaoNativaBloqueada.permission = 'denied';
    NotificacaoNativaBloqueada.requestPermission = function (cb) {
        if (typeof cb === 'function') cb('denied');
        return Promise.resolve('denied');
    };

    try {
        if (typeof unsafeWindow !== 'undefined') {
            unsafeWindow.Notification = NotificacaoNativaBloqueada;
        }
    } catch (e) {
        console.error('[Digisac] Falha ao bloquear Notification nativa:', e);
    }

    // ============================
    // NOTIFICAÇÃO
    // ============================
    function notificar(mensagem) {
        try {
            if (typeof GM_notification !== 'function') {
                console.error('[Digisac] GM_notification indisponível — confira o @grant.');
                return;
            }
            GM_notification({
                title: 'DIGISAC',
                text: mensagem,
                timeout: 10000,
                silent: true,
                onclick: function () {
                    try {
                        (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).focus();
                    } catch (e) { /* ignora */ }
                }
            });
        } catch (e) {
            console.error('[Digisac] Falha ao notificar:', e);
        }
    }

    function formatarNomes(nomes) {
        try {
            const limpos = (nomes || [])
                .filter(Boolean)
                .map(n => n.length > MAX_CARACTERES_NOME
                    ? n.slice(0, MAX_CARACTERES_NOME - 1) + '…'
                    : n);
            if (!limpos.length) return '';
            if (limpos.length <= MAX_NOMES_NOTIFICACAO) return limpos.join('\n');
            const restantes = limpos.length - MAX_NOMES_NOTIFICACAO;
            return limpos.slice(0, MAX_NOMES_NOTIFICACAO).join('\n') + `\n… e mais ${restantes}`;
        } catch (e) {
            return '';
        }
    }

    // ============================
    // ABAS — LAYOUT NOVO E ANTIGO
    // ============================
    // Layout novo: chips (toggle group) com data-testid queue-chip-*, onde a
    // ativa carrega data-state="on"/aria-checked="true" e o próprio rótulo
    // traz a contagem, como "Fila (1)".
    function chipsNovos() {
        return {
            minhas: document.querySelector('[data-testid="queue-chip-mine"]'),
            fila: document.querySelector('[data-testid="queue-chip-queue"]'),
            todas: document.querySelector('[data-testid="queue-chip-all"]')
        };
    }

    function layoutNovo() {
        const c = chipsNovos();
        return !!(c.minhas || c.fila || c.todas);
    }

    // A contagem aparece e some do rótulo do chip, e o formato varia: já foi
    // visto "Fila (1)" na tela enquanto o HTML trazia só "Fila". Por isso
    // procura qualquer número no texto, em vez de exigir parênteses.
    function contagemDoChip(chip) {
        try {
            if (!chip) return null;
            const m = (chip.textContent || '').match(/(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
        } catch (e) {
            return null;
        }
    }

    function abaAtiva() {
        try {
            if (layoutNovo()) {
                const chips = chipsNovos();
                const nomes = Object.keys(chips).filter(n => chips[n]);
                const ativa = nomes.find(n =>
                    chips[n].getAttribute('data-state') === 'on' ||
                    chips[n].getAttribute('aria-checked') === 'true'
                );
                return ativa || null;
            }

            // Layout antigo: a aba ativa é a única com uma classe não
            // compartilhada com as outras duas (hash do styled-components).
            const abas = {
                minhas: document.querySelector('[data-testid="chat-tab-mine"]'),
                fila: document.querySelector('[data-testid="chat-tab-queue_calls"]'),
                contatos: document.querySelector('[data-testid="chat-tab-start_conversation"]')
            };
            const nomes = Object.keys(abas).filter(n => abas[n]);
            if (!nomes.length) return null;

            const contagem = {};
            nomes.forEach(n => {
                Array.from(abas[n].classList).forEach(c => {
                    contagem[c] = (contagem[c] || 0) + 1;
                });
            });
            const unica = nomes.filter(n =>
                Array.from(abas[n].classList).some(c => contagem[c] === 1)
            );
            if (unica.length === 1) return unica[0];

            const porCor = nomes.filter(n => abas[n].querySelector('svg[stroke="#52658C"]'));
            return porCor.length === 1 ? porCor[0] : null;
        } catch (e) {
            console.error('[Digisac] Erro ao detectar aba ativa:', e);
            return null;
        }
    }

    // Quantos atendimentos SEUS existem agora. No layout novo vem do chip
    // "Minhas (N)"; no antigo, do badge "N atendimentos ativos" da aba Chats.
    // Em ambos, a ausência do número significa zero — foi assim que o script
    // original se protegia: com zero atendimentos seus ele saía sem olhar
    // card nenhum, em qualquer aba. É esse portão que impede alerta sobre
    // atendimento de colega.
    function meusAtendimentos() {
        try {
            if (layoutNovo()) return contagemDoChip(chipsNovos().minhas);
            const aba = document.querySelector('[data-testid="chat-tab-mine"]');
            if (!aba) return null;
            const badge =
                aba.querySelector('.badge.badge-primary.badge-pill') ||
                aba.querySelector('.badge.badge-primary');
            if (!badge) return 0;
            const n = parseInt(badge.textContent.trim(), 10);
            return isNaN(n) ? 0 : n;
        } catch (e) {
            return null;
        }
    }

    // ============================
    // LISTA E CARDS
    // ============================
    function containerLista() {
        try {
            return (
                document.querySelector('[data-testid^="contacts_list_view"]') ||
                document.querySelector('.chat-contact-list') ||
                null
            );
        } catch (e) {
            return null;
        }
    }

    function listaVazia(container) {
        try {
            if (!container) return false;
            return (container.textContent || '').toLowerCase().includes(TEXTO_LISTA_VAZIA);
        } catch (e) {
            return false;
        }
    }

    // O data-testid do card sobreviveu à mudança de layout.
    function cards(container) {
        try {
            if (!container) return [];
            return Array.from(container.querySelectorAll('[data-testid^="contact_internalName-"]'));
        } catch (e) {
            return [];
        }
    }

    function nomeContato(card) {
        try {
            const testid = card.getAttribute('data-testid') || '';
            const prefixo = 'contact_internalName-';
            if (testid.indexOf(prefixo) === 0) {
                const nome = testid.slice(prefixo.length).trim();
                if (nome) return nome;
            }
            const h5 = card.querySelector('h5');
            if (h5 && h5.textContent.trim()) return h5.textContent.trim();
            const span = card.querySelector('.name-wrapper span[title]');
            if (span) return (span.getAttribute('title') || '').trim() || null;
            return null;
        } catch (e) {
            return null;
        }
    }

    function textoUltimaMensagem(card) {
        try {
            const el = card.querySelector('[data-testid="last-message-text"]');
            if (el) {
                // Layout novo: o title fica no <p> que envolve o span.
                const comTitle = el.closest('[title]') || el.querySelector('[title]');
                if (comTitle) return (comTitle.getAttribute('title') || '').toLowerCase();
                return (el.textContent || '').toLowerCase();
            }
            return '';
        } catch (e) {
            return '';
        }
    }

    function ehConversaInativa(texto) {
        if (!texto) return false;
        return PADROES_CONVERSA_INATIVA.some(p => texto.includes(p));
    }

    // True = operador/bot falou por último; false = cliente falou por último.
    function ultimaMensagemDoOperador(card) {
        try {
            // Layout novo: ícone de status de envio no card.
            if (card.querySelector(ICONES_ENVIO)) return true;
            // Layout antigo: qualquer svg dentro do wrapper da mensagem.
            const wrapper = card.querySelector('.last-message-wrapper');
            if (wrapper) return !!wrapper.querySelector('svg');
            return false;
        } catch (e) {
            return false;
        }
    }

    // Layout antigo: title "dd/mm/yyyy hh:mm:ss".
    // Layout novo: só o texto, "08:05" para hoje e "Ontem"/data para o resto.
    // Por isso um HH:MM puro é necessariamente de hoje — o que torna seguro
    // assumir a data atual, e permite ignorar tudo que não seja de hoje.
    function dataUltimaMensagem(card) {
        try {
            const el = card.querySelector('[data-testid="last-message-at"]');
            if (!el) return null;

            const comTitle = el.querySelector('[title]') || (el.hasAttribute('title') ? el : null);
            if (comTitle) {
                const t = comTitle.getAttribute('title') || '';
                const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
                if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`);
            }

            const txt = (el.textContent || '').trim();
            const mh = txt.match(/^(\d{1,2}):(\d{2})$/);
            if (mh) {
                const agora = new Date();
                const d = new Date(
                    agora.getFullYear(), agora.getMonth(), agora.getDate(),
                    parseInt(mh[1], 10), parseInt(mh[2], 10), 0
                );
                return d > agora ? null : d;
            }

            return null; // "Ontem" ou data: não é de hoje
        } catch (e) {
            console.error('[Digisac] Erro ao ler a hora da mensagem:', e);
            return null;
        }
    }

    // ============================
    // FILA
    // ============================
    function dadosFila(aba, container) {
        let total = null;
        try {
            if (layoutNovo()) {
                // Com a aba Fila aberta, os próprios cards são a contagem
                // confiável — o rótulo do chip nem sempre traz o número.
                if (aba === 'fila' && container) {
                    total = listaVazia(container) ? 0 : cards(container).length;
                } else {
                    total = contagemDoChip(chipsNovos().fila);
                }
            } else {
                const abaFila =
                    document.querySelector('[data-testid="chat-tab-queue_calls"]') ||
                    document.querySelector('[data-testid*="queue-calls"]');
                if (abaFila) {
                    const badge =
                        abaFila.querySelector('.badge.badge-primary.badge-pill') ||
                        abaFila.querySelector('.badge.badge-primary') ||
                        abaFila.querySelector('.badge');
                    if (badge) {
                        const n = parseInt(badge.textContent.trim(), 10);
                        total = isNaN(n) ? 0 : n;
                    } else {
                        total = 0;
                    }
                }
            }
        } catch (e) {
            console.error('[Digisac] Erro em dadosFila:', e);
        }

        const nomes = [];
        try {
            if (total && aba === 'fila' && container && !listaVazia(container)) {
                cards(container).forEach(c => {
                    const nome = nomeContato(c);
                    if (nome) nomes.push(nome);
                });
            }
        } catch (e) { /* ignora */ }

        return { total: total, nomes: nomes };
    }

    // ============================
    // AGUARDANDO RESPOSTA (cliente falou por último)
    // ============================
    function dadosAguardando(aba, container) {
        try {
            // Só é possível saber quem falou por último inspecionando os
            // cards, e apenas a lista "Minhas" contém só os seus chamados.
            // As três abas sempre existiram: a atual "Todas" é a antiga
            // "Contatos" (chat-tab-start_conversation), que já listava
            // conversas com última mensagem e não lidas — só mudou o nome.
            // Esta regra, portanto, é a mesma que a versão anterior aplicava
            // à antiga aba "Chats", e não uma restrição nova.
            if (!container) return { total: 0, nomes: [] };

            // Portão: sem atendimento seu, não há o que alertar — vale para
            // qualquer aba, inclusive "Todas".
            const meus = meusAtendimentos();
            if (!meus) return { total: 0, nomes: [] };

            // A lista da Fila não contém atendimentos seus, só chamados
            // esperando alguém puxar; o alerta de fila já cobre esse caso.
            if (aba === 'fila') return { total: 0, nomes: [] };
            if (listaVazia(container)) return { total: 0, nomes: [] };

            const nomes = [];
            cards(container).forEach(c => {
                if (ultimaMensagemDoOperador(c)) return;
                const nome = nomeContato(c);
                if (nome) nomes.push(nome);
            });

            // Nunca mais do que os seus atendimentos: na aba "Todas" a
            // lista traz conversas de colegas, e o teto impede que elas
            // inflem a contagem.
            const total = Math.min(nomes.length, meus);

            // Só a lista "Minhas" contém apenas atendimentos seus, então é a
            // única em que o nome é confiável. Fora dela vai só o número —
            // como fazia a versão original, que nunca mostrou nomes.
            if (aba !== 'minhas') return { total: total, nomes: [] };
            return { total: total, nomes: nomes.slice(0, total) };
        } catch (e) {
            console.error('[Digisac] Erro em dadosAguardando:', e);
            return { total: 0, nomes: [] };
        }
    }

    // ============================
    // INATIVIDADE 18-21 MIN (operador falou por último, cliente sumiu)
    // ============================
    function dadosInatividade(aba, container) {
        try {
            // Medir cards de outra lista era a origem do alerta falso.
            if (!container) return { total: 0, nomes: [] };

            // Portão: sem atendimento seu, não há o que alertar — vale para
            // qualquer aba, inclusive "Todas".
            const meus = meusAtendimentos();
            if (!meus) return { total: 0, nomes: [] };

            // A lista da Fila não contém atendimentos seus, só chamados
            // esperando alguém puxar; o alerta de fila já cobre esse caso.
            if (aba === 'fila') return { total: 0, nomes: [] };
            if (listaVazia(container)) return { total: 0, nomes: [] };

            const agora = new Date();
            const nomes = [];

            cards(container).forEach(c => {
                if (!ultimaMensagemDoOperador(c)) return;
                if (ehConversaInativa(textoUltimaMensagem(c))) return;

                const data = dataUltimaMensagem(c);
                if (!data) return;

                const min = (agora - data) / 60000;
                if (min >= MINUTOS_INATIVIDADE_MIN && min <= MINUTOS_INATIVIDADE_MAX) {
                    const nome = nomeContato(c);
                    if (nome) nomes.push(nome);
                }
            });

            const total = Math.min(nomes.length, meus);
            if (aba !== 'minhas') return { total: total, nomes: [] };
            return { total: total, nomes: nomes.slice(0, total) };
        } catch (e) {
            console.error('[Digisac] Erro em dadosInatividade:', e);
            return { total: 0, nomes: [] };
        }
    }

    // ============================
    // VERIFICAÇÃO
    // ============================
    function verificar() {
        try {
            const aba = abaAtiva();
            const container = containerLista();

            const fila = dadosFila(aba, container);
            const aguardando = dadosAguardando(aba, container);
            const inatividade = dadosInatividade(aba, container);

            console.log(
                `[Digisac] ${new Date().toLocaleTimeString()} | Layout: ${layoutNovo() ? 'novo' : 'antigo'} | Aba ativa: ${aba} | Cards na lista: ${cards(container).length}${' | Meus atendimentos: ' + meusAtendimentos()} | Fila: ${fila.total} ${JSON.stringify(fila.nomes)} | Aguardando resposta: ${aguardando.total} ${JSON.stringify(aguardando.nomes)} | Inatividade 18-21min: ${inatividade.total} ${JSON.stringify(inatividade.nomes)}`
            );

            const agora = Date.now();

            if (deveAvisar(fila.total, notificadoFila, ultimaFila, INTERVALO_FILA, agora)) {
                ultimaFila = agora;
                let msg = `• ${fila.total} chamado(s) na fila`;
                const lista = formatarNomes(fila.nomes);
                if (lista) msg += `:\n${lista}`;
                notificar(msg);
            }

            if (deveAvisar(aguardando.total, notificadoResposta, ultimaResposta, INTERVALO_RESPOSTA, agora)) {
                ultimaResposta = agora;
                let msg = `• ${aguardando.total} atendimento(s) aguardando sua resposta`;
                const lista = formatarNomes(aguardando.nomes);
                if (lista) msg += `:\n${lista}`;
                notificar(msg);
            }

            if (deveAvisar(inatividade.total, notificadoInatividade, ultimaInatividade, INTERVALO_INATIVIDADE, agora)) {
                ultimaInatividade = agora;
                let msg = `Há ${inatividade.total} chat(s) com cliente ausente há mais de 18 minutos! Mande uma mensagem para não encerrar sozinho.`;
                const lista = formatarNomes(inatividade.nomes);
                if (lista) msg += `\n${lista}`;
                notificar(msg);
            }

            // Guarda os totais fora dos ifs, para que a queda a zero também
            // seja registrada: assim, de 0 para 1 volta a valer como fato novo.
            notificadoFila = fila.total || 0;
            notificadoResposta = aguardando.total || 0;
            notificadoInatividade = inatividade.total || 0;
        } catch (e) {
            console.error('[Digisac] Erro em verificar():', e);
        }
    }

    // ============================
    // LARGADA
    // ============================
    function tentarChecagemInicial() {
        try {
            const pronto =
                layoutNovo() ||
                document.querySelector('[data-testid="chat-tab-mine"]');

            if (!pronto) {
                setTimeout(tentarChecagemInicial, RETRY_DOM_NAO_PRONTO_MS);
                return;
            }

            verificar();
            setInterval(verificar, INTERVALO_RECORRENTE_MS);
        } catch (e) {
            console.error('[Digisac] Erro na checagem inicial:', e);
            setTimeout(tentarChecagemInicial, RETRY_DOM_NAO_PRONTO_MS);
        }
    }

    setTimeout(tentarChecagemInicial, CHECAGEM_INICIAL_MS);
})();
