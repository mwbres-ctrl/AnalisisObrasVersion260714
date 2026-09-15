/* ==========================================================================
   Módulo: BCMO Sin Cruce (modules/bcmoSinCruce.js)
   Lógica de la pestaña "BCMO Sin Cruce en Avance de Obras"
   ========================================================================== */

/* --------------------------------------------------------------------------
   Dependencias Globales Esperadas:
   - dataBCMO (Array): Listado inyectado desde s1_processedData (Etapa 1)
   - dataConsolidada (Array): Listado final de obras consolidadas para cruce
   - setTabBadge (Function): Helper para actualizar el contador de la pestaña
   -------------------------------------------------------------------------- */

// ── Estado de overrides: obras marcadas manualmente como "No Consumida" ──────
if (!window.bcmoSinCruceOverrides) {
    window.bcmoSinCruceOverrides = new Set();
}

/**
 * Alterna el override "No Consumida" para una obra del BCMO Sin Cruce.
 * @param {string} nodoBCMO - Identificador de la obra/nodo del BCMO
 */
function toggleBcmoSinCruceOverride(nodoBCMO) {
    if (window.bcmoSinCruceOverrides.has(nodoBCMO)) {
        window.bcmoSinCruceOverrides.delete(nodoBCMO);
    } else {
        window.bcmoSinCruceOverrides.add(nodoBCMO);
    }
    renderBcmoSinCruceTable();
}

function renderBcmoSinCruceTable() {
    if (!dataBCMO || dataBCMO.length === 0) {
        setTabBadge('tabBcmoSinCruceCount', 0);
        document.getElementById('bcmoSinCruceCountText').textContent = '0 obras';
        document.getElementById('bcmoSinCruceTableBody').innerHTML = '';
        document.getElementById('emptyBcmoSinCruceState').classList.remove('hidden');
        return;
    }

    // ── 1. Construir set de nodos presentes en el Avance (cruce rápido) ──────
    const nodosEnAvance = new Set();
    dataConsolidada.forEach(row => {
        const n = String(row['Nodo'] || row['Nodo Original'] || row['NODO'] || '').trim().toUpperCase();
        if (n) nodosEnAvance.add(n);
    });

    // ── 2. Filtrar: obras BCMO que NO cruzaron con el Avance ─────────────────
    let sinCruce = dataBCMO.filter(row => {
        const nodoBCMO = String(row['_N_TAREA_/_OBRA'] || row['_N_TAREA'] || row['_N_OBRA'] || '').trim().toUpperCase();
        return nodoBCMO !== '' && !nodosEnAvance.has(nodoBCMO);
    });

    // ── 3. FILTRO FIJO: solo estado SIN CONSUMO ──────────────────────────────
    sinCruce = sinCruce.filter(row => {
        const est = String(row['_N_ESTADO_DE_LIQUIDACION'] || '').trim().toUpperCase();
        return est === 'SIN CONSUMO';
    });

    // ── 4. FILTRO FIJO: solo obras con materiales entregados (Entregado > 0) ─
    sinCruce = sinCruce.filter(row => {
        return parseFloat(row['_N_ENTREGADO'] || 0) > 0;
    });

    // ── 5. Calcular posibles coincidencias por similitud de prefijo ──────────
    //    Se busca en todos los nodos del Avance (no solo "Sin registro")
    const nodosAvanceArray = Array.from(nodosEnAvance);

    function getPosibles(nodoBCMO) {
        const prefijo = nodoBCMO.toUpperCase().replace(/\s/g, '').substring(0, 5);
        return nodosAvanceArray
            .filter(n => {
                const np = n.replace(/\s/g, '');
                return np.startsWith(prefijo) || prefijo.startsWith(np.substring(0, 5));
            })
            .slice(0, 3);
    }

    // ── 6. Actualizar badge de pestaña con el total (pre-filtros opcionales) ─
    setTabBadge('tabBcmoSinCruceCount', sinCruce.length);

    // ── 7. FILTRO OPCIONAL: solo mostrar con similitud (checkbox) ────────────
    const soloSimilitud = document.getElementById('bcmoSinCruceSoloSugerencia')
        ? document.getElementById('bcmoSinCruceSoloSugerencia').checked
        : false;

    if (soloSimilitud) {
        sinCruce = sinCruce.filter(row => {
            const nodo = String(row['_N_TAREA_/_OBRA'] || row['_N_TAREA'] || row['_N_OBRA'] || '').trim();
            return getPosibles(nodo).length > 0;
        });
    }

    // ── 8. FILTRO OPCIONAL: búsqueda de texto libre ──────────────────────────
    const filterInput = document.getElementById('hFilterBcmoSinCruce');
    const filterText = filterInput ? filterInput.value.trim().toLowerCase() : '';

    if (filterText) {
        sinCruce = sinCruce.filter(row => {
            const nodo = String(row['_N_TAREA_/_OBRA'] || row['_N_TAREA'] || row['_N_OBRA'] || '').toLowerCase();
            const cont = String(row['_N_CONTRATISTA'] || '').toLowerCase();
            return nodo.includes(filterText) || cont.includes(filterText);
        });
    }

    // ── 9. Actualizar contador de resultados ─────────────────────────────────
    document.getElementById('bcmoSinCruceCountText').textContent = `${sinCruce.length} obras`;

    const tbody = document.getElementById('bcmoSinCruceTableBody');
    const emptyState = document.getElementById('emptyBcmoSinCruceState');
    tbody.innerHTML = '';

    if (sinCruce.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }
    emptyState.classList.add('hidden');

    // ── 10. Renderizar filas ─────────────────────────────────────────────────
    sinCruce.forEach((row, idx) => {
        const nodoBCMO   = String(row['_N_TAREA_/_OBRA'] || row['_N_TAREA'] || row['_N_OBRA'] || '').trim();
        const contrat    = String(row['_N_CONTRATISTA'] || '-').trim();
        const entregado  = parseFloat(row['_N_ENTREGADO'] || 0);
        const pctCons    = parseFloat(row['_N_%_CONSUMO'] || 0);

        const posibles     = getPosibles(nodoBCMO);
        const tieneSimilitud = posibles.length > 0;

        const posiblesHtml = tieneSimilitud
            ? posibles.map(p =>
                `<span class="inline-block bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold mr-1">${p}</span>`
              ).join('')
            : `<span class="text-slate-400 text-[10px] italic">Sin similitud encontrada</span>`;

        const entDisplay = entregado.toLocaleString('es-AR');
        const pctDisplay = pctCons > 0 ? `${(pctCons * 100).toFixed(1)}%` : '-';

        // Indicador de similitud en fila
        const similitudIcon = tieneSimilitud
            ? `<span class="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded"><i class="fa-solid fa-link text-[9px]"></i>Posible match</span>`
            : '';

        const tr = document.createElement('tr');
        tr.className = `hover:bg-amber-50/40 transition-colors border-b border-slate-100 ${tieneSimilitud ? 'bg-indigo-50/10' : ''}`;
        tr.innerHTML = `
            <td class="p-3 text-xs text-slate-400 border-r border-slate-100 text-center">${idx + 1}</td>
            <td class="p-3 border-r border-slate-100 bg-amber-50/20">
                <div class="flex flex-col gap-1">
                    <span class="font-bold text-amber-900 font-mono text-sm">${nodoBCMO}</span>
                    ${similitudIcon}
                </div>
            </td>
            <td class="p-3 border-r border-slate-100 text-xs text-slate-700">${contrat}</td>
            <td class="p-3 border-r border-slate-100 text-center">
                <span class="font-mono text-xs font-semibold text-emerald-700">${entDisplay}</span>
            </td>
            <td class="p-3 border-r border-slate-100 text-right">
                <span class="font-mono text-xs font-semibold ${pctCons > 0 ? 'text-emerald-700' : 'text-slate-400'}">${pctDisplay}</span>
            </td>
            <td class="p-3 text-left">${posiblesHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}
