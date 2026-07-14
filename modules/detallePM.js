/* ==========================================================================
   Módulo: Detalle PM (modules/detallePM.js)
   Lógica de la pestaña "Detalle de Obras (PM)"
   ========================================================================== */

/* --------------------------------------------------------------------------
   Dependencias Globales Esperadas:
   - dataMateriales (Array): Listado normalizado de materiales de la trx PMOVXF
   - dataConsolidada (Array): Listado final de las obras consolidadas para cruce
   -------------------------------------------------------------------------- */

/**
 * Inicializa la solapa PM: puebla los dropdowns y renderiza la tabla.
 * Se llama la primera vez que el usuario hace clic en la pestaña.
 */
function initDetallePMTab() {
    poblarDropdownsMotivoYEstados();
    renderDetallePMTable();
}

/**
 * Puebla los dropdowns de Motivo de Obra y Estado de Línea
 * con los valores únicos presentes en dataMateriales.
 */
function poblarDropdownsMotivoYEstados() {
    if (!dataMateriales || dataMateriales.length === 0) return;

    const selectMotivo = document.getElementById('pmFilterMotivoSelect');
    const selectEstadoLinea = document.getElementById('pmFilterEstadoLinea');
    const selectEstadoEntrega = document.getElementById('pmFilterEstadoEntrega');

    // Preservar selecciones actuales
    const prevMotivo = selectMotivo.value;
    const prevEstadoLinea = selectEstadoLinea.value;
    const prevEstadoEntrega = selectEstadoEntrega.value;

    // Obtener valores únicos de MOTIVO
    const motivos = [...new Set(
        dataMateriales.map(r => String(r['_N_MOTIVO'] || r['MOTIVO'] || '').trim().toUpperCase())
            .filter(m => m !== '')
    )].sort();

    selectMotivo.innerHTML = '<option value="">-- Todos los Motivos --</option>';
    motivos.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        selectMotivo.appendChild(opt);
    });

    // Obtener valores únicos de ESTADO_DE_LINEA
    const estadosLinea = [...new Set(
        dataMateriales.map(r => String(r['_N_ESTADO_DE_LINEA'] || r['ESTADO_DE_LINEA'] || '').trim().toUpperCase())
            .filter(e => e !== '')
    )].sort();

    selectEstadoLinea.innerHTML = '<option value="">Todos</option>';
    estadosLinea.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e;
        opt.textContent = e;
        selectEstadoLinea.appendChild(opt);
    });

    // Obtener valores únicos de Estado de Entrega (desde Resultados Consolidados)
    const estadosEntrega = [...new Set(
        dataConsolidada.map(r => String(r['Estado de Entregas'] || '').trim())
            .filter(e => e !== '' && e !== '-')
    )].sort();

    selectEstadoEntrega.innerHTML = '<option value="">Todos</option>';
    estadosEntrega.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e;
        opt.textContent = e;
        selectEstadoEntrega.appendChild(opt);
    });

    // Restaurar selecciones previas si siguen siendo válidas
    if (prevMotivo) selectMotivo.value = prevMotivo;
    if (prevEstadoLinea) selectEstadoLinea.value = prevEstadoLinea;
    if (prevEstadoEntrega) selectEstadoEntrega.value = prevEstadoEntrega;
}

/**
 * Limpia todos los filtros de la solapa PM.
 */
function limpiarFiltrosPM() {
    document.getElementById('pmFilterMotivoSelect').value = '';
    document.getElementById('pmFilterMasivo').value = '';
    document.getElementById('pmFilterTexto').value = '';
    document.getElementById('pmFilterEstadoLinea').value = '';
    document.getElementById('pmFilterEstadoEntrega').value = '';
    renderDetallePMTable();
}

/**
 * Parsear texto del filtro masivo: acepta líneas y/o espacios como separadores.
 * Retorna un Set de códigos en mayúsculas.
 */
function parsearCodigosMasivos(texto) {
    if (!texto || texto.trim() === '') return null;
    // Separar por saltos de línea, luego cada línea puede tener múltiples palabras
    const codigos = new Set();
    texto.split('\n').forEach(linea => {
        linea.trim().split(/\s+/).forEach(part => {
            // Reagrupar tokens que forman códigos compuestos (ej "ML056C MTP")
            if (part) codigos.add(part.toUpperCase());
        });
        // También agregar la línea completa normalizada (código compuesto)
        const lineaCompleta = linea.trim().toUpperCase();
        if (lineaCompleta) codigos.add(lineaCompleta);
    });
    return codigos.size > 0 ? codigos : null;
}

/**
 * Renderiza la tabla de Detalle de Obras (PM) aplicando todos los filtros.
 */
function renderDetallePMTable() {
    const tbody = document.getElementById('detallePMTableBody');
    const emptyState = document.getElementById('emptyDetallePMState');
    const countText = document.getElementById('detallePMCountText');

    if (!tbody) return;
    tbody.innerHTML = '';

    // Si no hay datos PM, mostrar estado vacío
    if (!dataMateriales || dataMateriales.length === 0) {
        emptyState.classList.remove('hidden');
        countText.textContent = '0 registros';
        return;
    }

    // Leer filtros
    const fMotivoSelect = document.getElementById('pmFilterMotivoSelect').value.trim().toUpperCase();
    const fMasivoTexto = document.getElementById('pmFilterMasivo').value;
    const fTexto = document.getElementById('pmFilterTexto').value.trim().toLowerCase();
    const fEstadoLinea = document.getElementById('pmFilterEstadoLinea').value.trim().toUpperCase();
    const fEstadoEntrega = document.getElementById('pmFilterEstadoEntrega').value.trim();

    // Parsear códigos masivos
    const codigosMasivos = parsearCodigosMasivos(fMasivoTexto);

    // Construir mapa de Estado de Entregas desde dataConsolidada por Nodo (MOTIVO)
    const mapaEstadoEntrega = {};
    dataConsolidada.forEach(row => {
        const nodo = String(row['Nodo'] || row['NODO'] || '').trim().toUpperCase();
        if (nodo) {
            mapaEstadoEntrega[nodo] = String(row['Estado de Entregas'] || '-').trim();
        }
    });

    // Filtrar registros del PM
    let registros = dataMateriales.filter(row => {
        const motivo = String(row['_N_MOTIVO'] || row['MOTIVO'] || '').trim().toUpperCase();
        const estadoLinea = String(row['_N_ESTADO_DE_LINEA'] || row['ESTADO_DE_LINEA'] || '').trim().toUpperCase();
        const proveedor = String(row['_N_NOMBRE_PROV'] || row['NOMBRE_PROV'] || '').trim().toLowerCase();
        const locDest = String(row['_N_LOCALIZADOR_DESTINO'] || row['LOCALIZADOR_DESTINO'] || '').trim().toLowerCase();
        const articulo = String(row['_N_ARTICULO'] || row['ARTICULO'] || '').trim().toLowerCase();
        const fechaTrx = String(row['_N_FECHA_TRX'] || row['FECHA_TRX'] || '').trim().toLowerCase();

        // Filtro masivo tiene precedencia sobre el dropdown
        if (codigosMasivos && codigosMasivos.size > 0) {
            const motivoTokens = motivo.split(/\s+/);
            const matchExacto = codigosMasivos.has(motivo);
            const matchParcial = motivoTokens.some(t => codigosMasivos.has(t));
            if (!matchExacto && !matchParcial) return false;
        } else if (fMotivoSelect && motivo !== fMotivoSelect) {
            return false;
        }

        // Filtro por Estado de Línea
        if (fEstadoLinea && estadoLinea !== fEstadoLinea) return false;

        // Filtro por Estado de Entrega (vinculado desde consolidado)
        if (fEstadoEntrega) {
            const estEnt = mapaEstadoEntrega[motivo] || '-';
            if (estEnt !== fEstadoEntrega) return false;
        }

        // Filtro de texto general (busca en proveedor, artículo, localizador, fecha)
        if (fTexto) {
            const hayMatch = proveedor.includes(fTexto)
                || locDest.includes(fTexto)
                || articulo.includes(fTexto)
                || fechaTrx.includes(fTexto)
                || motivo.toLowerCase().includes(fTexto)
                || estadoLinea.toLowerCase().includes(fTexto);
            if (!hayMatch) return false;
        }

        return true;
    });

    countText.textContent = `${registros.length} registros`;

    if (registros.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }
    emptyState.classList.add('hidden');

    // Helpers de formato
    const fmtNum = val => {
        const n = parseFloat(String(val || '0').replace(/,/g, '')) || 0;
        return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const fmtFecha = val => {
        if (!val || String(val).trim() === '') return '-';
        if (val instanceof Date) return val.toLocaleDateString('es-AR');
        const s = String(val);
        if (s.match(/^\d{4}-\d{2}-\d{2}T/)) return new Date(s).toLocaleDateString('es-AR');
        return s;
    };

    // Colores para Estado de Línea
    const estadoLineaColor = (est) => {
        const e = (est || '').toUpperCase();
        if (e === 'CANCELADA' || e === 'CANCELADO') return 'bg-rose-100 text-rose-800 border-rose-200';
        if (e === 'CERRADA' || e === 'CERRADO') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
        if (e.includes('PEND') || e.includes('ACTIV')) return 'bg-amber-100 text-amber-800 border-amber-200';
        return 'bg-slate-100 text-slate-700 border-slate-200';
    };

    // Colores para Estado de Entrega
    const estadoEntregaColor = (est) => {
        const e = (est || '').toLowerCase();
        if (e.includes('con entregas y pendientes')) return 'bg-blue-100 text-blue-800 border-blue-200';
        if (e.includes('con entregas')) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
        if (e.includes('sin entregas con pendiente')) return 'bg-orange-100 text-orange-800 border-orange-200';
        if (e.includes('sin registro')) return 'bg-slate-100 text-slate-500 border-slate-200';
        if (e === '-') return 'text-slate-400';
        return 'bg-purple-100 text-purple-700 border-purple-200';
    };

    // Limitar a 1000 filas para performance
    const limite = Math.min(registros.length, 1000);

    for (let i = 0; i < limite; i++) {
        const row = registros[i];
        const motivo = String(row['_N_MOTIVO'] || row['MOTIVO'] || '').trim().toUpperCase();
        const estadoLinea = String(row['_N_ESTADO_DE_LINEA'] || row['ESTADO_DE_LINEA'] || '').trim().toUpperCase();
        const proveedor = String(row['_N_NOMBRE_PROV'] || row['NOMBRE_PROV'] || '').trim();
        const locDest = String(row['_N_LOCALIZADOR_DESTINO'] || row['LOCALIZADOR_DESTINO'] || '').trim();
        const articulo = String(row['_N_ARTICULO'] || row['ARTICULO'] || '').trim();
        const udm = String(row['_N_UDM'] || row['UDM'] || '').trim();
        const ctdPend = row['_N_CTD_PENDIENTE'] !== undefined ? row['_N_CTD_PENDIENTE'] : (row['CTD_PENDIENTE'] || '0');
        const cantSol = row['_N_CANTIDAD_SOLICITADA'] !== undefined ? row['_N_CANTIDAD_SOLICITADA'] : (row['CANTIDAD_SOLICITADA'] || '0');
        const cantEnt = row['_N_CANTIDAD_ENTREGADA'] !== undefined ? row['_N_CANTIDAD_ENTREGADA'] : (row['CANTIDAD_ENTREGADA'] || '0');
        const fechaTrx = row['_N_FECHA_TRX'] !== undefined ? row['_N_FECHA_TRX'] : (row['FECHA_TRX'] || '');

        const estadoEntrega = mapaEstadoEntrega[motivo] || '-';

        const elColor = estadoLineaColor(estadoLinea);
        const eeColor = estadoEntregaColor(estadoEntrega);

        const tr = document.createElement('tr');
        tr.className = 'group border-b border-slate-100 transition-colors hover:bg-teal-50/30';
        tr.innerHTML = `
            <td class="py-1.5 px-3 border-r border-slate-100 text-[10px] text-slate-400 font-mono">${i + 1}</td>
            <td class="py-1.5 px-3 border-r border-slate-200 font-bold text-teal-800 text-xs bg-teal-50/30">${motivo || '-'}</td>
            <td class="py-1.5 px-3 border-r border-slate-100">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold border ${elColor}">${estadoLinea || '-'}</span>
            </td>
            <td class="py-1.5 px-3 border-r border-slate-100 text-xs text-slate-700">${proveedor || '-'}</td>
            <td class="py-1.5 px-3 border-r border-slate-100 text-xs font-mono text-indigo-700">${locDest || '-'}</td>
            <td class="py-1.5 px-3 border-r border-slate-200 text-xs text-slate-800 bg-indigo-50/20 font-medium">${articulo || '-'}</td>
            <td class="py-1.5 px-3 border-r border-slate-100 text-[10px] text-slate-500 text-center">${udm || '-'}</td>
            <td class="py-1.5 px-3 border-r border-slate-100 text-xs text-right font-mono text-slate-700">${fmtNum(ctdPend)}</td>
            <td class="py-1.5 px-3 border-r border-slate-100 text-xs text-right font-mono text-slate-700">${fmtNum(cantSol)}</td>
            <td class="py-1.5 px-3 border-r border-slate-100 text-xs text-right font-mono text-emerald-700 font-semibold">${fmtNum(cantEnt)}</td>
            <td class="py-1.5 px-3 border-r border-slate-100 text-[10px] text-slate-500">${fmtFecha(fechaTrx)}</td>
            <td class="py-1.5 px-3 text-xs">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold border ${eeColor}">${estadoEntrega}</span>
            </td>
        `;
        tbody.appendChild(tr);
    }

    if (registros.length > 1000) {
        tbody.innerHTML += `<tr><td colspan="12" class="py-3 px-3 text-center text-slate-500 text-xs italic bg-slate-50">Mostrando 1000 de ${registros.length}. Aplique filtros para acotar la vista.</td></tr>`;
    }
}
