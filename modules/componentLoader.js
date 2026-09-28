        (function () {
            'use strict';

            // --------------------------------------------------------
            // Helpers de inyección
            // --------------------------------------------------------

            /** Reemplaza un marcador por un conjunto de nodos del DOM */
            function injectNodes(markerId, nodes) {
                const el = document.getElementById(markerId);
                if (!el) { console.warn('[Loader] Marcador no encontrado:', markerId); return; }
                el.replaceWith(...nodes);
            }

            /** Parsea HTML en nodos DOM */
            function parseHTML(html) {
                const tpl = document.createElement('template');
                tpl.innerHTML = html;
                return Array.from(tpl.content.childNodes);
            }

            // -------------------------------------------------------------------
            // Obtención del HTML del componente usando variables preâ€‘cargadas.
            // Los archivos *.js generados exponen window.__COMP_...__ con el HTML
            // como cadena. Esta estrategia funciona con el protocolo
            // file:// sin necesidad de fetch().
            // -------------------------------------------------------------------
            function getComponentHTML(varName) {
                const comp = window[varName];
                if (typeof comp !== 'string') {
                    console.error('[Loader] Variable de componente no encontrada:', varName);
                    return '';
                }
                return comp;
            }

            // --------------------------------------------------------
            // Carga y distribución de Etapa 1 (BCMO)
            // El componente etapa1BCMO.html contiene:
            //   - Parte A (tarjeta): hasta el div#s1_bcmoModule (exclusive)
            //   - Parte B (módulo): el div#s1_bcmoModule y sus submodales
            // --------------------------------------------------------
            async function loadEtapa1() {
                const html = getComponentHTML('__COMP_ETAPA1_BCMO__');

                // Encontrar el índice donde comienza s1_bcmoModule
                const splitMarker = '<!-- [SPLIT-MARKER] s1_bcmoModule begin -->';
                const splitIdx = html.indexOf(splitMarker);

                let cardHtml, moduleHtml;
                if (splitIdx !== -1) {
                    cardHtml = html.substring(0, splitIdx).trim();
                    moduleHtml = html.substring(splitIdx).trim();
                } else {
                    // fallback: inyectar todo como tarjeta
                    cardHtml = html;
                    moduleHtml = '';
                }

                // Inyectar tarjeta dentro del setupSection
                injectNodes('etapa1-card-container', parseHTML(cardHtml));

                // Inyectar módulo BCMO como hermano de setupSection (dentro de main)
                if (moduleHtml) {
                    injectNodes('etapa1-bcmo-container', parseHTML(moduleHtml));
                }
            }

            // --------------------------------------------------------
            // Carga y distribución de Etapa 2 (Consolidación)
            // El componente etapa2Consolidacion.html contiene:
            //   - Parte A (tarjeta): hasta el comentario de resultsSection
            //   - Parte B (resultados): el div#resultsSection + modales
            // --------------------------------------------------------
            async function loadEtapa2() {
                const html = getComponentHTML('__COMP_ETAPA2_CONSOLIDACION__');

                // Encontrar el índice donde comienza resultsSection
                const splitMarker = '<!-- [SPLIT-MARKER] resultsSection begin -->';
                const splitIdx = html.indexOf(splitMarker);

                let cardHtml, resultsHtml;
                if (splitIdx !== -1) {
                    cardHtml = html.substring(0, splitIdx).trim();
                    resultsHtml = html.substring(splitIdx).trim();
                } else {
                    // fallback: inyectar todo como tarjeta
                    cardHtml = html;
                    resultsHtml = '';
                }

                // Inyectar tarjeta dentro del setupSection
                injectNodes('etapa2-card-container', parseHTML(cardHtml));

                // Inyectar resultsSection + modales como hermanos de setupSection
                if (resultsHtml) {
                    injectNodes('etapa2-results-container', parseHTML(resultsHtml));
                }
            }

            // --------------------------------------------------------
            // Carga y distribución de Etapa 3 (Modalidad TAREA)
            // --------------------------------------------------------
            async function loadEtapa3() {
                const html = getComponentHTML('__COMP_ETAPA3_TAREA__');
                if (!html) return;

                const splitMarker = '<!-- [SPLIT-MARKER] s3_tareaModule begin -->';
                const splitIdx = html.indexOf(splitMarker);

                let cardHtml, moduleHtml;
                if (splitIdx !== -1) {
                    cardHtml = html.substring(0, splitIdx).trim();
                    moduleHtml = html.substring(splitIdx).trim();
                } else {
                    cardHtml = html;
                    moduleHtml = '';
                }

                injectNodes('etapa3-card-container', parseHTML(cardHtml));

                if (moduleHtml) {
                    injectNodes('etapa3-tarea-container', parseHTML(moduleHtml));
                }
            }

            // --------------------------------------------------------
            // Orquestador principal
            // --------------------------------------------------------
            async function initApp() {
                try {
                    await Promise.all([loadEtapa1(), loadEtapa2(), loadEtapa3()]);
                    console.log('[Loader] ✓ Todos los componentes (Etapas 1, 2 y 3) cargados e inyectados.');
                } catch (e) {
                    console.error('[Loader] Error crítico al cargar componentes:', e);
                }

                // Restaurar addEventListener original
                if (window._origAEL) {
                    EventTarget.prototype.addEventListener = window._origAEL;
                }

                // Disparar los DOMContentLoaded que quedaron pendientes
                if (window._pendingDCL) {
                    const dcl = new Event('DOMContentLoaded');
                    window._pendingDCL.forEach(function (item) {
                        try { item.handler.call(document, dcl); }
                        catch (err) { console.error('[Loader] Error en handler DOMContentLoaded:', err); }
                    });
                }

                if (typeof window.actualizarTarjetasEtapa2UI === 'function') {
                    window.actualizarTarjetasEtapa2UI();
                }
                if (typeof window.s3_actualizarTarjetasEtapa3 === 'function') {
                    window.s3_actualizarTarjetasEtapa3();
                if (typeof window.s3_actualizarFichaEtapa3 === "function") {
                    window.s3_actualizarFichaEtapa3();
                }
                }
            }

            // Arrancar cuando el DOM esté listo
            if (document.readyState === 'loading') {
                if (window._origAEL) {
                    window._origAEL.call(document, 'DOMContentLoaded', initApp);
                } else {
                    document.addEventListener('DOMContentLoaded', initApp);
                }
            } else {
                initApp();
            }
        })();