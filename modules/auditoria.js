/* ==========================================================================
   Módulo: Auditoría y Trazabilidad (modules/auditoria.js)
   Lógica de la tabla de Auditoría y Panel de Detalles
   ========================================================================== */

/* --------------------------------------------------------------------------
   Dependencias Globales Esperadas:
   - stateOverrides, stateColorMap (Objects)
   - filteredConsolidada (Array)
   - showToast, procesarConsolidacion (Functions)
   -------------------------------------------------------------------------- */

function renderAuditTable() {
    const tbody = document.getElementById('auditTableBody');
    const emptyState = document.getElementById('emptyAuditState');
    tbody.innerHTML = '';

    const logs = Object.values(stateOverrides);
    if (logs.length === 0) {
        emptyState.classList.remove('hidden'); return;
    }
    emptyState.classList.add('hidden');

    logs.sort((a, b) => new Date(b.timestamp.replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$2-$1')) - new Date(a.timestamp.replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$2-$1')));

    logs.forEach(log => {
        const tr = document.createElement('tr');
        const isRev = log.reverted;
        tr.className = `transition-colors border-b border-slate-100 ${isRev ? 'bg-slate-50 opacity-70' : 'bg-white hover:bg-slate-50'}`;

        const statusBadge = isRev
            ? `<span class="bg-rose-100 text-rose-800 text-[10px] px-2 py-0.5 rounded font-bold border border-rose-200">REVERTIDO</span>`
            : `<span class="bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 rounded font-bold border border-emerald-200">ACTIVO</span>`;

        tr.innerHTML = `
            <td class="p-3 text-center border-r border-slate-100">${statusBadge}</td>
            <td class="p-3 text-xs font-bold text-slate-800 border-r border-slate-100 ${isRev ? 'line-through text-slate-500' : ''}">${log.nodo}</td>
            <td class="p-3 text-xs font-bold text-indigo-700 border-r border-slate-100 ${isRev ? 'line-through text-slate-400' : ''}">
                ${(log.changes && log.changes.length > 0) ? `
                <div class="flex flex-col gap-1">
                    ${log.changes.map(c => `
                        <div class="text-[11px] leading-tight">
                            <span class="font-bold text-slate-600">${c.campo}:</span>
                            <span class="text-slate-400 line-through">${c.anterior}</span>
                            <i class="fa-solid fa-arrow-right-long text-[9px] text-slate-400 mx-1"></i>
                            <span class="text-indigo-700 font-bold">${c.nuevo}</span>
                        </div>
                    `).join('')}
                </div>
                ` : `
                ${log.correctedNodo ? `<div><i class="fa-solid fa-spell-check text-[10px] mr-1"></i>Renombrado a: ${log.correctedNodo}</div>` : ''}
                ${log.newState ? `<div><i class="fa-solid fa-pen-nib text-[10px] mr-1"></i>Forzado a: ${log.newState}</div>` : ''}
                ${log.newModality ? `<div><i class="fa-solid fa-tag text-[10px] mr-1"></i>Mod. a: ${log.newModality}</div>` : ''}
                ${log.orphanJustification ? `<div><i class="fa-solid fa-shield-halved text-[10px] mr-1 text-slate-500"></i>Justificado: ${log.orphanJustification}</div>` : ''}
                `}
            </td>
            <td class="p-3 text-xs text-slate-600 border-r border-slate-100">
                ${log.newState ? `
                <div class="flex flex-col gap-0.5">
                    <span title="Inicio"><i class="fa-solid fa-play text-emerald-500 w-3"></i> ${log.startDate}</span>
                    <span title="Cierre"><i class="fa-solid fa-flag-checkered text-slate-400 w-3"></i> ${log.closeDate || '-'}</span>
                </div>` : '-'}
            </td>
            <td class="p-3 text-xs text-slate-600 border-r border-slate-100">
                ${log.newState ? `
                <div class="flex flex-col gap-0.5">
                    <span title="Mail"><i class="fa-regular fa-envelope text-blue-400 w-3"></i> ${log.mailDate}</span>
                    <span title="Autorizó"><i class="fa-solid fa-signature text-slate-400 w-3"></i> ${log.validator}</span>
                </div>` : '-'}
            </td>
            <td class="p-3 text-xs text-slate-600 border-r border-slate-100">${log.auditor}</td>
            <td class="p-3 text-[10px] text-slate-400 font-mono">
                <div>${log.timestamp}</div>
                ${isRev ? `<div class="text-rose-500 mt-1">Rev: ${log.revertedTimestamp}</div>` : ''}
            </td>
            <td class="p-3 text-center">
                ${!isRev ? `
                    <button type="button" onclick="removeOverride('${log.nodo}')" class="text-rose-500 hover:text-white bg-rose-50 hover:bg-rose-500 border border-rose-200 px-3 py-1.5 rounded text-[10px] font-bold uppercase transition-colors shadow-sm">
                        Revertir
                    </button>
                ` : '-'}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function removeOverride(nodo) {
    if (confirm(`¿Desea revertir las correcciones manuales de la obra ${nodo}? El registro de reversión quedará guardado inmutablemente en el historial.`)) {
        Object.values(stateOverrides).forEach(log => {
            if (log.nodo === nodo && !log.reverted) {
                log.reverted = true;
                log.revertedTimestamp = new Date().toLocaleString('es-AR');
            }
        });
        persistStateOverrides();
        renderAuditTable();
        showToast("Cambios revertidos. Recalculando sistema...", "info");
        setTimeout(() => procesarConsolidacion(), 300);
    }
}

// --- DETALLES ---
function showDetails(fIdx) {
    const row = filteredConsolidada[fIdx];
    document.getElementById('detModalTitle').textContent = row['Nodo'] || row['NODO'];
    document.getElementById('detModalSubtitle').textContent = row['Estado de Avance (Calculado)'];
    const tbody = document.getElementById('detModalTableBody');
    tbody.innerHTML = '';

    const categories = {
        'Auditoría y Lógica': ['Obra BF', 'Estado (Original Excel)', 'Estado (Motor)', 'Estado de Avance (Calculado)', 'Obra a considerar', 'Acción Sugerida / Observación', '_AUDIT_'],
        'Tracking de Obra': Object.keys(row).filter(k => k.startsWith('BCMO') || k.startsWith('TAREA')),
        'Datos Origen (Avance)': Object.keys(row).filter(k => !k.startsWith('BCMO') && !k.startsWith('TAREA') && !k.startsWith('_') && !['Obra BF', 'Estado (Motor)', 'Estado (Original Excel)', 'Estado de Avance (Calculado)', 'Obra a considerar', 'Acción Sugerida / Observación', 'Nodo Original'].includes(k))
    };

    const styleMap = stateColorMap[row['Estado de Avance (Calculado)']] || stateColorMap['DEFAULT'];

    for (const [catName, fields] of Object.entries(categories)) {
        let hasData = false;
        let htmlTemp = `<tr><td colspan="2" class="px-6 py-2 bg-slate-100 text-[10px] font-bold text-slate-600 uppercase tracking-widest border-y border-slate-200 shadow-inner">${catName}</td></tr>`;

        fields.forEach(field => {
            let val = row[field];
            if (val !== undefined && val !== '') {
                hasData = true;
                if (field.includes('Fecha') && val) {
                    if (val instanceof Date) val = val.toLocaleDateString('es-AR');
                    else if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}T/)) val = new Date(val).toLocaleDateString('es-AR');
                }
                if (field.includes('%') && typeof val === 'number') val = (val * 100).toFixed(2) + '%';

                let valClass = "text-slate-800";
                if (field === 'Estado de Avance (Calculado)') valClass = `${styleMap.text}`;
                if (field === 'Acción Sugerida / Observación' && (String(val).includes('reclamar') || String(val).includes('corregir'))) valClass = "text-red-700 font-bold";
                if (field === 'Estado (Motor)' && row['_MODIFICADO_ESTADO_']) valClass = "text-indigo-600 font-bold";

                htmlTemp += `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="px-6 py-2.5 text-xs font-medium text-slate-500 w-1/3 border-b border-slate-100 align-top">${field.replace('_AUDIT_', 'Parámetro Clave')}</td>
                        <td class="px-6 py-2.5 text-sm ${valClass} border-b border-slate-100 align-top break-words">${val}</td>
                    </tr>
                `;
            }
        });
        if (hasData) tbody.innerHTML += htmlTemp;
    }

    document.getElementById('detailsModal').classList.remove('hidden');
    requestAnimationFrame(() => {
        document.getElementById('detailsModalContent').classList.remove('translate-x-full');
        document.getElementById('detailsModalContent').classList.add('translate-x-0');
    });
}

function closeDetailsModal() {
    document.getElementById('detailsModalContent').classList.remove('translate-x-0');
    document.getElementById('detailsModalContent').classList.add('translate-x-full');
    setTimeout(() => document.getElementById('detailsModal').classList.add('hidden'), 300);
}
