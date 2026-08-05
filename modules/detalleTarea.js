/* ==========================================================================
   Módulo: Dashboard BF / Detalle Tareas (modules/detalleTarea.js)
   Se alimenta de window.dataTarea (cargado en Etapa 1 y consolidado al
   presionar "Procesar y Consolidar"). No requiere carga de archivo propia.
   ========================================================================== */

// Memoria en vivo de la última tabla filtrada (para exportar y para el modal)
let dtDatosFiltrados = [];

function formatStatsObj(statsObj) {
    if (!statsObj || Object.keys(statsObj).length === 0) return {};
    return statsObj;
}

// Clasifica el Resultado Final en una de las categorías de badge visual
function clasificarResultadoFinal(resultado) {
    const r = String(resultado || '').toUpperCase();
    if (r === 'FINALIZADA CON CONSUMO TOTAL') return 'status-finalizado-total';
    if (r.includes('PARCIAL')) return 'status-finalizado-parcial';
    if (r.includes('SIN CONSUMO') || r.includes('CANCELAD')) return 'status-sinconsumo';
    if (r.includes('CURSO') || r.includes('EJECU')) return 'status-encurso';
    return 'status-otro';
}

/* --------------------------------------------------------------------------
   Poblar los selectores de Estado y Contratista con valores únicos
   -------------------------------------------------------------------------- */
function poblarFiltrosDetalleTareas(datos) {
    const selEstado = document.getElementById('dtFiltroEstado');
    const selContratista = document.getElementById('dtFiltroContratista');
    if (!selEstado || !selContratista) return;

    const estadoActual = selEstado.value;
    const contratistaActual = selContratista.value;

    const estados = Array.from(new Set(datos.map(i => i._N_RESULTADO_FINAL).filter(Boolean))).sort();
    const contratistas = Array.from(new Set(datos.map(i => i.Contratista).filter(Boolean))).sort();

    selEstado.innerHTML = '<option value="">-- Todos --</option>' +
        estados.map(e => `<option value="${e}">${e}</option>`).join('');
    selContratista.innerHTML = '<option value="">-- Todos --</option>' +
        contratistas.map(c => `<option value="${c}">${c}</option>`).join('');

    // Mantener la selección previa si sigue siendo válida
    if (estados.includes(estadoActual)) selEstado.value = estadoActual;
    if (contratistas.includes(contratistaActual)) selContratista.value = contratistaActual;
}

function limpiarFiltrosDetalleTareas() {
    const obraInput = document.getElementById('dtFiltroObra');
    const estadoSel = document.getElementById('dtFiltroEstado');
    const contratistaSel = document.getElementById('dtFiltroContratista');
    if (obraInput) obraInput.value = '';
    if (estadoSel) estadoSel.value = '';
    if (contratistaSel) contratistaSel.value = '';
    renderDetalleTareasTable();
}

/* --------------------------------------------------------------------------
   Render principal: aplica filtros, actualiza el resumen y pinta la tabla
   -------------------------------------------------------------------------- */
function renderDetalleTareasTable() {
    const tbody = document.getElementById('detalleTareasTableBody');
    const emptyState = document.getElementById('emptyDetalleTareasState');
    if (!tbody) return;

    const datosBase = window.dataTarea || [];

    // Poblar los selects solo si todavía no tienen opciones cargadas (evita resetear la selección en cada tecla)
    const selEstado = document.getElementById('dtFiltroEstado');
    if (selEstado && selEstado.options.length <= 1) poblarFiltrosDetalleTareas(datosBase);

    const filtroObra = (document.getElementById('dtFiltroObra')?.value || '').trim().toUpperCase();
    const filtroEstado = document.getElementById('dtFiltroEstado')?.value || '';
    const filtroContratista = document.getElementById('dtFiltroContratista')?.value || '';

    dtDatosFiltrados = datosBase.filter(item => {
        if (filtroObra && !String(item._N_OBRA_BF || '').toUpperCase().includes(filtroObra)) return false;
        if (filtroEstado && item._N_RESULTADO_FINAL !== filtroEstado) return false;
        if (filtroContratista && item.Contratista !== filtroContratista) return false;
        return true;
    });

    // --- Resumen Consumo (Filtrado) ---
    let totalConsumoTotal = 0, totalConsumoParcial = 0, totalOtros = 0, totalTickets = 0, totalCerrados = 0;
    dtDatosFiltrados.forEach(item => {
        const r = String(item._N_RESULTADO_FINAL || '').toUpperCase();
        if (r === 'FINALIZADA CON CONSUMO TOTAL') totalConsumoTotal++;
        else if (r.includes('PARCIAL')) totalConsumoParcial++;
        else totalOtros++;
        totalTickets += Number(item.totalTickets) || 0;
        totalCerrados += Number(item._N_CERRADOS) || 0;
    });

    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setText('dtResumenTotal', dtDatosFiltrados.length);
    setText('dtResumenTotalConsumo', totalConsumoTotal);
    setText('dtResumenParcialConsumo', totalConsumoParcial);
    setText('dtResumenOtros', totalOtros);
    setText('dtResumenTickets', totalTickets);
    setText('dtResumenCerrados', totalCerrados);

    // --- Tabla ---
    if (dtDatosFiltrados.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    tbody.innerHTML = dtDatosFiltrados.map((item, idx) => {
        const statsTarea = formatStatsObj(item.statsTarea);
        const statsObra = formatStatsObj(item.statsObra);
        const pillsTarea = Object.entries(statsTarea).map(([k, v]) => `<span class="pill">${k} <span class="pill-count">${v}</span></span>`).join(' ') || '<span class="text-slate-400 text-xs">-</span>';
        const pillsObra = Object.entries(statsObra).map(([k, v]) => `<span class="pill">${k} <span class="pill-count">${v}</span></span>`).join(' ') || '<span class="text-slate-400 text-xs">-</span>';
        const resultadoClass = clasificarResultadoFinal(item._N_RESULTADO_FINAL);

        return `
            <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100" onclick="openDetalleTareaModal(${idx})">
                <td class="p-3 text-sm font-mono text-indigo-700 bg-indigo-50/20 font-bold border-r border-slate-100">${item._N_OBRA_BF || '-'}</td>
                <td class="p-3 text-sm text-slate-700 border-r border-slate-100">${item.Contratista || 'S/D'}</td>
                <td class="p-3 text-xs text-slate-600 border-r border-slate-100"><div class="flex flex-wrap gap-1">${pillsTarea}</div></td>
                <td class="p-3 text-xs text-slate-600 border-r border-slate-100"><div class="flex flex-wrap gap-1">${pillsObra}</div></td>
                <td class="p-3 text-sm text-center text-slate-600 border-r border-slate-100 font-semibold">${item.totalTickets || 0}</td>
                <td class="p-3 text-sm text-center text-emerald-700 font-bold border-r border-slate-100 bg-emerald-50/10">${item._N_CERRADOS || 0}</td>
                <td class="p-3 text-xs text-center"><span class="pill ${resultadoClass}">${item._N_RESULTADO_FINAL || '-'}</span></td>
            </tr>
        `;
    }).join('');
}

/* --------------------------------------------------------------------------
   Modal de Detalle: se abre al hacer clic en una fila de la tabla
   -------------------------------------------------------------------------- */
function openDetalleTareaModal(idx) {
    const item = dtDatosFiltrados[idx];
    if (!item) return;

    document.getElementById('detailModalObraBF').textContent = item._N_OBRA_BF || '-';
    document.getElementById('detailModalContratista').textContent = item.Contratista || 'S/D';
    document.getElementById('detailModalTotalTickets').textContent = item.totalTickets || 0;
    document.getElementById('detailModalCerrados').textContent = item._N_CERRADOS || 0;

    const resultadoEl = document.getElementById('detailModalResultado');
    resultadoEl.textContent = item._N_RESULTADO_FINAL || '-';
    resultadoEl.className = 'pill text-sm ' + clasificarResultadoFinal(item._N_RESULTADO_FINAL);

    const statsTarea = formatStatsObj(item.statsTarea);
    const statsObra = formatStatsObj(item.statsObra);
    const contTarea = document.getElementById('detailModalStatsTarea');
    const contObra = document.getElementById('detailModalStatsObra');
    contTarea.innerHTML = Object.entries(statsTarea).map(([k, v]) => `<span class="pill">${k} <span class="pill-count">${v}</span></span>`).join('') || '<span class="text-slate-400 text-xs">Sin datos</span>';
    contObra.innerHTML = Object.entries(statsObra).map(([k, v]) => `<span class="pill">${k} <span class="pill-count">${v}</span></span>`).join('') || '<span class="text-slate-400 text-xs">Sin datos</span>';

    document.getElementById('detailModal').classList.remove('hidden');
}

function closeDetalleTareaModal() {
    document.getElementById('detailModal').classList.add('hidden');
}

/* --------------------------------------------------------------------------
   Exportar (respeta los filtros aplicados en pantalla)
   -------------------------------------------------------------------------- */
function exportarDetalleTareas() {
    const datos = (dtDatosFiltrados && dtDatosFiltrados.length > 0) ? dtDatosFiltrados : (window.dataTarea || []);
    if (!datos || datos.length === 0) {
        showToast("No hay datos de Tareas para exportar.", "error");
        return;
    }

    function formatStats(statsObj) {
        if (!statsObj || Object.keys(statsObj).length === 0) return '-';
        return Object.entries(statsObj)
            .map(([key, val]) => `${key} (${val})`)
            .join(' | ');
    }

    const data = datos.map(item => ({
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
