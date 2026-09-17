/* ==========================================================================
   Módulo: Gestor de Caducidad (modules/caducidad.js)
   ========================================================================== */

/* --------------------------------------------------------------------------
   Dependencias Globales Esperadas:
   - dataConsolidada (Array)
   - stateOverrides (Object)
   - setTabBadge (Function)
   - showToast (Function)
   - procesarConsolidacion (Function)
   -------------------------------------------------------------------------- */

function parseCaducidadDate(raw) {
    if (!raw) return null;
    if (raw instanceof Date) {
        return isNaN(raw.getTime()) ? null : raw;
    }
    if (typeof raw === 'number') {
        if (isNaN(raw) || raw <= 0) return null;
        if (raw > 1000 && raw < 100000) {
            const utcMs = Math.round((raw - 25569) * 86400 * 1000);
            const dUtc = new Date(utcMs);
            return new Date(dUtc.getUTCFullYear(), dUtc.getUTCMonth(), dUtc.getUTCDate());
        }
        return null;
    }
    const str = String(raw).trim();
    if (!str) return null;

    if (/^\d{4,6}(\.\d+)?$/.test(str)) {
        const num = parseFloat(str);
        if (num > 1000 && num < 100000) {
            const utcMs = Math.round((num - 25569) * 86400 * 1000);
            const dUtc = new Date(utcMs);
            return new Date(dUtc.getUTCFullYear(), dUtc.getUTCMonth(), dUtc.getUTCDate());
        }
    }

    const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (dmyMatch) {
        let day = parseInt(dmyMatch[1], 10);
        let month = parseInt(dmyMatch[2], 10) - 1;
        let year = parseInt(dmyMatch[3], 10);
        if (year < 100) year += 2000;
        const d = new Date(year, month, day);
        return isNaN(d.getTime()) ? null : d;
    }

    const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (ymdMatch) {
        let year = parseInt(ymdMatch[1], 10);
        let month = parseInt(ymdMatch[2], 10) - 1;
        let day = parseInt(ymdMatch[3], 10);
        const d = new Date(year, month, day);
        return isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(str);
    if (isNaN(d.getTime()) || d.getFullYear() < 1980) return null;
    return d;
}

function formatISODateLocal(d) {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatDisplayDateLocal(d) {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '-';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

function renderCaducidadTable() {
    const tbody = document.getElementById('caducidadTableBody');
    const emptyState = document.getElementById('emptyCaducidadState');

    if (!dataConsolidada || dataConsolidada.length === 0) {
        setTabBadge('tabCaducidadCount', 0);
        const countText = document.getElementById('caducidadCountText');
        if (countText) countText.textContent = '0 obras';
        if (tbody) tbody.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    const hoy = new Date();
    const limiteCaducidad = new Date();
    limiteCaducidad.setFullYear(hoy.getFullYear() - 4);
    limiteCaducidad.setHours(23, 59, 59, 999);

    let caducadas = dataConsolidada.filter(row => {
        // 1. Obra a considerar no es "-" ni vacío, ni nulo.
        const obraAConsiderar = String(row['Obra a considerar'] || '').trim().toUpperCase();
        if (obraAConsiderar === '' || obraAConsiderar === '-') return false;
        
        // No mostrar si el estado calculado ya es FINALIZADO
        const estadoCalc = String(row['Estado de Avance (Calculado)'] || '').trim().toUpperCase();
        if (estadoCalc === 'FINALIZADO') return false;

        // 2 & 3. Fecha Cierre Tecnico > 4 años
        let cDateRaw = row['Fecha Cierre Tecnico'] || row['FECHA CIERRE TECNICO'] || row['Fecha Cierre Técnico'] || row['Cierre Técnico'] || row['CIERRE TÉCNICO'] || row['Fin'] || row['_N_FECHA_CIERRE_TECNICO'] || row['_N_FECHA_CIERRE_TECNICO_'];
        if (!cDateRaw || String(cDateRaw).trim() === '') return false;

        let cDate = parseCaducidadDate(cDateRaw);

        if (cDate && !isNaN(cDate.getTime())) {
            if (cDate <= limiteCaducidad) {
                row['_DATE_OBJ_CIERRE'] = cDate; // Guardamos para reuso y ordenamiento
                return true;
            }
        }
        return false;
    });

    // Ordenar por más antiguas primero
    caducadas.sort((a, b) => a['_DATE_OBJ_CIERRE'] - b['_DATE_OBJ_CIERRE']);

    setTabBadge('tabCaducidadCount', caducadas.length);
    const countText = document.getElementById('caducidadCountText');
    if (countText) countText.textContent = `${caducadas.length} obras`;

    if (tbody) tbody.innerHTML = '';

    if (caducadas.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    caducadas.forEach((row, idx) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-rose-50/30 transition-colors border-b border-slate-100';

        const nodoOriginal = row['Nodo Original'] || row['Nodo'] || row['NODO'];
        const obraBf = row['Obra BF'] || '-';
        const fCierreFormat = formatDisplayDateLocal(row['_DATE_OBJ_CIERRE']);
        const diffTime = Math.abs(hoy - row['_DATE_OBJ_CIERRE']);
        const diffYears = (diffTime / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);
        
        const estado = row['Estado de Avance (Calculado)'] || '-';
        const contratista = row['BCMO - Contratista'] || '-';
        
        const fInicio = row['Fecha Inicio'] || row['FECHA INICIO'] || row['Inicio'] || row['INICIO'] || row['_N_FECHA_INICIO'] || '';
        const fInicioObj = parseCaducidadDate(fInicio);
        const fInicioStr = fInicioObj ? formatISODateLocal(fInicioObj) : '';
        const fCierreStr = formatISODateLocal(row['_DATE_OBJ_CIERRE']);

        tr.innerHTML = `
            <td class="p-3 text-xs text-slate-400 border-r border-slate-100 text-center">${idx + 1}</td>
            <td class="p-3 border-r border-slate-100 bg-rose-50/20">
                <span class="font-bold text-rose-900 font-mono text-sm">${nodoOriginal}</span>
            </td>
            <td class="p-3 text-xs font-mono text-indigo-700 border-r border-slate-100">${obraBf}</td>
            <td class="p-3 text-xs font-bold text-slate-700 border-r border-slate-100 text-center">${fCierreFormat}</td>
            <td class="p-3 text-xs text-rose-700 font-bold border-r border-slate-100 text-center">${diffYears} años</td>
            <td class="p-3 text-xs text-slate-600 border-r border-slate-100">${estado}</td>
            <td class="p-3 text-xs text-slate-700 border-r border-slate-100">${contratista}</td>
            <td class="p-3 text-center">
                <button type="button" onclick="aplicarCaducidad('${nodoOriginal}', '${fInicioStr}', '${fCierreStr}')" 
                        class="bg-rose-100 hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-200 px-4 py-1.5 rounded text-xs font-bold transition-colors shadow-sm">
                    <i class="fa-solid fa-lock mr-1"></i> Forzar FINALIZADO
                </button>
            </td>
        `;
        if (tbody) tbody.appendChild(tr);
    });
}

function aplicarCaducidad(nodoOriginal, fechaInicio, fechaCierre) {
    if (!confirm(`¿Forzar estado FINALIZADO para el nodo ${nodoOriginal} por caducidad de plazos?`)) return;

    const auditorInput = document.getElementById('auditorName');
    const auditor = auditorInput && auditorInput.value.trim() ? auditorInput.value.trim() : 'Sistema (Caducidad)';

    const globalAuditDateInput = document.getElementById('globalAuditDate');
    const globalAuditDate = globalAuditDateInput ? globalAuditDateInput.value : new Date().toISOString().split('T')[0];

    const logId = nodoOriginal + "_" + new Date().getTime();

    // Capturar el Nodo corregido del override activo ANTES de revertirlo, para no perder
    // esa corrección al forzar FINALIZADO. Si no había corrección previa, queda vacío (comportamiento igual al anterior).
    let correctedNodoPrevio = "";
    Object.values(stateOverrides).forEach(log => {
        if (log.nodo === nodoOriginal && !log.reverted && log.correctedNodo) {
            correctedNodoPrevio = log.correctedNodo;
        }
    });

    // Revertir posibles modificaciones anteriores sobre el mismo nodo
    Object.values(stateOverrides).forEach(log => {
        if (log.nodo === nodoOriginal && !log.reverted) {
            log.reverted = true;
            log.revertedTimestamp = new Date().toLocaleString('es-AR');
        }
    });

    stateOverrides[logId] = {
        nodo: nodoOriginal,
        correctedNodo: correctedNodoPrevio,
        newState: "FINALIZADO",
        newModality: "",
        orphanJustification: "",
        justifType: "",
        pmNumber: "",
        startDate: fechaInicio,
        closeDate: fechaCierre,
        mailDate: globalAuditDate, // Usamos la fecha de corte como validación
        validator: "Cierre por Caducidad (>4 años)",
        auditor: auditor,
        timestamp: new Date().toLocaleString('es-AR'),
        reverted: false,
        revertedTimestamp: null
    };

    showToast(`Obra ${nodoOriginal} enviada a FINALIZADO por caducidad (> 4 años).`, "success");
    setTimeout(() => procesarConsolidacion(), 300);
}
