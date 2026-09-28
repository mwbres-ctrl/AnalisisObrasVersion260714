// ============================================================================
        // LÓGICA DE LA ETAPA 2 (CONSOLIDACIÓN Y AUDITORÍA DE AVANCES)
        // ============================================================================
        // --- ESTADO GLOBAL Y MEMORIA ---
        let dataAvance = null;
        let tempAvanceData = [];
        let tempAvanceHeaders = [];
        let tempAvanceDateStr = "";

        let dataAvanceCorporativo = null;
        let dataCorporativoRaw = [];

        let dataBCMO = null;
        let dataTarea = null;
        let dataMateriales = null;

        let dataConsolidada = [];
        let filteredConsolidada = [];
        let headersAvance = [];

        let fileUploadDates = { avance: null, bcmo: null, tarea: null, pmovxf: null, corporativo: null };

        // Memoria de trazabilidad (JSON portable e Inmutable)
        let stateOverrides = {};

        // --- Persistencia del Historial de Cambios Manuales ---
        // Mismo patrón que ya usa Etapa 1 (excludedTasks, excludedMaterials, etc.):
        // se guarda en localStorage para que sobreviva a un F5 o cierre de pestaña.
        function persistStateOverrides() {
            try {
                localStorage.setItem('stateOverrides_v1', JSON.stringify(stateOverrides));
            } catch (e) {
                console.error('No se pudo guardar el Historial de Cambios Manuales:', e);
            }
        }

        function loadStateOverrides() {
            try {
                const saved = localStorage.getItem('stateOverrides_v1');
                if (saved) {
                    stateOverrides = JSON.parse(saved);
                }
            } catch (e) {
                console.error('No se pudo recuperar el Historial de Cambios Manuales guardado:', e);
                stateOverrides = {};
            }
        }
        loadStateOverrides();

        // Reglas de Estandarización Dinámica (Punto 5)
        let standardizationRules = {
            'TERMINADO': 'TERMINADO',
            'TERMINADA - CALDARA': 'FINALIZADO',
            'CANCELADA': 'CANCELADA',
            'SIC CANCELADA': 'CANCELADA',
            'EN EJECUCIÓN': 'EN EJECUCIÓN',
            'EN EJECUCION': 'EN EJECUCIÓN',
            'A EJECUTAR': 'A EJECUTAR',
            'CANCELADO': 'CANCELADA'
        };
        let standardizationDateLimit = '2023-01-01';

        // Reglas Condicionales (Fecha Limite)
        let conditionalRules = [
            { org: 'CT PARCIAL', lt: 'FINALIZADO', gte: 'CIERRE TÉCNICO PARCIAL' }
        ];

        let ctRecategorizadosData = []; // Para la Pestaña de Recategorizaciones

        // Filtros Múltiples
        let activeStateFilters = [];
        let activeModalityFilters = [];
        let activeObraConsiderarFilters = [];
        let activeOrphansStateFilters = [];
        let activeOrphansModFilters = [];

        let currentEditNodo = null;
        // Guarda el "antes" (Nodo/Estado/Modalidad) del registro que se está editando,
        // para poder calcular Valor Anterior -> Nuevo Valor en el Historial de Cambios Manuales.
        let currentEditOriginals = { nodo: null, estado: '', modalidad: '' };

        const corporativoEstadoMapping = {
            'CIERRE TÉCNICO': 'TERMINADO',
            'CANCELADO': 'CANCELADA',
            'SUSPENDIDA': 'SUSPENDIDA',
            'A REASIGNAR': 'A REASIGNAR',
            'FINALIZADA': 'TERMINADO',
            'A EJECUTAR': 'A EJECUTAR',
            'CT-OBRA CANCELADA': 'CANCELADA',
            'EN EJECUCIÓN': 'EN EJECUCIÓN',
            'EN EJECUCION': 'EN EJECUCIÓN',
            'A CANCELAR': 'CANCELADA',
            'CANCELADA': 'CANCELADA',
            'SUSPENDIDO': 'SUSPENDIDA',
            'PARCIAL FINALIZADO': 'TERMINADO'
        };

        // Estilos Categóricos Profesionales
        const stateColorMap = {
            'TERMINADO': { badge: 'bg-emerald-100 text-emerald-800 border-emerald-200', text: 'text-emerald-700 font-semibold' },
            'FINALIZADA CON CONSUMO': { badge: 'bg-emerald-100 text-emerald-800 border-emerald-200', text: 'text-emerald-700 font-semibold' },
            'FINALIZADA CON CONSUMO TOTAL': { badge: 'bg-emerald-200 text-emerald-900 border-emerald-300', text: 'text-emerald-800 font-bold' },
            'FINALIZADA CON CONSUMO PARCIAL': { badge: 'bg-teal-100 text-teal-800 border-teal-200', text: 'text-teal-700 font-bold' },
            'EN EJECUCION CON CONSUMO PARCIAL': { badge: 'bg-cyan-100 text-cyan-800 border-cyan-200', text: 'text-cyan-700 font-bold' },
            'EN EJECUCION': { badge: 'bg-blue-100 text-blue-800 border-blue-200', text: 'text-blue-700 font-semibold' },
            'EN EJECUCIÓN': { badge: 'bg-blue-100 text-blue-800 border-blue-200', text: 'text-blue-700 font-semibold' },
            'A EJECUTAR': { badge: 'bg-slate-100 text-slate-700 border-slate-300', text: 'text-slate-600 font-semibold' },
            'CANCELADA': { badge: 'bg-rose-100 text-rose-800 border-rose-200', text: 'text-rose-700 font-semibold' },
            'SUSPENDIDA': { badge: 'bg-red-100 text-red-800 border-red-200', text: 'text-red-700 font-semibold' },
            'A REASIGNAR': { badge: 'bg-orange-100 text-orange-800 border-orange-200', text: 'text-orange-700 font-semibold' },
            'VERIFICAR: ¿A EJECUTAR o EN EJECUCION?': { badge: 'bg-amber-100 text-amber-800 border-amber-200', text: 'text-amber-700 font-bold' },
            'DEFAULT': { badge: 'bg-purple-100 text-purple-800 border-purple-200', text: 'text-purple-700 font-semibold' }
        };

        // --- FUNCIONES UTILITARIAS Y UI ---

        // Overlay de carga global: usar en cualquier procesamiento pesado
        // para evitar que el cambio de vista se sienta como una recarga seca.
        function showLoadingOverlay(msg) {
            const overlay = document.getElementById('globalLoadingOverlay');
            document.getElementById('globalLoadingText').textContent = msg || 'Procesando...';
            overlay.classList.add('visible');
        }

        function hideLoadingOverlay() {
            document.getElementById('globalLoadingOverlay').classList.remove('visible');
        }

        // Stepper de etapas: step = 0 (Etapa 1), 1 (Etapa 2), 2 (Etapa 3), 3 (Resultados)
        function updateStepper(step) {
            for (let i = 0; i <= 3; i++) {
                const dot = document.getElementById('stepDot' + i);
                const label = document.getElementById('stepLabel' + i);
                if (!dot || !label) continue;
                dot.classList.remove('done', 'active');
                label.classList.remove('done', 'active');
                if (i < step) {
                    dot.classList.add('done');
                    dot.innerHTML = '<i class="fa-solid fa-check"></i>';
                    label.classList.add('done');
                } else if (i === step) {
                    dot.classList.add('active');
                    dot.textContent = (i + 1);
                    label.classList.add('active');
                } else {
                    dot.textContent = (i + 1);
                }
            }
            for (let i = 0; i <= 2; i++) {
                const line = document.getElementById('stepLine' + i);
                if (line) line.classList.toggle('done', i < step);
            }
        }

        // Transición de cross-fade entre dos secciones, en vez de un toggle seco de "hidden"
        function fadeSwapSection(hideEl, showEl, showDisplayClass) {
            hideEl.classList.add('fade-out-active');
            const consEl = document.getElementById('s2_consolidacionModule');
            if (consEl && !consEl.classList.contains('hidden') && showEl && showEl.id === 'resultsSection') {
                consEl.classList.add('hidden');
                consEl.classList.remove('flex', 'fade-out-active', 'fade-in-active');
            }
            setTimeout(() => {
                hideEl.classList.add('hidden');
                if (showDisplayClass) hideEl.classList.remove(showDisplayClass);
                hideEl.classList.remove('fade-out-active');

                showEl.classList.remove('hidden');
                if (showDisplayClass) showEl.classList.add(showDisplayClass);
                showEl.classList.add('fade-out-active');
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        showEl.classList.remove('fade-out-active');
                        showEl.classList.add('fade-in-active');
                    });
                });
            }, 180);
        }

        // Actualiza el contador de una pestaña sin reescribir todo el botón
        // (evita perder el ícono/estructura). El badge solo se muestra si count > 0.
        function setTabBadge(spanId, count) {
            const el = document.getElementById(spanId);
            if (!el) return;
            if (count > 0) {
                el.textContent = count;
                el.classList.remove('hidden');
            } else {
                el.textContent = '';
                el.classList.add('hidden');
            }
            const diagBadgeIds = ['tabRecatCount', 'tabOrphansCount', 'tabBcmoSinCruceCount', 'tabCaducidadCount'];
            if (diagBadgeIds.includes(spanId)) {
                s1_updateDiagBadgeTotal();
            }
            const preAuditBadgeIds = ['tabValidacionContratistaCount', 'tabSinModalidadCount', 'tabIncoherenciasTareaCount'];
            if (preAuditBadgeIds.includes(spanId)) {
                s1_updatePreAuditBadgeTotal();
            }
            const novedadesBadgeIds = ['s1_invalidCountBadge', 's1_reasignadasCountBadge', 's1_otraECCountBadge'];
            if (novedadesBadgeIds.includes(spanId)) {
                s1_updateNovedadesBadgeTotal();
            }
        }

        function showToast(msg, type = 'info') {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            const bg = type === 'error' ? 'bg-rose-600' : (type === 'success' ? 'bg-emerald-600' : 'bg-slate-800');
            const icon = type === 'error' ? 'fa-triangle-exclamation' : (type === 'success' ? 'fa-check' : 'fa-info-circle');

            toast.className = `px-4 py-3 rounded-lg shadow-lg text-white text-sm font-semibold flex items-center gap-3 transition-all duration-300 transform translate-y-10 opacity-0 pointer-events-auto ${bg}`;
            toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${msg}</span>`;

            container.appendChild(toast);
            requestAnimationFrame(() => toast.classList.remove('translate-y-10', 'opacity-0'));
            setTimeout(() => {
                toast.classList.add('opacity-0');
                setTimeout(() => toast.remove(), 300);
            }, 3500);
        }

        function toggleConfig() {
            const panel = document.getElementById('configPanel');
            panel.classList.toggle('hidden');
            panel.classList.toggle('flex');
        }

        function toggleOrphansConfig() {
            const panel = document.getElementById('orphansConfigPanel');
            panel.classList.toggle('hidden');
        }

        function navigateToStep(stepIndex) {
            const bcmoEl = document.getElementById('s1_bcmoModule');
            const consEl = document.getElementById('s2_consolidacionModule');
            const tareaEl = document.getElementById('s3_tareaModule');
            const setupEl = document.getElementById('setupSection');
            const resultsEl = document.getElementById('resultsSection');

            if (stepIndex === 0) {
                // Etapa 1: BCMO
                if (consEl && !consEl.classList.contains('hidden')) closeConsolidacionModule();
                if (tareaEl && !tareaEl.classList.contains('hidden')) closeTareaModule();
                openBcmoModule();
            } else if (stepIndex === 1) {
                // Etapa 2: Consolidación
                if (bcmoEl && !bcmoEl.classList.contains('hidden')) closeBcmoModule();
                if (tareaEl && !tareaEl.classList.contains('hidden')) closeTareaModule();
                openConsolidacionModule();
            } else if (stepIndex === 2) {
                // Etapa 3: TAREA
                const tieneTarea = Boolean(
                    (window.dataTarea && Array.isArray(window.dataTarea) && window.dataTarea.length > 0) ||
                    (window.rawTarea && Array.isArray(window.rawTarea) && window.rawTarea.length > 0) ||
                    (window.s2_rawTareaData && Array.isArray(window.s2_rawTareaData) && window.s2_rawTareaData.length > 0)
                );
                if (!tieneTarea) {
                    showToast("La Etapa 3 está bloqueada: Esta empresa no requiere modalidad TAREA o aún no se ha cargado el archivo de Sistema TAREA en la Etapa 2.", "warning");
                    return;
                }
                if (bcmoEl && !bcmoEl.classList.contains('hidden')) closeBcmoModule();
                if (consEl && !consEl.classList.contains('hidden')) closeConsolidacionModule();
                if (typeof openTareaModule === 'function') {
                    openTareaModule();
                }
            } else if (stepIndex === 3) {
                // Resultados
                if (dataConsolidada && dataConsolidada.length > 0) {
                    if (bcmoEl && !bcmoEl.classList.contains('hidden')) bcmoEl.classList.add('hidden');
                    if (consEl && !consEl.classList.contains('hidden')) consEl.classList.add('hidden');
                    if (tareaEl && !tareaEl.classList.contains('hidden')) tareaEl.classList.add('hidden');
                    showResultsSection();
                } else {
                    showToast("No hay resultados para mostrar. Debe procesar el cruce en la Etapa 2.", "error");
                }
            }
        }

        function showSetupSection() {
            const resultsEl = document.getElementById('resultsSection');
            const setupEl = document.getElementById('setupSection');
            const consEl = document.getElementById('s2_consolidacionModule');
            const bcmoEl = document.getElementById('s1_bcmoModule');
            if (bcmoEl) bcmoEl.classList.add('hidden');
            if (consEl) consEl.classList.add('hidden');
            if (resultsEl.classList.contains('hidden')) {
                setupEl.classList.remove('hidden');
            } else {
                fadeSwapSection(resultsEl, setupEl, 'flex');
            }
            const btnResults = document.getElementById('btnGoToResults');
            if (btnResults && dataConsolidada.length > 0) {
                btnResults.classList.remove('hidden');
            }
            updateStepper(1);
            if (typeof actualizarTarjetasEtapa2UI === 'function') {
                actualizarTarjetasEtapa2UI();
            }
        }

        function showResultsSection() {
            if (dataConsolidada.length > 0) {
                const setupEl = document.getElementById('setupSection');
                const resultsEl = document.getElementById('resultsSection');
                fadeSwapSection(setupEl, resultsEl, 'flex');
                updateStepper(3);
            } else {
                showToast("No hay resultados para mostrar. Debe procesar el cruce.", "error");
            }
        }

        function switchTab(tab) {
            const preAuditTabs = ['validacioncontratista', 'sinmodalidad', 'incoherenciastarea'];
            const diagTabs = ['audit', 'orphans', 'recat', 'detallepm', 'bcmosincruce', 'caducidad'];

            document.getElementById('tabDataContent').classList.toggle('hidden', tab !== 'data');
            document.getElementById('tabAuditContent').classList.toggle('hidden', tab !== 'audit');
            document.getElementById('tabOrphansContent').classList.toggle('hidden', tab !== 'orphans');
            document.getElementById('tabRecatContent').classList.toggle('hidden', tab !== 'recat');
            document.getElementById('tabDetallePMContent').classList.toggle('hidden', tab !== 'detallepm');
            document.getElementById('tabBcmoSinCruceContent').classList.toggle('hidden', tab !== 'bcmosincruce');
            document.getElementById('tabCaducidadContent').classList.toggle('hidden', tab !== 'caducidad');
            const smEl = document.getElementById('tabSinModalidadContent');
            if (smEl) smEl.classList.toggle('hidden', tab !== 'sinmodalidad');
            document.getElementById('tabValidacionContratistaContent').classList.toggle('hidden', tab !== 'validacioncontratista');
            const itEl = document.getElementById('tabIncoherenciasTareaContent');
            if (itEl) itEl.classList.toggle('hidden', tab !== 'incoherenciastarea');
            const dtEl = document.getElementById('tabDetalleTareasContent');
            if (dtEl) dtEl.classList.toggle('hidden', tab !== 'detalletareas');

            document.getElementById('tabDataBtn').classList.toggle('active', tab === 'data');
            const preBtn = document.getElementById('tabPreAuditBtn');
            if (preBtn) preBtn.classList.toggle('active', preAuditTabs.includes(tab));
            document.getElementById('tabDiagBtn').classList.toggle('active', diagTabs.includes(tab));

            document.querySelectorAll('.diag-menu-item').forEach(el => el.classList.remove('active'));
            document.getElementById('tabAuditBtn').classList.toggle('active', tab === 'audit');
            document.getElementById('tabOrphansBtn').classList.toggle('active', tab === 'orphans');
            document.getElementById('tabRecatBtn').classList.toggle('active', tab === 'recat');
            document.getElementById('tabDetallePMBtn').classList.toggle('active', tab === 'detallepm');
            document.getElementById('tabBcmoSinCruceBtn').classList.toggle('active', tab === 'bcmosincruce');
            document.getElementById('tabCaducidadBtn').classList.toggle('active', tab === 'caducidad');
            const smBtn = document.getElementById('tabSinModalidadBtn');
            if (smBtn) smBtn.classList.toggle('active', tab === 'sinmodalidad');
            const vcBtn = document.getElementById('tabValidacionContratistaBtn');
            if (vcBtn) vcBtn.classList.toggle('active', tab === 'validacioncontratista');
            const itBtn = document.getElementById('tabIncoherenciasTareaBtn');
            if (itBtn) itBtn.classList.toggle('active', tab === 'incoherenciastarea');
            const dtBtn = document.getElementById('tabDetalleTareasBtn');
            if (dtBtn) dtBtn.classList.toggle('active', tab === 'detalletareas');

            s1_closeDiagMenu();
            s1_closePreAuditMenu();

            const activeContentId = {
                data: 'tabDataContent', audit: 'tabAuditContent', orphans: 'tabOrphansContent',
                recat: 'tabRecatContent', detallepm: 'tabDetallePMContent',
                bcmosincruce: 'tabBcmoSinCruceContent', caducidad: 'tabCaducidadContent',
                sinmodalidad: 'tabSinModalidadContent',
                validacioncontratista: 'tabValidacionContratistaContent',
                incoherenciastarea: 'tabIncoherenciasTareaContent',
                detalletareas: 'tabDetalleTareasContent'
            }[tab];
            if (activeContentId) {
                const el = document.getElementById(activeContentId);
                if (el) {
                    el.classList.remove('tab-content-fade');
                    void el.offsetWidth;
                    el.classList.add('tab-content-fade');
                }
            }

            if (tab === 'audit') renderAuditTable();
            if (tab === 'orphans') renderOrphansTable();
            if (tab === 'recat') renderRecatTable();
            if (tab === 'detallepm') initDetallePMTab();
            if (tab === 'bcmosincruce') renderBcmoSinCruceTable();
            if (tab === 'caducidad') renderCaducidadTable();
            if (tab === 'sinmodalidad' && typeof renderSinModalidadTable === 'function') renderSinModalidadTable();
            if (tab === 'validacioncontratista') renderValidacionContratistaTable();
            if (tab === 'incoherenciastarea' && typeof renderIncoherenciasTareaTable === 'function') renderIncoherenciasTareaTable();
            if (tab === 'detalletareas' && typeof renderDetalleTareasTable === 'function') renderDetalleTareasTable();
        }

        // Menú desplegable "Pre-Auditoría": agrupa Validación Contratista y Obras sin Modalidad
        function s1_togglePreAuditMenu(evt) {
            if (evt) evt.stopPropagation();
            s1_closeDiagMenu();
            const el = document.getElementById('preAuditMenuDropdown');
            if (el) el.classList.toggle('hidden');
        }

        function s1_closePreAuditMenu() {
            const el = document.getElementById('preAuditMenuDropdown');
            if (el) el.classList.add('hidden');
        }

        // Menú desplegable "Diagnóstico": agrupa las vistas técnicas
        function s1_toggleDiagMenu(evt) {
            if (evt) evt.stopPropagation();
            s1_closePreAuditMenu();
            const el = document.getElementById('diagMenuDropdown');
            if (el) el.classList.toggle('hidden');
        }

        function s1_closeDiagMenu() {
            const el = document.getElementById('diagMenuDropdown');
            if (el) el.classList.add('hidden');
        }

        // Menú desplegable "Correcciones y Novedades" (Etapa 1)
        function s1_toggleNovedadesMenu(evt) {
            if (evt) evt.stopPropagation();
            const el = document.getElementById('s1_novedadesMenuDropdown');
            if (el) el.classList.toggle('hidden');
        }

        function s1_closeNovedadesMenu() {
            const el = document.getElementById('s1_novedadesMenuDropdown');
            if (el) el.classList.add('hidden');
        }

        document.addEventListener('click', (e) => {
            const diagDropdown = document.getElementById('diagMenuDropdown');
            const diagBtn = document.getElementById('tabDiagBtn');
            if (diagDropdown && !diagDropdown.classList.contains('hidden')) {
                if (!diagDropdown.contains(e.target) && !diagBtn.contains(e.target)) {
                    s1_closeDiagMenu();
                }
            }

            const preDropdown = document.getElementById('preAuditMenuDropdown');
            const preBtn = document.getElementById('tabPreAuditBtn');
            if (preDropdown && !preDropdown.classList.contains('hidden')) {
                if (!preDropdown.contains(e.target) && !preBtn.contains(e.target)) {
                    s1_closePreAuditMenu();
                }
            }

            const novDropdown = document.getElementById('s1_novedadesMenuDropdown');
            const novBtn = document.getElementById('s1_btnTabNovedades');
            if (novDropdown && !novDropdown.classList.contains('hidden')) {
                if (!novDropdown.contains(e.target) && !novBtn.contains(e.target)) {
                    s1_closeNovedadesMenu();
                }
            }
        });

        // Suma los badges de las vistas de Pre-Auditoría
        function s1_updatePreAuditBadgeTotal() {
            const ids = ['tabValidacionContratistaCount', 'tabSinModalidadCount', 'tabIncoherenciasTareaCount'];
            let total = 0;
            ids.forEach(id => {
                const el = document.getElementById(id);
                const n = el ? parseInt(el.textContent, 10) : 0;
                if (!isNaN(n)) total += n;
            });
            setTabBadge('tabPreAuditCount', total);
        }

        // Suma los badges de las 4 vistas agrupadas para mostrar el total en "Diagnóstico"
        function s1_updateDiagBadgeTotal() {
            const ids = ['tabRecatCount', 'tabOrphansCount', 'tabBcmoSinCruceCount', 'tabCaducidadCount'];
            let total = 0;
            ids.forEach(id => {
                const el = document.getElementById(id);
                const n = el ? parseInt(el.textContent, 10) : 0;
                if (!isNaN(n)) total += n;
            });
            setTabBadge('tabDiagCount', total);
        }

        // Suma los badges de las 3 vistas agrupadas de Correcciones y Novedades en Etapa 1
        function s1_updateNovedadesBadgeTotal() {
            const ids = ['s1_invalidCountBadge', 's1_reasignadasCountBadge', 's1_otraECCountBadge'];
            let total = 0;
            ids.forEach(id => {
                const el = document.getElementById(id);
                const n = el ? parseInt(el.textContent, 10) : 0;
                if (!isNaN(n)) total += n;
            });
            setTabBadge('s1_novedadesCountBadge', total);
        }


        function resetApp() {
            if (!confirm("¿Desea iniciar un nuevo cruce? Se limpiarán los archivos cargados (sus modificaciones manuales se mantendrán en memoria).")) return;

            dataAvance = dataAvanceCorporativo = dataBCMO = dataTarea = dataMateriales = null;
            window.dataTarea = null;
            dataCorporativoRaw = [];
            dataConsolidada = filteredConsolidada = [];
            fileUploadDates = { avance: null, bcmo: null, tarea: null, pmovxf: null, corporativo: null };

            if (typeof renderDetalleTareasTable === 'function') renderDetalleTareasTable();

            // Limpiar overrides manuales de BCMO Sin Cruce
            if (window.bcmoSinCruceOverrides) window.bcmoSinCruceOverrides.clear();

            actualizarEstadoUI('statusAvance', false);
            actualizarEstadoUI('statusBCMO', false);
            actualizarEstadoUI('statusTarea', false);
            actualizarEstadoUI('statusMateriales', false);
            actualizarEstadoUI('statusCorpInd', false);

            const statCorp = document.getElementById('statusCorporativo');
            if (statCorp) statCorp.textContent = 'No cargado';
            const btnDelCorp = document.getElementById('btnDeleteCorp');
            if (btnDelCorp) btnDelCorp.classList.add('hidden');

            const btnCons = document.getElementById('btnConsolidar');
            if (btnCons) {
                btnCons.disabled = true;
                btnCons.className = "w-full sm:w-auto min-w-[240px] bg-slate-300 text-slate-500 font-bold py-3 px-6 rounded-xl shadow-sm text-sm cursor-not-allowed transition-all flex items-center justify-center gap-2";
            }

            document.getElementById('resultsSection').classList.add('hidden');
            document.getElementById('resultsSection').classList.remove('flex');
            document.getElementById('setupSection').classList.remove('hidden');
            document.getElementById('btnExportar').classList.add('hidden');
            const btnResultsReset = document.getElementById('btnGoToResults');
            if (btnResultsReset) btnResultsReset.classList.add('hidden');

            // Limpiar badges de pestañas y dropdowns
            ['tabValidacionContratistaCount', 'tabSinModalidadCount', 'tabIncoherenciasTareaCount', 'tabRecatCount', 'tabOrphansCount', 'tabBcmoSinCruceCount', 'tabCaducidadCount'].forEach(id => {
                setTabBadge(id, 0);
            });

            const fi = document.getElementById('fileInput'); if (fi) fi.value = "";
            const fc = document.getElementById('fileCorporativo'); if (fc) fc.value = "";
            const ft = document.getElementById('s2_fileTarea'); if (ft) ft.value = "";

            if (typeof actualizarTarjetasEtapa2UI === 'function') {
                actualizarTarjetasEtapa2UI();
            }

            switchTab('data');
            showToast("Sesión reiniciada. Listo para nuevo cruce.", "info");
        }

        // --- JSON MEMORY (SESION COMPLETA) ---
        function exportFullSessionJSON() {
            if (!dataAvance && !dataAvanceCorporativo) {
                showToast("No hay registros cargados para guardar.", "error");
                return;
            }

            // Filtrar los descartes que son solo para la auditoria en curso (RECIENTE_SIN_PM)
            const overridesToSave = {};
            for (const [key, log] of Object.entries(stateOverrides)) {
                if (log.justifType !== 'RECIENTE_SIN_PM') {
                    overridesToSave[key] = log;
                }
            }

            const data = {
                version: "5.3_AuditCorpStrict",
                exportDate: new Date().toISOString(),
                overrides: overridesToSave,
                dataAvance: dataAvance,
                dataAvanceCorporativo: dataAvanceCorporativo,
                dataBCMO: dataBCMO,
                dataTarea: dataTarea,
                dataMateriales: dataMateriales,
                headersAvance: headersAvance,
                fileUploadDates: fileUploadDates,
                formulaObraBF: document.getElementById('formulaInput').value,
                configExcludedContratistas: document.getElementById('configExcludedContratistas').value,
                configCustomJustifications: document.getElementById('configCustomJustifications') ? document.getElementById('configCustomJustifications').value : ""
            };

            const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const dlNode = document.createElement('a');
            dlNode.setAttribute("href", url);
            dlNode.setAttribute("download", `Sesion_Auditoria_Obras_${new Date().getTime()}.json`);
            document.body.appendChild(dlNode);
            dlNode.click();
            dlNode.remove();
            URL.revokeObjectURL(url);

            showToast("Sesión completa guardada exitosamente.", "success");
        }

        function importFullSessionJSON(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const parsed = JSON.parse(e.target.result);

                    if (parsed.version && parsed.version.includes("Audit")) {
                        stateOverrides = parsed.overrides || {};
                        dataAvance = parsed.dataAvance || null;
                        dataAvanceCorporativo = parsed.dataAvanceCorporativo || null;
                        dataBCMO = parsed.dataBCMO || null;
                        dataTarea = parsed.dataTarea || null;
                        window.dataTarea = dataTarea;
            window.s2_rawTareaData = json;
            if (typeof window.s3_ejecutarCruceTarea === 'function') window.s3_ejecutarCruceTarea();
                        dataMateriales = parsed.dataMateriales || null;
                        headersAvance = parsed.headersAvance || [];
                        fileUploadDates = parsed.fileUploadDates || { avance: null, bcmo: null, tarea: null, pmovxf: null, corporativo: null };

                        if (parsed.formulaObraBF) document.getElementById('formulaInput').value = parsed.formulaObraBF;
                        if (parsed.configExcludedContratistas) document.getElementById('configExcludedContratistas').value = parsed.configExcludedContratistas;
                        if (parsed.configCustomJustifications !== undefined && document.getElementById('configCustomJustifications')) {
                            document.getElementById('configCustomJustifications').value = parsed.configCustomJustifications;
                        }

                        if (dataAvance) actualizarEstadoUI('statusAvance', true, fileUploadDates.avance);
                        if (dataAvanceCorporativo) {
                            actualizarEstadoUI('statusCorpInd', true, fileUploadDates.corporativo);
                            document.getElementById('statusCorporativo').textContent = `Cargado (Restaurado)`;
                            document.getElementById('btnDeleteCorp').classList.remove('hidden');
                        }
                        if (dataBCMO) actualizarEstadoUI('statusBCMO', true, fileUploadDates.bcmo);
                        if (dataTarea) actualizarEstadoUI('statusTarea', true, fileUploadDates.tarea);
                        if (dataMateriales) actualizarEstadoUI('statusMateriales', true, fileUploadDates.pmovxf);

                        showToast(`Sesión restaurada correctamente.`, "success");

                        checkReadyToConsolidate();
                        if ((dataAvance || dataAvanceCorporativo) && (dataBCMO || dataTarea)) {
                            // Only trigger processing if auditor is set (requirement)
                            if (document.getElementById('auditorName').value && document.getElementById('globalAuditDate').value) {
                                procesarConsolidacion();
                            }
                        }
                    } else {
                        throw new Error("Formato inválido");
                    }
                } catch (err) {
                    showToast("Error al cargar archivo de sesión.", "error");
                }
                document.getElementById('jsonFileInput').value = "";
            };
            reader.readAsText(file);
        }

        // --- FUNCIONES NUEVAS: CARGA CORPORATIVO ---
        function eliminarCargaCorp() {
            if (!confirm("¿Desea eliminar los datos importados del archivo Corporativo?")) return;
            dataAvanceCorporativo = null;
            dataCorporativoRaw = [];
            fileUploadDates.corporativo = null;

            actualizarEstadoUI('statusCorpInd', false);
            document.getElementById('statusCorporativo').textContent = 'No cargado';
            document.getElementById('fileCorporativo').value = '';
            document.getElementById('btnDeleteCorp').classList.add('hidden');

            checkReadyToConsolidate();
            if (typeof actualizarTarjetasEtapa2UI === 'function') {
                actualizarTarjetasEtapa2UI();
            }

            if (dataConsolidada.length > 0) {
                procesarConsolidacion();
                showToast("Archivo Corporativo eliminado. Cruce recalculado.", "info");
            } else {
                showToast("Archivo Corporativo eliminado.", "info");
            }
        }

        function preAnalizarCorporativo(event) {
            const file = event.target.files[0];
            if (!file) return;
            event.target.value = '';

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array', cellDates: true });

                    // Priorizamos la hoja 'OBRAS'
                    const sheetName = workbook.SheetNames.find(n => n.toUpperCase() === 'OBRAS') || workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];

                    // Buscar la fila de cabecera que contenga 'Contratista' y 'Nodo'
                    const aoa = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                    let headerRowIdx = 0;
                    for (let i = 0; i < Math.min(aoa.length, 50); i++) {
                        const rowStr = (aoa[i] || []).join(' ').toLowerCase();
                        if (rowStr.includes('nodo') && rowStr.includes('contratista')) {
                            headerRowIdx = i;
                            break;
                        }
                    }

                    let json = XLSX.utils.sheet_to_json(worksheet, { range: headerRowIdx, defval: "" });

                    // Filtrar registros que no tengan informado el NODO
                    json = json.filter(r => String(r['Nodo'] || '').trim() !== '');

                    dataCorporativoRaw = json;

                    // Excluir contratistas por defecto
                    const excludedText = document.getElementById('configExcludedContratistas').value || "";
                    const excludedList = excludedText.split(',').map(s => s.trim().toUpperCase()).filter(s => s);

                    // Poblar modal con Contratistas únicos válidos
                    const contratistas = [...new Set(json.map(r => r['Contratista']).filter(c => c && String(c).trim() !== ''))]
                        .filter(c => !excludedList.includes(String(c).trim().toUpperCase()))
                        .sort();

                    const select = document.getElementById('selectContratistaCorp');
                    select.innerHTML = contratistas.map(c => `<option value="${c}">${c}</option>`).join('');

                    if (contratistas.length > 0) {
                        document.getElementById('modalFiltroContratista').classList.remove('hidden');
                    } else {
                        showToast("No se encontraron contratistas válidas (todas fueron filtradas o el archivo está vacío).", "error");
                    }
                } catch (error) {
                    showToast("No se pudo leer el archivo corporativo.", "error");
                }
                document.getElementById('fileCorporativo').value = '';
            };
            reader.readAsArrayBuffer(file);
        }

        function cancelarCargaCorp() {
            document.getElementById('modalFiltroContratista').classList.add('hidden');
            dataCorporativoRaw = [];
        }

        function getMinDate(d1, d2, d3) {
            const dates = [d1, d2, d3]
                .map(d => new Date(d))
                .filter(d => !isNaN(d.getTime()));
            return dates.length > 0 ? new Date(Math.min(...dates)) : null;
        }

        function confirmarCargaCorp() {
            const selectElement = document.getElementById('selectContratistaCorp');
            const selectedOptions = Array.from(selectElement.selectedOptions).map(opt => opt.value);

            if (selectedOptions.length === 0) {
                showToast("Por favor seleccione al menos una contratista.", "error");
                return;
            }

            const filtered = dataCorporativoRaw.filter(r => selectedOptions.includes(r['Contratista']));

            dataAvanceCorporativo = filtered.map(row => {
                // Cálculo Fecha Cierre Mínima
                const fFin = row['Fin'];
                const fPuesta = row['Puesta en M.'];
                const fCierre = row['Cierre Técnico'];
                const fechaMinima = getMinDate(fFin, fPuesta, fCierre);

                const fMinStr = fechaMinima ? fechaMinima.toLocaleDateString('es-AR') : "";

                // Mapeo de Estado Corporativo según requerimiento
                let rawEstado = String(row['ESTADO'] || '').trim();
                let upperEstado = rawEstado.toUpperCase();
                let estadoMapeado = corporativoEstadoMapping[upperEstado] || upperEstado;

                return {
                    ...row,
                    '_N_NODO': String(row['Nodo'] || '').trim(),
                    '_N_ESTADO': estadoMapeado,
                    '_N_INICIO': row['Inicio'],
                    '_N_CONTRATISTA': row['Contratista'],
                    '_N_MODALIDAD_DE_LIQUIDACION': 'CORPORATIVO',
                    '_N_FECHA_CIERRE_CALCULADA': fMinStr,
                    '_ORIGEN': 'CORPORATIVO'
                };
            });

            fileUploadDates.corporativo = new Date().toLocaleString('es-AR');
            actualizarEstadoUI('statusCorpInd', true, fileUploadDates.corporativo);

            let resumenNombres = selectedOptions.length <= 2 ? selectedOptions.join(', ') : `${selectedOptions.length} contratistas`;
            document.getElementById('statusCorporativo').textContent = `Cargado: ${resumenNombres} (${dataAvanceCorporativo.length} res.)`;
            document.getElementById('btnDeleteCorp').classList.remove('hidden');

            document.getElementById('modalFiltroContratista').classList.add('hidden');
            showToast(`Se importaron ${dataAvanceCorporativo.length} registros de ${resumenNombres}.`, "success");
            checkReadyToConsolidate();
            if (typeof actualizarTarjetasEtapa2UI === 'function') {
                actualizarTarjetasEtapa2UI();
            }
        }

        // --- MOTOR DE FÓRMULAS EXCEL ---
        function evaluateExcelFormula(formula, context) {
            try {
                let f = formula.replace(/\[Nodo\]/gi, `'${context.nodo || ""}'`);
                const funcs = {
                    'LEFT': (s, n) => s.substring(0, n),
                    'RIGHT': (s, n) => s.substring(s.length - n),
                    'MID': (s, start, n) => s.substring(start - 1, (start - 1) + n),
                    'SUBSTITUTE': (s, old, newVal) => s.replaceAll(old, newVal),
                    'UPPER': (s) => s.toUpperCase(),
                    'TRIM': (s) => s.trim()
                };
                return String(new Function(...Object.keys(funcs), `return ${f}`)(...Object.values(funcs)));
            } catch (e) { return "ERR!"; }
        }

        // --- INICIALIZACIÓN ---
        document.addEventListener("DOMContentLoaded", () => {
            const globalAuditInput = document.getElementById('globalAuditDate');
            if (globalAuditInput) {
                globalAuditInput.valueAsDate = new Date();
            }

            const dropZone = document.getElementById('dropZone');
            const fileInput = document.getElementById('fileInput');

            if (dropZone) {
                dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
                dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
                dropZone.addEventListener('drop', (e) => {
                    e.preventDefault(); dropZone.classList.remove('dragover');
                    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
                });
            }
            if (fileInput) {
                fileInput.addEventListener('change', (e) => { if (e.target.files.length) handleFiles(e.target.files); });
            }
        });

        function handleFiles(files) {
            Array.from(files).forEach(file => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const data = new Uint8Array(e.target.result);
                        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                        const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
                        clasificarArchivo(json, Object.keys(json[0] || {}), file.name);
                    } catch (error) { leerComoCSV(file); }
                };
                reader.readAsArrayBuffer(file);
            });
        }

        function leerComoCSV(file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target.result;
                let delimiter = text.split('\n')[0].includes('\t') ? '\t' : (text.split('\n')[0].includes(';') ? ';' : ',');
                const lines = text.split('\n');
                const headers = lines[0].split(delimiter).map(h => h.trim());
                const hStr = headers.join(' ').toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const isTarea = hStr.includes('PERMITE DECLARAR MATERIAL') && hStr.includes('ESTADO TAREA');
                const isBCMO = hStr.includes('ESTADO DE LIQUIDACION') || (hStr.includes('ENTREGADO') && hStr.includes('CONSUMIDO') && hStr.includes('TAREA'));
                const json = [];

                if (isTarea) {
                    const normalizeKey = (s) => String(s || '').trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_');
                    let idxPermitir = -1, idxObra = -1, idxDecl = -1, idxTarea = -1, idxObraBF = -1, idxProv = -1;
                    let colPermitir = "Permite Declarar Material", colObra = "Obra BF", colDecl = "Estado Declaración";
                    let colTarea = "Estado Tarea", colObraBF = "Estado Obra BF", colProv = "Contratista";

                    headers.forEach((h, idx) => {
                        const norm = normalizeKey(h);
                        if (norm.includes('PERMITE_DECLARAR') || norm.includes('PERMITIR_DECLARAR')) { idxPermitir = idx; colPermitir = h; }
                        else if (norm === 'OBRA_BF' || norm.includes('OBRA_BF')) { idxObra = idx; colObra = h; }
                        else if (norm.includes('DECLARA') || norm.includes('ESTADO_DECL')) { idxDecl = idx; colDecl = h; }
                        else if (norm === 'ESTADO_TAREA' || norm.includes('ESTADO_TAREA')) { idxTarea = idx; colTarea = h; }
                        else if (norm === 'ESTADO_OBRA_BF' || norm.includes('ESTADO_OBRA')) { idxObraBF = idx; colObraBF = h; }
                        else if (norm === 'CONTRATISTA' || norm === 'NOMBRE_PROV' || norm === 'PROVEEDOR') { idxProv = idx; colProv = h; }
                    });

                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;
                        const values = line.split(delimiter);
                        if (idxPermitir !== -1) {
                            const pVal = (values[idxPermitir] || '').trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                            if (pVal && pVal !== "SI") continue;
                        }
                        if (idxTarea !== -1) {
                            const stVal = (values[idxTarea] || '').trim().toUpperCase();
                            if (stVal.includes('CANCELADA') || stVal.includes('ANULADA') || stVal.includes('DUPLICADA')) continue;
                        }
                        if (idxObraBF !== -1) {
                            const soVal = (values[idxObraBF] || '').trim().toUpperCase();
                            if (soVal.includes('CANCELADA') || soVal.includes('ANULADA') || soVal.includes('DUPLICADA')) continue;
                        }
                        const row = {};
                        row[colPermitir] = idxPermitir !== -1 && values[idxPermitir] ? values[idxPermitir].trim() : "";
                        row[colObra] = idxObra !== -1 && values[idxObra] ? values[idxObra].trim() : "";
                        row[colDecl] = idxDecl !== -1 && values[idxDecl] ? values[idxDecl].trim() : "";
                        row[colTarea] = idxTarea !== -1 && values[idxTarea] ? values[idxTarea].trim() : "";
                        row[colObraBF] = idxObraBF !== -1 && values[idxObraBF] ? values[idxObraBF].trim() : "";
                        row[colProv] = idxProv !== -1 && values[idxProv] ? values[idxProv].trim() : "";
                        json.push(row);
                    }
                } else if (isBCMO) {
                    const normalize = (s) => String(s || '').trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\.$/, '');
                    const kLocCod = headers.findIndex(k => normalize(k) === 'LOCALIZADOR_COD' || normalize(k) === 'LOCALIZADOR COD' || normalize(k) === 'LOCALIZADOR');
                    const kLocDesc = headers.findIndex(k => normalize(k) === 'LOCALIZADOR_DESC' || normalize(k) === 'LOCALIZADOR DESC' || normalize(k) === 'NOMBRE_PROV');
                    const kTarea = headers.findIndex(k => normalize(k) === 'TAREA');
                    const kObra = headers.findIndex(k => normalize(k) === 'MOTIVO_DE_OBRA' || normalize(k) === 'MOTIVO DE OBRA' || normalize(k) === 'MOTIVO' || normalize(k) === 'OBRA');
                    const kItem = headers.findIndex(k => normalize(k) === 'ITEM' || normalize(k) === 'CODIGO');
                    const kDesc = headers.findIndex(k => normalize(k) === 'DESCRIPCION');
                    const kUM = headers.findIndex(k => normalize(k) === 'UM');
                    const kEnt = headers.findIndex(k => normalize(k) === 'ENTREGADO');
                    const kCon = headers.findIndex(k => normalize(k) === 'CONSUMIDO');
                    const kDif = headers.findIndex(k => normalize(k) === 'DIFERENCIA');
                    const kFecha = headers.findIndex(k => normalize(k) === 'FECHA_TRX' || normalize(k) === 'FECHA');

                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;
                        const values = line.split(delimiter);
                        const locCod = kLocCod !== -1 && values[kLocCod] ? values[kLocCod].trim() : '';
                        if (locCod.endsWith('.3001') || locCod.endsWith('.4001') || (/\.1\d{3}$/.test(locCod) && !locCod.endsWith('.1001'))) continue;

                        const locDesc = kLocDesc !== -1 && values[kLocDesc] ? values[kLocDesc].trim() : '';
                        if (locDesc.toUpperCase().includes('SOBRANTES')) continue;

                        json.push({
                            LOCALIZADOR_COD: locCod,
                            LOCALIZADOR_DESC: locDesc,
                            TAREA: kTarea !== -1 && values[kTarea] ? values[kTarea].trim() : '',
                            MOTIVO_DE_OBRA: kObra !== -1 && values[kObra] ? values[kObra].trim() : '',
                            ITEM: kItem !== -1 && values[kItem] ? values[kItem].trim() : '',
                            DESCRIPCION: kDesc !== -1 && values[kDesc] ? values[kDesc].trim() : '',
                            UM: kUM !== -1 && values[kUM] ? values[kUM].trim() : '',
                            ENTREGADO: kEnt !== -1 && values[kEnt] !== undefined ? values[kEnt].trim() : 0,
                            CONSUMIDO: kCon !== -1 && values[kCon] !== undefined ? values[kCon].trim() : 0,
                            DIFERENCIA: kDif !== -1 && values[kDif] !== undefined ? values[kDif].trim() : 0,
                            FECHA_TRX: kFecha !== -1 && values[kFecha] ? values[kFecha].trim() : ''
                        });
                    }
                } else {
                    for (let i = 1; i < lines.length; i++) {
                        if (!lines[i].trim()) continue;
                        const values = lines[i].split(delimiter);
                        const row = {};
                        for (let j = 0; j < headers.length; j++) row[headers[j]] = values[j] ? values[j].trim() : "";
                        json.push(row);
                    }
                }
                clasificarArchivo(json, headers, file.name);
            };
            reader.readAsText(file, 'ISO-8859-1');
        }

        function clasificarArchivo(data, headers, filename) {
            if (data.length === 0) return;
            const hStr = headers.join(' ').toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const dateStr = new Date().toLocaleString('es-AR');

            if (hStr.includes('MODALIDAD DE LIQUIDACION') || hStr.includes('ETAPA LOGICA') || (hStr.includes('MOTIVO') && (hStr.includes('EMPRESA') || hStr.includes('CONTRATISTA')))) {
                showToast("El archivo de Avance General corresponde a la Etapa 1. Debe cargarse, verificarse y transferirse desde allí.", "warning");
                return;
            } else if (hStr.includes('ESTADO DE LIQUIDACION') || (hStr.includes('ENTREGADO') && hStr.includes('CONSUMIDO') && hStr.includes('TAREA'))) {
                showToast("El archivo BCMO corresponde a la Etapa 1. Debe cargarse, verificarse y transferirse desde allí.", "warning");
                return;
            } else if (hStr.includes('TRANSACCION') || hStr.includes('TIPO TRX') || (hStr.includes('MOTIVO') && hStr.includes('FECHA_TRX')) || ((hStr.includes('ITEM') || hStr.includes('ARTICULO')) && hStr.includes('CANTIDAD'))) {
                showToast("El archivo PMOVXF corresponde a la Etapa 1. Debe cargarse, verificarse y transferirse desde allí.", "warning");
                return;
            } else if (hStr.includes('PERMITE DECLARAR MATERIAL') && hStr.includes('ESTADO TAREA')) {
                const slimData = s2_adelgazarDatasetTarea(data);
                data = null;
                dataTarea = procesarHistorialTareas(slimData);
                window.dataTarea = dataTarea;
                fileUploadDates.tarea = dateStr;
                actualizarEstadoUI('statusTarea', true, dateStr);
                if (typeof renderDetalleTareasTable === 'function') renderDetalleTareasTable();
            } else if (hStr.includes('OBRA BF') || hStr.includes('DETALLE TKT')) {
                dataTarea = normalizarDataset(data);
                window.dataTarea = dataTarea;
                fileUploadDates.tarea = dateStr;
                actualizarEstadoUI('statusTarea', true, dateStr);
                if (typeof renderDetalleTareasTable === 'function') renderDetalleTareasTable();
            } else if (hStr.includes('TRANSACCION') || hStr.includes('TIPO TRX') || (hStr.includes('MOTIVO') && hStr.includes('FECHA_TRX')) || ((hStr.includes('ITEM') || hStr.includes('ARTICULO')) && hStr.includes('CANTIDAD'))) {
                dataMateriales = data;
                window.dataMateriales = data;
                fileUploadDates.pmovxf = dateStr;
                actualizarEstadoUI('statusMateriales', true, dateStr);
                actualizarTarjetasEtapa2UI();
                checkReadyToConsolidate();
                showToast("PMOVXF cargado individualmente en Etapa 2.", "success");
                return;
            }
            checkReadyToConsolidate();
            if (typeof window.renderRecatTable === 'function') window.renderRecatTable();
        }

        function confirmarCargaAvanceFallback() {
            dataAvance = tempAvanceData;
            headersAvance = tempAvanceHeaders;
            aplicarEstandarizacionInPlace(dataAvance);
            fileUploadDates.avance = tempAvanceDateStr;
            actualizarEstadoUI('statusAvance', true, tempAvanceDateStr);
            checkReadyToConsolidate();
            if (typeof window.renderRecatTable === 'function') window.renderRecatTable();
        }

        function confirmarCargaAvance() {
            const selectElement = document.getElementById('selectContratistaAvance');
            const selectedOptions = Array.from(selectElement.selectedOptions).map(opt => opt.value);

            if (selectedOptions.length === 0) {
                showToast("Por favor seleccione al menos una contratista.", "error");
                return;
            }

            dataAvance = tempAvanceData.filter(r => {
                let c = String(r['_N_CONTRATISTA'] || r['CONTRATISTA'] || r['Contratista'] || "").trim();
                return selectedOptions.includes(c);
            });

            headersAvance = tempAvanceHeaders;
            aplicarEstandarizacionInPlace(dataAvance);
            fileUploadDates.avance = tempAvanceDateStr;
            actualizarEstadoUI('statusAvance', true, tempAvanceDateStr);

            document.getElementById('modalFiltroContratistaAvance').classList.add('hidden');
            tempAvanceData = [];

            checkReadyToConsolidate();
            if (typeof window.renderRecatTable === 'function') window.renderRecatTable();
            showToast("Avance de Obras cargado exitosamente.", "success");
        }

        function cancelarCargaAvance() {
            document.getElementById('modalFiltroContratistaAvance').classList.add('hidden');
            tempAvanceData = [];
            tempAvanceHeaders = [];
        }

        function normalizarDataset(data) {
            if (!data || !Array.isArray(data)) return [];
            return data.map(row => {
                const newRow = { ...row, '_ORIGEN': row['_ORIGEN'] || 'PRINCIPAL' };
                for (let key in row) {
                    const cleanKey = key.trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_');
                    newRow[`_N_${cleanKey}`] = row[key];

                    if (cleanKey === 'ESTADO') {
                        newRow['_PRISTINE_ESTADO'] = String(row[key]).trim().toUpperCase();
                    }
                }

                // Homologar NODO canónico si no fue creado directamente
                if (!newRow['_N_NODO'] || String(newRow['_N_NODO']).trim() === '') {
                    const nodoVal = newRow['_N_MOTIVO'] || newRow['_N_MOTIVO_DE_OBRA'] || newRow['_N_OBRA'] || 
                                    newRow['_N_OBRA_BF'] || newRow['NODO'] || newRow['Nodo'] || 
                                    newRow['MOTIVO'] || newRow['Motivo'] || newRow['OBRA'] || newRow['Obra'] || '';
                    if (nodoVal) {
                        newRow['_N_NODO'] = String(nodoVal).trim();
                        newRow['NODO'] = String(nodoVal).trim();
                        newRow['Nodo'] = String(nodoVal).trim();
                    }
                } else {
                    newRow['NODO'] = String(newRow['_N_NODO']).trim();
                    newRow['Nodo'] = String(newRow['_N_NODO']).trim();
                }

                // Homologar ESTADO canónico
                if (!newRow['_N_ESTADO'] || String(newRow['_N_ESTADO']).trim() === '') {
                    const estVal = newRow['_N_ESTADO_DE_AVANCE'] || newRow['_N_ESTADO_OBRA'] || newRow['_N_ESTADO_DE_LA_OBRA'] ||
                                   newRow['ESTADO'] || newRow['Estado'] || newRow['ESTADO DE AVANCE'] || '';
                    if (estVal) {
                        newRow['_N_ESTADO'] = String(estVal).trim().toUpperCase();
                        newRow['ESTADO'] = String(estVal).trim().toUpperCase();
                    }
                } else {
                    newRow['ESTADO'] = String(newRow['_N_ESTADO']).trim().toUpperCase();
                }
                if (!newRow['_PRISTINE_ESTADO'] && newRow['_N_ESTADO']) {
                    newRow['_PRISTINE_ESTADO'] = String(newRow['_N_ESTADO']).trim().toUpperCase();
                }

                // Homologar MODALIDAD DE LIQUIDACIÓN canónica
                if (!newRow['_N_MODALIDAD_DE_LIQUIDACION'] || String(newRow['_N_MODALIDAD_DE_LIQUIDACION']).trim() === '') {
                    const modVal = newRow['_N_MODALIDAD'] || newRow['_N_MOD_LIQUIDACION'] || newRow['_N_MODALIDAD_LIQUIDACION'] ||
                                   newRow['MODALIDAD DE LIQUIDACION'] || newRow['MODALIDAD DE LIQUIDACIÓN'] || newRow['Modalidad'] || '';
                    if (modVal) {
                        newRow['_N_MODALIDAD_DE_LIQUIDACION'] = String(modVal).trim().toUpperCase();
                        newRow['MODALIDAD DE LIQUIDACION'] = String(modVal).trim().toUpperCase();
                    }
                } else {
                    newRow['MODALIDAD DE LIQUIDACION'] = String(newRow['_N_MODALIDAD_DE_LIQUIDACION']).trim().toUpperCase();
                }

                // Homologar CONTRATISTA canónico
                if (!newRow['_N_CONTRATISTA'] || String(newRow['_N_CONTRATISTA']).trim() === '') {
                    const cVal = newRow['_N_EMPRESA'] || newRow['_N_RAZON_SOCIAL'] || newRow['_N_LOCALIZADOR_DESC'] || newRow['_N_NOMBRE_PROV'] ||
                                 newRow['CONTRATISTA'] || newRow['Contratista'] || newRow['EMPRESA'] || newRow['Empresa'] || newRow['RAZON SOCIAL'] || '';
                    if (cVal) {
                        newRow['_N_CONTRATISTA'] = String(cVal).trim();
                        newRow['CONTRATISTA'] = String(cVal).trim();
                    }
                } else {
                    newRow['CONTRATISTA'] = String(newRow['_N_CONTRATISTA']).trim();
                }

                // Homologar FECHAS (INICIO, FIN, CIERRE TÉCNICO)
                if (!newRow['_N_INICIO']) {
                    newRow['_N_INICIO'] = newRow['_N_FECHA_INICIO'] || newRow['_N_FECHA_DE_INICIO'] || newRow['INICIO'] || newRow['Inicio'] || newRow['FECHA INICIO'] || '';
                }
                if (!newRow['_N_FIN']) {
                    newRow['_N_FIN'] = newRow['_N_FECHA_FIN'] || newRow['_N_FECHA_DE_FIN'] || newRow['FIN'] || newRow['Fin'] || newRow['FECHA FIN'] || '';
                }
                if (!newRow['_N_CIERRE_TECNICO']) {
                    newRow['_N_CIERRE_TECNICO'] = newRow['_N_FECHA_CIERRE_TECNICO'] || newRow['_N_CIERRE'] || newRow['CIERRE TECNICO'] || newRow['Cierre Tecnico'] || '';
                }

                return newRow;
            });
        }

        // La función aplicarEstandarizacionInPlace fue extraída a modules/recategorizacion.js

        function actualizarEstadoUI(id, success, date) {
            const el = document.getElementById(id);
            if (!el) return;

            const labelMap = {
                'statusAvance': 'Avance de Obras (Principal)',
                'statusBCMO': 'BCMO (Inyectado desde Etapa 1)',
                'statusTarea': 'Sistema TAREA',
                'statusMateriales': 'PMOVXF',
                'statusCorpInd': 'Avance Corporativo'
            };
            const title = labelMap[id] || id;

            if (success) {
                el.innerHTML = `<span class="text-slate-100 font-medium flex items-center gap-2"><i class="fa-solid fa-circle-check text-emerald-400"></i>${title}</span><span class="text-[10px] text-slate-300/80 italic font-mono">${date}</span>`;
            } else {
                el.innerHTML = `<span class="text-slate-400 flex items-center gap-2"><i class="fa-regular fa-circle text-slate-500"></i>${title}</span><span class="text-[10px] text-slate-500 italic"></span>`;
            }

            if (typeof actualizarTarjetasEtapa2UI === 'function') {
                actualizarTarjetasEtapa2UI();
            }
        }

        // Requerimos al menos Avance (Principal o Corp) y (BCMO o TAREA)
        function checkReadyToConsolidate() {
            const btn = document.getElementById('btnConsolidar');
            const auditor = document.getElementById('auditorName').value.trim();
            const auditDate = document.getElementById('globalAuditDate').value;

            if ((dataAvance || dataAvanceCorporativo) && (dataBCMO || dataTarea)) {
                if (auditor && auditDate) {
                    btn.disabled = false;
                    btn.className = "w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded shadow-md text-sm transition-colors";
                    btn.textContent = "Procesar y Consolidar";
                } else {
                    btn.disabled = true;
                    btn.className = "w-full bg-amber-500 text-white font-bold py-3 rounded shadow-sm text-sm cursor-not-allowed transition-colors";
                    btn.textContent = "Complete Auditor y Fecha arriba para procesar";
                }
            } else {
                btn.disabled = true;
                btn.className = "w-full bg-slate-300 text-slate-500 font-bold py-3 rounded shadow-sm text-sm cursor-not-allowed transition-colors";
                btn.textContent = "Procesar y Consolidar";
            }
        }

        function getActiveOverride(nodo) {
            let active = null;
            Object.values(stateOverrides).forEach(log => {
                if (log.nodo === nodo && !log.reverted) {
                    active = log;
                }
            });
            return active;
        }

        // --- PROCESAMIENTO CORE ---
        // procesarConsolidacion(), _procesarConsolidacionCore(), toggleStateFilter(),
        // toggleModalityFilter(), renderPreview() han sido extraídos a modules/consolidacion.js

        window.toggleOrphanStateFilter = function (estado) {
            const idx = activeOrphansStateFilters.indexOf(estado);
            if (idx > -1) activeOrphansStateFilters.splice(idx, 1);
            else activeOrphansStateFilters.push(estado);
            renderOrphansTable();
        };

        window.toggleOrphanModFilter = function (mod) {
            const idx = activeOrphansModFilters.indexOf(mod);
            if (idx > -1) activeOrphansModFilters.splice(idx, 1);
            else activeOrphansModFilters.push(mod);
            renderOrphansTable();
        };

        // --- FUNCIONES DE ESTANDARIZACION UI ---
        // Toda la lógica de estandarización, reglas y tabla recategorizada se encuentra en modules/recategorizacion.js

        // ============================================================
        // BCMO SIN CRUCE EN AVANCE DE OBRAS
        // ============================================================
        // La lógica de la SOLAPA BCMO SIN CRUCE ha sido migrada a modules/bcmoSinCruce.js

        // ============================================================
        // GESTOR DE CADUCIDAD
        // ============================================================
        // La lógica del GESTOR DE CADUCIDAD ha sido migrada a modules/caducidad.js

        // ============================================================
        // NODOS SIN REGISTRO (HUÉRFANOS) Y SISTEMA DE EDICIÓN
        // ============================================================
        // La lógica de HUÉRFANOS Y EDICIÓN DE ESTADO ha sido migrada a modules/orphans.js

        // NOTA: renderAuditTable(), removeOverride(), showDetails() y closeDetailsModal()
        // viven exclusivamente en modules/auditoria.js. Antes había "stubs" vacíos acá
        // que sobrescribían esas funciones reales por orden de carga de scripts — se
        // eliminaron porque causaban que el Historial de Cambios Manuales no se pintara.

        // La lógica de la SOLAPA DETALLE DE OBRAS (PM) ha sido migrada a modules/detallePM.js

        // --- EXPORTACIÓN EXCEL NATIVA ---
        // exportToExcel() fue extraída a modules/consolidacion.js


        // ============================================================================
        // FUNCIONES PUENTE ENTRE ETAPA 1 Y ETAPA 2
        // ============================================================================
        function showToastGlobal(msg, type) {
            showToast(msg, type);
        }

        function parseDecimalGlobal(val) {
            if (val === undefined || val === null || val === '') return 0;
            if (typeof val === 'number') return val;
            let str = String(val).trim();
            if (str.includes(',') && !str.includes('.')) str = str.replace(',', '.');
            else if (str.includes(',') && str.includes('.')) {
                if (str.lastIndexOf(',') > str.lastIndexOf('.')) str = str.replace(/\./g, '').replace(',', '.');
                else str = str.replace(/,/g, '');
            }
            return parseFloat(str) || 0;
        }

        function openBcmoModule() {
            const el = document.getElementById('s1_bcmoModule');
            el.classList.remove('hidden');
            el.classList.add('flex', 'fade-out-active');
            requestAnimationFrame(() => requestAnimationFrame(() => {
                el.classList.remove('fade-out-active');
                el.classList.add('fade-in-active');
            }));
            updateStepper(0);
        }

        function closeBcmoModule() {
            const el = document.getElementById('s1_bcmoModule');
            el.classList.add('fade-out-active');
            setTimeout(() => {
                el.classList.add('hidden');
                el.classList.remove('flex', 'fade-out-active', 'fade-in-active');
            }, 180);
            updateStepper(1);
        }

        
        function s2_avanzarSiguienteEtapa() {
            const tieneTarea = Boolean(
                (window.dataTarea && Array.isArray(window.dataTarea) && window.dataTarea.length > 0) ||
                (window.rawTarea && Array.isArray(window.rawTarea) && window.rawTarea.length > 0) ||
                (window.s2_rawTareaData && Array.isArray(window.s2_rawTareaData) && window.s2_rawTareaData.length > 0)
            );
            if (tieneTarea) {
                navigateToStep(2); // Etapa 3 · TAREA
            } else {
                navigateToStep(3); // Etapa 4 · Resultados
            }
        }
        window.s2_avanzarSiguienteEtapa = s2_avanzarSiguienteEtapa;

        function openConsolidacionModule() {
            const bcmoEl = document.getElementById('s1_bcmoModule');
            if (bcmoEl && !bcmoEl.classList.contains('hidden')) {
                closeBcmoModule();
            }
            const el = document.getElementById('s2_consolidacionModule');
            if (!el) return;
            el.classList.remove('hidden');
            el.classList.add('flex', 'fade-out-active');
            requestAnimationFrame(() => requestAnimationFrame(() => {
                el.classList.remove('fade-out-active');
                el.classList.add('fade-in-active');
            }));
            updateStepper(1);
            actualizarTarjetasEtapa2UI();
        }

        function closeConsolidacionModule() {
            const el = document.getElementById('s2_consolidacionModule');
            if (!el) return;
            el.classList.add('fade-out-active');
            setTimeout(() => {
                el.classList.add('hidden');
                el.classList.remove('flex', 'fade-out-active', 'fade-in-active');
            }, 180);
            updateStepper(1);
            actualizarTarjetasEtapa2UI();
        }

        function s2_adelgazarDatasetTarea(rawJson) {
            if (!rawJson || rawJson.length === 0) return rawJson;
            // Si ya viene adelgazado (por ejemplo desde el parseo CSV temprano)
            if (rawJson.length > 0 && Object.keys(rawJson[0]).length <= 8) {
                return rawJson;
            }
            const headers = Object.keys(rawJson[0] || {});
            const normalize = (s) => String(s || '').trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_');
            const hStr = headers.join(' ').toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            if (!hStr.includes('PERMITE DECLARAR MATERIAL') || !hStr.includes('ESTADO TAREA')) {
                return rawJson;
            }

            const colPermitir = headers.find(k => normalize(k).includes("PERMITE_DECLARAR") || normalize(k).includes("PERMITIR_DECLARAR")) || "Permite Declarar Material";
            const colObraBF = headers.find(k => normalize(k) === "OBRA_BF") || "Obra BF";
            const colEstadoDecl = headers.find(k => {
                const norm = normalize(k);
                return (norm.includes("ESTADO") && (norm.includes("DECL") || norm.includes("DECLARA"))) || norm === "ESTADO_DECLARACION";
            }) || "Estado Declaración";
            const colEstadoTarea = headers.find(k => normalize(k) === "ESTADO_TAREA") || "Estado Tarea";
            const colEstadoObraBF = headers.find(k => normalize(k) === "ESTADO_OBRA_BF") || "Estado Obra BF";
            const colContratista = headers.find(k => normalize(k) === "CONTRATISTA" || normalize(k) === "NOMBRE_PROV" || normalize(k) === "PROVEEDOR") || "Contratista";

            const slim = [];
            const len = rawJson.length;
            for (let i = 0; i < len; i++) {
                const r = rawJson[i];
                const valPermitir = String(r[colPermitir] || '').trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                if (valPermitir !== "SI") continue;

                const valEstadoTarea = String(r[colEstadoTarea] || '').trim().toUpperCase();
                const valEstadoObraBF = String(r[colEstadoObraBF] || '').trim().toUpperCase();
                const valEstadoDecl = String(r[colEstadoDecl] || '').trim().toUpperCase();
                if (valEstadoTarea.includes('CANCELAD') || valEstadoTarea.includes('ANULAD') || valEstadoTarea.includes('DUPLICAD') || valEstadoTarea.includes('BAJA')) continue;
                if (valEstadoDecl.includes('CANCELAD') || valEstadoDecl.includes('ANULAD') || valEstadoDecl.includes('DUPLICAD') || valEstadoDecl.includes('BAJA')) continue;
                if (valEstadoObraBF.includes('CANCELAD') || valEstadoObraBF.includes('ANULAD') || valEstadoObraBF.includes('DUPLICAD') || valEstadoObraBF.includes('BAJA')) continue;

                const rowSlim = {};
                rowSlim[colPermitir] = r[colPermitir];
                rowSlim[colObraBF] = r[colObraBF];
                rowSlim[colEstadoDecl] = r[colEstadoDecl];
                rowSlim[colEstadoTarea] = r[colEstadoTarea];
                rowSlim[colEstadoObraBF] = r[colEstadoObraBF];
                rowSlim[colContratista] = r[colContratista];
                slim.push(rowSlim);
            }
            return slim;
        }

        function s2_handleFileTarea(event) {
            const file = event.target.files[0];
            if (!file) return;
            event.target.value = '';

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rawJson = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
                    const json = s2_adelgazarDatasetTarea(rawJson);
                    s2_procesarDatosTarea(json, file.name);
                } catch (err) {
                    const textReader = new FileReader();
                    textReader.onload = (te) => {
                        const text = te.target.result;
                        let delimiter = text.split('\n')[0].includes('\t') ? '\t' : (text.split('\n')[0].includes(';') ? ';' : ',');
                        const lines = text.split('\n');
                        const headers = lines[0].split(delimiter).map(h => h.trim());
                        const hStr = headers.join(' ').toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                        const isTareaHistorial = hStr.includes('PERMITE DECLARAR MATERIAL') && hStr.includes('ESTADO TAREA');

                        let idxPermitir = -1, idxEstadoTarea = -1, idxEstadoObra = -1;
                        let colPermitirKey = "", colObraKey = "", colEstadoTareaKey = "", colEstadoObraKey = "", colContratistaKey = "", colDeclKey = "";

                        if (isTareaHistorial) {
                            headers.forEach((h, idx) => {
                                const norm = h.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_');
                                if (norm.includes('PERMITE_DECLARAR') || norm.includes('PERMITIR_DECLARAR')) { idxPermitir = idx; colPermitirKey = h; }
                                else if (norm === 'OBRA_BF' || norm.includes('OBRA_BF')) { colObraKey = h; }
                                else if (norm === 'ESTADO_TAREA' || norm.includes('ESTADO_TAREA')) { idxEstadoTarea = idx; colEstadoTareaKey = h; }
                                else if (norm === 'ESTADO_OBRA_BF' || norm.includes('ESTADO_OBRA')) { idxEstadoObra = idx; colEstadoObraKey = h; }
                                else if (norm === 'CONTRATISTA' || norm === 'NOMBRE_PROV' || norm === 'PROVEEDOR') { colContratistaKey = h; }
                                else if (norm.includes('DECLARA') || norm.includes('ESTADO_DECL')) { colDeclKey = h; }
                            });
                        }

                        const json = [];
                        for (let i = 1; i < lines.length; i++) {
                            const line = lines[i].trim();
                            if (!line) continue;
                            const values = line.split(delimiter);

                            if (isTareaHistorial) {
                                if (idxPermitir !== -1) {
                                    const pVal = (values[idxPermitir] || '').trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                                    if (pVal && pVal !== "SI") continue;
                                }
                                if (idxEstadoTarea !== -1) {
                                    const stVal = (values[idxEstadoTarea] || '').trim().toUpperCase();
                                    if (stVal.includes('CANCELADA') || stVal.includes('ANULADA') || stVal.includes('DUPLICADA')) continue;
                                }
                                if (idxEstadoObra !== -1) {
                                    const soVal = (values[idxEstadoObra] || '').trim().toUpperCase();
                                    if (soVal.includes('CANCELADA') || soVal.includes('ANULADA') || soVal.includes('DUPLICADA')) continue;
                                }
                                const row = {};
                                for (let j = 0; j < headers.length; j++) {
                                    const h = headers[j];
                                    if (h === colPermitirKey || h === colObraKey || h === colEstadoTareaKey || h === colEstadoObraKey || h === colContratistaKey || h === colDeclKey) {
                                        row[h] = values[j] ? values[j].trim() : "";
                                    }
                                }
                                json.push(row);
                            } else {
                                const row = {};
                                for (let j = 0; j < headers.length; j++) row[headers[j]] = values[j] ? values[j].trim() : "";
                                json.push(row);
                            }
                        }
                        s2_procesarDatosTarea(json, file.name);
                    };
                    textReader.readAsText(file, 'ISO-8859-1');
                }
            };
            reader.readAsArrayBuffer(file);
        }

        function s2_procesarDatosTarea(json, filename) {
            if (!json || json.length === 0) {
                showToast("El archivo Sistema TAREA está vacío.", "error");
                return;
            }
            const dateStr = new Date().toLocaleString('es-AR');
            const headers = Object.keys(json[0] || {});
            const hStr = headers.join(' ').toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            if (hStr.includes('PERMITE DECLARAR MATERIAL') && hStr.includes('ESTADO TAREA')) {
                dataTarea = procesarHistorialTareas(json);
            } else {
                dataTarea = normalizarDataset(json);
            }
            window.dataTarea = dataTarea;
            fileUploadDates.tarea = dateStr;
            actualizarEstadoUI('statusTarea', true, dateStr);
            actualizarTarjetasEtapa2UI();
            checkReadyToConsolidate();
            if (typeof window.renderRecatTable === 'function') window.renderRecatTable();
            if (typeof renderDetalleTareasTable === 'function') renderDetalleTareasTable();
            showToast("Sistema TAREA cargado exitosamente.", "success");
        }

        function s2_eliminarTarea() {
            dataTarea = null;
            window.dataTarea = null;
            fileUploadDates.tarea = null;
            const input = document.getElementById('s2_fileTarea');
            if (input) input.value = '';
            actualizarEstadoUI('statusTarea', false);
            actualizarTarjetasEtapa2UI();
            checkReadyToConsolidate();
            if (typeof window.renderRecatTable === 'function') window.renderRecatTable();
            if (typeof renderDetalleTareasTable === 'function') renderDetalleTareasTable();
            showToast("Sistema TAREA removido.", "info");
        }

        function s2_handleFileBCMO(event) {
            const file = event.target.files ? event.target.files[0] : null;
            if (!file) return;
            event.target.value = '';
            handleFiles([file]);
        }

        function s2_handleFilePMOVXF(event) {
            const file = event.target.files ? event.target.files[0] : null;
            if (!file) return;
            event.target.value = '';
            handleFiles([file]);
        }

        function s2_handleFileAvance(event) {
            const file = event.target.files ? event.target.files[0] : null;
            if (!file) return;
            event.target.value = '';
            handleFiles([file]);
        }

        function actualizarTarjetasEtapa2UI() {
            // 1. Tarjeta 1: BCMO
            const cardBCMO = document.getElementById('s2_cardBCMO');
            const badgeBCMO = document.getElementById('s2_badgeBCMO');
            const bodyBCMO = document.getElementById('s2_bodyBCMO');
            const pillBCMO = document.getElementById('s2_pillBCMO');

            if (dataBCMO && dataBCMO.length > 0) {
                if (cardBCMO) {
                    cardBCMO.className = "bg-emerald-50/40 border border-emerald-300 rounded-2xl p-5 shadow-sm hover:shadow-md flex flex-col justify-between transition-all relative overflow-hidden border-t-4 border-t-emerald-500";
                }
                if (badgeBCMO) {
                    badgeBCMO.className = "text-[10px] bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5 shadow-xs";
                    badgeBCMO.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-700"></i> BCMO Listo';
                }
                if (bodyBCMO) {
                    bodyBCMO.innerHTML = `
                        <div class="bg-white border border-emerald-200 rounded-lg p-3 text-xs text-emerald-900 shadow-2xs">
                            <div class="font-bold flex items-center gap-1.5 text-emerald-800 mb-1">
                                <i class="fa-solid fa-circle-check text-emerald-600"></i>
                                <span>${dataBCMO.length.toLocaleString('es-AR')} registros de consumos</span>
                            </div>
                            <div class="text-[11px] text-slate-500">${fileUploadDates.bcmo || 'Cargado'}</div>
                        </div>
                    `;
                }
                if (pillBCMO) {
                    pillBCMO.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold text-[11px]";
                    pillBCMO.innerHTML = '<i class="fa-solid fa-check text-emerald-600"></i> BCMO Listo';
                }
            } else {
                if (cardBCMO) {
                    cardBCMO.className = "bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md flex flex-col justify-between transition-all relative overflow-hidden border-t-4 border-t-blue-500";
                }
                if (badgeBCMO) {
                    badgeBCMO.className = "text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold flex items-center gap-1";
                    badgeBCMO.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Pendiente';
                }
                if (bodyBCMO) {
                    bodyBCMO.innerHTML = `
                        <div class="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 mb-2">
                            <i class="fa-solid fa-lock text-slate-400 mr-1"></i> Requiere procesar y transferir desde la <b>Etapa 1</b>.
                        </div>
                        <button type="button" onclick="navigateToStep(0)"
                            class="w-full bg-slate-800 hover:bg-slate-900 text-white font-semibold py-2 px-3 rounded-lg transition-colors text-xs shadow-sm flex items-center justify-center gap-2 cursor-pointer">
                            <i class="fa-solid fa-arrow-left text-[11px]"></i> Ir a Etapa 1
                        </button>
                    `;
                }
                if (pillBCMO) {
                    pillBCMO.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium text-[11px]";
                    pillBCMO.innerHTML = '<i class="fa-regular fa-circle text-slate-400"></i> BCMO';
                }
            }

            // 2. Tarjeta 2: PMOVXF
            const cardPMOVXF = document.getElementById('s2_cardPMOVXF');
            const badgePMOVXF = document.getElementById('s2_badgePMOVXF');
            const bodyPMOVXF = document.getElementById('s2_bodyPMOVXF');
            const pillPMOVXF = document.getElementById('s2_pillPMOVXF');

            if (dataMateriales && dataMateriales.length > 0) {
                if (cardPMOVXF) {
                    cardPMOVXF.className = "bg-emerald-50/40 border border-emerald-300 rounded-2xl p-5 shadow-sm hover:shadow-md flex flex-col justify-between transition-all relative overflow-hidden border-t-4 border-t-emerald-500";
                }
                if (badgePMOVXF) {
                    badgePMOVXF.className = "text-[10px] bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5 shadow-xs";
                    badgePMOVXF.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-700"></i> PMOVXF Listo';
                }
                if (bodyPMOVXF) {
                    bodyPMOVXF.innerHTML = `
                        <div class="bg-white border border-emerald-200 rounded-lg p-3 text-xs text-emerald-900 shadow-2xs">
                            <div class="font-bold flex items-center gap-1.5 text-emerald-800 mb-1">
                                <i class="fa-solid fa-circle-check text-emerald-600"></i>
                                <span>${dataMateriales.length.toLocaleString('es-AR')} movimientos</span>
                            </div>
                            <div class="text-[11px] text-slate-500">${fileUploadDates.pmovxf || 'Cargado'}</div>
                        </div>
                    `;
                }
                if (pillPMOVXF) {
                    pillPMOVXF.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold text-[11px]";
                    pillPMOVXF.innerHTML = '<i class="fa-solid fa-check text-emerald-600"></i> PMOVXF Listo';
                }
            } else {
                if (cardPMOVXF) {
                    cardPMOVXF.className = "bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md flex flex-col justify-between transition-all relative overflow-hidden border-t-4 border-t-amber-500";
                }
                if (badgePMOVXF) {
                    badgePMOVXF.className = "text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-semibold";
                    badgePMOVXF.textContent = 'No cargado (Opcional)';
                }
                if (bodyPMOVXF) {
                    bodyPMOVXF.innerHTML = `
                        <div class="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 mb-2">
                            Opcional. Se transfiere automáticamente si se cargó en la <b>Etapa 1</b>.
                        </div>
                        <button type="button" onclick="navigateToStep(0)"
                            class="w-full bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-semibold py-2 px-3 rounded-lg transition-colors text-xs shadow-sm flex items-center justify-center gap-2 cursor-pointer">
                            <i class="fa-solid fa-arrow-left text-[11px]"></i> Ir a Etapa 1
                        </button>
                    `;
                }
                if (pillPMOVXF) {
                    pillPMOVXF.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium text-[11px]";
                    pillPMOVXF.innerHTML = '<i class="fa-regular fa-circle text-slate-400"></i> PMOVXF';
                }
            }

            // 3. Tarjeta 3: Avance de Obras (Principal)
            const cardAvance = document.getElementById('s2_cardAvance');
            const badgeAvance = document.getElementById('s2_badgeAvance');
            const bodyAvance = document.getElementById('s2_bodyAvance');
            const pillAvance = document.getElementById('s2_pillAvance');

            if (dataAvance && dataAvance.length > 0) {
                if (cardAvance) {
                    cardAvance.className = "bg-emerald-50/40 border border-emerald-300 rounded-2xl p-5 shadow-sm hover:shadow-md flex flex-col justify-between transition-all relative overflow-hidden border-t-4 border-t-emerald-500";
                }
                if (badgeAvance) {
                    badgeAvance.className = "text-[10px] bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5 shadow-xs";
                    badgeAvance.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-700"></i> Avance Listo';
                }
                if (bodyAvance) {
                    bodyAvance.innerHTML = `
                        <div class="bg-white border border-emerald-200 rounded-lg p-3 text-xs text-emerald-900 shadow-2xs">
                            <div class="font-bold flex items-center gap-1.5 text-emerald-800 mb-1">
                                <i class="fa-solid fa-circle-check text-emerald-600"></i>
                                <span>${dataAvance.length.toLocaleString('es-AR')} obras cargadas</span>
                            </div>
                            <div class="text-[11px] text-slate-500">${fileUploadDates.avance || 'Cargado'}</div>
                        </div>
                    `;
                }
                if (pillAvance) {
                    pillAvance.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold text-[11px]";
                    pillAvance.innerHTML = '<i class="fa-solid fa-check text-emerald-600"></i> Avance Listo';
                }
            } else {
                if (cardAvance) {
                    cardAvance.className = "bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md flex flex-col justify-between transition-all relative overflow-hidden border-t-4 border-t-orange-500";
                }
                if (badgeAvance) {
                    badgeAvance.className = "text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold flex items-center gap-1";
                    badgeAvance.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Pendiente';
                }
                if (bodyAvance) {
                    bodyAvance.innerHTML = `
                        <div class="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 mb-2">
                            <i class="fa-solid fa-lock text-slate-400 mr-1"></i> Requiere depurar por empresa y transferir desde la <b>Etapa 1</b>.
                        </div>
                        <button type="button" onclick="navigateToStep(0)"
                            class="w-full bg-slate-800 hover:bg-slate-900 text-white font-semibold py-2 px-3 rounded-lg transition-colors text-xs shadow-sm flex items-center justify-center gap-2 cursor-pointer">
                            <i class="fa-solid fa-arrow-left text-[11px]"></i> Ir a Etapa 1
                        </button>
                    `;
                }
                if (pillAvance) {
                    pillAvance.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium text-[11px]";
                    pillAvance.innerHTML = '<i class="fa-regular fa-circle text-slate-400"></i> Avance';
                }
            }

            // 4. Tarjeta 4: Sistema TAREA (Opcional)
            const cardTarea = document.getElementById('s2_cardTarea');
            const badgeTarea = document.getElementById('s2_badgeTarea');
            const bodyTarea = document.getElementById('s2_bodyTarea');
            const pillTarea = document.getElementById('s2_pillTarea');

            if (dataTarea && dataTarea.length > 0) {
                if (cardTarea) {
                    cardTarea.className = "bg-emerald-50/40 border border-emerald-300 rounded-2xl p-5 shadow-sm hover:shadow-md flex flex-col justify-between transition-all relative overflow-hidden border-t-4 border-t-emerald-500";
                }
                if (badgeTarea) {
                    badgeTarea.className = "text-[10px] bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full font-bold flex items-center gap-1";
                    badgeTarea.innerHTML = '<i class="fa-solid fa-check text-emerald-600"></i> Cargado (Opcional)';
                }
                if (bodyTarea) {
                    bodyTarea.innerHTML = `
                        <div class="bg-white border border-emerald-200 rounded-lg p-3 text-xs text-emerald-900 shadow-2xs flex items-center justify-between gap-2">
                            <div>
                                <div class="font-bold text-emerald-800">${dataTarea.length.toLocaleString('es-AR')} registros</div>
                                <div class="text-[11px] text-slate-500">${fileUploadDates.tarea || 'Cargado'}</div>
                            </div>
                            <button type="button" onclick="s2_eliminarTarea()" class="text-rose-500 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 w-7 h-7 rounded-lg flex items-center justify-center transition-colors shadow-2xs cursor-pointer" title="Eliminar TAREA">
                                <i class="fa-solid fa-trash-can text-xs"></i>
                            </button>
                        </div>
                    `;
                }
                if (pillTarea) {
                    pillTarea.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold text-[11px]";
                    pillTarea.innerHTML = '<i class="fa-solid fa-check text-emerald-600"></i> TAREA Listo';
                }
            } else {
                if (cardTarea) {
                    cardTarea.className = "bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md flex flex-col justify-between transition-all relative overflow-hidden border-t-4 border-t-indigo-500";
                }
                if (badgeTarea) {
                    badgeTarea.className = "text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-semibold";
                    badgeTarea.textContent = 'Opcional';
                }
                if (bodyTarea) {
                    bodyTarea.innerHTML = `
                        <button type="button" onclick="document.getElementById('s2_fileTarea').click()"
                            class="w-full bg-white hover:bg-slate-50 text-indigo-600 border border-indigo-200 hover:border-indigo-300 font-semibold py-2 px-3 rounded-lg transition-colors text-xs shadow-sm flex items-center justify-center gap-2 cursor-pointer">
                            <i class="fa-solid fa-cloud-arrow-up"></i> Cargar Sistema TAREA
                        </button>
                        <div class="text-[11px] text-slate-400 italic text-center mt-1">No cargado (Opcional)</div>
                    `;
                }
                if (pillTarea) {
                    pillTarea.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium text-[11px]";
                    pillTarea.innerHTML = '<i class="fa-regular fa-circle text-slate-400"></i> TAREA (Opcional)';
                }
            }

            // 5. Tarjeta 5: Avance Corporativo (Opcional)
            const cardCorp = document.getElementById('s2_cardCorp');
            const badgeCorp = document.getElementById('s2_badgeCorp');
            const btnDeleteCorp = document.getElementById('btnDeleteCorp');
            const pillCorp = document.getElementById('s2_pillCorp');

            if (dataCorporativoRaw && dataCorporativoRaw.length > 0) {
                if (cardCorp) {
                    cardCorp.className = "bg-emerald-50/40 border border-emerald-300 rounded-2xl p-5 shadow-sm hover:shadow-md flex flex-col justify-between transition-all relative overflow-hidden border-t-4 border-t-emerald-500";
                }
                if (badgeCorp) {
                    badgeCorp.className = "text-[10px] bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full font-bold flex items-center gap-1";
                    badgeCorp.innerHTML = '<i class="fa-solid fa-check text-emerald-600"></i> Cargado (Opcional)';
                }
                if (btnDeleteCorp) btnDeleteCorp.classList.remove('hidden');
                if (pillCorp) {
                    pillCorp.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold text-[11px]";
                    pillCorp.innerHTML = '<i class="fa-solid fa-check text-emerald-600"></i> Corp Listo';
                }
            } else {
                if (cardCorp) {
                    cardCorp.className = "bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md flex flex-col justify-between transition-all relative overflow-hidden border-t-4 border-t-teal-500";
                }
                if (badgeCorp) {
                    badgeCorp.className = "text-[10px] bg-teal-50 text-teal-700 px-2 py-0.5 rounded font-semibold";
                    badgeCorp.textContent = 'Opcional';
                }
                if (btnDeleteCorp) btnDeleteCorp.classList.add('hidden');
                if (pillCorp) {
                    pillCorp.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium text-[11px]";
                    pillCorp.innerHTML = '<i class="fa-regular fa-circle text-slate-400"></i> Corp (Opcional)';
                }
            }

            // Sincronizar indicador de requisitos en pie del módulo
            const txtReq = document.getElementById('s2_txtRequisitos');
            const infoConsolidar = document.getElementById('s2_statusConsolidarInfo');
            const auditor = document.getElementById('auditorName') ? document.getElementById('auditorName').value.trim() : '';
            const auditDate = document.getElementById('globalAuditDate') ? document.getElementById('globalAuditDate').value : '';

            const tieneAvance = !!((dataAvance && dataAvance.length > 0) || (dataAvanceCorporativo && dataAvanceCorporativo.length > 0));
            const tieneBCMOoTarea = !!((dataBCMO && dataBCMO.length > 0) || (dataTarea && dataTarea.length > 0));

            if (txtReq) {
                if (tieneAvance && tieneBCMOoTarea) {
                    txtReq.innerHTML = '<span class="text-emerald-700 font-bold flex items-center gap-1"><i class="fa-solid fa-circle-check"></i> Archivos requeridos listos.</span>';
                } else {
                    txtReq.innerHTML = '<span class="text-amber-700 font-medium flex items-center gap-1"><i class="fa-solid fa-circle-info"></i> Requiere Avance y (BCMO o TAREA).</span>';
                }
            }

            if (infoConsolidar) {
                if (!auditor || !auditDate) {
                    infoConsolidar.innerHTML = '<span class="text-amber-600 font-semibold">⚠️ Recuerde completar el campo "Analista / Auditor" y la fecha en la barra superior.</span>';
                } else if (tieneAvance && tieneBCMOoTarea) {
                    infoConsolidar.innerHTML = '<span class="text-emerald-700 font-semibold">✓ Todos los datos requeridos están listos para consolidar.</span>';
                } else {
                    infoConsolidar.textContent = 'Se cruzará la información depurada para auditoría integral.';
                }
            }

            checkReadyToConsolidate();
        }

        window.openConsolidacionModule = openConsolidacionModule;
        window.closeConsolidacionModule = closeConsolidacionModule;
        window.actualizarTarjetasEtapa2UI = actualizarTarjetasEtapa2UI;
        window.s2_handleFileTarea = s2_handleFileTarea;
        window.s2_handleFileBCMO = s2_handleFileBCMO;
        window.s2_handleFilePMOVXF = s2_handleFilePMOVXF;
        window.s2_handleFileAvance = s2_handleFileAvance;
        window.s2_eliminarTarea = s2_eliminarTarea;

        function inyectarAlConsolidador() {
            const allBcmoMap = new Map();

            // 1. Obras del Dashboard Principal
            const rawProcessed = (typeof s1_processedData !== 'undefined' && Array.isArray(s1_processedData)) ? s1_processedData : [];
            rawProcessed.forEach(item => {
                const k = String(item.Obra || '').trim().toUpperCase();
                if (!k) return;
                const est = item._enOtraEC ? 'CONSUMO EN OTRA RAZON SOCIAL' : (item['Estado de liquidacion'] || 'Sin Consumo');
                allBcmoMap.set(k, {
                    '_N_TAREA_/_OBRA': item.Obra,
                    '_N_ESTADO_DE_LIQUIDACION': est,
                    '_N_%_CONSUMO': item.PorcentajeReal !== undefined ? item.PorcentajeReal : 0,
                    '_N_CONTRATISTA': item.Contratista || s1_empresaAuditada || '',
                    '_N_ENTREGADO': item.Entregado || 0,
                    '_N_CONSUMIDO': item.Consumido || 0,
                    '_N_DIFERENCIA': item.Diferencia || 0,
                    '_N_LOCALIZADOR_COD': item.LocalizadorCod || '',
                    '_ORIGEN_ETAPA1': 'Dashboard Principal'
                });
            });

            // 2. Obras Reasignadas (en Avance pertenecen a otra contratista)
            const rawReasig = (typeof s1_obrasReasignadasData !== 'undefined' && Array.isArray(s1_obrasReasignadasData)) ? s1_obrasReasignadasData : [];
            rawReasig.forEach(item => {
                const k = String(item.Obra || '').trim().toUpperCase();
                if (!k) return;
                const ent = item.Entregado || 0;
                const con = item.Consumido || 0;
                const p = ent > 0 ? (con / ent) : (con > 0 ? 1 : 0);
                if (!allBcmoMap.has(k)) {
                    allBcmoMap.set(k, {
                        '_N_TAREA_/_OBRA': item.Obra,
                        '_N_ESTADO_DE_LIQUIDACION': 'REASIGNADA',
                        '_N_%_CONSUMO': p,
                        '_N_CONTRATISTA': item.Contratista || s1_empresaAuditada || '',
                        '_N_ENTREGADO': ent,
                        '_N_CONSUMIDO': con,
                        '_N_DIFERENCIA': ent - con,
                        '_N_LOCALIZADOR_COD': item.LocalizadorCod || '',
                        '_N_EMPRESA_REASIGNADA': item.EmpresaEnAvance || '',
                        '_ORIGEN_ETAPA1': 'Obras Reasignadas'
                    });
                }
            });

            // 3. Nomenclatura Inválida
            const rawInvalid = (typeof s1_invalidData !== 'undefined' && Array.isArray(s1_invalidData)) ? s1_invalidData : [];
            rawInvalid.forEach(item => {
                const k = String(item.Obra || '').trim().toUpperCase();
                if (!k) return;
                const ent = item.Entregado || 0;
                const con = item.Consumido || 0;
                const p = ent > 0 ? (con / ent) : (con > 0 ? 1 : 0);
                if (!allBcmoMap.has(k)) {
                    allBcmoMap.set(k, {
                        '_N_TAREA_/_OBRA': item.Obra,
                        '_N_ESTADO_DE_LIQUIDACION': 'NOMENCLATURA INVALIDA',
                        '_N_%_CONSUMO': p,
                        '_N_CONTRATISTA': item.Contratista || s1_empresaAuditada || '',
                        '_N_ENTREGADO': ent,
                        '_N_CONSUMIDO': con,
                        '_N_DIFERENCIA': ent - con,
                        '_N_LOCALIZADOR_COD': item.LocalizadorCod || '',
                        '_ORIGEN_ETAPA1': 'Nomenclatura Inválida'
                    });
                }
            });

            // 4. Obras Excluidas por Tarea
            const rawExcluidas = (typeof s1_excluidasPorTareaData !== 'undefined' && Array.isArray(s1_excluidasPorTareaData)) ? s1_excluidasPorTareaData : [];
            rawExcluidas.forEach(item => {
                const k = String(item.Obra || '').trim().toUpperCase();
                if (!k) return;
                const ent = item.Entregado || 0;
                const con = item.Consumido || 0;
                const p = item.PorcentajeReal !== undefined ? item.PorcentajeReal : (ent > 0 ? con / ent : (con > 0 ? 1 : 0));
                if (!allBcmoMap.has(k)) {
                    allBcmoMap.set(k, {
                        '_N_TAREA_/_OBRA': item.Obra,
                        '_N_ESTADO_DE_LIQUIDACION': 'EXCLUIDA POR TAREA',
                        '_N_%_CONSUMO': p,
                        '_N_CONTRATISTA': item.Contratista || s1_empresaAuditada || '',
                        '_N_ENTREGADO': ent,
                        '_N_CONSUMIDO': con,
                        '_N_DIFERENCIA': ent - con,
                        '_N_LOCALIZADOR_COD': item.LocalizadorCod || '',
                        '_ORIGEN_ETAPA1': 'Excluidas por Tarea'
                    });
                }
            });

            // 5. Consumo en Otra EC
            const rawOtraEC = (typeof s1_otraECData !== 'undefined' && Array.isArray(s1_otraECData)) ? s1_otraECData : [];
            rawOtraEC.forEach(item => {
                const k = String(item.Obra || '').trim().toUpperCase();
                if (!k) return;
                if (allBcmoMap.has(k)) {
                    allBcmoMap.get(k)['_N_ESTADO_DE_LIQUIDACION'] = 'CONSUMO EN OTRA RAZON SOCIAL';
                } else {
                    allBcmoMap.set(k, {
                        '_N_TAREA_/_OBRA': item.Obra,
                        '_N_ESTADO_DE_LIQUIDACION': 'CONSUMO EN OTRA RAZON SOCIAL',
                        '_N_%_CONSUMO': 1.0,
                        '_N_CONTRATISTA': item.EmpresaOriginal || item.RazonSocialOtraEC || s1_empresaAuditada || '',
                        '_N_ENTREGADO': 0,
                        '_N_CONSUMIDO': 0,
                        '_N_DIFERENCIA': 0,
                        '_N_LOCALIZADOR_COD': item.LocalizadorCod || '',
                        '_ORIGEN_ETAPA1': 'Consumo en Otra EC'
                    });
                }
            });

            if (allBcmoMap.size === 0) {
                showToast("No hay datos del BCMO procesados para inyectar.", "error"); return;
            }

            dataBCMO = Array.from(allBcmoMap.values());

            fileUploadDates.bcmo = "Inyectado de Módulo BCMO: " + new Date().toLocaleString('es-AR') + " (" + dataBCMO.length + " obras)";
            actualizarEstadoUI('statusBCMO', true, fileUploadDates.bcmo);

            if (s1_dataMateriales && s1_dataMateriales.length > 0) {
                dataMateriales = s1_dataMateriales;
                fileUploadDates.pmovxf = "Inyectado de Módulo Etapa 1: " + (s1_fileUploadDates.pmovxf || new Date().toLocaleString('es-AR'));
                actualizarEstadoUI('statusMateriales', true, fileUploadDates.pmovxf);
            }

            // Transferir Avance General a Etapa 2 filtrando por la empresa auditada seleccionada en Etapa 1
            // Leemos con fallback window.s1_dataAvanceGeneral para cubrir el alcance entre módulos separados
            const _fuenteAvance = (typeof s1_dataAvanceGeneral !== 'undefined' && s1_dataAvanceGeneral && s1_dataAvanceGeneral.length > 0)
                ? s1_dataAvanceGeneral
                : (window.s1_dataAvanceGeneral && window.s1_dataAvanceGeneral.length > 0 ? window.s1_dataAvanceGeneral : null);

            if (_fuenteAvance && _fuenteAvance.length > 0) {
                const headers = Object.keys(_fuenteAvance[0]);
                const empresaAuditada = window.s1_empresaAuditada || (typeof s1_empresaAuditada !== 'undefined' ? s1_empresaAuditada : '') ||
                                        window.s1_empresaAuditadaAvance || (typeof s1_empresaAuditadaAvance !== 'undefined' ? s1_empresaAuditadaAvance : '');
                
                const campoEmpresa = window._s1_campoEmpresaAvance || headers.find(h => {
                    const hu = h.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    return hu.includes('EMPRESA') || hu.includes('CONTRATISTA') || hu.includes('RAZON SOCIAL') || hu.includes('LOCALIZADOR_DESC');
                }) || headers[0];

                const matchEmpresaFn = window.s1_esMismaEmpresa || function(a, b) {
                    if (!a || !b) return false;
                    const na = a.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
                    const nb = b.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
                    return na === nb || na.includes(nb) || nb.includes(na);
                };

                let avanceFiltrado = _fuenteAvance;
                if (empresaAuditada) {
                    const coincidencias = _fuenteAvance.filter(r => {
                        const empVal = String(r[campoEmpresa] || r['CONTRATISTA'] || r['Contratista'] || r['EMPRESA'] || r['Empresa'] || r['RAZON SOCIAL'] || '').trim();
                        return matchEmpresaFn(empVal, empresaAuditada);
                    });
                    if (coincidencias.length > 0) {
                        avanceFiltrado = coincidencias;
                    } else {
                        console.warn(`Filtro de Avance por "${empresaAuditada}" dio 0 coincidencias. Se conserva dataset completo.`);
                    }
                }

                dataAvance = normalizarDataset(avanceFiltrado);
                // Llamar a aplicarEstandarizacionInPlace de forma segura (está expuesta en window por recategorizacion.js)
                try {
                    const _estandarizar = window.aplicarEstandarizacionInPlace || (typeof aplicarEstandarizacionInPlace !== 'undefined' ? aplicarEstandarizacionInPlace : null);
                    if (_estandarizar) _estandarizar(dataAvance);
                } catch (e) {
                    console.warn('No se pudo aplicar estandarización al Avance. El dataset se transfiere sin estandarizar.', e);
                }
                headersAvance = headers;
                fileUploadDates.avance = "Transferido de Etapa 1: " + new Date().toLocaleString('es-AR') + " (" + dataAvance.length + " obras" + (empresaAuditada ? ` - ${empresaAuditada}` : '') + ")";
                actualizarEstadoUI('statusAvance', true, fileUploadDates.avance);
            } else {
                console.warn('inyectarAlConsolidador: s1_dataAvanceGeneral no disponible, el Avance no se transfiere.');
            }

            checkReadyToConsolidate();
            closeBcmoModule();
            actualizarTarjetasEtapa2UI();

            if (dataConsolidada.length > 0) {
                procesarConsolidacion();
                showToast(`Se transfirieron ${dataBCMO.length} obras completas (Dashboard, Reasignadas, Excluidas, Inválidas, Otra EC). Cruce actualizado.`, "success");
            } else {
                showToast(`Se transfirieron ${dataBCMO.length} obras completas a la Etapa 2 (Consolidación).`, "success");
            }
        }

window.openBcmoModule = openBcmoModule;
window.closeBcmoModule = closeBcmoModule;
window.navigateToStep = navigateToStep;
window.updateStepper = updateStepper;
window.showSetupSection = showSetupSection;
window.showResultsSection = showResultsSection;
window.s1_toggleNovedadesMenu = s1_toggleNovedadesMenu;
window.s1_closeNovedadesMenu = s1_closeNovedadesMenu;
window.s1_toggleDiagMenu = s1_toggleDiagMenu;
window.s1_closeDiagMenu = s1_closeDiagMenu;
window.s1_togglePreAuditMenu = s1_togglePreAuditMenu;
window.s1_closePreAuditMenu = s1_closePreAuditMenu;
window.inyectarAlConsolidador = inyectarAlConsolidador;


// --- AUTO-EXPORTS FOR HTML EVENT HANDLERS ---
if (typeof eliminarCargaCorp !== 'undefined') window.eliminarCargaCorp = eliminarCargaCorp;
if (typeof switchTab !== 'undefined') window.switchTab = switchTab;
if (typeof toggleOrphansConfig !== 'undefined') window.toggleOrphansConfig = toggleOrphansConfig;
if (typeof cancelarCargaCorp !== 'undefined') window.cancelarCargaCorp = cancelarCargaCorp;
if (typeof confirmarCargaCorp !== 'undefined') window.confirmarCargaCorp = confirmarCargaCorp;
if (typeof cancelarCargaAvance !== 'undefined') window.cancelarCargaAvance = cancelarCargaAvance;
if (typeof confirmarCargaAvance !== 'undefined') window.confirmarCargaAvance = confirmarCargaAvance;
if (typeof preAnalizarCorporativo !== 'undefined') window.preAnalizarCorporativo = preAnalizarCorporativo;
