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

function renderCaducidadTable() {
    const tbody = document.getElementById('caducidadTableBody');
    const emptyState = document.getElementById('emptyCaducidadState');

    if (!dataConsolidada || dataConsolidada.length === 0) {
        setTabBadge('tabCaducidadCount', 0);
        document.getElementById('caducidadCountText').textContent = '0 obras';
        if (tbody) tbody.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    const hoy = new Date();
    const limiteCaducidad = new Date();
    limiteCaducidad.setFullYear(hoy.getFullYear() - 4);

    let caducadas = dataConsolidada.filter(row => {
        // 1. Obra a considerar no es "-" ni vacío, ni nulo. Y no está ya FINALIZADO manualmente si es el caso (opcional)
        const obraAConsiderar = String(row['Obra a considerar'] || '').trim().toUpperCase();
        if (obraAConsiderar === '' || obraAConsiderar === '-') return false;
        
        // No mostrar si el estado calculado ya es FINALIZADO
        const estadoCalc = String(row['Estado de Avance (Calculado)'] || '').trim().toUpperCase();
        if (estadoCalc === 'FINALIZADO') return false;

        // 2 & 3. Fecha Cierre Tecnico > 4 años
        let cDateRaw = row['Fecha Cierre Tecnico'] || row['FECHA CIERRE TECNICO'] || row['Fecha Cierre Técnico'] || row['Cierre Técnico'] || row['CIERRE TÉCNICO'] || row['Fin'];
        if (!cDateRaw || String(cDateRaw).trim() === '') return false;

        let cDate;
        if (cDateRaw instanceof Date) {
            cDate = cDateRaw;
        } else {
            let parts = String(cDateRaw).split('/');
            if (parts.length === 3) cDate = new Date(parts[2], parts[1] - 1, parts[0]);
            else cDate = new Date(cDateRaw);
        }

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
    document.getElementById('caducidadCountText').textContent = `${caducadas.length} obras`;

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
        const fCierreFormat = row['_DATE_OBJ_CIERRE'].toLocaleDateString('es-AR');
        const diffTime = Math.abs(hoy - row['_DATE_OBJ_CIERRE']);
        const diffYears = (diffTime / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);
        
        const estado = row['Estado de Avance (Calculado)'] || '-';
        const contratista = row['BCMO - Contratista'] || '-';
        
        const fInicio = row['Fecha Inicio'] || row['FECHA INICIO'] || row['Inicio'] || row['INICIO'] || '';
        let fInicioStr = '';
        if (fInicio instanceof Date) fInicioStr = fInicio.toISOString().split('T')[0];
        else if (typeof fInicio === 'string' && fInicio.match(/^\d{4}-\d{2}-\d{2}T/)) fInicioStr = new Date(fInicio).toISOString().split('T')[0];
        else fInicioStr = String(fInicio);

        let fCierreStr = row['_DATE_OBJ_CIERRE'].toISOString().split('T')[0];

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

    // Revertir posibles modificaciones anteriores sobre el mismo nodo
    Object.values(stateOverrides).forEach(log => {
        if (log.nodo === nodoOriginal && !log.reverted) {
            log.reverted = true;
            log.revertedTimestamp = new Date().toLocaleString('es-AR');
        }
    });

    stateOverrides[logId] = {
        nodo: nodoOriginal,
        correctedNodo: "",
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
