/* ==========================================================================
   Módulo: Validación Contratista (modules/analisisObras.js)
   Lógica de la pestaña "Validación Contratista"
   ==========================================================================

   Dependencias Globales Esperadas:
   - dataConsolidada (Array): Listado final de obras consolidadas (Etapa 2)
   - dataBCMO (Array): Listado inyectado desde el módulo BCMO (Etapa 1)
   - setTabBadge (Function): Helper para actualizar el contador de la pestaña
   - showToast (Function): Helper de notificaciones
   -------------------------------------------------------------------------- */

// Memoria en vivo de la tabla de Validación Contratista (se recalcula en cada render)
let validacionContratistaData = [];

/* --------------------------------------------------------------------------
   1) FILTRADO Y ARMADO DE LA TABLA
   -------------------------------------------------------------------------- */
function getNomenclaturasInvalidas() {
    // Misma fuente que usa Etapa 1 para "Nomenclatura Inválida", para no duplicar configuración
    try {
        const saved = localStorage.getItem('invalidNomenclatures');
        if (saved) {
            return saved.split('\n').map(n => n.trim().toUpperCase()).filter(n => n);
        }
    } catch (e) {
        console.error('No se pudo leer la lista de nomenclaturas inválidas:', e);
    }
    // Fallback: mismos valores por defecto que Etapa 1
    return ["PM-ETIQUETASTAPCAISA", "ETIQUETAS-CAISA", "STOCK PASAR A CONSUMIDO"];
}

function renderValidacionContratistaTable() {
    validacionContratistaData = [];

    const nomenclaturasInvalidas = getNomenclaturasInvalidas();

    // --- Set de nodos presentes en el Avance, para saber qué BCMO "no cruzó" ---
    const nodosEnAvance = new Set();
    (dataConsolidada || []).forEach(row => {
        const n = String(row['Nodo'] || row['Nodo Original'] || row['NODO'] || '').trim().toUpperCase();
        if (n) nodosEnAvance.add(n);
    });

    // --- a) Obras del Consolidado (Etapa 2) con Estado de Avance (Calculado) = "A EJECUTAR" ---
    (dataConsolidada || []).forEach(row => {
        const estado = String(row['Estado de Avance (Calculado)'] || '').trim().toUpperCase();
        if (estado !== 'A EJECUTAR') return;

        const rawInicio = row['Fecha Inicio'] || row['FECHA INICIO'] || row['Inicio'] || row['INICIO'] || row['_N_FECHA_INICIO'] || row['_N_FECHA_DE_INICIO'];
        const fInicio = rawInicio ? (rawInicio instanceof Date ? rawInicio.toISOString().split('T')[0] : String(rawInicio).trim()) : '';

        const rawCierre = row['Fecha Cierre Tecnico'] || row['FECHA CIERRE TECNICO'] || row['Fecha Cierre Técnico'] || row['Cierre Técnico'] || row['CIERRE TÉCNICO'] || row['Fin'] || row['_N_FECHA_CIERRE_TECNICO'] || row['_N_FECHA_CIERRE_TECNICO_'];
        const fCierre = rawCierre ? (rawCierre instanceof Date ? rawCierre.toISOString().split('T')[0] : String(rawCierre).trim()) : '';

        const rawAvance = row['% Avance'] || row['% AVANCE'] || row['%_Avance'] || row['Porcentaje de Avance'] || row['PORCENTAJE AVANCE'] || row['Avance'] || row['AVANCE'] || row['_N_%_AVANCE'] || row['_N_AVANCE'];
        const pctAvance = (rawAvance !== undefined && rawAvance !== null && rawAvance !== '') ? rawAvance : 0;

        const nodoKey = String(row['Nodo'] || row['Nodo Original'] || row['NODO'] || '').trim().toUpperCase();
        const obraBFKey = String(row['Obra BF'] || '').trim().toUpperCase();
        const matchBCMO = (dataBCMO || []).find(b => {
            const bKey = String(b['_N_TAREA_/_OBRA'] || '').trim().toUpperCase();
            return bKey === nodoKey || bKey === obraBFKey;
        });
        const entregado = matchBCMO ? parseFloat(matchBCMO['_N_ENTREGADO']) || 0 : 0;

        validacionContratistaData.push({
            Nodo: row['Nodo'] || row['Nodo Original'] || row['NODO'] || '-',
            ObraBF: row['Obra BF'] || '-',
            Contratista: row['BCMO - Contratista'] || row['Contratista'] || '-',
            Modalidad: row['Modalidad de Liquidación Calculada'] || '-',
            Origen: 'Avance',
            Estado: row['Estado de Avance (Calculado)'] || '-',
            FechaInicio: fInicio,
            FechaCierre: fCierre,
            PctAvance: pctAvance,
            EstadoContratista: '',
            Entregado: entregado
        });
    });

    // --- b) Obras del BCMO (Etapa 1) sin cruce en Avance, con Entregado > 0, Consumido == 0,
    //        y que NO estén excluidas por nomenclatura inválida de Etapa 1 ni por regla de Localizador ---
    (dataBCMO || []).forEach(row => {
        const nodoBCMO = String(row['_N_TAREA_/_OBRA'] || '').trim();
        const nodoBCMOUpper = nodoBCMO.toUpperCase();
        if (!nodoBCMOUpper) return;

        // Debe NO cruzar con el Avance
        if (nodosEnAvance.has(nodoBCMOUpper)) return;

        // Exclusión explícita por nomenclatura inválida (ej: "GARANTIAS")
        if (nomenclaturasInvalidas.includes(nodoBCMOUpper)) return;

        // NUEVA REGLA DE EXCLUSIÓN: Localizador Cod termina en .3001, .4001, o .1015
        const locCod = String(row['_N_LOCALIZADOR_COD'] || '').trim();
        if (locCod.endsWith('.3001') || locCod.endsWith('.4001') || locCod.endsWith('.1015')) return;

        const entregado = parseFloat(row['_N_ENTREGADO']) || 0;
        const pctConsumo = parseFloat(row['_N_%_CONSUMO']) || 0;

        if (!(entregado > 0)) return;
        if (pctConsumo !== 0) return;

        validacionContratistaData.push({
            Nodo: nodoBCMO,
            ObraBF: '-',
            Contratista: row['_N_CONTRATISTA'] || '-',
            Modalidad: '-',
            Origen: 'BCMO',
            Estado: row['_N_ESTADO_DE_LIQUIDACION'] || '-',
            FechaInicio: '',
            FechaCierre: '',
            PctAvance: '',
            EstadoContratista: '',
            Entregado: entregado
        });
    });

    // --- Autocompletar Contratista y Cantidad de Obras con Limpieza ---
    const cleanNames = [];
    validacionContratistaData.forEach(r => {
        const cVal = String(r.Contratista || '').trim();
        if (cVal && cVal !== '-') {
            cVal.split(',').forEach(part => {
                const subParts = part.split('-');
                let cleanPart = subParts[0].trim();
                cleanPart = cleanPart.replace(/\bsobrante\b/gi, '').trim();
                cleanPart = cleanPart.replace(/\s+/g, ' ');

                if (cleanPart && cleanPart.toUpperCase() !== 'SIN CONTRATISTA') {
                    if (!cleanNames.some(n => n.toUpperCase() === cleanPart.toUpperCase())) {
                        cleanNames.push(cleanPart);
                    }
                }
            });
        }
    });

    const contratistaAuto = cleanNames.join(', ');

    const inputContratista = document.getElementById('vcContratista');
    const inputCantidad = document.getElementById('vcCantidadObras');
    if (inputContratista) inputContratista.value = contratistaAuto;
    if (inputCantidad) inputCantidad.value = validacionContratistaData.length;

    // --- Render de tabla visual ---
    renderTableBodyOnly();
}

function renderTableBodyOnly() {
    const tbody = document.getElementById('validacionContratistaTableBody');
    const emptyState = document.getElementById('emptyValidacionContratistaState');
    const countText = document.getElementById('validacionContratistaCountText');
    const filterInput = document.getElementById('vcFilterNodo');
    const filterVal = filterInput ? filterInput.value.trim().toUpperCase() : '';
    const filterOrigenInput = document.getElementById('vcFilterOrigen');
    const filterOrigen = filterOrigenInput ? filterOrigenInput.value.toUpperCase() : 'AVANCE';

    const filtered = validacionContratistaData.filter(item => {
        const matchNodo = !filterVal || String(item.Nodo).toUpperCase().includes(filterVal);
        let matchOrigen = true;
        if (filterOrigen === 'AVANCE') {
            matchOrigen = item.Origen === 'Avance';
        } else if (filterOrigen === 'BCMO') {
            matchOrigen = item.Origen === 'BCMO';
        }
        return matchNodo && matchOrigen;
    });

    if (countText) countText.textContent = `${filtered.length} obras`;
    setTabBadge('tabValidacionContratistaCount', filtered.length);

    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    tbody.innerHTML = filtered.map((item, idx) => {
        const origenBadge = item.Origen === 'BCMO'
            ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">BCMO</span>'
            : '<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">Avance</span>';

        const entregaMateriales = (item.Entregado && item.Entregado > 0) ? 'SÍ' : 'NO';

        return `
            <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100">
                <td class="py-2 px-3 border-r border-slate-200 text-slate-400 text-xs">${idx + 1}</td>
                <td class="py-2 px-3 border-r border-slate-200 font-mono text-[11px] font-bold text-indigo-700 bg-indigo-50/20">${item.Nodo}</td>
                <td class="py-2 px-3 border-r border-slate-200 font-mono text-[10px] text-slate-600">${item.ObraBF}</td>
                <td class="py-2 px-3 border-r border-slate-200 text-xs text-slate-700">${item.Estado}</td>
                <td class="py-2 px-3 border-r border-slate-200 text-xs text-slate-700">${item.FechaInicio}</td>
                <td class="py-2 px-3 border-r border-slate-200 text-xs text-slate-700">${item.FechaCierre}</td>
                <td class="py-2 px-3 border-r border-slate-200 text-xs text-slate-700">${item.Modalidad}</td>
                <td class="py-2 px-3 border-r border-slate-200 text-right text-xs text-slate-700">${item.PctAvance}${typeof item.PctAvance === 'number' ? '%' : ''}</td>
                <td class="py-2 px-3 border-r border-slate-200 text-xs text-slate-700 font-semibold text-center">${entregaMateriales}</td>
                <td class="py-2 px-3 border-r border-slate-200 text-center">${origenBadge}</td>
                <td class="py-2 px-3 text-xs text-slate-700"></td>
            </tr>
        `;
    }).join('');
}

// Event listener function called on input change for VC Filter
function filterValidacionContratistaTable() {
    renderTableBodyOnly();
}

/* --------------------------------------------------------------------------
   2) BOTÓN "Descargar Tabla" — Excel simple con los datos de la grilla
   -------------------------------------------------------------------------- */
function descargarTablaValidacionContratista() {
    if (!validacionContratistaData || validacionContratistaData.length === 0) {
        showToast("No hay datos para descargar.", "error");
        return;
    }

    const contratista = (document.getElementById('vcContratista').value || 'Sin Contratista').trim();
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const filterInput = document.getElementById('vcFilterNodo');
    const filterVal = filterInput ? filterInput.value.trim().toUpperCase() : '';
    const filterOrigenInput = document.getElementById('vcFilterOrigen');
    const filterOrigen = filterOrigenInput ? filterOrigenInput.value.toUpperCase() : 'AVANCE';

    const filtered = validacionContratistaData.filter(item => {
        const matchNodo = !filterVal || String(item.Nodo).toUpperCase().includes(filterVal);
        let matchOrigen = true;
        if (filterOrigen === 'AVANCE') {
            matchOrigen = item.Origen === 'Avance';
        } else if (filterOrigen === 'BCMO') {
            matchOrigen = item.Origen === 'BCMO';
        }
        return matchNodo && matchOrigen;
    });

    const rows = filtered.map((item, idx) => ({
        "#": idx + 1,
        "Nodo": item.Nodo,
        "Obra BF": item.ObraBF,
        "Estado de Avance (Calculado)": item.Estado,
        "Fecha Inicio": item.FechaInicio,
        "Fecha Cierre Técnico": item.FechaCierre,
        "Modalidad de Liquidación": item.Modalidad,
        "% Avance": item.PctAvance,
        "Entrega de materiales": (item.Entregado && item.Entregado > 0) ? "SÍ" : "NO",
        "Origen": item.Origen,
        "Estado de Avance (CONTRATISTA)": ""
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Validación Contratista");

    const cleanContratista = contratista.replace(/[\/\\:\*\?"<>\|]/g, '_');
    const fileName = `Listado de Obra - ${dateStr} - ${cleanContratista}.xlsx`;

    XLSX.writeFile(wb, fileName);
    showToast("Tabla descargada correctamente.", "success");
}

/* --------------------------------------------------------------------------
   3) BOTÓN "Enviar por Mail" — valida fechas, genera Excel complejo con
      metadatos + encabezados + datos, y abre el cliente de correo (mailto:)
   -------------------------------------------------------------------------- */
function enviarPorMailValidacionContratista() {
    if (!validacionContratistaData || validacionContratistaData.length === 0) {
        showToast("No hay datos para enviar.", "error");
        return;
    }

    const contratista = (document.getElementById('vcContratista').value || 'Sin Contratista').trim();
    const fechaInventario = document.getElementById('vcFechaInventario').value;
    const fechaBalanceObras = document.getElementById('vcFechaBalanceObras').value;
    const fechaAvanceOperaciones = document.getElementById('vcFechaAvanceOperaciones').value;

    // --- Validación de las 3 fechas manuales ---
    if (!fechaInventario || !fechaBalanceObras || !fechaAvanceOperaciones) {
        alert("Debe completar las 3 fechas (Inventario, Balance de Obras y Reporte de Avance) antes de enviar.");
        return;
    }

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const filterInput = document.getElementById('vcFilterNodo');
    const filterVal = filterInput ? filterInput.value.trim().toUpperCase() : '';
    const filterOrigenInput = document.getElementById('vcFilterOrigen');
    const filterOrigen = filterOrigenInput ? filterOrigenInput.value.toUpperCase() : 'AVANCE';

    const filtered = validacionContratistaData.filter(item => {
        const matchNodo = !filterVal || String(item.Nodo).toUpperCase().includes(filterVal);
        let matchOrigen = true;
        if (filterOrigen === 'AVANCE') {
            matchOrigen = item.Origen === 'Avance';
        } else if (filterOrigen === 'BCMO') {
            matchOrigen = item.Origen === 'BCMO';
        }
        return matchNodo && matchOrigen;
    });

    const cantidadObras = filtered.length;

    // --- Construcción del Excel complejo: metadatos + encabezados + datos ---
    const headers = [
        "#",
        "Nodo",
        "Obra BF",
        "Estado de Avance (Calculado)",
        "Fecha Inicio",
        "Fecha Cierre Técnico",
        "Modalidad de Liquidación",
        "% Avance",
        "Entrega de materiales",
        "Origen",
        "Estado de Avance (CONTRATISTA)"
    ];

    const aoa = [
        ["Contratista:", contratista],
        ["Fecha de Inventario:", fechaInventario],
        ["Fecha del Balance de Obras (ORACLE):", fechaBalanceObras],
        ["Fecha del Reporte de Avance (OPERACIONES):", fechaAvanceOperaciones],
        ["Cantidad de Obras:", cantidadObras],
        [], // fila en blanco de separación
        headers
    ];

    filtered.forEach((item, idx) => {
        const entregaMateriales = (item.Entregado && item.Entregado > 0) ? "SÍ" : "NO";
        aoa.push([
            idx + 1,
            item.Nodo,
            item.ObraBF,
            item.Estado,
            item.FechaInicio,
            item.FechaCierre,
            item.Modalidad,
            item.PctAvance,
            entregaMateriales,
            item.Origen,
            "" // Estado de Avance (CONTRATISTA) — queda en blanco para que lo complete el contratista
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Validación Contratista");

    const cleanContratista = contratista.replace(/[\/\\:\*\?"<>\|]/g, '_');
    const fileName = `Listado de Obra - ${dateStr} - ${cleanContratista}.xlsx`;
    XLSX.writeFile(wb, fileName);
    showToast("Excel generado. Abriendo cliente de correo...", "success");

    // --- Generación del mailto: dinámico ---
    const asunto = `URGENTE: Validación urgente de estados de obras - ${contratista}`;
    const cuerpo = "Estimados,\n\n" +
        "Adjuntamos el listado de obras con los estados de avance informados por la Gerencia de Obras, a fin de que evalúen si existen inconsistencias respecto del estado real de cada una.\n\n" +
        "Les recordamos que toda obra con estado A EJECUTAR que haya recibido entrega de materiales debe contar con el 100 % de los materiales disponibles en el depósito. \n\n" +
        "Solicitamos de manera urgente:\n" +
        "1. Validar el estado real de cada obra incluida en el listado.\n" +
        "2. Identificar cualquier inconsistencia entre el estado informado y la situación real. \n" +
        "3. Coordinar a la brevedad con el Gerente de Obras la actualización de los estados correspondientes.\n\n" +
        "Agradecemos que estas validaciones sean realizadas a la mayor brevedad, ya que la información es necesaria para asegurar la correcta gestión y control de los materiales. \n\n" +
        "Saludos cordiales.";

    const mailtoLink = `mailto:?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;

    // Pequeño delay para asegurar que la descarga del Excel se dispare antes de abrir el cliente de correo
    setTimeout(() => {
        window.location.href = mailtoLink;
    }, 300);
}