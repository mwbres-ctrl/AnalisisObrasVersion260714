/* ==========================================================================
   Módulo: Detalle Tareas (modules/detalleTarea.js)
   ========================================================================== */

function renderDetalleTareasTable() {
    const tbody = document.getElementById('detalleTareasTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!window.dataTarea || window.dataTarea.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400 italic">No hay datos de Tareas cargados en el sistema.</td></tr>`;
        return;
    }

    function formatStats(statsObj) {
        if (!statsObj || Object.keys(statsObj).length === 0) return '-';
        return Object.entries(statsObj)
            .map(([key, val]) => `${key} (${val})`)
            .join(' | ');
    }

    window.dataTarea.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors border-b border-slate-100";
        tr.innerHTML = `
            <td class="p-3 text-sm font-mono text-indigo-700 bg-indigo-50/20 font-bold border-r border-slate-100">${item._N_OBRA_BF || '-'}</td>
            <td class="p-3 text-sm text-slate-700 border-r border-slate-100">${item.Contratista || 'S/D'}</td>
            <td class="p-3 text-xs text-slate-600 border-r border-slate-100">${formatStats(item.statsTarea)}</td>
            <td class="p-3 text-xs text-slate-600 border-r border-slate-100">${formatStats(item.statsObra)}</td>
            <td class="p-3 text-sm text-center text-slate-600 border-r border-slate-100 font-semibold">${item.totalTickets || 0}</td>
            <td class="p-3 text-sm text-center text-emerald-700 font-bold border-r border-slate-100 bg-emerald-50/10">${item._N_CERRADOS || 0}</td>
            <td class="p-3 text-xs text-slate-700 font-bold text-center ${item._N_RESULTADO_FINAL === 'FINALIZADA CON CONSUMO TOTAL' ? 'text-emerald-700 bg-emerald-50' : item._N_RESULTADO_FINAL.includes('PARCIAL') ? 'text-amber-700 bg-amber-50' : 'text-indigo-700 bg-indigo-50'}">${item._N_RESULTADO_FINAL || '-'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function exportarDetalleTareas() {
    if (!window.dataTarea || window.dataTarea.length === 0) {
        showToast("No hay datos de Tareas para exportar.", "error");
        return;
    }

    function formatStats(statsObj) {
        if (!statsObj || Object.keys(statsObj).length === 0) return '-';
        return Object.entries(statsObj)
            .map(([key, val]) => `${key} (${val})`)
            .join(' | ');
    }

    const data = window.dataTarea.map(item => ({
        "Obra BF": item._N_OBRA_BF || '',
        "Contratista": item.Contratista || 'S/D',
        "Detalle Tkt (Con Consumo)": formatStats(item.statsTarea),
        "Detalle Obra BF": formatStats(item.statsObra),
        "Tkt Material": item.totalTickets || 0,
        "Cerrados": item._N_CERRADOS || 0,
        "Resultado Final": item._N_RESULTADO_FINAL || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Detalle Tareas");
    XLSX.writeFile(wb, "Analisis_BF_Tickets.xlsx");
    showToast("Reporte de Tareas exportado con éxito.", "success");
}
