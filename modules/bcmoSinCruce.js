/* ==========================================================================
   Módulo: BCMO Sin Cruce con Sub-pestañas (modules/bcmoSinCruce.js)
   Lógica de la pestaña "BCMO Sin Cruce en Avance de Obras" con split
   ========================================================================== */

/* --------------------------------------------------------------------------
   Dependencias Globales Esperadas:
   - dataBCMO (Array): Listado inyectado desde BCMO
   - dataConsolidada (Array): Listado final de las obras consolidadas para cruce
   - setTabBadge (Function): Helper para actualizar el contador de la pestaña
   -------------------------------------------------------------------------- */

let activeBcmoSinCruceEstadoFilters = [];
let bcmoSinCruceActiveSubTab = 'principal'; // 'principal' o 'descartadas'
let bcmoSinCruceFilterOnlySuggestions = false; // checkbox "Solo con sugerencia"

function renderBcmoSinCruceTable() {
    if (!dataBCMO || dataBCMO.length === 0) {
        setTabBadge('tabBcmoSinCruceCount', 0);
        document.getElementById('bcmoSinCruceCountText').textContent = '0 obras';
        document.getElementById('bcmoSinCruceTableBody').innerHTML = '';
        document.getElementById('emptyBcmoSinCruceState').classList.remove('hidden');
        return;
    }

    // Construir set de nodos del Avance (para cruce rápido)
    const nodosEnAvance = new Set();
    dataConsolidada.forEach(row => {
        const n = String(row['Nodo'] || row['Nodo Original'] || row['NODO'] || '').trim().toUpperCase();
        if (n) nodosEnAvance.add(n);
    });

    // Filtrar BCMO sin cruce
    let sinCruce = dataBCMO.filter(row => {
        const nodoBCMO = String(row['_N_TAREA_/_OBRA'] || row['_N_TAREA'] || row['_N_OBRA'] || '').trim().toUpperCase();
        return nodoBCMO !== '' && !nodosEnAvance.has(nodoBCMO);
    });

    // ===== CRITERIO PRINCIPAL =====
    // Sub-tab "Principal": SIN CONSUMO AND Entregado > 0
    let principal = sinCruce.filter(row => {
        const est = String(row['_N_ESTADO_DE_LIQUIDACION'] || '').trim().toUpperCase();
        const entregado = parseFloat(row['_N_ENTREGADO'] || 0);
        return est === 'SIN CONSUMO' && entregado > 0;
    });

    // ===== DESCARTADAS =====
    // Sub-tab "Descartadas": Todo lo que NO cumple el criterio principal
    let descartadas = sinCruce.filter(row => {
        const est = String(row['_N_ESTADO_DE_LIQUIDACION'] || '').trim().toUpperCase();
        const entregado = parseFloat(row['_N_ENTREGADO'] || 0);
        // NO cumple el criterio principal
        return !(est === 'SIN CONSUMO' && entregado > 0);
    });

    // Badge count: SOLO los del principal (los realmente accionables)
    setTabBadge('tabBcmoSinCruceCount', principal.length);

    // Seleccionar dataset activo según sub-tab
    let datasetActivo = bcmoSinCruceActiveSubTab === 'principal' ? principal : descartadas;

    const tbody = document.getElementById('bcmoSinCruceTableBody');
    const emptyState = document.getElementById('emptyBcmoSinCruceState');
    const filterText = document.getElementById('hFilterBcmoSinCruce').value.trim().toLowerCase();

    // Aplicar filtro de "Solo con sugerencia" SOLO en la sub-tab principal
    if (bcmoSinCruceActiveSubTab === 'principal' && bcmoSinCruceFilterOnlySuggestions) {
        datasetActivo = datasetActivo.filter(row => {
            const nodoBCMO = String(row['_N_TAREA_/_OBRA'] || row['_N_TAREA'] || row['_N_OBRA'] || '').trim();
            const nodoPrefijo = nodoBCMO.toUpperCase().replace(/\s/g, '').substring(0, 5);
            
            // Nodos para sugerencia: del avance con Estado de Entregas = "Sin registro de materiales a entregar"
            const nodosParaSugerencia = new Set();
            dataConsolidada.forEach(r => {
                if (r['Estado de Entregas'] === 'Sin registro de materiales a entregar') {
                    const n = String(r['Nodo'] || r['Nodo Original'] || r['NODO'] || '').trim().toUpperCase();
                    if (n) nodosParaSugerencia.add(n);
                }
            });
            const nodosAvanceArray = Array.from(nodosParaSugerencia);
            
            const posibles = nodosAvanceArray
                .filter(n => n.replace(/\s/g, '').startsWith(nodoPrefijo) || nodoPrefijo.startsWith(n.replace(/\s/g, '').substring(0, 5)))
                .slice(0, 3);
            
            // Solo mostrar si hay sugerencia (posibles.length > 0)
            return posibles.length > 0;
        });
    }

    // Actualizar UI de sub-tabs
    document.getElementById('bcmoSinCruceTabPrincipal').classList.toggle('active', bcmoSinCruceActiveSubTab === 'principal');
    document.getElementById('bcmoSinCruceTabDescartadas').classList.toggle('active', bcmoSinCruceActiveSubTab === 'descartadas');

    // Mostrar/ocultar checkbox "Solo con sugerencia" según la sub-tab
    const checkboxContainer = document.getElementById('bcmoSinCruceOnlySuggestionsContainer');
    if (checkboxContainer) {
        checkboxContainer.classList.toggle('hidden', bcmoSinCruceActiveSubTab !== 'principal');
    }

    // Badges de estados de liquidación (para la sub-tab activa)
    const countsEstado = {};
    datasetActivo.forEach(row => {
        const e = String(row['_N_ESTADO_DE_LIQUIDACION'] || 'SIN ESTADO').trim().toUpperCase();
        countsEstado[e] = (countsEstado[e] || 0) + 1;
    });

    const badgesContainer = document.getElementById('bcmoSinCruceEstadoBadges');
    badgesContainer.innerHTML = '';
    const allActive = activeBcmoSinCruceEstadoFilters.length === 0;
    const btnAllClass = allActive ? 'bg-amber-600 text-white' : 'bg-white text-slate-600 border border-slate-300';
    badgesContainer.innerHTML += `<button type="button" onclick="activeBcmoSinCruceEstadoFilters=[]; renderBcmoSinCruceTable();" class="px-3 py-1 text-xs rounded font-semibold transition-colors shadow-sm ${btnAllClass}">TODOS</button>`;

    const estadoColorMap = {
        'CONSUMIDO':        { badge: 'bg-emerald-100 border-emerald-300 text-emerald-800' },
        'SIN CONSUMO':      { badge: 'bg-slate-100 border-slate-300 text-slate-600' },
        'VERIFICAR CONSUMO':{ badge: 'bg-amber-100 border-amber-300 text-amber-800' },
        'DEFAULT':          { badge: 'bg-blue-100 border-blue-300 text-blue-800' }
    };

    for (const [estado, cantidad] of Object.entries(countsEstado)) {
        const isActive = activeBcmoSinCruceEstadoFilters.includes(estado);
        const style = estadoColorMap[estado] || estadoColorMap['DEFAULT'];
        const btnClass = isActive ? 'bg-amber-600 text-white shadow-inner' : `bg-white border ${style.badge} hover:bg-amber-50`;
        badgesContainer.innerHTML += `<button type="button" onclick="toggleBcmoSinCruceEstadoFilter('${estado}')" class="px-3 py-1 text-[10px] rounded border font-bold shadow-sm transition-colors ${btnClass}">${estado} (${cantidad})</button>`;
    }

    // Aplicar filtro de badges de estado
    if (activeBcmoSinCruceEstadoFilters.length > 0) {
        datasetActivo = datasetActivo.filter(row => {
            const e = String(row['_N_ESTADO_DE_LIQUIDACION'] || 'SIN ESTADO').trim().toUpperCase();
            return activeBcmoSinCruceEstadoFilters.includes(e);
        });
    }

    // Aplicar búsqueda de texto
    if (filterText) {
        datasetActivo = datasetActivo.filter(row => {
            const nodo = String(row['_N_TAREA_/_OBRA'] || row['_N_TAREA'] || row['_N_OBRA'] || '').toLowerCase();
            const cont = String(row['_N_CONTRATISTA'] || '').toLowerCase();
            const est  = String(row['_N_ESTADO_DE_LIQUIDACION'] || '').toLowerCase();
            return nodo.includes(filterText) || cont.includes(filterText) || est.includes(filterText);
        });
    }

    // Actualizar etiqueta de sub-tab
    const subTabLabel = bcmoSinCruceActiveSubTab === 'principal' 
        ? `${principal.length} obras (accionables)`
        : `${descartadas.length} obras (descartadas)`;
    document.getElementById('bcmoSinCruceCountText').textContent = `${datasetActivo.length} obras mostradas`;
    
    tbody.innerHTML = '';

    if (datasetActivo.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }
    emptyState.classList.add('hidden');

    // Calcular posibles coincidencias
    const nodosParaSugerencia = new Set();
    dataConsolidada.forEach(row => {
        if (row['Estado de Entregas'] === 'Sin registro de materiales a entregar') {
            const n = String(row['Nodo'] || row['Nodo Original'] || row['NODO'] || '').trim().toUpperCase();
            if (n) nodosParaSugerencia.add(n);
        }
    });
    const nodosAvanceArray = Array.from(nodosParaSugerencia);

    datasetActivo.forEach((row, idx) => {
        const nodoBCMO = String(row['_N_TAREA_/_OBRA'] || row['_N_TAREA'] || row['_N_OBRA'] || '').trim();
        const estLiq   = String(row['_N_ESTADO_DE_LIQUIDACION'] || '-').trim().toUpperCase();
        const pctCons  = parseFloat(row['_N_%_CONSUMO'] || 0);
        const contrat  = String(row['_N_CONTRATISTA'] || '-').trim();
        const entregado = parseFloat(row['_N_ENTREGADO'] || 0);

        // Color del estado de liquidación
        let estBadge = '';
        if (estLiq === 'CONSUMIDO') {
            estBadge = 'bg-emerald-100 text-emerald-800 border border-emerald-200';
        } else if (estLiq === 'VERIFICAR CONSUMO') {
            estBadge = 'bg-amber-100 text-amber-800 border border-amber-200';
        } else if (estLiq === 'SIN CONSUMO') {
            estBadge = 'bg-slate-100 text-slate-600 border border-slate-200';
        } else {
            estBadge = 'bg-blue-100 text-blue-800 border border-blue-200';
        }

        // Buscar posible coincidencia
        const nodoPrefijo = nodoBCMO.toUpperCase().replace(/\s/g, '').substring(0, 5);
        const posibles = nodosAvanceArray
            .filter(n => n.replace(/\s/g, '').startsWith(nodoPrefijo) || nodoPrefijo.startsWith(n.replace(/\s/g, '').substring(0, 5)))
            .slice(0, 3);

        const posiblesHtml = posibles.length > 0
            ? posibles.map(p => `<span class="inline-block bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold mr-1">${p}</span>`).join('')
            : `<span class="text-slate-400 text-[10px] italic">Sin similitud encontrada</span>`;

        const pctDisplay = pctCons > 0 ? `${(pctCons * 100).toFixed(1)}%` : '-';
        const entDisplay = entregado > 0 ? entregado.toLocaleString('es-AR') : '-';

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-amber-50/30 transition-colors border-b border-slate-100';
        tr.innerHTML = `
            <td class="p-3 text-xs text-slate-400 border-r border-slate-100 text-center">${idx + 1}</td>
            <td class="p-3 border-r border-slate-100 bg-amber-50/20">
                <span class="font-bold text-amber-900 font-mono text-sm">${nodoBCMO}</span>
            </td>
            <td class="p-3 border-r border-slate-100">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${estBadge}">${estLiq}</span>
            </td>
            <td class="p-3 border-r border-slate-100 text-right">
                <span class="font-mono text-xs font-semibold ${pctCons > 0 ? 'text-emerald-700' : 'text-slate-400'}">${pctDisplay}</span>
            </td>
            <td class="p-3 border-r border-slate-100 text-xs text-slate-700">${contrat}</td>
            <td class="p-3 border-r border-slate-100 text-center">
                <span class="font-mono text-xs ${entregado > 0 ? 'text-emerald-700 font-semibold' : 'text-slate-400'}">${entDisplay}</span>
            </td>
            <td class="p-3 text-left">${posiblesHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

function toggleBcmoSinCruceEstadoFilter(estado) {
    const idx = activeBcmoSinCruceEstadoFilters.indexOf(estado);
    if (idx > -1) activeBcmoSinCruceEstadoFilters.splice(idx, 1);
    else activeBcmoSinCruceEstadoFilters.push(estado);
    renderBcmoSinCruceTable();
}

function switchBcmoSinCruceSubTab(subTab) {
    bcmoSinCruceActiveSubTab = subTab;
    activeBcmoSinCruceEstadoFilters = []; // Reset filters when switching tabs
    renderBcmoSinCruceTable();
}

function toggleBcmoSinCruceOnlySuggestions() {
    bcmoSinCruceFilterOnlySuggestions = !bcmoSinCruceFilterOnlySuggestions;
    renderBcmoSinCruceTable();
}
