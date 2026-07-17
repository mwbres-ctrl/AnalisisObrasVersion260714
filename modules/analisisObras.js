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

        validacionContratistaData.push({
            Nodo: row['Nodo'] || row['Nodo Original'] || row['NODO'] || '-',
            ObraBF: row['Obra BF'] || '-',
            Contratista: row['BCMO - Contratista'] || row['Contratista'] || '-',
            Modalidad: row['Modalidad de Liquidación Calculada'] || '-',
            Origen: 'Avance (A Ejecutar)',
            Estado: row['Estado de Avance (Calculado)'] || '-',
            Entregado: '-',
            ConsumoBCMO: (row['BCMO - % Consumo'] !== undefined && row['BCMO - % Consumo'] !== '') ? row['BCMO - % Consumo'] : '-'
        });
    });

    // --- b) Obras del BCMO (Etapa 1) sin cruce en Avance, con Entregado > 0, Consumido == 0,
    //        y que NO estén excluidas por nomenclatura inválida de Etapa 1 ---
    (dataBCMO || []).forEach(row => {
        const nodoBCMO = String(row['_N_TAREA_/_OBRA'] || '').trim();
        const nodoBCMOUpper = nodoBCMO.toUpperCase();
        if (!nodoBCMOUpper) return;

        // Debe NO cruzar con el Avance
        if (nodosEnAvance.has(nodoBCMOUpper)) return;

        // Exclusión explícita por nomenclatura inválida (ej: "GARANTIAS"), misma regla que Etapa 1
        if (nomenclaturasInvalidas.includes(nodoBCMOUpper)) return;

        const entregado = parseFloat(row['_N_ENTREGADO']) || 0;
        const pctConsumo = parseFloat(row['_N_%_CONSUMO']) || 0;

        if (!(entregado > 0)) return;
        if (pctConsumo !== 0) return;

        validacionContratistaData.push({
            Nodo: nodoBCMO,
            ObraBF: '-',
            Contratista: row['_N_CONTRATISTA'] || '-',
            Modalidad: '-',
            Origen: 'BCMO Sin Cruce',
            Estado: row['_N_ESTADO_DE_LIQUIDACION'] || '-',
            Entregado: entregado,
            ConsumoBCMO: pctConsumo
        });
    });

    // --- Autocompletar Contratista y Cantidad de Obras ---
    const contratistasUnicos = Array.from(new Set(
        validacionContratistaData
            .map(r => String(r.Contratista || '').trim())
            .filter(c => c && c !== '-')
    ));

    let contratistaAuto = '';
    if (contratistasUnicos.length === 1) {
        contratistaAuto = contratistasUnicos[0];
    } else if (contratistasUnicos.length > 1) {
        contratistaAuto = contratistasUnicos.join(', ');
    }

    const inputContratista = document.getElementById('vcContratista');
    const inputCantidad = document.getElementById('vcCantidadObras');
    if (inputContratista) inputContratista.value = contratistaAuto;
    if (inputCantidad) inputCantidad.value = validacionContratistaData.length;

    // --- Render de tabla ---
    const tbody = document.getElementById('validacionContratistaTableBody');
    const emptyState = document.getElementById('emptyValidacionContratistaState');
    const countText = document.getElementById('validacionContratistaCountText');

    if (countText) countText.textContent = `${validacionContratistaData.length} obras`;
    setTabBadge('tabValidacionContratistaCount', validacionContratistaData.length);

    if (!tbody) return;

    if (validacionContratistaData.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    tbody.innerHTML = validacionContratistaData.map((item, idx) => {
        const origenBadge = item.Origen === 'BCMO Sin Cruce'
            ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">BCMO Sin Cruce</span>'
            : '<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">Avance (A Ejecutar)</span>';

        return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="py-2 px-3 border-r border-slate-200 text-slate-400 text-xs">${idx + 1}</td>
                <td class="py-2 px-3 border-r border-slate-200 font-mono text-[11px] font-bold text-indigo-700 bg-indigo-50/20">${item.Nodo}</td>
                <td class="py-2 px-3 border-r border-slate-200 font-mono text-[10px] text-slate-600">${item.ObraBF}</td>
                <td class="py-2 px-3 border-r border-slate-200 text-xs text-slate-700">${item.Contratista}</td>
                <td class="py-2 px-3 border-r border-slate-200 text-xs text-slate-700">${item.Modalidad}</td>
                <td class="py-2 px-3 border-r border-slate-200 text-center">${origenBadge}</td>
                <td class="py-2 px-3 border-r border-slate-200 text-xs font-semibold text-slate-700">${item.Estado}</td>
                <td class="py-2 px-3 border-r border-slate-200 text-right text-xs text-slate-700">${item.Entregado}</td>
                <td class="py-2 px-3 text-right text-xs text-slate-700">${item.ConsumoBCMO}${item.ConsumoBCMO !== '-' ? '%' : ''}</td>
            </tr>
        `;
    }).join('');
}

/* --------------------------------------------------------------------------
   2) BOTÓN "Descargar Tabla" — Excel simple con los datos de la grilla
   -------------------------------------------------------------------------- */
function descargarTablaValidacionContratista() {
    if (!validacionContratistaData || validacionContratistaData.length === 0) {
        showToast("No hay datos para descargar.", "error");
        return;
    }

    const rows = validacionContratistaData.map(item => ({
        "Nodo": item.Nodo,
        "Obra BF": item.ObraBF,
        "Contratista": item.Contratista,
        "Modalidad": item.Modalidad,
        "Origen": item.Origen,
        "Estado": item.Estado,
        "Entregado": item.Entregado,
        "% Consumo (BCMO)": item.ConsumoBCMO
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Validación Contratista");
    XLSX.writeFile(wb, `Validacion_Contratista_${new Date().getTime()}.xlsx`);
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
    const cantidadObras = validacionContratistaData.length;

    // --- Validación de las 3 fechas manuales ---
    if (!fechaInventario || !fechaBalanceObras || !fechaAvanceOperaciones) {
        alert("Debe completar las 3 fechas (Inventario, Balance de Obras y Reporte de Avance) antes de enviar.");
        return;
    }

    // --- Construcción del Excel complejo: metadatos + encabezados + datos ---
    const headers = ["Nodo", "Obra BF", "Contratista", "Modalidad", "Origen", "Estado", "Entregado", "% Consumo (BCMO)", "Estado de Avance (CONTRATISTA)"];

    const aoa = [
        ["Contratista:", contratista],
        ["Fecha de Inventario:", fechaInventario],
        ["Fecha del Balance de Obras (ORACLE):", fechaBalanceObras],
        ["Fecha del Reporte de Avance (OPERACIONES):", fechaAvanceOperaciones],
        ["Cantidad de Obras:", cantidadObras],
        [], // fila en blanco de separación
        headers
    ];

    validacionContratistaData.forEach(item => {
        aoa.push([
            item.Nodo,
            item.ObraBF,
            item.Contratista,
            item.Modalidad,
            item.Origen,
            item.Estado,
            item.Entregado,
            item.ConsumoBCMO,
            "" // Estado de Avance (CONTRATISTA) — queda en blanco para que lo complete el contratista
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Validación Contratista");

    const fileName = `Validacion_Contratista_${contratista.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().getTime()}.xlsx`;
    XLSX.writeFile(wb, fileName);
    showToast("Excel generado. Abriendo cliente de correo...", "success");

    // --- Generación del mailto: dinámico ---
    const asunto = `URGENTE: Validación de Inconsistencias en Avance de Obras vs Materiales - ${contratista}`;
    const cuerpo = "Estimados,\n\n" +
        "Adjuntamos el listado de obras que presentan posibles inconsistencias entre el estado informado en el Avance de Obras y los movimientos de materiales registrados.\n\n" +
        "Les recordamos que toda obra cuyo estado sea 'A EJECUTAR' debe contar con el 100% de los materiales disponibles en el depósito, sin presentar consumos.\n\n" +
        "Solicitamos de manera urgente:\n" +
        "1. Validar el estado real de cada obra listada.\n" +
        "2. Identificar las posibles inconsistencias en la información.\n" +
        "3. Coordinar a la brevedad con el Gerente de Obras la actualización de los estados correspondientes.\n\n" +
        "Saludos cordiales.";

    const mailtoLink = `mailto:?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;

    // Pequeño delay para asegurar que la descarga del Excel se dispare antes de abrir el cliente de correo
    setTimeout(() => {
        window.location.href = mailtoLink;
    }, 300);
}
