/* ==========================================================================
   Módulo: Nodos Sin Registro / Huérfanos (modules/orphans.js)
   Lógica de la pestaña "Nodos Sin Registro" y Sistema de Edición
   ========================================================================== */

/* --------------------------------------------------------------------------
   Dependencias Globales Esperadas:
   - dataConsolidada, dataBCMO, dataMateriales (Arrays)
   - stateOverrides, stateColorMap (Objects)
   - currentEditNodo (Variable global declarada en app.js o principal)
   - setTabBadge, showToast, procesarConsolidacion, getActiveOverride (Functions)
   -------------------------------------------------------------------------- */

function renderOrphansTable() {
    const tbody = document.getElementById('orphansTableBody');
    const emptyState = document.getElementById('emptyOrphansState');
    const filterText = document.getElementById('hFilterOrphans').value.trim().toLowerCase();
    const hideCancelados = document.getElementById('configHideCancelados').checked;
    const dateLimitStr = document.getElementById('configOrphansDateLimit') ? document.getElementById('configOrphansDateLimit').value : null;

    tbody.innerHTML = '';

    let orphans = dataConsolidada.filter(i => i['_ES_HUERFANO'] === true);

    if (hideCancelados) {
        orphans = orphans.filter(i => {
            const e = String(i['Estado (Original Excel)'] || '').toUpperCase();
            return e !== 'CANCELADA' && e !== 'CANCELADO';
        });
    }

    // Filtrado por Fecha de Cierre Histórica
    if (dateLimitStr) {
        const limitDate = new Date(dateLimitStr);
        limitDate.setHours(0, 0, 0, 0);
        orphans = orphans.filter(i => {
            const e = String(i['Estado (Original Excel)'] || '').toUpperCase();
            if (e === 'A EJECUTAR') return true; // Siempre mostrar A Ejecutar

            let cDateRaw = i['Fecha Cierre Tecnico'] || i['FECHA CIERRE TECNICO'] || i['Fecha Cierre Técnico'] || i['Cierre Técnico'] || i['CIERRE TÉCNICO'] || i['Fin'];

            if (!cDateRaw || String(cDateRaw).trim() === '') {
                cDateRaw = i['Fecha Inicio'] || i['FECHA INICIO'] || i['Inicio'] || i['INICIO'];
            }

            if (!cDateRaw || String(cDateRaw).trim() === '') return true; // Mostrar si no tiene ninguna de las dos

            let cDate;
            if (cDateRaw instanceof Date) {
                cDate = cDateRaw;
            } else {
                let parts = String(cDateRaw).split('/');
                if (parts.length === 3) cDate = new Date(parts[2], parts[1] - 1, parts[0]);
                else cDate = new Date(cDateRaw);
            }
            if (cDate && !isNaN(cDate.getTime())) {
                cDate.setHours(0, 0, 0, 0);
                if (cDate < limitDate) return false; // Ocultar si es mas antigua
            }
            return true;
        });
    }

    setTabBadge('tabOrphansCount', orphans.length);

    // Resumen de Estados (Badges)
    const countsState = {};
    const countsMod = {};
    orphans.forEach(i => {
        const e = i['Estado (Original Excel)'] || 'SIN ESTADO';
        countsState[e] = (countsState[e] || 0) + 1;

        let m = (i['Modalidad de Liquidación Calculada'] || i['Modalidad de Liquidación'] || i['MODALIDAD DE LIQUIDACIÓN'] || '').toUpperCase().trim();
        m = m === '' ? (i['_ORIGEN'] === 'CORPORATIVO' ? 'CORPORATIVO' : 'SIN MODALIDAD') : m;
        countsMod[m] = (countsMod[m] || 0) + 1;
    });

    const badgesContainer = document.getElementById('orphansSummaryBadges');
    badgesContainer.innerHTML = '';

    const allActive = activeOrphansStateFilters.length === 0;
    const btnAllClass = allActive ? "bg-slate-700 text-white" : "bg-white text-slate-600 border border-slate-300";
    badgesContainer.innerHTML += `<button type="button" onclick="activeOrphansStateFilters=[]; renderOrphansTable();" class="px-3 py-1 text-xs rounded font-semibold transition-colors shadow-sm ${btnAllClass}">TODOS</button>`;

    for (const [estado, cantidad] of Object.entries(countsState)) {
        const isActive = activeOrphansStateFilters.includes(estado);
        const style = stateColorMap[estado] || stateColorMap['DEFAULT'];
        const btnClass = isActive ? `bg-slate-700 text-white shadow-inner` : `bg-white border text-slate-700 hover:bg-slate-50 ${style.badge}`;
        badgesContainer.innerHTML += `<button type="button" onclick="toggleOrphanStateFilter('${estado}')" class="px-3 py-1 text-[10px] rounded border font-bold shadow-sm transition-colors ${btnClass}">${estado} <span class="bg-white/50 px-1 ml-0.5 rounded text-slate-800">${cantidad}</span></button>`;
    }

    // Resumen de Modalidades (Badges)
    const modBadgesContainer = document.getElementById('orphansModalityBadges');
    modBadgesContainer.innerHTML = '';

    const allModActive = activeOrphansModFilters.length === 0;
    const btnModAllClass = allModActive ? "bg-indigo-600 text-white" : "bg-white text-slate-600 border border-slate-300";
    modBadgesContainer.innerHTML += `<button type="button" onclick="activeOrphansModFilters=[]; renderOrphansTable();" class="px-3 py-1 text-xs rounded font-semibold transition-colors shadow-sm ${btnModAllClass}">TODAS</button>`;

    for (const [mod, cantidad] of Object.entries(countsMod)) {
        const isActive = activeOrphansModFilters.includes(mod);
        let btnClass = isActive ? `bg-indigo-600 text-white shadow-inner` : `bg-white border-slate-300 text-slate-700 hover:bg-slate-50`;
        if (mod === 'SIN MODALIDAD' && !isActive) btnClass = `bg-red-50 border-red-200 text-red-700 hover:bg-red-100`;
        modBadgesContainer.innerHTML += `<button type="button" onclick="toggleOrphanModFilter('${mod}')" class="px-3 py-1 text-[10px] rounded border font-bold shadow-sm transition-colors ${btnClass}">${mod} <span class="bg-white/50 px-1 ml-0.5 rounded text-slate-800">${cantidad}</span></button>`;
    }

    // Aplicar Filtros de Badges
    if (activeOrphansStateFilters.length > 0) {
        orphans = orphans.filter(i => {
            const e = i['Estado (Original Excel)'] || 'SIN ESTADO';
            return activeOrphansStateFilters.includes(e);
        });
    }

    if (activeOrphansModFilters.length > 0) {
        orphans = orphans.filter(i => {
            let m = (i['Modalidad de Liquidación Calculada'] || i['Modalidad de Liquidación'] || i['MODALIDAD DE LIQUIDACIÓN'] || '').toUpperCase().trim();
            m = m === '' ? (i['_ORIGEN'] === 'CORPORATIVO' ? 'CORPORATIVO' : 'SIN MODALIDAD') : m;
            return activeOrphansModFilters.includes(m);
        });
    }

    // Aplicar Búsqueda de Texto
    if (filterText) {
        orphans = orphans.filter(i => {
            const n = String(i['Nodo Original'] || i['Nodo'] || i['NODO'] || '').toLowerCase();
            const o = String(i['Obra BF'] || '').toLowerCase();
            const e = String(i['Estado (Original Excel)'] || '').toLowerCase();
            return n.includes(filterText) || o.includes(filterText) || e.includes(filterText);
        });
    }

    document.getElementById('orphansCountText').textContent = `${orphans.length} Nodos`;

    if (orphans.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }
    emptyState.classList.add('hidden');

    orphans.forEach((item) => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors border-b border-slate-100";

        const nodoOriginal = item['Nodo Original'] || item['Nodo'] || item['NODO'];
        const nodoRender = item['_MODIFICADO_NODO_']
            ? `<span class="text-indigo-600 font-bold" title="Original: ${nodoOriginal}"><i class="fa-solid fa-spell-check mr-1 text-[10px]"></i> ${item['Nodo']}</span>`
            : `<span class="text-slate-800 font-bold">${nodoOriginal}</span>`;

        const estadoOrig = item['Estado (Original Excel)'];
        const origen = item['_ORIGEN'] === 'CORPORATIVO' ? '<span class="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded text-[10px] font-bold">CORPORATIVO</span>' : '<span class="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-[10px] font-bold">PRINCIPAL</span>';

        const estadoRender = item['_MODIFICADO_ESTADO_']
            ? `<span class="text-indigo-600 font-bold" title="Original: ${estadoOrig}">FORZADO: ${item['Estado (Motor)']}</span>`
            : `<span class="text-slate-600">${item['Estado (Motor)']}</span>`;

        // Modalidad
        let modLiquidacion = (item['Modalidad de Liquidación Calculada'] || item['Modalidad de Liquidación'] || item['MODALIDAD DE LIQUIDACIÓN'] || '').toUpperCase().trim();
        modLiquidacion = modLiquidacion === '' ? (item['_ORIGEN'] === 'CORPORATIVO' ? 'CORPORATIVO' : 'SIN MODALIDAD') : modLiquidacion;
        const modHtml = modLiquidacion === 'SIN MODALIDAD'
            ? `<span class="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-red-200">SIN MOD</span>`
            : `<span class="bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-bold border border-slate-300">${modLiquidacion}</span>`;

        // Fecha Inicio
        const fInicioRaw = item['Fecha Inicio'] || item['FECHA INICIO'] || item['Inicio'] || item['INICIO'] || '-';
        let fInicioFormat = fInicioRaw;
        if (fInicioRaw instanceof Date) {
            fInicioFormat = fInicioRaw.toLocaleDateString('es-AR');
        } else if (typeof fInicioRaw === 'string' && fInicioRaw.match(/^\d{4}-\d{2}-\d{2}T/)) {
            fInicioFormat = new Date(fInicioRaw).toLocaleDateString('es-AR');
        }

        tr.innerHTML = `
            <td class="p-3 border-r border-slate-100">${origen}</td>
            <td class="p-3 text-sm border-r border-slate-100">${nodoRender}</td>
            <td class="p-3 text-xs font-mono text-indigo-700 border-r border-slate-100 bg-indigo-50/20">${item['Obra BF']}</td>
            <td class="p-3 text-xs border-r border-slate-100">${estadoRender}</td>
            <td class="p-3 border-r border-slate-100">${modHtml}</td>
            <td class="p-3 text-xs text-slate-600 border-r border-slate-100 text-center">${fInicioFormat}</td>
            <td class="p-3 text-center">
                <button type="button" onclick="openEditModal('${nodoOriginal}', '${estadoOrig}', true)" class="text-indigo-600 hover:text-white bg-indigo-50 hover:bg-indigo-600 border border-indigo-200 px-4 py-1.5 rounded text-xs font-bold transition-colors shadow-sm">
                    <i class="fa-solid fa-pen-to-square mr-1"></i> Corregir
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- SISTEMA DE EDICIÓN Y TRAZABILIDAD ---
function toggleCloseDateReq() {
    const state = document.getElementById('editModalNewState').value;
    const reqClose = document.getElementById('reqCloseDate');
    const reqStart = document.getElementById('reqStartMarker');
    const reqMail = document.getElementById('reqMailMarker');
    const reqVal = document.getElementById('reqValMarker');

    if (state !== "") {
        reqStart.classList.remove('hidden');
        reqMail.classList.remove('hidden');
        reqVal.classList.remove('hidden');
        if (state === "TERMINADO") reqClose.classList.remove('hidden');
        else reqClose.classList.add('hidden');
    } else {
        reqStart.classList.add('hidden');
        reqMail.classList.add('hidden');
        reqVal.classList.add('hidden');
        reqClose.classList.add('hidden');
    }
}

function togglePMRequisito() {
    const val = document.getElementById('editModalOrphanJustification').value;
    const pmContainer = document.getElementById('pmInputContainer');
    if (val === 'PM_CANCELADO') {
        pmContainer.classList.remove('hidden');
    } else {
        pmContainer.classList.add('hidden');
    }
}

function openEditModal(nodo, origState, isOrphan = false) {
    currentEditNodo = nodo;
    document.getElementById('editModalNodo').textContent = nodo;
    document.getElementById('editModalEstadoOrig').textContent = origState;

    const justifySection = document.getElementById('editModalJustifySection');
    const suggestionBox = document.getElementById('editModalOrphanSuggestion');
    const stateSection = document.getElementById('editModalStateSection');
    const datesSection = document.getElementById('editModalDatesSection');

    suggestionBox.classList.add('hidden');
    document.getElementById('orphanSuggestionText').textContent = "";

    if (isOrphan) {
        stateSection.classList.add('hidden');
        datesSection.classList.add('hidden');
        if (justifySection) justifySection.classList.remove('hidden');

        // CONSTRUIR SELECT DE JUSTIFICACIONES DINÁMICO
        const justifySelect = document.getElementById('editModalOrphanJustification');
        justifySelect.innerHTML = `
            <option value="">-- No justificar (Mantener como no encontrado) --</option>
            <option value="RECIENTE_SIN_PM">Descartar: Obra reciente sin PM / Sin entrega de materiales</option>
            <option value="ANTIGUA">Descartar: Obra muy antigua (Posiblemente Consumida/Cancelada)</option>
            <option value="ANTIGUA_SIN_MAT">Descartar: Obra muy antigua sin entrega de materiales</option>
            <option value="PM_CANCELADO">Descartar: Obra sin entrega de material con PM cancelado</option>
        `;

        // Agregar motivos personalizados
        const customInput = document.getElementById('configCustomJustifications');
        if (customInput && customInput.value.trim() !== '') {
            const customs = customInput.value.split('\\n').map(s => s.trim()).filter(s => s !== '');
            if (customs.length > 0) {
                const optGroup = document.createElement('optgroup');
                optGroup.label = "Motivos Personalizados (Manuales)";
                customs.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = `CUSTOM_${c}`;
                    opt.textContent = `Descartar: ${c}`;
                    optGroup.appendChild(opt);
                });
                justifySelect.appendChild(optGroup);
            }
        }

        // Asistente Inteligente de Búsqueda de Nodos
        const sNodo = nodo.replace(/[\\s-]/g, '').toUpperCase();
        const checkList = [];
        if (dataBCMO) dataBCMO.forEach(r => { const k = String(r['_N_TAREA_/_OBRA'] || r['_N_TAREA'] || r['_N_OBRA'] || '').trim(); if (k) checkList.push(k); });
        if (dataMateriales) dataMateriales.forEach(r => { const k = String(r['_N_MOTIVO'] || '').trim(); if (k) checkList.push(k); });

        let suggested = null;
        for (let candidate of checkList) {
            if (candidate.replace(/[\\s-]/g, '').toUpperCase() === sNodo && candidate.toUpperCase() !== nodo.toUpperCase()) {
                suggested = candidate; break;
            }
        }

        if (suggested) {
            document.getElementById('orphanSuggestionText').textContent = suggested;
            suggestionBox.classList.remove('hidden');
        }

    } else {
        stateSection.classList.remove('hidden');
        datesSection.classList.remove('hidden');
        if (justifySection) justifySection.classList.add('hidden');
    }

    const activeLog = getActiveOverride(nodo);
    if (activeLog) {
        document.getElementById('editModalCorrectedNodo').value = activeLog.correctedNodo || "";
        document.getElementById('editModalNewState').value = activeLog.newState || "";
        document.getElementById('editModalNewMod').value = activeLog.newModality || "";
        document.getElementById('editModalStartDate').value = activeLog.startDate || "";
        document.getElementById('editModalCloseDate').value = activeLog.closeDate || "";
        document.getElementById('editModalMailDate').value = activeLog.mailDate || "";
        document.getElementById('editModalValidator').value = activeLog.validator || "";

        if (document.getElementById('editModalOrphanJustification')) {
            document.getElementById('editModalOrphanJustification').value = activeLog.justifType || "";
            if (activeLog.justifType === 'PM_CANCELADO') {
                document.getElementById('pmInputContainer').classList.remove('hidden');
                document.getElementById('editModalPMNumber').value = activeLog.pmNumber || "";
            } else {
                document.getElementById('pmInputContainer').classList.add('hidden');
                document.getElementById('editModalPMNumber').value = "";
            }
        }
    } else {
        document.getElementById('editModalCorrectedNodo').value = "";
        document.getElementById('editModalNewState').value = "";
        document.getElementById('editModalNewMod').value = "";
        document.getElementById('editModalStartDate').value = "";
        document.getElementById('editModalCloseDate').value = "";
        document.getElementById('editModalMailDate').value = "";
        document.getElementById('editModalValidator').value = "";

        if (document.getElementById('editModalOrphanJustification')) {
            document.getElementById('editModalOrphanJustification').value = "";
            document.getElementById('pmInputContainer').classList.add('hidden');
            document.getElementById('editModalPMNumber').value = "";
        }
    }

    toggleCloseDateReq();
    document.getElementById('editStateModal').classList.remove('hidden');
}

function closeEditModal() {
    document.getElementById('editStateModal').classList.add('hidden');
    currentEditNodo = null;
}

function saveStateChange() {
    const correctedNodo = document.getElementById('editModalCorrectedNodo').value.trim().toUpperCase();

    let newState = "";
    let newMod = "";
    let startDate = "";
    let closeDate = "";
    let mailDate = "";
    let validator = "";

    let orphanJustification = "";
    let justifType = "";
    let pmNumber = "";

    if (!document.getElementById('editModalStateSection').classList.contains('hidden')) {
        newState = document.getElementById('editModalNewState').value;
        newMod = document.getElementById('editModalNewMod').value;
        startDate = document.getElementById('editModalStartDate').value;
        closeDate = document.getElementById('editModalCloseDate').value;
        mailDate = document.getElementById('editModalMailDate').value;
        validator = document.getElementById('editModalValidator').value.trim();
    }

    if (!document.getElementById('editModalJustifySection').classList.contains('hidden')) {
        justifType = document.getElementById('editModalOrphanJustification').value;
        if (justifType === 'PM_CANCELADO') {
            pmNumber = document.getElementById('editModalPMNumber').value.trim();
            if (!pmNumber) {
                showToast("Debe ingresar el número de PM para este motivo de descarte.", "error"); return;
            }
            orphanJustification = `Descartar: Obra sin entrega de material con PM cancelado (PM: ${pmNumber})`;
        } else if (justifType === 'RECIENTE_SIN_PM') {
            orphanJustification = "Descartar: Obra reciente sin PM / Sin entrega de materiales";
        } else if (justifType === 'ANTIGUA') {
            orphanJustification = "Descartar: Obra muy antigua (Posiblemente Consumida/Cancelada)";
        } else if (justifType === 'ANTIGUA_SIN_MAT') {
            orphanJustification = "Descartar: Obra muy antigua sin entrega de materiales";
        } else if (justifType.startsWith('CUSTOM_')) {
            orphanJustification = `Descartar (Manual): ${justifType.substring(7)}`;
        }
    }

    const auditorInput = document.getElementById('auditorName');
    const auditor = auditorInput && auditorInput.value.trim() ? auditorInput.value.trim() : 'Auditor Anónimo';

    const globalAuditDateInput = document.getElementById('globalAuditDate');
    const globalAuditDate = globalAuditDateInput ? globalAuditDateInput.value : new Date().toISOString().split('T')[0];

    const hasCorrection = correctedNodo !== "";
    const hasForceState = newState !== "";
    const hasModChange = newMod !== "";
    const hasJustification = justifType !== "";

    if (!hasCorrection && !hasForceState && !hasModChange && !hasJustification) {
        showToast("Debe corregir el nodo, forzar un estado, cambiar modalidad o justificar.", "error"); return;
    }

    if (hasForceState) {
        if (!startDate || !mailDate || !validator) {
            showToast("Faltan completar campos obligatorios para forzar estado.", "error"); return;
        }
        if (!globalAuditDate) {
            showToast("La Fecha de Corte de Auditoría no está definida.", "error"); return;
        }
        if (newState === "TERMINADO" && !closeDate) {
            showToast("Para forzar a TERMINADO, es obligatorio registrar la Fecha de Cierre Técnico.", "error"); return;
        }
        const dtStart = new Date(startDate);
        const dtAudit = new Date(globalAuditDate);
        if (dtStart > dtAudit) {
            showToast(`Bloqueo: La Fecha de Inicio (${startDate}) es posterior a la Fecha de Corte de Auditoría (${globalAuditDate}).`, "error");
            return;
        }
    }

    // Crear ID Único
    const logId = currentEditNodo + "_" + new Date().getTime();

    Object.values(stateOverrides).forEach(log => {
        if (log.nodo === currentEditNodo && !log.reverted) {
            log.reverted = true;
            log.revertedTimestamp = new Date().toLocaleString('es-AR');
        }
    });

    stateOverrides[logId] = {
        nodo: currentEditNodo, // Identificador original
        correctedNodo: correctedNodo,
        newState: newState,
        newModality: newMod,
        orphanJustification: orphanJustification,
        justifType: justifType,
        pmNumber: pmNumber,
        startDate: startDate,
        closeDate: closeDate,
        mailDate: mailDate,
        validator: validator,
        auditor: auditor,
        timestamp: new Date().toLocaleString('es-AR'),
        reverted: false,
        revertedTimestamp: null
    };

    closeEditModal();
    showToast(`Cambios guardados exitosamente. Recalculando...`, "success");
    // Refresh audit table immediately
    renderAuditTable();
    // Recalculate consolidations after a short delay
    setTimeout(() => procesarConsolidacion(), 300);
}
