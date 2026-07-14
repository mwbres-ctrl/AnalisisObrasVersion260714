/* ==========================================================================
   Módulo: Consolidación, Vista Previa y Exportación (modules/consolidacion.js)
   Motor de cruce, renderizado de tabla principal, filtros y exportación Excel
   ========================================================================== */

/* --------------------------------------------------------------------------
   Dependencias Globales Esperadas:
   - dataAvance, dataAvanceCorporativo, dataBCMO, dataTarea, dataMateriales
   - dataConsolidada, filteredConsolidada, headersAvance
   - stateOverrides, fileUploadDates
   - activeStateFilters, activeModalityFilters
   - stateColorMap, corporativoEstadoMapping
   - showToast, showLoadingOverlay, hideLoadingOverlay, fadeSwapSection
   - evaluateExcelFormula, getActiveOverride, updateStepper, setTabBadge
   - renderAuditTable, renderOrphansTable, renderBcmoSinCruceTable,
     renderCaducidadTable, renderRecatTable
   - openEditModal, showDetails (de orphans.js / auditoria.js)
   -------------------------------------------------------------------------- */

// --- PROCESAMIENTO CORE CON AUDITORÍA Y SIN REGISTROS ---
function procesarConsolidacion() {
    showLoadingOverlay('Procesando y consolidando datos...');
    setTimeout(_procesarConsolidacionCore, 60);
}

function _procesarConsolidacionCore() {
    dataConsolidada = [];
    const formula = document.getElementById('formulaInput').value;

    const mapBCMO = {};
    if (dataBCMO) dataBCMO.forEach(row => { const k = String(row['_N_TAREA_/_OBRA'] || row['_N_TAREA'] || row['_N_OBRA'] || '').trim().toUpperCase(); if (k) mapBCMO[k] = row; });
    const mapTarea = {};
    if (dataTarea) dataTarea.forEach(row => { const k = String(row['_N_OBRA_BF'] || '').trim().toUpperCase(); if (k) mapTarea[k] = row; });

    const mapCorp = {};
    if (dataAvanceCorporativo) dataAvanceCorporativo.forEach(row => { const k = String(row['_N_NODO'] || '').trim().toUpperCase(); if (k) mapCorp[k] = true; });

    // mapMateriales: agrega totales por MOTIVO (nodo), excluyendo líneas canceladas
    const mapMateriales = {};
    if (dataMateriales) {
        const parseNum = val => parseFloat(String(val || '0').replace(/,/g, '')) || 0;
        dataMateriales.forEach(row => {
            const k = String(row['_N_MOTIVO'] || '').trim().toUpperCase();
            if (!k) return;
            const estLinPM = String(row['_N_ESTADO_DE_LINEA'] || '').trim().toUpperCase();
            const esCancelada = estLinPM === 'CANCELADA' || estLinPM === 'CANCELADO';

            if (!mapMateriales[k]) {
                mapMateriales[k] = {
                    cantEntregada: 0,
                    cantSolicitada: 0,
                    ctdPendiente: 0,
                    tieneSinCancelar: false,
                    // Flags por línea individual: evitan que sumas positivas y negativas
                    // se cancelen y oculten pendientes o entregas reales.
                    tieneEntregada: false,
                    tienePendiente: false
                };
            }
            if (!esCancelada) {
                const lineaEntregada = parseNum(row['_N_CANTIDAD_ENTREGADA']);
                const lineaSolicitada = parseNum(row['_N_CANTIDAD_SOLICITADA']);
                const lineaPendiente = parseNum(row['_N_CTD_PENDIENTE']);
                mapMateriales[k].cantEntregada += lineaEntregada;
                mapMateriales[k].cantSolicitada += lineaSolicitada;
                mapMateriales[k].ctdPendiente += lineaPendiente;
                mapMateriales[k].tieneSinCancelar = true;
                // Activar flags si la línea individual supera el umbral
                if (lineaEntregada > 0.01) mapMateriales[k].tieneEntregada = true;
                if (lineaPendiente > 0.01) mapMateriales[k].tienePendiente = true;
            }
        });
    }

    // Combinar arrays si existen
    const allAvance = [];
    if (dataAvance) allAvance.push(...dataAvance);
    if (dataAvanceCorporativo) allAvance.push(...dataAvanceCorporativo);

    allAvance.forEach(rowAvance => {
        const fila = { ...rowAvance };
        Object.keys(fila).forEach(k => { if (k.startsWith('_N_')) delete fila[k]; });

        let nodo = String(rowAvance['_N_NODO'] || '').trim();
        let estadoAvance = String(rowAvance['_N_ESTADO'] || '').trim().toUpperCase();
        let modalidad = String(rowAvance['_N_MODALIDAD_DE_LIQUIDACION'] || '').trim().toUpperCase();

        // 1. APLICACIÓN DE TRAZABILIDAD Y CORRECCIONES MANUALES
        const originalEstado = estadoAvance;
        const originalNodo = nodo;
        const override = getActiveOverride(originalNodo);

        if (override) {
            if (override.correctedNodo) {
                nodo = override.correctedNodo;
                fila['_MODIFICADO_NODO_'] = true;
                fila['Nodo Original'] = originalNodo;
            }
            if (override.newState) {
                estadoAvance = override.newState;
                fila['_MODIFICADO_ESTADO_'] = true;
            }
            if (override.newModality) {
                modalidad = override.newModality;
                fila['_MODIFICADO_MODALIDAD_'] = true;
            }
            fila['_MODIFICADO_'] = true;
        }

        // Fallback para modalidad: Si no tiene, consultar el archivo corporativo
        if (modalidad === '' || modalidad === 'SIN MODALIDAD') {
            if (mapCorp[nodo.toUpperCase()]) {
                modalidad = 'CORPORATIVO';
            }
        }

        const obraBfCalculada = evaluateExcelFormula(formula, { nodo: nodo }).toUpperCase();
        fila['Nodo'] = nodo; // Guardar el nodo (sea original o corregido)
        fila['Obra BF'] = obraBfCalculada;
        fila['Estado (Original Excel)'] = originalEstado;

        let nuevoEstado = estadoAvance;
        let observacion = "";
        let auditInfo = "-";

        // DETECCIÓN GLOBAL DE NODOS SIN REGISTROS (Sin registros en BCMO, TAREA, PM)
        const matchBCMO = mapBCMO[nodo.toUpperCase()] || mapBCMO[obraBfCalculada];
        const enBCMO = !!matchBCMO;
        const enTarea = !!mapTarea[obraBfCalculada];
        const enMateriales = !!mapMateriales[nodo.toUpperCase()];
        fila['_ES_HUERFANO'] = false;

        if (!enBCMO && !enTarea && !enMateriales) {
            const justif = override ? override.orphanJustification : null;
            if (justif) {
                fila['_ES_HUERFANO'] = false; // Justificado: No debe figurar como error
                auditInfo = 'JUSTIFICADO (Excepción)';
                observacion = justif; // Utiliza la frase guardada en el sistema de forma dinámica
            } else {
                fila['_ES_HUERFANO'] = true;
            }
        }

        // 2. REGLAS ESPECÍFICAS (Lógica Sistémica Original)
        if (modalidad === '' || modalidad === 'SIN MODALIDAD') {
            if (estadoAvance !== 'CANCELADA') {
                if (!fila['_ES_HUERFANO'] && override && override.orphanJustification) {
                    // Mantenemos la observacion de justificacion
                } else {
                    observacion = "Sector de auditoría de control de contratista debe reclamar a Obras";
                }
            }
        }

        // Si es Corporativo, aplica reglas generales de cruce.
        if (modalidad === 'LEGAJO' || modalidad === 'CORPORATIVO') {
            const match = matchBCMO;
            if (match) {
                const estBCMO = String(match['_N_ESTADO_DE_LIQUIDACION'] || '').trim().toUpperCase();
                const consBCMO = match['_N_%_CONSUMO'] || 0;
                fila['BCMO - % Consumo'] = consBCMO;
                fila['BCMO - Estado Liquidacion'] = estBCMO;
                fila['BCMO - Contratista'] = match['_N_CONTRATISTA'] || '';
                auditInfo = `${estBCMO} (${(consBCMO * 100).toFixed(0)}%)`;

                nuevoEstado = estBCMO === "SIN CONSUMO" ? estadoAvance : "FINALIZADA CON CONSUMO";

                if (estBCMO === "VERIFICAR CONSUMO") {
                    observacion = "";
                } else if ((estadoAvance === "EN EJECUCIÓN" || estadoAvance === "A EJECUTAR") && estBCMO === "CONSUMIDO") {
                    observacion = "Obras: Obra consumida en BCMO pero informada en EJECUCION/A EJECUTAR.";
                }
            }
            //else {
            //    if (enMateriales) {
            //        observacion = "La obra tiene PM pero no fue entregada(No en BCMO)";
            //    }
            //}
        }
        else if (modalidad === 'TAREA') {
            const match = mapTarea[obraBfCalculada];
            if (match) {
                const resFinal = String(match['_N_RESULTADO_FINAL'] || '').trim().toUpperCase();
                const cerrados = parseInt(match['_N_CERRADOS']) || 0;
                fila['TAREA - Resultado Final'] = resFinal;
                fila['TAREA - Cerrados'] = cerrados;
                auditInfo = `${resFinal} (Cerrados: ${cerrados})`;

                if (resFinal === "FINALIZADA CON CONSUMO TOTAL") {
                    nuevoEstado = "FINALIZADA CON CONSUMO TOTAL";
                    if (estadoAvance === "EN EJECUCIÓN" || estadoAvance === "A EJECUTAR" || estadoAvance === "CANCELADA") {
                        observacion = "Contratista ponerse en contacto con Obras para corregir el estado de avance de obras";
                    }
                }
                else if (resFinal === "FINALIZADA CON CONSUMO PARCIAL") {
                    if (estadoAvance === "TERMINADO") {
                        nuevoEstado = "FINALIZADA CON CONSUMO PARCIAL";
                    } else if (estadoAvance === "EN EJECUCIÓN") {
                        nuevoEstado = "EN EJECUCION CON CONSUMO PARCIAL";
                    } else if (estadoAvance === "A EJECUTAR" || estadoAvance === "CANCELADA") {
                        nuevoEstado = "EN EJECUCION CON CONSUMO PARCIAL";
                        observacion = "Contratista ponerse en contacto con Obras para corregir el estado de avance de obras";
                    }
                }
                else if (resFinal === "EN CURSO") {
                    if (estadoAvance === "A EJECUTAR" || estadoAvance === "CANCELADA") {
                        nuevoEstado = "EN EJECUCIÓN";
                        observacion = "Contratista ponerse en contacto con Obras para corregir el estado de avance de obras, según tickets se encuentra en curso";
                    } else {
                        nuevoEstado = estadoAvance;
                    }
                }
                else {
                    if (estadoAvance === "TERMINADO" && resFinal === "A EJECUTAR") {
                        observacion = "Contratista: Completar tickets y realizar descarga.";
                    } else if (estadoAvance === "EN EJECUCIÓN" && resFinal === "A EJECUTAR") {
                        observacion = "Contratista: Completar tickets y realizar descarga.";
                    } else if (estadoAvance === "CANCELADA" && resFinal !== "A EJECUTAR" && resFinal !== "") {
                        observacion = "Obras: Cancelada en Avance pero con tickets activos/finalizados.";
                    }
                }
            } else {
                if (!fila['_ES_HUERFANO'] && override && override.orphanJustification) {
                    // justificada, mantener el texto actual
                } else {
                    observacion = "ALERTA: No encontrada en tickets.";
                }
            }
        }

        fila['Estado de Avance (Calculado)'] = nuevoEstado;
        fila['Acción Sugerida / Observación'] = observacion;
        fila['_AUDIT_'] = auditInfo;
        fila['Estado (Motor)'] = estadoAvance;
        fila['Modalidad de Liquidación Calculada'] = modalidad;

        // --- Lógica de Estado de Entregas ---
        // El campo ESTADO_DE_LINEA viene del archivo PM (PMOVXF), agregado por MOTIVO.
        // Si la obra existe en el mapa y tiene al menos una línea no cancelada, evaluamos cantidades.
        const pmData = mapMateriales[nodo.toUpperCase()];

        let estadoEntrega = "-";
        if (pmData) {
            if (!pmData.tieneSinCancelar) {
                // Todas las líneas del PM para este nodo están canceladas
                estadoEntrega = "-";
            } else if (pmData.cantSolicitada === 0) {
                estadoEntrega = "Sin registro de materiales a entregar";
            } else if (pmData.tieneEntregada && pmData.tienePendiente) {
                // Al menos una línea tiene entregada Y al menos una tiene pendiente
                // (evaluado por línea individual para evitar cancelaciones aritméticas)
                estadoEntrega = "Con entregas y pendientes";
            } else if (pmData.tieneEntregada && !pmData.tienePendiente) {
                estadoEntrega = "Con entregas";
            } else if (!pmData.tieneEntregada && pmData.tienePendiente) {
                estadoEntrega = "Sin entregas con pendiente";
            } else {
                estadoEntrega = "Sin registro de materiales a entregar";
            }
        } else {
            // El nodo no existe en el archivo PM
            estadoEntrega = "Sin registro de materiales a entregar";
        }

        // --- NUEVA LÓGICA DE FALLBACK A BCMO ---
        if (estadoEntrega === "Sin registro de materiales a entregar" && matchBCMO) {
            const entregadoBCMO = parseFloat(matchBCMO['_N_ENTREGADO']) || 0;
            if (entregadoBCMO > 0) {
                estadoEntrega = "Con entregas";
            }
        }

        fila['Estado de Entregas'] = estadoEntrega;

        // --- Lógica de Obra a considerar ---
        let obraAConsiderar = "-";
        const estBCMO = (matchBCMO ? String(matchBCMO['_N_ESTADO_DE_LIQUIDACION'] || '').trim().toUpperCase() : "");
        if ((estadoEntrega === "Con entregas" || estadoEntrega === "Con entregas y pendientes") &&
            nuevoEstado === "TERMINADO" &&
            estBCMO === "SIN CONSUMO" &&
            modalidad === "LEGAJO") {
            obraAConsiderar = "Considerar en hoja TERMINADO/CT";
        } else if ((modalidad === "TAREA" || modalidad === "LEGAJO") &&
            nuevoEstado === "A EJECUTAR" &&
            (estadoEntrega === "Con entregas" || estadoEntrega === "Con entregas y pendientes")) {
            obraAConsiderar = "Considerar en hoja A EJECUTAR (solo lo entregado vs conteo)";
        } else if ((estadoEntrega === "Con entregas" || estadoEntrega === "Con entregas y pendientes") &&
            (nuevoEstado === "EN EJECUCIÓN" || nuevoEstado === "EN EJECUCION") &&
            estBCMO === "SIN CONSUMO" &&
            modalidad === "LEGAJO") {
            obraAConsiderar = "Considerar en hoja En ejecución (lo entregado + pendiente)";
        }

        fila['Obra a considerar'] = obraAConsiderar;

        dataConsolidada.push(fila);
    });

    fadeSwapSection(document.getElementById('setupSection'), document.getElementById('resultsSection'), 'flex');
    document.getElementById('btnExportar').classList.remove('hidden');
    document.getElementById('btnExportar').classList.add('flex');
    document.getElementById('btnGoToResults').classList.remove('hidden');
    updateStepper(2);

    // Actualizar solapa de estandarizacion si estamos mostrando "Recategorizados"
    if (document.getElementById('tabRecatContent') && !document.getElementById('tabRecatContent').classList.contains('hidden')) {
        renderRecatTable();
    }

    renderPreview();
    renderAuditTable();
    renderOrphansTable();
    renderBcmoSinCruceTable();
    renderCaducidadTable();
    hideLoadingOverlay();
}

// --- FILTROS MULTIPLES ---
function toggleStateFilter(estado) {
    const idx = activeStateFilters.indexOf(estado);
    if (idx > -1) activeStateFilters.splice(idx, 1);
    else activeStateFilters.push(estado);
    renderPreview();
}

function toggleModalityFilter(mod) {
    const idx = activeModalityFilters.indexOf(mod);
    if (idx > -1) activeModalityFilters.splice(idx, 1);
    else activeModalityFilters.push(mod);
    renderPreview();
}

function renderPreview() {
    const fNodo = document.getElementById('hFilterNodo').value.trim().toLowerCase();
    const fObraBf = document.getElementById('hFilterObraBF').value.trim().toLowerCase();
    const fMod = document.getElementById('hFilterMod').value.trim().toLowerCase();
    const fEstOrig = document.getElementById('hFilterEstOrig').value.trim().toLowerCase();
    const fAudit = document.getElementById('hFilterAudit').value.trim().toLowerCase();
    const fEstCalc = document.getElementById('hFilterEstCalc').value.trim().toLowerCase();
    const fEstEnt = document.getElementById('hFilterEstEnt').value.trim().toLowerCase();
    const fObraConsiderar = document.getElementById('hFilterObraConsiderar') ? document.getElementById('hFilterObraConsiderar').value.trim().toLowerCase() : "";
    const fObs = document.getElementById('hFilterObs').value.trim().toLowerCase();

    let baseFiltered = dataConsolidada.filter(item => {
        const n = String(item['Nodo'] || item['NODO'] || '').toLowerCase();
        const oBf = String(item['Obra BF'] || '').toLowerCase();
        const m = String(item['Modalidad de Liquidación Calculada'] || item['Modalidad de Liquidación'] || item['MODALIDAD DE LIQUIDACIÓN'] || item['_ORIGEN'] || '').toLowerCase();
        const eo = String(item['Estado (Original Excel)'] || item['Estado (Motor)'] || '').toLowerCase();
        const au = String(item['_AUDIT_'] || '').toLowerCase();
        const ec = String(item['Estado de Avance (Calculado)'] || '').toLowerCase();
        const ee = String(item['Estado de Entregas'] || '').toLowerCase();
        const oc = String(item['Obra a considerar'] || '').toLowerCase();
        const ob = String(item['Acción Sugerida / Observación'] || '').toLowerCase();

        if (fNodo && !n.includes(fNodo)) return false;
        if (fObraBf && !oBf.includes(fObraBf)) return false;
        if (fMod && !m.includes(fMod)) return false;
        if (fEstOrig && !eo.includes(fEstOrig)) return false;
        if (fAudit && !au.includes(fAudit)) return false;
        if (fEstCalc && !ec.includes(fEstCalc)) return false;
        if (fEstEnt && !ee.includes(fEstEnt)) return false;
        if (fObraConsiderar && !oc.includes(fObraConsiderar)) return false;
        if (fObs && !ob.includes(fObs)) return false;
        return true;
    });

    const countsState = {}; const countsMod = {};

    baseFiltered.forEach(i => {
        const e = i['Estado de Avance (Calculado)'] || 'Otro';
        countsState[e] = (countsState[e] || 0) + 1;
        let m = (i['Modalidad de Liquidación Calculada'] || i['Modalidad de Liquidación'] || i['MODALIDAD DE LIQUIDACIÓN'] || '').toUpperCase().trim();
        m = m === '' ? (i['_ORIGEN'] === 'CORPORATIVO' ? 'CORPORATIVO' : 'SIN MODALIDAD') : m;
        countsMod[m] = (countsMod[m] || 0) + 1;
    });

    // Badges Estado Múltiple
    const badgesContainer = document.getElementById('summaryBadges');
    badgesContainer.innerHTML = '';

    const allActive = activeStateFilters.length === 0;
    const btnAllClass = allActive ? "bg-slate-700 text-white" : "bg-white text-slate-600 border border-slate-300";
    badgesContainer.innerHTML += `<button type="button" onclick="activeStateFilters=[]; renderPreview();" class="px-3 py-1 text-xs rounded font-semibold transition-colors shadow-sm ${btnAllClass}">TODOS</button>`;

    for (const [estado, cantidad] of Object.entries(countsState)) {
        const isActive = activeStateFilters.includes(estado);
        const style = stateColorMap[estado] || stateColorMap['DEFAULT'];
        const btnClass = isActive ? `bg-slate-700 text-white shadow-inner` : `bg-white border text-slate-700 hover:bg-slate-50 ${style.badge}`;
        badgesContainer.innerHTML += `<button type="button" onclick="toggleStateFilter('${estado}')" class="px-3 py-1 text-xs rounded border font-semibold transition-colors flex items-center gap-1 shadow-sm ${btnClass}">${estado} <span class="text-[10px] ml-1 px-1.5 rounded ${isActive ? 'bg-white/20' : 'bg-slate-200'}">${cantidad}</span></button>`;
    }

    // Badges Modalidad Múltiple
    const modBadgesContainer = document.getElementById('modalityBadges');
    modBadgesContainer.innerHTML = '';

    const allModActive = activeModalityFilters.length === 0;
    const btnModAllClass = allModActive ? "bg-slate-700 text-white" : "bg-white text-slate-600 border border-slate-300";
    modBadgesContainer.innerHTML += `<button type="button" onclick="activeModalityFilters=[]; renderPreview();" class="px-3 py-1 text-xs rounded font-semibold transition-colors shadow-sm ${btnModAllClass}">TODAS</button>`;

    for (const [mod, cantidad] of Object.entries(countsMod)) {
        const isActive = activeModalityFilters.includes(mod);
        let btnClass = isActive ? `bg-indigo-600 text-white` : `bg-white border-slate-300 text-slate-700 hover:bg-slate-50`;
        if (mod === 'SIN MODALIDAD' && !isActive) btnClass = `bg-red-50 border-red-200 text-red-700`;
        modBadgesContainer.innerHTML += `<button type="button" onclick="toggleModalityFilter('${mod}')" class="px-3 py-1 text-xs rounded border font-semibold transition-colors flex items-center gap-1 shadow-sm ${btnClass}">${mod} <span class="text-[10px] ml-1 px-1.5 rounded ${isActive ? 'bg-white/20' : 'bg-slate-200'}">${cantidad}</span></button>`;
    }

    // Filtrado Final Combinado
    filteredConsolidada = baseFiltered.filter(item => {
        if (activeStateFilters.length > 0 && !activeStateFilters.includes(item['Estado de Avance (Calculado)'])) return false;
        let itemMod = (item['Modalidad de Liquidación Calculada'] || item['Modalidad de Liquidación'] || item['MODALIDAD DE LIQUIDACIÓN'] || '').toUpperCase().trim();
        itemMod = itemMod === '' ? (item['_ORIGEN'] === 'CORPORATIVO' ? 'CORPORATIVO' : 'SIN MODALIDAD') : itemMod;
        if (activeModalityFilters.length > 0 && !activeModalityFilters.includes(itemMod)) return false;
        return true;
    });

    document.getElementById('statsText').innerHTML = `<b>${filteredConsolidada.length}</b> de ${dataConsolidada.length} registros`;

    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';

    filteredConsolidada.slice(0, 500).forEach((item, idx) => {
        const obs = item['Acción Sugerida / Observación'] || '';
        const style = stateColorMap[item['Estado de Avance (Calculado)']] || stateColorMap['DEFAULT'];

        let modText = item['Modalidad de Liquidación Calculada'] || '';
        if (modText === '' && item['_ORIGEN'] === 'CORPORATIVO') modText = 'CORP';

        let modHtml = modText === '' || modText === 'SIN MODALIDAD'
            ? `<span class="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-red-200">SIN MOD</span>`
            : `<span class="bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-bold border border-slate-300">${modText}</span>`;

        if (item['_MODIFICADO_MODALIDAD_']) {
            modHtml = `<span class="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-indigo-300" title="Modalidad Forzada"><i class="fa-solid fa-pen-nib mr-1 text-[8px]"></i>${modText}</span>`;
        }

        const isModificado = item['_MODIFICADO_'];
        const estadoRender = item['_MODIFICADO_ESTADO_']
            ? `<span class="text-indigo-600 font-bold" title="Original: ${item['Estado (Original Excel)']}"><i class="fa-solid fa-pen-nib mr-1 text-[10px]"></i> ${item['Estado (Motor)']}</span>`
            : item['Estado (Motor)'];

        const nodoRender = item['_MODIFICADO_NODO_']
            ? `<span class="text-indigo-600 font-bold" title="Original: ${item['Nodo Original']}"><i class="fa-solid fa-spell-check mr-1 text-[10px]"></i> ${item['Nodo'] || item['NODO']}</span>`
            : `<span class="text-slate-800">${item['Nodo'] || item['NODO']}</span>`;

        const tr = document.createElement('tr');
        tr.className = "group border-b border-slate-200 transition-colors";
        tr.innerHTML = `
            <td class="py-2 px-3 border-r border-slate-200 font-medium">${nodoRender}</td>
            <td class="py-2 px-3 border-r border-slate-200 font-mono text-[10px] text-indigo-700 bg-indigo-50/20">${item['Obra BF']}</td>
            <td class="py-2 px-3 border-r border-slate-200">${modHtml}</td>
            <td class="py-2 px-3 border-r border-slate-200 text-slate-500">${estadoRender}</td>
            <td class="py-2 px-3 border-r border-slate-200 text-indigo-600 font-mono text-[10px] bg-indigo-50/30">${item['_AUDIT_']}</td>
            <td class="py-2 px-3 border-r border-slate-200 ${style.text}">${item['Estado de Avance (Calculado)']}</td>
            <td class="py-2 px-3 border-r border-slate-200 text-[11px] font-semibold text-slate-700 bg-amber-50/20">${item['Estado de Entregas'] || '-'}</td>
            <td class="py-2 px-3 border-r border-slate-200 text-[11px] font-semibold text-blue-700 bg-blue-50/20">${item['Obra a considerar'] || '-'}</td>
            <td class="py-2 px-3 border-r border-slate-200 text-xs ${obs.includes('reclamar a Obras') || obs.includes('corregir el estado') || item['_ES_HUERFANO'] ? 'text-red-700 font-bold bg-red-50' : 'text-slate-600'} truncate max-w-[250px]" title="${obs}">${obs}</td>
            <td class="py-2 px-3 text-center flex justify-center gap-1">
                <button type="button" onclick="openEditModal('${item['Nodo Original'] || item['Nodo'] || item['NODO']}', '${item['Estado (Original Excel)']}')" class="text-slate-400 hover:text-indigo-600 bg-slate-50 border border-slate-200 hover:bg-slate-100 w-6 h-6 rounded flex items-center justify-center transition-colors" title="Forzar Corrección">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button type="button" onclick="showDetails(${idx})" class="text-slate-400 hover:text-emerald-600 bg-slate-50 border border-slate-200 hover:bg-emerald-50 w-6 h-6 rounded flex items-center justify-center transition-colors" title="Ver Campos">
                    <i class="fa-solid fa-eye"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    if (filteredConsolidada.length > 500) {
        tbody.innerHTML += `<tr><td colspan="9" class="py-3 px-3 text-center text-slate-500 text-xs italic bg-slate-50">Mostrando 500. Use exportar para ver el total.</td></tr>`;
    }
}

// --- EXPORTACIÓN EXCEL NATIVA ---
function exportToExcel() {
    if (!dataConsolidada.length) return;

    const auditorInput = document.getElementById('auditorName');
    const auditorStr = auditorInput && auditorInput.value.trim() ? auditorInput.value.trim() : 'Auditor Anónimo';

    const globalAuditDateInput = document.getElementById('globalAuditDate');
    const auditDate = globalAuditDateInput ? globalAuditDateInput.value : new Date().toISOString().split('T')[0];

    // 1. Exportar Maestro Ignorando Filtros
    const excludedHeaders = ['ZONA', 'PARTIDO', 'LOCALIDAD', 'ETAPA', 'ETAPA LOGICA', 'MZAS'];

    // Combinar cabeceras para ambos orígenes
    const allHeadersSet = new Set(headersAvance);
    if (dataAvanceCorporativo && dataAvanceCorporativo.length > 0) {
        Object.keys(dataAvanceCorporativo[0]).forEach(k => {
            if (!k.startsWith('_')) allHeadersSet.add(k);
        });
    }
    const activeHeaders = Array.from(allHeadersSet);

    const data = dataConsolidada.map(row => {
        const r = {};
        activeHeaders.forEach(h => {
            const normalizedH = h.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            if (excludedHeaders.includes(normalizedH)) return;
            let v = row[h] !== undefined ? row[h] : row[`_N_${normalizedH.replace(/\s+/g, '_')}`];
            if (h.toUpperCase().includes('%') && typeof v === 'string') v = parseFloat(v.replace(',', '.')) / 100;
            if (v !== undefined) r[h] = v;
        });
        r['Obra BF'] = row['Obra BF'];
        if (row['_ORIGEN'] === 'CORPORATIVO') r['Cierre Calculado (Mínimo)'] = row['_N_FECHA_CIERRE_CALCULADA'];
        if (row['BCMO - % Consumo'] !== undefined) r['BCMO - % Consumo'] = row['BCMO - % Consumo'];
        if (row['BCMO - Estado Liquidacion']) r['BCMO - Estado Liquidacion'] = row['BCMO - Estado Liquidacion'];
        if (row['TAREA - Obra BF']) r['TAREA - Obra BF'] = row['TAREA - Obra BF'];
        if (row['TAREA - Resultado Final']) r['TAREA - Resultado Final'] = row['TAREA - Resultado Final'];
        r['Estado de Avance (Calculado)'] = row['Estado de Avance (Calculado)'];
        r['Estado de Entregas'] = row['Estado de Entregas'] || '-';
        r['Obra a considerar'] = row['Obra a considerar'] || '-';
        r['Acción Sugerida / Observación'] = row['Acción Sugerida / Observación'];
        return r;
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let C = range.s.c; C <= range.e.c; ++C) {
        const header = String(ws[XLSX.utils.encode_cell({ c: C, r: 0 })].v).toUpperCase();
        for (let R = 1; R <= range.e.r; ++R) {
            const cell = ws[XLSX.utils.encode_cell({ c: C, r: R })];
            if (!cell) continue;
            if (header.includes('%')) cell.z = "0.00%";
            if (header.includes('FECHA') || header.includes('INICIO')) cell.z = "dd/mm/yyyy";
        }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Consolidado Maestro");

    // 2. Exportar Registro de Cambios (Trazabilidad Inmutable)
    const logs = Object.values(stateOverrides).sort((a, b) => new Date(b.timestamp.replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$2-$1')) - new Date(a.timestamp.replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$2-$1')));
    const overridesList = logs.map(log => ({
        "Estado Registro": log.reverted ? "REVERTIDO" : "ACTIVO",
        "Nodo/Obra Original": log.nodo,
        "Nodo Corregido A": log.correctedNodo || "-",
        "Estado Forzado A": log.newState || "-",
        "Justificación de Descarte": log.orphanJustification || "-",
        "Fecha de Inicio Real": log.startDate || "-",
        "Fecha de Cierre Técnico": log.closeDate || "-",
        "Fecha Correo Respaldo": log.mailDate || "-",
        "Autorizado Por": log.validator || "-",
        "Auditor/Operador": log.auditor,
        "Fec/Hora Creación": log.timestamp,
        "Fec/Hora Reversión": log.revertedTimestamp || "-"
    }));
    const wsAudit = XLSX.utils.json_to_sheet(overridesList.length > 0 ? overridesList : [{ "Info": "No se registraron cambios manuales en esta sesión." }]);
    XLSX.utils.book_append_sheet(wb, wsAudit, "Trazabilidad de Cambios");

    // 3. Exportar Nodos sin Registro
    const orphans = dataConsolidada.filter(i => i['_ES_HUERFANO'] === true).map(i => ({
        "Origen": i['_ORIGEN'],
        "Nodo": i['Nodo Original'] || i['Nodo'] || i['NODO'],
        "Obra BF": i['Obra BF'],
        "Estado Original": i['Estado (Original Excel)'],
        "Contratista": i['Contratista'] || '-',
        "Estado Forzado (Actual)": i['_MODIFICADO_ESTADO_'] ? i['Estado (Motor)'] : 'Pendiente'
    }));
    const wsOrphans = XLSX.utils.json_to_sheet(orphans.length > 0 ? orphans : [{ "Info": "No hay nodos sin registro en la vista." }]);
    XLSX.utils.book_append_sheet(wb, wsOrphans, "Nodos Sin Registro");

    // 4. Exportar Info de Sesión
    const sessionInfo = [
        { "Dato": "Fecha de Reporte", "Valor": new Date().toLocaleString('es-AR') },
        { "Dato": "Usuario Auditor", "Valor": auditorStr },
        { "Dato": "Fecha de Corte (Auditoría)", "Valor": auditDate },
        { "Dato": "---", "Valor": "---" },
        { "Dato": "Fecha Archivo: Avance de Obras", "Valor": fileUploadDates.avance || "No cargado" },
        { "Dato": "Fecha Archivo: Avance Corporativo", "Valor": fileUploadDates.corporativo || "No cargado" },
        { "Dato": "Fecha Archivo: BCMO", "Valor": fileUploadDates.bcmo || "No cargado" },
        { "Dato": "Fecha Archivo: Sistema TAREA", "Valor": fileUploadDates.tarea || "No cargado" },
        { "Dato": "Fecha Archivo: PMOVXF", "Valor": fileUploadDates.pmovxf || "No cargado" }
    ];
    const wsSession = XLSX.utils.json_to_sheet(sessionInfo);
    XLSX.utils.book_append_sheet(wb, wsSession, "Info de Sesión");

    XLSX.writeFile(wb, `Auditoria_Obras_${new Date().getTime()}.xlsx`);
    showToast("Reporte Maestro Exportado Exitosamente.", "success");
}
