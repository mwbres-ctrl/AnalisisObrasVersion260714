/* ==========================================================================
   Módulo: Carga por Lote Asistida y Guiada (modules/batchLoader.js)
   Permite seleccionar múltiples archivos para cada etapa, clasifica
   automáticamente sus roles mediante cabeceras, y orquesta el pipeline
   secuencial coordinando los cuadros de diálogo correspondientes.
   Convive al 100% con los selectores manuales individuales existentes.
   ========================================================================== */

(function () {
    'use strict';

    // Estado del asistente de carga por lote
    const BatchState = {
        activeStage: null,       // 1, 2 o 3
        queue: [],              // Lista de { file, type, name, status, headers }
        currentIndex: 0
    };

    // Diccionario de tipos válidos y etiquetas por etapa
    const STAGE_FILE_DEFS = {
        1: [
            { id: 'localizadores', name: 'Reporte de Localizadores', icon: 'fa-link', color: 'violet', required: true },
            { id: 'bcmo', name: 'Archivo BCMO', icon: 'fa-file-excel', color: 'blue', required: true },
            { id: 'avance', name: 'Avance General', icon: 'fa-chart-line', color: 'orange', required: true },
            { id: 'pmovxf', name: 'PMOVXF (Detalle PM)', icon: 'fa-boxes-stacked', color: 'amber', required: false }
        ],
        2: [
            { id: 'tarea', name: 'Sistema TAREA', icon: 'fa-file-invoice', color: 'indigo', required: false },
            { id: 'corporativo', name: 'Sector Corporativo', icon: 'fa-building-user', color: 'teal', required: false }
        ],
        3: [
            { id: 'tarea', name: 'Tickets TAREA (Paso 1)', icon: 'fa-ticket', color: 'purple', required: true },
            { id: 'avance', name: 'Avance de Obras (Paso 2)', icon: 'fa-chart-line', color: 'indigo', required: true },
            { id: 'pm', name: 'Reporte PM (PMOVXF Paso 4)', icon: 'fa-boxes-stacked', color: 'teal', required: false },
            { id: 'descargos', name: 'Tareas en Desc Mat (Saldos)', icon: 'fa-file-signature', color: 'amber', required: false }
        ]
    };

    /**
     * Extrae las cabeceras de un archivo Excel o CSV/TXT de forma rápida
     */
    async function readHeadersFast(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        return new Promise((resolve) => {
            if (ext === 'csv' || ext === 'txt') {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const text = e.target.result || '';
                        const firstLine = text.split('\n')[0] || '';
                        let delim = ',';
                        if (firstLine.includes('\t')) delim = '\t';
                        else if (firstLine.includes(';')) delim = ';';
                        const headers = firstLine.split(delim).map(h => h.trim().replace(/^["']|["']$/g, ''));
                        resolve(headers);
                    } catch (err) {
                        resolve([]);
                    }
                };
                reader.onerror = () => resolve([]);
                const slice = file.slice(0, 16384);
                reader.readAsText(slice, 'ISO-8859-1');
            } else {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const data = new Uint8Array(e.target.result);
                        if (typeof XLSX === 'undefined') {
                            resolve([]);
                            return;
                        }
                        const workbook = XLSX.read(data, { type: 'array', sheetRows: 5 });
                        let sheetName = workbook.SheetNames[0];
                        const sObras = workbook.SheetNames.find(n => n.toUpperCase() === 'OBRAS');
                        if (sObras) sheetName = sObras;
                        const worksheet = workbook.Sheets[sheetName];
                        const aoa = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                        
                        let bestRow = [];
                        for (let i = 0; i < Math.min(aoa.length, 5); i++) {
                            const row = (aoa[i] || []).map(c => String(c || '').trim());
                            if (row.filter(Boolean).length > bestRow.filter(Boolean).length) {
                                bestRow = row;
                            }
                        }
                        resolve(bestRow);
                    } catch (err) {
                        resolve([]);
                    }
                };
                reader.onerror = () => resolve([]);
                reader.readAsArrayBuffer(file);
            }
        });
    }

    /**
     * Normaliza un texto para comparaciones seguras
     */
    function normStr(s) {
        return String(s || '').toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    }

    /**
     * Clasifica un archivo según su nombre y cabeceras para una etapa dada
     */
    function classifyFile(stage, filename, headers) {
        const hStr = headers.map(normStr).join(' ');
        const fn = normStr(filename);

        if (stage === 1) {
            // Reporte de Localizadores
            if ((hStr.includes('SUBINVENTARIO') && hStr.includes('LOCALIZADOR')) ||
                (hStr.includes('LOCALIZADOR') && (hStr.includes('NOMBRE PROV') || hStr.includes('PROVEEDOR') || fn.includes('LOCALIZADOR')))) {
                if (!hStr.includes('ESTADO DE LIQUIDACION') && !hStr.includes('ENTREGADO') && !hStr.includes('CONSUMIDO')) {
                    return 'localizadores';
                }
            }

            // BCMO: Estado de liquidación o entregado/consumido/tarea
            if (hStr.includes('ESTADO DE LIQUIDACION') || 
                (hStr.includes('ENTREGADO') && hStr.includes('CONSUMIDO') && hStr.includes('TAREA')) ||
                (hStr.includes('LOCALIZADOR_COD') && hStr.includes('DIFERENCIA')) ||
                fn.includes('BCMO')) {
                return 'bcmo';
            }

            // Avance General
            if (hStr.includes('MODALIDAD DE LIQUIDACION') || 
                hStr.includes('ETAPA LOGICA') || 
                fn.includes('AVANCE') ||
                ((hStr.includes('EMPRESA') || hStr.includes('CONTRATISTA')) && (hStr.includes('PROYECTO') || hStr.includes('MOTIVO')))) {
                return 'avance';
            }

            // PMOVXF
            if ((hStr.includes('MOTIVO') && hStr.includes('FECHA_TRX')) || 
                hStr.includes('SUBINVENTARIO_ORIGEN') || 
                hStr.includes('ORGANIZATION_CODE') || 
                fn.includes('PMOVXF') || 
                fn.includes('DETALLE PM')) {
                return 'pmovxf';
            }
        } else if (stage === 2) {
            // Sistema TAREA
            if ((hStr.includes('PERMITE DECLARAR MATERIAL') && hStr.includes('ESTADO TAREA')) ||
                (hStr.includes('OBRA_BF') && hStr.includes('ESTADO_TAREA')) ||
                fn.includes('TAREA')) {
                return 'tarea';
            }

            // Corporativo
            if ((hStr.includes('NODO') && hStr.includes('CONTRATISTA')) ||
                fn.includes('CORPORATIVO') || fn.includes('CORP')) {
                return 'corporativo';
            }
        } else if (stage === 3) {
            // Tickets TAREA
            if (hStr.includes('PERMITE DECLARAR MATERIAL') || 
                (hStr.includes('ESTADO TAREA') && hStr.includes('TICKET')) ||
                fn.includes('TICKET') || (fn.includes('TAREA') && !fn.includes('DESC'))) {
                return 'tarea';
            }

            // Avance de Obras
            if (hStr.includes('MODALIDAD DE LIQUIDACION') || 
                hStr.includes('ETAPA LOGICA') || 
                (hStr.includes('NODO') && (hStr.includes('FECHA') || hStr.includes('INICIO'))) ||
                fn.includes('AVANCE')) {
                return 'avance';
            }

            // PMOVXF / PM
            if ((hStr.includes('MOTIVO') && hStr.includes('FECHA_TRX')) || 
                fn.includes('PMOVXF') || fn.includes('PM')) {
                return 'pm';
            }

            // Descargos (Tareas en Desc Mat)
            if (hStr.includes('DESCARGO') || 
                hStr.includes('CANTIDAD DESCARGADA') || 
                fn.includes('DESC') || fn.includes('SALDO')) {
                return 'descargos';
            }
        }

        return null;
    }

    /**
     * Construye o retorna el modal del Asistente de Carga por Lote
     */
    function getOrCreateBatchModal() {
        let modal = document.getElementById('batchUploadWizardModal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'batchUploadWizardModal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs transition-opacity duration-200 hidden';
        modal.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
                <!-- Header del Modal -->
                <div class="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-400/30 flex items-center justify-center text-base">
                            <i class="fa-solid fa-wand-magic-sparkles"></i>
                        </div>
                        <div>
                            <h3 class="text-sm font-bold text-white tracking-wide" id="batchWizardTitle">Asistente de Carga por Lote</h3>
                            <p class="text-[11px] text-slate-400" id="batchWizardSubtitle">Verificación y procesamiento guiado de insumos</p>
                        </div>
                    </div>
                    <button type="button" onclick="window.batchLoader.cerrarModal()" class="text-slate-400 hover:text-white transition-colors w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800">
                        <i class="fa-solid fa-xmark text-sm"></i>
                    </button>
                </div>

                <!-- Barra de Progreso y Alerta Informativa -->
                <div class="bg-slate-50 border-b border-slate-200 px-6 py-3 flex items-center justify-between gap-4">
                    <div class="flex-1">
                        <div class="flex items-center justify-between text-xs mb-1.5">
                            <span class="font-bold text-slate-700" id="batchProgressLabel">Archivos identificados</span>
                            <span class="font-semibold text-indigo-600" id="batchProgressPercent">0%</span>
                        </div>
                        <div class="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                            <div id="batchProgressBar" class="bg-indigo-600 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
                        </div>
                    </div>
                    <div id="batchStatusBadge" class="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1.5">
                        <span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                        Revisión requerida
                    </div>
                </div>

                <!-- Cuerpo: Lista de archivos detectados -->
                <div class="p-6 overflow-y-auto flex-1 space-y-3 custom-scrollbar">
                    <p class="text-xs text-slate-600 mb-1">
                        Verifica el orden y destino de los archivos seleccionados y haz clic en <b>"Iniciar Carga Guiada"</b>:
                    </p>
                    <div id="batchFileList" class="space-y-2.5">
                        <!-- Items inyectados dinámicamente -->
                    </div>

                    <!-- Mensaje de aviso de diálogo interactivo -->
                    <div id="batchDialogNotice" class="hidden bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-xl p-3.5 text-xs flex items-start gap-3 mt-4">
                        <i class="fa-solid fa-circle-question text-indigo-600 text-base mt-0.5 shrink-0"></i>
                        <div class="flex-1">
                            <b class="font-bold block mb-0.5">Se requiere tu confirmación en el cuadro de diálogo:</b>
                            <p class="text-[11px] text-indigo-700" id="batchDialogNoticeText">Por favor, atiende el cuadro de diálogo de empresa que se abrió en pantalla para continuar.</p>
                        </div>
                    </div>
                </div>

                <!-- Footer: Acciones -->
                <div class="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
                    <button type="button" id="btnBatchCancel" onclick="window.batchLoader.cerrarModal()" class="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors">
                        Cancelar
                    </button>
                    <div class="flex items-center gap-2">
                        <button type="button" id="btnBatchStart" onclick="window.batchLoader.ejecutarPipeline()" class="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer">
                            <i class="fa-solid fa-play"></i> Iniciar Carga Guiada
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        return modal;
    }

    /**
     * Inicia el proceso de selección masiva para una etapa
     */
    async function iniciarCargaEtapa(stage) {
        BatchState.activeStage = stage;
        BatchState.queue = [];
        BatchState.currentIndex = 0;

        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = '.xlsx, .xls, .csv, .txt';

        input.onchange = async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length === 0) return;
            await procesarSeleccionArchivos(stage, files);
        };

        input.click();
    }

    /**
     * Procesa los archivos seleccionados, lee sus cabeceras y muestra el asistente
     */
    async function procesarSeleccionArchivos(stage, files) {
        if (typeof showToastGlobal === 'function') {
            showToastGlobal(`Analizando ${files.length} archivos para Etapa ${stage}...`, 'info');
        }

        const queue = [];
        for (const file of files) {
            const headers = await readHeadersFast(file);
            const detectedType = classifyFile(stage, file.name, headers);
            queue.push({
                file: file,
                name: file.name,
                headers: headers,
                type: detectedType || '',
                status: 'pending'
            });
        }

        // Ordenar de entrada según la secuencia lógica de cada etapa
        if (stage === 1) {
            const ordenEtapa1 = { 'localizadores': 1, 'bcmo': 2, 'avance': 3, 'pmovxf': 4 };
            queue.sort((a, b) => (ordenEtapa1[a.type] || 99) - (ordenEtapa1[b.type] || 99));
        } else if (stage === 2) {
            const ordenEtapa2 = { 'tarea': 1, 'corporativo': 2 };
            queue.sort((a, b) => (ordenEtapa2[a.type] || 99) - (ordenEtapa2[b.type] || 99));
        } else if (stage === 3) {
            const ordenEtapa3 = { 'tarea': 1, 'avance': 2, 'pm': 3, 'descargos': 4 };
            queue.sort((a, b) => (ordenEtapa3[a.type] || 99) - (ordenEtapa3[b.type] || 99));
        }

        BatchState.queue = queue;
        renderWizardModal(stage);
    }

    /**
     * Renderiza la UI del asistente modal con los archivos y sus selectores
     */
    function renderWizardModal(stage) {
        const modal = getOrCreateBatchModal();
        const title = document.getElementById('batchWizardTitle');
        const subtitle = document.getElementById('batchWizardSubtitle');
        const fileList = document.getElementById('batchFileList');
        const defs = STAGE_FILE_DEFS[stage] || [];

        const stageNames = {
            1: 'Etapa 1 · BCMO (Localizadores ➔ BCMO ➔ Avance ➔ PMOVXF)',
            2: 'Etapa 2 · Consolidación (Sistema TAREA ➔ Corporativo)',
            3: 'Etapa 3 · TAREA (Tickets ➔ Avance ➔ PM ➔ Descargos)'
        };

        if (title) title.textContent = `Asistente de Carga por Lote · Etapa ${stage}`;
        if (subtitle) subtitle.textContent = stageNames[stage] || 'Procesamiento asistido de insumos';

        if (fileList) {
            fileList.innerHTML = BatchState.queue.map((item, idx) => {
                const def = defs.find(d => d.id === item.type);
                const color = def ? def.color : 'slate';
                const icon = def ? def.icon : 'fa-file';

                let selectOptions = `<option value="">-- Seleccionar destino --</option>`;
                defs.forEach(d => {
                    const isSelected = d.id === item.type ? 'selected' : '';
                    selectOptions += `<option value="${d.id}" ${isSelected}>${d.name}${d.required ? ' *' : ''}</option>`;
                });

                let statusBadge = `<span class="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Pendiente</span>`;
                if (item.status === 'processing') {
                    statusBadge = `<span class="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full flex items-center gap-1 justify-end"><i class="fa-solid fa-spinner fa-spin"></i> Procesando</span>`;
                } else if (item.status === 'done') {
                    statusBadge = `<span class="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1 justify-end"><i class="fa-solid fa-check"></i> Listo</span>`;
                }

                return `
                    <div id="batchItem_${idx}" class="p-3 bg-white border border-slate-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-all">
                        <div class="flex items-center gap-3 min-w-0 flex-1">
                            <div class="w-8 h-8 rounded-lg bg-${color}-100 text-${color}-600 flex items-center justify-center shrink-0">
                                <i class="fa-solid ${icon} text-sm"></i>
                            </div>
                            <div class="min-w-0 flex-1">
                                <p class="text-xs font-bold text-slate-800 truncate" title="${item.name}">${item.name}</p>
                                <span class="text-[10px] text-slate-400 font-mono">(${item.headers.slice(0, 3).join(', ') || 'cabeceras leídas'}...)</span>
                            </div>
                        </div>

                        <div class="flex items-center gap-2 shrink-0">
                            <div class="w-48">
                                <select onchange="window.batchLoader.cambiarTipo(${idx}, this.value)" class="w-full text-xs font-semibold p-1.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white outline-none focus:ring-1 focus:ring-indigo-500">
                                    ${selectOptions}
                                </select>
                            </div>
                            <div id="batchItemStatus_${idx}" class="w-24 text-right">
                                ${statusBadge}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        actualizarProgresoUI();
        modal.classList.remove('hidden');
    }

    /**
     * Permite cambiar manualmente el tipo asignado a un archivo
     */
    function cambiarTipo(idx, nuevoTipo) {
        if (BatchState.queue[idx]) {
            BatchState.queue[idx].type = nuevoTipo;
            actualizarProgresoUI();
        }
    }

    /**
     * Actualiza la barra de progreso y badges del asistente
     */
    function actualizarProgresoUI() {
        const total = BatchState.queue.length;
        const listos = BatchState.queue.filter(q => q.status === 'done').length;
        const asignados = BatchState.queue.filter(q => q.type).length;

        const percent = total > 0 ? Math.round((listos / total) * 100) : 0;
        const pBar = document.getElementById('batchProgressBar');
        const pText = document.getElementById('batchProgressPercent');
        const pLabel = document.getElementById('batchProgressLabel');
        const badge = document.getElementById('batchStatusBadge');

        if (pBar) pBar.style.width = `${percent}%`;
        if (pText) pText.textContent = `${percent}%`;

        if (listos === total && total > 0) {
            if (pLabel) pLabel.textContent = '¡Carga de etapa finalizada exitosamente!';
            if (badge) {
                badge.className = 'shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1.5';
                badge.innerHTML = '<i class="fa-solid fa-check text-emerald-600"></i> Completado';
            }
            const btnStart = document.getElementById('btnBatchStart');
            if (btnStart) {
                btnStart.disabled = false;
                btnStart.classList.remove('opacity-50', 'cursor-not-allowed');
                btnStart.className = 'px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer';
                btnStart.innerHTML = '<i class="fa-solid fa-check"></i> Finalizar y Continuar';
                btnStart.onclick = cerrarModal;
            }
        } else {
            if (pLabel) pLabel.textContent = `${listos} de ${total} procesados (${asignados} identificados)`;
        }
    }

    /**
     * Ejecuta el pipeline secuencial ordenado para la etapa activa
     */
    async function ejecutarPipeline() {
        const stage = BatchState.activeStage;
        const queue = BatchState.queue;

        const sinTipo = queue.find(q => !q.type);
        if (sinTipo) {
            if (typeof showToastGlobal === 'function') {
                showToastGlobal(`Por favor asigna el destino para "${sinTipo.name}" antes de iniciar.`, 'error');
            } else {
                alert(`Por favor asigna el destino para "${sinTipo.name}" antes de iniciar.`);
            }
            return;
        }

        const btnStart = document.getElementById('btnBatchStart');
        if (btnStart) {
            btnStart.disabled = true;
            btnStart.classList.add('opacity-50', 'cursor-not-allowed');
            btnStart.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';
        }

        // Procesar archivo por archivo en orden
        for (let i = 0; i < queue.length; i++) {
            const item = queue[i];
            BatchState.currentIndex = i;
            item.status = 'processing';
            actualizarEstadoItem(i, 'processing', 'Procesando...');

            try {
                if (stage === 1) {
                    await procesarItemEtapa1(item, i);
                } else if (stage === 2) {
                    await procesarItemEtapa2(item, i);
                } else if (stage === 3) {
                    await procesarItemEtapa3(item, i);
                }
                item.status = 'done';
                actualizarEstadoItem(i, 'done', 'Listo');
            } catch (err) {
                console.error(`[BatchLoader] Error procesando ${item.name}:`, err);
                item.status = 'error';
                actualizarEstadoItem(i, 'error', 'Error');
                if (typeof showToastGlobal === 'function') {
                    showToastGlobal(`Error procesando ${item.name}: ${err.message || err}`, 'error');
                }
            }
            actualizarProgresoUI();
        }

        // Refrescar estados globales de cada etapa
        if (stage === 1 && typeof window.s1_checkReadyToAnalyze === 'function') {
            window.s1_checkReadyToAnalyze();
        } else if (stage === 2 && typeof window.checkReadyToConsolidate === 'function') {
            window.checkReadyToConsolidate();
        } else if (stage === 3 && typeof window.s3_ejecutarCruceTarea === 'function') {
            window.s3_ejecutarCruceTarea();
        }

        if (typeof showToastGlobal === 'function') {
            showToastGlobal(`¡Procesamiento por lote de Etapa ${stage} completado con éxito!`, 'success');
        }
    }

    /**
     * Espera a que el usuario confirme o cierre el cuadro de diálogo s1_avanceModal
     */
    function esperarDialogoEmpresaAuditada(wizardModal, tituloPaso) {
        return new Promise((resolve) => {
            // Ocultar modal del asistente para dejar el diálogo al frente y 100% interactivo
            if (wizardModal) wizardModal.classList.add('hidden');

            if (typeof showToastGlobal === 'function') {
                showToastGlobal(`Selecciona la Empresa Auditada para continuar con ${tituloPaso}...`, 'info');
            }

            const modalAvance = document.getElementById('s1_avanceModal');
            let isDone = false;

            const onConfirmado = () => {
                if (isDone) return;
                isDone = true;
                if (wizardModal) wizardModal.classList.remove('hidden');
                setTimeout(resolve, 300);
            };

            // Observer para detectar cuando s1_avanceModal se oculte (al confirmar o cancelar)
            const obs = new MutationObserver(() => {
                if (modalAvance && modalAvance.classList.contains('hidden')) {
                    obs.disconnect();
                    onConfirmado();
                }
            });
            if (modalAvance) obs.observe(modalAvance, { attributes: true, attributeFilter: ['class'] });

            // Hook directo en el botón confirmar por seguridad
            const btnConfirmar = document.querySelector('#s1_avanceModal button[onclick*="s1_confirmarEmpresaAuditada"]');
            if (btnConfirmar) {
                btnConfirmar.addEventListener('click', () => {
                    setTimeout(() => {
                        obs.disconnect();
                        onConfirmado();
                    }, 250);
                }, { once: true });
            }
        });
    }

    /**
     * PROCESAMIENTO SECUENCIAL - ETAPA 1 (BCMO)
     */
    async function procesarItemEtapa1(item, index) {
        const file = item.file;
        const type = item.type;
        const wizardModal = document.getElementById('batchUploadWizardModal');

        if (type === 'localizadores') {
            // 1. Localizadores: Invoca la carga y DEBE pedir inmediatamente la empresa auditada (1° Consulta)
            const fnCarga = window.s1_handleLocalizadoresFile;
            if (typeof fnCarga !== 'function') {
                throw new Error("s1_handleLocalizadoresFile no está disponible.");
            }

            // Disparar carga del archivo de localizadores
            fnCarga(file);

            // Aguardar a que se abra y confirme el diálogo de Empresa Auditada
            await esperarDialogoEmpresaAuditada(wizardModal, 'el Análisis de Localizadores');
        } 
        else if (type === 'bcmo') {
            // 2. BCMO: Parsear y adelgazar dataset
            return new Promise((resolve, reject) => {
                const fnCarga = window.s1_handleFiles;
                if (typeof fnCarga !== 'function') {
                    reject(new Error("s1_handleFiles no está disponible."));
                    return;
                }
                fnCarga([file]);

                // Polling seguro para esperar que s1_currentRawData esté poblado
                let waited = 0;
                const t = setInterval(() => {
                    waited += 150;
                    if ((window.s1_currentRawData && window.s1_currentRawData.length > 0) || waited > 30000) {
                        clearInterval(t);
                        resolve();
                    }
                }, 150);
            });
        } 
        else if (type === 'avance') {
            // 3. Avance General: Invoca la carga y pide ratificar la empresa auditada (2° Consulta)
            const fnCarga = window.s1_handleAvanceGeneralFile;
            if (typeof fnCarga !== 'function') {
                throw new Error("s1_handleAvanceGeneralFile no está disponible.");
            }

            // Disparar carga del Avance de Obras
            fnCarga(file);

            // Aguardar a que se abra y confirme el diálogo de Empresa Auditada para el Avance
            await esperarDialogoEmpresaAuditada(wizardModal, 'el Avance de Obras');
        } 
        else if (type === 'pmovxf') {
            // 4. PMOVXF
            return new Promise((resolve) => {
                if (typeof window.s1_handleFiles === 'function') {
                    window.s1_handleFiles([file]);
                }
                let waited = 0;
                const t = setInterval(() => {
                    waited += 150;
                    if ((window.s1_dataMateriales && window.s1_dataMateriales.length > 0) || waited > 15000) {
                        clearInterval(t);
                        resolve();
                    }
                }, 150);
            });
        }
    }

    /**
     * PROCESAMIENTO SECUENCIAL - ETAPA 2 (CONSOLIDACIÓN)
     */
    async function procesarItemEtapa2(item, index) {
        const file = item.file;
        const type = item.type;
        const wizardModal = document.getElementById('batchUploadWizardModal');

        if (type === 'tarea') {
            return new Promise((resolve) => {
                if (typeof window.s2_handleFileTarea === 'function') {
                    window.s2_handleFileTarea({ target: { files: [file], value: '' } });
                }
                let waited = 0;
                const t = setInterval(() => {
                    waited += 150;
                    if (window.dataTarea || waited > 15000) {
                        clearInterval(t);
                        resolve();
                    }
                }, 150);
            });
        } else if (type === 'corporativo') {
            return new Promise((resolve) => {
                const modalCorp = document.getElementById('modalFiltroContratista');
                let resolved = false;

                const finish = () => {
                    if (resolved) return;
                    resolved = true;
                    if (wizardModal) wizardModal.classList.remove('hidden');
                    resolve();
                };

                const obs = new MutationObserver(() => {
                    if (modalCorp && !modalCorp.classList.contains('hidden')) {
                        if (wizardModal) wizardModal.classList.add('hidden');
                    } else if (modalCorp && modalCorp.classList.contains('hidden')) {
                        obs.disconnect();
                        setTimeout(finish, 200);
                    }
                });
                if (modalCorp) obs.observe(modalCorp, { attributes: true, attributeFilter: ['class'] });

                if (typeof window.preAnalizarCorporativo === 'function') {
                    window.preAnalizarCorporativo({ target: { files: [file], value: '' } });
                }

                setTimeout(() => {
                    if (!modalCorp || modalCorp.classList.contains('hidden')) {
                        obs.disconnect();
                        finish();
                    }
                }, 2000);
            });
        }
    }

    /**
     * PROCESAMIENTO SECUENCIAL - ETAPA 3 (MODALIDAD TAREA)
     */
    async function procesarItemEtapa3(item, index) {
        const file = item.file;
        const type = item.type;

        return new Promise((resolve) => {
            if (type === 'tarea' && typeof window.s3_handleFileInputTarea === 'function') {
                window.s3_handleFileInputTarea(file);
            } else if (type === 'avance' && typeof window.s3_handleFileInputAvance === 'function') {
                window.s3_handleFileInputAvance(file);
            } else if (type === 'pm' && typeof window.s3_handleFileInputPM === 'function') {
                window.s3_handleFileInputPM(file);
            } else if (type === 'descargos' && typeof window.s3_handleFileInputDescargos === 'function') {
                window.s3_handleFileInputDescargos(file);
            }
            setTimeout(resolve, 800);
        });
    }

    /**
     * Actualiza el badge visual de un item en el asistente
     */
    function actualizarEstadoItem(index, status, texto) {
        const itemEl = document.getElementById(`batchItemStatus_${index}`);
        if (!itemEl) return;

        let badgeHtml = '';
        if (status === 'processing') {
            badgeHtml = `<span class="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full flex items-center gap-1 justify-end"><i class="fa-solid fa-spinner fa-spin"></i> ${texto}</span>`;
        } else if (status === 'done') {
            badgeHtml = `<span class="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1 justify-end"><i class="fa-solid fa-check"></i> ${texto}</span>`;
        } else if (status === 'error') {
            badgeHtml = `<span class="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full flex items-center gap-1 justify-end"><i class="fa-solid fa-circle-exclamation"></i> ${texto}</span>`;
        } else {
            badgeHtml = `<span class="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">${texto}</span>`;
        }
        itemEl.innerHTML = badgeHtml;
    }

    /**
     * Cierra el modal asistente
     */
    function cerrarModal() {
        const modal = document.getElementById('batchUploadWizardModal');
        if (modal) modal.classList.add('hidden');
    }

    // Exponer API global
    window.batchLoader = {
        iniciarCargaEtapa,
        cambiarTipo,
        ejecutarPipeline,
        cerrarModal
    };

    console.log('[BatchLoader] ✓ Módulo de carga por lote asistida activo con doble consulta de empresa.');
})();
