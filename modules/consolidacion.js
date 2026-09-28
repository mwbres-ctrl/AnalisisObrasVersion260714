/* ==========================================================================
   Módulo: Consolidación, Vista Previa y Exportación (modules/consolidacion.js)
   Motor de cruce, renderizado de tabla principal, filtros y exportación Excel
   ========================================================================== */

/* --------------------------------------------------------------------------
   Dependencias Globales Esperadas:
   - dataAvance, dataAvanceCorporativo, dataBCMO, dataTarea, dataMateriales
   - dataConsolidada, filteredConsolidada, headersAvance
   - stateOverrides, fileUploadDates
   - activeStateFilters = [];
   - activeModalityFilters = [];
   - activeObraConsiderarFilters = [];
   - activeSectorFilters = [];
   - stateColorMap, corporativoEstadoMapping
   - showToast, showLoadingOverlay, hideLoadingOverlay, fadeSwapSection
   - evaluateExcelFormula, getActiveOverride, updateStepper, setTabBadge
   - renderAuditTable, renderOrphansTable, renderBcmoSinCruceTable,
     renderCaducidadTable, renderRecatTable
   - openEditModal, showDetails (de orphans.js / auditoria.js)
   -------------------------------------------------------------------------- */

// --- POST-PROCESO: Etiquetado de Obras Reversionadas (E0, E1, E2...) ---
/**
 * Agrupa las filas de dataConsolidada por "nodo raíz" (sin el sufijo de versión EX)
 * y aplica el etiquetado correcto sobre el campo "Obra a considerar" según:
 *
 *   CASO A: La versión más nueva tiene "A EJECUTAR"
 *     → nueva versión: texto estándar + " - Versión X"
 *     → versiones viejas con entregas: ídem con su número
 *     → versiones viejas sin entregas: sin cambio
 *
 *   CASO B: La versión más nueva tiene "EN EJECUCIÓN" o "TERMINADO/CT"
 *     → TODAS las versiones reciben el texto de la versión nueva + " - Versión X"
 *
 * Solo actúa sobre grupos con 2 o más versiones detectadas.
 * Los nodos sin sufijo EX no se modifican.
 */
function _aplicarEtiquetadoVersionado(data) {
    // Regex: captura el nodo raíz y el número de versión del sufijo EX (case-insensitive)
    // Acepta separadores opcionales: espacio, guión, guión bajo antes de "E"
    const REGEX_VERSION = /^(.*?)[- _]?E(\d+)$/i;

    // --- PASO 1: Clasificar filas e identificar grupos con múltiples versiones ---
    const grupos = new Map(); // clave: nodoRaíz → [ { fila, versionNum } ]

    data.forEach((fila, idx) => {
        const nodo = String(fila['Nodo'] || fila['NODO'] || '').trim();
        const match = nodo.match(REGEX_VERSION);
        if (!match) return; // nodo sin sufijo de versión → ignorar

        const raiz = match[1].trim().toUpperCase();
        const versionNum = parseInt(match[2], 10);

        if (!grupos.has(raiz)) grupos.set(raiz, []);
        grupos.get(raiz).push({ fila, idx, versionNum });
    });

    // --- PASO 2: Procesar solo grupos con 2+ versiones ---
    grupos.forEach((versiones, raiz) => {
        if (versiones.length < 2) return; // nodo único con sufijo E0 → ignorar

        // Ordenar por número de versión de mayor a menor
        versiones.sort((a, b) => b.versionNum - a.versionNum);
        const nueva = versiones[0]; // La de número más alto = más reciente

        const obraActualNueva = String(nueva.fila['Obra a considerar'] || '').trim();

        // Detectar a qué caso pertenece según el texto de la versión más nueva
        const esA_EJECUTAR = obraActualNueva.includes('A EJECUTAR');
        const esEN_EJECUCION = obraActualNueva.includes('EN EJECUCIÓN') || obraActualNueva.includes('EN EJECUCION');
        const esTerminadoCT = obraActualNueva.includes('TERMINADO/CT');

        if (!esA_EJECUTAR && !esEN_EJECUCION && !esTerminadoCT) {
            // La versión nueva no tiene una etiqueta relevante → no modificar el grupo
            return;
        }

        // --- CASO A: Versión nueva = A EJECUTAR ---
        if (esA_EJECUTAR) {
            const textoBaseA = 'Considerar en hoja A EJECUTAR (solo lo entregado vs conteo)';

            versiones.forEach(({ fila, versionNum }) => {
                const esNueva = (versionNum === nueva.versionNum);
                const tieneEntregasMat =
                    fila['Estado de Entregas'] === 'Con entregas' ||
                    fila['Estado de Entregas'] === 'Con entregas y pendientes';

                if (esNueva) {
                    // La versión nueva siempre se etiqueta
                    fila['Obra a considerar'] = `${textoBaseA} - Versión ${versionNum}`;
                } else {
                    // Versiones viejas: solo si tienen material entregado
                    if (tieneEntregasMat) {
                        fila['Obra a considerar'] = `${textoBaseA} - Versión ${versionNum}`;
                    }
                    // Sin entregas → se deja el valor original intacto
                }
            });
        }
        // --- CASO B: Versión nueva = EN EJECUCIÓN o TERMINADO/CT ---
        else {
            // Usamos el texto exacto calculado para la versión nueva como base
            // y lo aplicamos a TODAS las versiones del grupo
            versiones.forEach(({ fila, versionNum }) => {
                fila['Obra a considerar'] = `${obraActualNueva} - Versión ${versionNum}`;
            });
        }
    });
}

// --- PROCESAMIENTO CORE CON AUDITORÍA Y SIN REGISTROS ---
function procesarConsolidacion() {
    showLoadingOverlay('Procesando y consolidando datos...');
    setTimeout(_procesarConsolidacionCore, 60);
}

// Limpia únicamente los resultados de Etapa 2 (dataConsolidada, filtros, búsqueda),
// sin tocar los archivos/análisis de Etapa 1 (dataBCMO, dataTarea, dataMateriales, etc.)
// ni el historial de cambios manuales (stateOverrides). Mirror local de "Limpiar BCMO" de Etapa 1.
function limpiarEtapa2() {
    if (!confirm("¿Limpiar los resultados de Etapa 2? Vas a tener que presionar \"Procesar y Consolidar\" de nuevo. Los archivos y el análisis de Etapa 1, y el historial de cambios manuales, no se ven afectados.")) return;

    dataConsolidada = [];
    filteredConsolidada = [];
    activeStateFilters = [];
    activeModalityFilters = [];
    activeObraConsiderarFilters = [];
    activeSectorFilters = [];

    const searchInput = document.getElementById('globalSearchInput');
    if (searchInput) searchInput.value = '';

    renderPreview();
    showToast("Etapa 2 limpiada. Presioná \"Procesar y Consolidar\" para volver a generarla.", "info");
}

function _procesarConsolidacionCore() {
    dataConsolidada = [];
    const formula = document.getElementById('formulaInput').value;

    const mapBCMO = {};
    if (dataBCMO) dataBCMO.forEach(row => { const k = String(row['_N_TAREA_/_OBRA'] || row['_N_TAREA'] || row['_N_OBRA'] || '').trim().toUpperCase(); if (k) mapBCMO[k] = row; });
    const mapTarea = {};
    if (dataTarea) dataTarea.forEach(row => { const k = String(row['_N_OBRA_BF'] || '').trim().toUpperCase(); if (k) mapTarea[k] = row; });

    const mapCorp = {};
    if (dataAvanceCorporativo) dataAvanceCorporativo.forEach(row => { const k = String(row['_N_NODO'] || '').trim().toUpperCase(); if (k) mapCorp[k] = true; });

    // mapMateriales: agrega totales por MOTIVO (nodo), excluyendo líneas canceladas
    const mapMateriales = {};
    if (dataMateriales) {
        const parseNum = val => parseFloat(String(val || '0').replace(/,/g, '')) || 0;
        dataMateriales.forEach(row => {
            const k = String(row['_N_MOTIVO'] || '').trim().toUpperCase();
            if (!k) return;
            const estLinPM = String(row['_N_ESTADO_DE_LINEA'] || '').trim().toUpperCase();
            const esCancelada = estLinPM === 'CANCELADA' || estLinPM === 'CANCELADO';

            if (!mapMateriales[k]) {
                mapMateriales[k] = {
                    cantEntregada: 0,
                    cantSolicitada: 0,
                    ctdPendiente: 0,
                    tieneSinCancelar: false,
                    // Flags por línea individual: evitan que sumas positivas y negativas
                    // se cancelen y oculten pendientes o entregas reales.
                    tieneEntregada: false,
                    tienePendiente: false
                };
            }
            if (!esCancelada) {
                const lineaEntregada = parseNum(row['_N_CANTIDAD_ENTREGADA']);
                const lineaSolicitada = parseNum(row['_N_CANTIDAD_SOLICITADA']);
                const lineaPendiente = parseNum(row['_N_CTD_PENDIENTE']);
                mapMateriales[k].cantEntregada += lineaEntregada;
                mapMateriales[k].cantSolicitada += lineaSolicitada;
                mapMateriales[k].ctdPendiente += lineaPendiente;
                mapMateriales[k].tieneSinCancelar = true;
                // Activar flags si la línea individual supera el umbral
                if (lineaEntregada > 0.01) mapMateriales[k].tieneEntregada = true;
                if (lineaPendiente > 0.01) mapMateriales[k].tienePendiente = true;
            }
        });
    }

    // Combinar arrays si existen y resolver cruce
    const allAvance = [];
    const mapAvance = new Map();

    const getLatestDate = (row) => {
        const parseDate = (d) => {
            if (!d) return 0;
            if (typeof d === 'number') return d;
            const str = String(d).trim();
            if (str === '-' || str === '') return 0;
            const parts = str.split(/[T\s/:-]/);
            if (parts.length >= 3) {
                if (parts[0].length === 2 && parts[2].length === 4) {
                    return new Date(parts[2], parts[1] - 1, parts[0]).getTime() || 0;
                }
            }
            return new Date(str).getTime() || 0;
        };
        return Math.max(
            parseDate(row['_N_INICIO']),
            parseDate(row['_N_FIN']),
            parseDate(row['_N_CIERRE_TECNICO'])
        );
    };

    if (dataAvance) {
        dataAvance.forEach(row => {
            const rowCopy = { ...row, 'Sector Informante': 'Obras' };
            const k = String(
                rowCopy['_N_NODO'] || rowCopy['NODO'] || rowCopy['Nodo'] ||
                rowCopy['_N_MOTIVO'] || rowCopy['MOTIVO'] || rowCopy['Motivo'] ||
                rowCopy['_N_OBRA'] || rowCopy['OBRA'] || rowCopy['Obra'] || ''
            ).trim().toUpperCase();
            if (k) mapAvance.set(k, rowCopy);
            else allAvance.push(rowCopy);
        });
    }

    if (dataAvanceCorporativo) {
        function estandarizarEstadoCorporativo(estado) {
            if (!estado) return "";
            let est = String(estado).trim().toUpperCase();
            const sinAcentos = est.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            if (sinAcentos === "CIERRE TECNICO") return "CIERRE TECNICO";
            if (sinAcentos === "FINALIZADA" || sinAcentos === "FINALIZADO") return "FINALIZADA";
            if (sinAcentos === "A EJECUTAR") return "A EJECUTAR";
            if (sinAcentos === "SUSPENDIDA" || sinAcentos === "SUSPENDIDO") return "SUSPENDIDA";
            if (sinAcentos === "CANCELADA" || sinAcentos === "CANCELADO") return "CANCELADA";
            if (sinAcentos === "EN EJECUCION") return "EN EJECUCIÓN";
            if (sinAcentos === "TERMINADA" || sinAcentos === "TERMINADO") return "TERMINADO";
            return est;
        }

        dataAvanceCorporativo.forEach(row => {
            const rawEstado = row['ESTADO'] || row['_N_ESTADO'] || '';
            const stdEstado = estandarizarEstadoCorporativo(rawEstado);

            const filteredRow = {
                '_N_NODO': row['_N_NODO'],
                'NODO': row['NODO'] || row['_N_NODO'],
                '_N_ESTADO': stdEstado,
                'ESTADO': stdEstado,
                '_N_INICIO': row['_N_INICIO'],
                'INICIO': row['INICIO'] || row['_N_INICIO'],
                '_N_FIN': row['_N_FIN'],
                'FIN': row['FIN'] || row['_N_FIN'],
                '_N_PUESTA_EN_M': row['_N_PUESTA_EN_M'] || row['_N_PUESTA_EN_MARCHA'],
                'PUESTA EN M.': row['PUESTA EN M.'] || row['PUESTA EN MARCHA'] || row['_N_PUESTA_EN_M'] || row['_N_PUESTA_EN_MARCHA'],
                '_N_CIERRE_TECNICO': row['_N_CIERRE_TECNICO'],
                'CIERRE TECNICO': row['CIERRE TECNICO'] || row['_N_CIERRE_TECNICO'],
                '_N_CONTRATISTA': row['_N_CONTRATISTA'],
                'CONTRATISTA': row['CONTRATISTA'] || row['_N_CONTRATISTA'],
                '_N_MODALIDAD_DE_LIQUIDACION': row['_N_MODALIDAD_DE_LIQUIDACION'],
                'MODALIDAD DE LIQUIDACION': row['MODALIDAD DE LIQUIDACION'] || row['_N_MODALIDAD_DE_LIQUIDACION'],
                '_ORIGEN': row['_ORIGEN'] || 'CORPORATIVO',
                '_N_FECHA_CIERRE_CALCULADA': row['_N_FECHA_CIERRE_CALCULADA'],
                'Sector Informante': 'Corporativos'
            };

            const k = String(filteredRow['_N_NODO'] || '').trim().toUpperCase();
            if (k) {
                if (mapAvance.has(k)) {
                    const existingRow = mapAvance.get(k);
                    const dateExisting = getLatestDate(existingRow);
                    const dateNew = getLatestDate(filteredRow);

                    if (dateNew > dateExisting) {
                        mapAvance.set(k, filteredRow);
                    }
                } else {
                    mapAvance.set(k, filteredRow);
                }
            } else {
                allAvance.push(filteredRow);
            }
        });
    }

    // Agregar todos los procesados del mapa al array final
    for (const row of mapAvance.values()) {
        allAvance.push(row);
    }

    allAvance.forEach(rowAvance => {
        const fila = { ...rowAvance };
        Object.keys(fila).forEach(k => { if (k.startsWith('_N_')) delete fila[k]; });

        let nodo = String(
            rowAvance['_N_NODO'] || rowAvance['NODO'] || rowAvance['Nodo'] ||
            rowAvance['_N_MOTIVO'] || rowAvance['MOTIVO'] || rowAvance['Motivo'] ||
            rowAvance['_N_OBRA'] || rowAvance['OBRA'] || rowAvance['Obra'] || ''
        ).trim();
        let estadoAvance = String(
            rowAvance['_N_ESTADO'] || rowAvance['ESTADO'] || rowAvance['Estado'] ||
            rowAvance['_N_ESTADO_DE_AVANCE'] || rowAvance['ESTADO DE AVANCE'] || ''
        ).trim().toUpperCase();
        let modalidad = String(
            rowAvance['_N_MODALIDAD_DE_LIQUIDACION'] || rowAvance['MODALIDAD DE LIQUIDACION'] ||
            rowAvance['MODALIDAD DE LIQUIDACIÓN'] || rowAvance['_N_MODALIDAD'] ||
            rowAvance['MODALIDAD'] || rowAvance['Modalidad'] || ''
        ).trim().toUpperCase();

        // 1. APLICACIÓN DE TRAZABILIDAD Y CORRECCIONES MANUALES
        const originalEstado = estadoAvance;
        const originalNodo = nodo;
        const override = getActiveOverride(originalNodo);

        if (override) {
            if (override.correctedNodo) {
                nodo = override.correctedNodo;
                fila['_MODIFICADO_NODO_'] = true;
                fila['Nodo Original'] = originalNodo;
            }
            if (override.newState) {
                estadoAvance = override.newState;
                fila['_MODIFICADO_ESTADO_'] = true;
            }
            if (override.newModality) {
                modalidad = override.newModality;
                fila['_MODIFICADO_MODALIDAD_'] = true;
            }
            fila['_MODIFICADO_'] = true;
        }

        // Fallback para modalidad: Si no tiene, consultar el archivo corporativo
        if (modalidad === '' || modalidad === 'SIN MODALIDAD') {
            if (mapCorp[nodo.toUpperCase()]) {
                modalidad = 'CORPORATIVO';
            }
        }

        const obraBfCalculada = evaluateExcelFormula(formula, { nodo: nodo }).toUpperCase();
        fila['Nodo'] = nodo; // Guardar el nodo (sea original o corregido)
        fila['Obra BF'] = obraBfCalculada;
        fila['Estado (Original Excel)'] = originalEstado;

        let nuevoEstado = estadoAvance;
        let observacion = "";
        let auditInfo = "-";

        // DETECCIÓN GLOBAL DE NODOS SIN REGISTROS (Sin registros en BCMO, TAREA, PM)
        const matchBCMO = mapBCMO[nodo.toUpperCase()] || mapBCMO[obraBfCalculada];
        const enBCMO = !!matchBCMO;
        const enTarea = !!mapTarea[obraBfCalculada];
        const enMateriales = !!mapMateriales[nodo.toUpperCase()];
        fila['_ES_HUERFANO'] = false;

        if (!enBCMO && !enTarea && !enMateriales) {
            const justif = override ? override.orphanJustification : null;
            if (justif) {
                fila['_ES_HUERFANO'] = false; // Justificado: No debe figurar como error
                auditInfo = 'JUSTIFICADO (Excepción)';
                observacion = justif; // Utiliza la frase guardada en el sistema de forma dinámica
            } else {
                fila['_ES_HUERFANO'] = true;
            }
        }

        // 2. REGLAS ESPECÍFICAS (Lógica Sistémica Original)
        if (modalidad === '' || modalidad === 'SIN MODALIDAD') {
            if (estadoAvance !== 'CANCELADA') {
                if (!fila['_ES_HUERFANO'] && override && override.orphanJustification) {
                    // Mantenemos la observacion de justificacion
                } else {
                    observacion = "⚠️ Reclamar a Obras registrar modalidad de liquidación";
                }
            }
        }

        // Si es Corporativo, aplica reglas generales de cruce.
        if (modalidad === 'LEGAJO' || modalidad === 'CORPORATIVO') {
            const match = matchBCMO;
            if (match) {
                const estBCMO = String(match['_N_ESTADO_DE_LIQUIDACION'] || '').trim().toUpperCase();
                const consBCMO = match['_N_%_CONSUMO'] || 0;
                fila['BCMO - % Consumo'] = consBCMO;
                fila['BCMO - Estado Liquidacion'] = estBCMO;
                fila['BCMO - Contratista'] = match['_N_CONTRATISTA'] || '';
                auditInfo = `${estBCMO} (${(consBCMO * 100).toFixed(0)}%)`;

                nuevoEstado = estBCMO === "SIN CONSUMO" ? estadoAvance : "FINALIZADA CON CONSUMO";

                if (estBCMO === "VERIFICAR CONSUMO") {
                    observacion = "";
                } else if ((estadoAvance === "EN EJECUCIÓN" || estadoAvance === "A EJECUTAR") && estBCMO === "CONSUMIDO") {
                    observacion = "Obras: Obra consumida en BCMO pero informada en EJECUCION/A EJECUTAR.";
                }
            }
            //else {
            //    if (enMateriales) {
            //        observacion = "La obra tiene PM pero no fue entregada(No en BCMO)";
            //    }
            //}
        }
        else if (modalidad === 'TAREA') {
            const match = mapTarea[obraBfCalculada];
            if (match) {
                const resFinal = String(match['_N_RESULTADO_FINAL'] || '').trim().toUpperCase();
                const cerrados = parseInt(match['_N_CERRADOS']) || 0;
                fila['TAREA - Resultado Final'] = resFinal;
                fila['TAREA - Cerrados'] = cerrados;
                auditInfo = `${resFinal} (Cerrados: ${cerrados})`;

                if (resFinal === "FINALIZADA CON CONSUMO TOTAL") {
                    nuevoEstado = "FINALIZADA CON CONSUMO TOTAL";
                    if (estadoAvance === "EN EJECUCIÓN" || estadoAvance === "A EJECUTAR" || estadoAvance === "CANCELADA") {
                        observacion = "Contratista ponerse en contacto con Obras para corregir el estado de avance de obras";
                    }
                }
                else if (resFinal === "FINALIZADA CON CONSUMO PARCIAL") {
                    if (estadoAvance === "TERMINADO") {
                        nuevoEstado = "FINALIZADA CON CONSUMO PARCIAL";
                    } else if (estadoAvance === "EN EJECUCIÓN") {
                        nuevoEstado = "EN EJECUCION CON CONSUMO PARCIAL";
                    } else if (estadoAvance === "A EJECUTAR" || estadoAvance === "CANCELADA") {
                        nuevoEstado = "EN EJECUCION CON CONSUMO PARCIAL";
                        observacion = "Contratista ponerse en contacto con Obras para corregir el estado de avance de obras";
                    }
                }
                else if (resFinal === "EN CURSO") {
                    if (estadoAvance === "A EJECUTAR" || estadoAvance === "CANCELADA") {
                        nuevoEstado = "EN EJECUCIÓN";
                        observacion = "Contratista ponerse en contacto con Obras para corregir el estado de avance de obras, según tickets se encuentra en curso";
                    } else {
                        nuevoEstado = estadoAvance;
                    }
                }
                else {
                    if (estadoAvance === "TERMINADO" && resFinal === "A EJECUTAR") {
                        observacion = "Contratista: Completar tickets y realizar descarga.";
                    } else if (estadoAvance === "EN EJECUCIÓN" && resFinal === "A EJECUTAR") {
                        observacion = "Contratista: Completar tickets y realizar descarga.";
                    } else if (estadoAvance === "CANCELADA" && resFinal !== "A EJECUTAR" && resFinal !== "") {
                        observacion = "Obras: Cancelada en Avance pero con tickets activos/finalizados.";
                    }
                }
            } else {
                if (!fila['_ES_HUERFANO'] && override && override.orphanJustification) {
                    // justificada, mantener el texto actual
                } else {
                    observacion = "ALERTA: No encontrada en tickets.";
                }
            }
        }

        fila['Estado de Avance (Calculado)'] = nuevoEstado;
        fila['Acción Sugerida / Observación'] = observacion;
        fila['_AUDIT_'] = auditInfo;
        fila['Estado (Motor)'] = estadoAvance;
        fila['Modalidad de Liquidación Calculada'] = modalidad;

        // --- Lógica de Estado de Entregas ---
        // El campo ESTADO_DE_LINEA viene del archivo PM (PMOVXF), agregado por MOTIVO.
        // Si la obra existe en el mapa y tiene al menos una línea no cancelada, evaluamos cantidades.
        const pmData = mapMateriales[nodo.toUpperCase()];

        let estadoEntrega = "-";
        if (pmData) {
            if (!pmData.tieneSinCancelar) {
                // Todas las líneas del PM para este nodo están canceladas
                estadoEntrega = "-";
            } else if (pmData.cantSolicitada === 0) {
                estadoEntrega = "Sin registro de materiales a entregar";
            } else if (pmData.tieneEntregada && pmData.tienePendiente) {
                // Al menos una línea tiene entregada Y al menos una tiene pendiente
                // (evaluado por línea individual para evitar cancelaciones aritméticas)
                estadoEntrega = "Con entregas y pendientes";
            } else if (pmData.tieneEntregada && !pmData.tienePendiente) {
                estadoEntrega = "Con entregas";
            } else if (!pmData.tieneEntregada && pmData.tienePendiente) {
                estadoEntrega = "Sin entregas con pendiente";
            } else {
                estadoEntrega = "Sin registro de materiales a entregar";
            }
        } else {
            // El nodo no existe en el archivo PM
            estadoEntrega = "Sin registro de materiales a entregar";
        }

        // --- NUEVA LÓGICA DE FALLBACK A BCMO ---
        if (estadoEntrega === "Sin registro de materiales a entregar" && matchBCMO) {
            const entregadoBCMO = parseFloat(matchBCMO['_N_ENTREGADO']) || 0;
            if (entregadoBCMO > 0) {
                estadoEntrega = "Con entregas";
            }
        }

        fila['Estado de Entregas'] = estadoEntrega;

        // --- Lógica de Obra a considerar ---
        let obraAConsiderar = "-";
        const estBCMO = (matchBCMO ? String(matchBCMO['_N_ESTADO_DE_LIQUIDACION'] || '').trim().toUpperCase() : "");
        const tieneEntregas = (estadoEntrega === "Con entregas" || estadoEntrega === "Con entregas y pendientes");

        // [RUTEO] Detectar si el registro proviene del sector Corporativo.
        // Para corporativos, el motor de auditoría (BCMO/TAREA) no calcula nuevoEstado de forma
        // representativa. En cambio, usamos el estado ya estandarizado en el paso de carga del corporativo.
        const esCorporativo = (rowAvance['_ORIGEN'] === 'CORPORATIVO' || modalidad === 'CORPORATIVO');

        // [RUTEO] Selección de la fuente de estado según el origen del registro:
        //   - Corporativo → lee el campo ESTADO/_N_ESTADO estandarizado del filteredRow corporativo.
        //   - Obras       → usa nuevoEstado, calculado por el motor de auditoría normal.
        const estadoParaObra = esCorporativo
            ? String(rowAvance['ESTADO'] || rowAvance['_N_ESTADO'] || '').trim().toUpperCase()
            : nuevoEstado;

        // [BRANCH CORPORATIVO] Para registros de sector Corporativo, se usan sus
        // propios estados estandarizados. No se verifica modalidad porque siempre
        // será "CORPORATIVO". El mapeo de estados es:
        //   - FINALIZADA / CIERRE TECNICO → "Considerar en Hoja: TERMINADO/CT"
        //   - A EJECUTAR                  → "Considerar en Hoja: A EJECUTAR"
        //   - EN EJECUCIÓN                → "Considerar en Hoja: EN EJECUCIÓN"
        if (esCorporativo) {
            // [RUTEO CORP] Solo consideramos las obras que aún NO han sido consumidas por BCMO
            if (tieneEntregas && estBCMO === "SIN CONSUMO") {
                if (estadoParaObra === "FINALIZADA" || estadoParaObra === "CIERRE TECNICO" || estadoParaObra === "TERMINADO") {
                    // [RUTEO CORP] FINALIZADA y CIERRE TECNICO equivalen a TERMINADO en el mundo corporativo
                    obraAConsiderar = "Considerar en Hoja: TERMINADO/CT";
                } else if (estadoParaObra === "A EJECUTAR") {
                    // [RUTEO CORP] A EJECUTAR corporativo → hoja A EJECUTAR
                    obraAConsiderar = "Considerar en Hoja: A EJECUTAR (lo entregado vs conteo)";
                } else if (estadoParaObra === "EN EJECUCIÓN" || estadoParaObra === "EN EJECUCION") {
                    // [RUTEO CORP] En ejecución corporativo → hoja En ejecución
                    obraAConsiderar = "Considerar en Hoja: EN EJECUCIÓN (lo entregado + pendiente)";
                }
            }
        } else {
            // [BRANCH OBRAS] Lógica original: depende de nuevoEstado, estBCMO y modalidad
            if (tieneEntregas &&
                estadoParaObra === "TERMINADO" &&
                estBCMO === "SIN CONSUMO" &&
                modalidad === "LEGAJO") {
                obraAConsiderar = "Considerar en Hoja: TERMINADO/CT";
            } else if (tieneEntregas && estadoParaObra === "A EJECUTAR") {
                if (modalidad === "TAREA" || modalidad === "LEGAJO") {
                    obraAConsiderar = "Considerar en Hoja: A EJECUTAR (lo entregado vs conteo)";
                }
            } else if (tieneEntregas &&
                (estadoParaObra === "EN EJECUCIÓN" || estadoParaObra === "EN EJECUCION") &&
                estBCMO === "SIN CONSUMO" &&
                modalidad === "LEGAJO") {
                obraAConsiderar = "Considerar en Hoja: EN EJECUCIÓN (lo entregado + pendiente)";
            }
        }

        fila['Obra a considerar'] = obraAConsiderar;
        dataConsolidada.push(fila);
    });

    // --- POST-PROCESO: Etiquetado de obras reversionadas (E0, E1, E2...) ---
    _aplicarEtiquetadoVersionado(dataConsolidada);

    fadeSwapSection(document.getElementById('setupSection'), document.getElementById('resultsSection'), 'flex');
    document.getElementById('btnExportar').classList.remove('hidden');
    document.getElementById('btnExportar').classList.add('flex');
    const btnGoToRes = document.getElementById('btnGoToResults');
    if (btnGoToRes) btnGoToRes.classList.remove('hidden');
    updateStepper(2);

    renderPreview();
    renderAuditTable();
    renderOrphansTable();
    renderBcmoSinCruceTable();
    renderCaducidadTable();
    if (typeof renderSinModalidadTable === 'function') {
        renderSinModalidadTable();
    }
    if (typeof renderValidacionContratistaTable === 'function') {
        renderValidacionContratistaTable();
    }
    if (typeof renderRecatTable === 'function') {
        renderRecatTable();
    }
    if (typeof renderDetalleTareasTable === 'function') {
        renderDetalleTareasTable();
    }
    if (typeof renderIncoherenciasTareaTable === 'function') {
        renderIncoherenciasTareaTable();
    }
    hideLoadingOverlay();
}

// Funciones Pop-up Resumen Interactivo
window.openSummaryModal = function () {
    const modal = document.getElementById('summaryModal');
    if (modal) modal.classList.remove('hidden');
};

window.closeSummaryModal = function () {
    const modal = document.getElementById('summaryModal');
    if (modal) modal.classList.add('hidden');
};

// --- FILTROS MULTIPLES ---
let activeSectorFilters = [];
function toggleSectorFilter(sector) {
    const idx = activeSectorFilters.indexOf(sector);
    if (idx > -1) activeSectorFilters.splice(idx, 1);
    else activeSectorFilters.push(sector);
    renderPreview();
}

function toggleStateFilter(estado) {
    const idx = activeStateFilters.indexOf(estado);
    if (idx > -1) activeStateFilters.splice(idx, 1);
    else activeStateFilters.push(estado);
    renderPreview();
}

function toggleModalityFilter(mod) {
    const idx = activeModalityFilters.indexOf(mod);
    if (idx > -1) activeModalityFilters.splice(idx, 1);
    else activeModalityFilters.push(mod);
    renderPreview();
}

function toggleObraConsFilter(valor) {
    const idx = activeObraConsiderarFilters.indexOf(valor);
    if (idx > -1) activeObraConsiderarFilters.splice(idx, 1);
    else activeObraConsiderarFilters.push(valor);
    renderPreview();
}

function renderPreview() {
    const globalSearch = document.getElementById('globalSearchInput') ? document.getElementById('globalSearchInput').value.trim().toLowerCase() : "";

    let baseFiltered = dataConsolidada.filter(item => {
        const n = String(item['Nodo'] || item['NODO'] || '').toLowerCase();
        const oBf = String(item['Obra BF'] || '').toLowerCase();

        // Búsqueda global simplificada
        if (globalSearch && !n.includes(globalSearch) && !oBf.includes(globalSearch)) return false;
        return true;
    });

    const countsState = {}; const countsMod = {}; const countsObraCons = {}; const countsSector = {};

    baseFiltered.forEach(i => {
        const e = i['Estado de Avance (Calculado)'] || 'Otro';
        countsState[e] = (countsState[e] || 0) + 1;

        let m = (i['Modalidad de Liquidación Calculada'] || i['Modalidad de Liquidación'] || i['MODALIDAD DE LIQUIDACIÓN'] || '').toUpperCase().trim();
        m = m === '' ? (i['_ORIGEN'] === 'CORPORATIVO' ? 'CORPORATIVO' : 'SIN MODALIDAD') : m;
        countsMod[m] = (countsMod[m] || 0) + 1;

        const oc = i['Obra a considerar'] || '-';
        countsObraCons[oc] = (countsObraCons[oc] || 0) + 1;

        const sec = i['Sector Informante'] || 'Desconocido';
        countsSector[sec] = (countsSector[sec] || 0) + 1;
    });

    // Renderizado dinámico de los Dropdowns
    const renderDropdownContent = (containerId, countsObj, activeArray, toggleFuncName, arrVarName) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        const allActive = activeArray.length === 0;
        container.innerHTML += `
            <label class="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-100 rounded cursor-pointer transition-colors">
                <input type="checkbox" ${allActive ? 'checked' : ''} onchange="${arrVarName}.length=0; renderPreview();" class="rounded text-indigo-600 focus:ring-indigo-500">
                <span class="text-xs font-bold text-slate-700">Seleccionar Todos</span>
            </label>
            <div class="border-t border-slate-200 my-1"></div>
        `;

        for (const [val, count] of Object.entries(countsObj)) {
            const isActive = activeArray.includes(val);
            container.innerHTML += `
                <label class="flex items-center justify-between px-2 py-1.5 hover:bg-slate-100 rounded cursor-pointer transition-colors">
                    <div class="flex items-center gap-2 overflow-hidden w-full">
                        <input type="checkbox" ${isActive ? 'checked' : ''} onchange="${toggleFuncName}('${val}')" class="rounded text-indigo-600 focus:ring-indigo-500 shrink-0">
                        <span class="text-xs text-slate-600 truncate flex-1" title="${val}">${val}</span>
                    </div>
                    <span class="text-[10px] bg-slate-200 text-slate-600 px-1.5 rounded-full font-mono shrink-0 ml-2">${count}</span>
                </label>
            `;
        }
    };

    renderDropdownContent('dropdownSectorContent', countsSector, activeSectorFilters, 'toggleSectorFilter', 'activeSectorFilters');
    renderDropdownContent('dropdownEstadoContent', countsState, activeStateFilters, 'toggleStateFilter', 'activeStateFilters');
    renderDropdownContent('dropdownModalidadContent', countsMod, activeModalityFilters, 'toggleModalityFilter', 'activeModalityFilters');
    renderDropdownContent('dropdownObraConsContent', countsObraCons, activeObraConsiderarFilters, 'toggleObraConsFilter', 'activeObraConsiderarFilters');

    // Cruce Final
    filteredConsolidada = baseFiltered.filter(item => {
        if (activeStateFilters.length > 0 && !activeStateFilters.includes(item['Estado de Avance (Calculado)'])) return false;

        let itemMod = (item['Modalidad de Liquidación Calculada'] || item['Modalidad de Liquidación'] || item['MODALIDAD DE LIQUIDACIÓN'] || '').toUpperCase().trim();
        itemMod = itemMod === '' ? (item['_ORIGEN'] === 'CORPORATIVO' ? 'CORPORATIVO' : 'SIN MODALIDAD') : itemMod;
        if (activeModalityFilters.length > 0 && !activeModalityFilters.includes(itemMod)) return false;

        const oc = item['Obra a considerar'] || '-';
        if (activeObraConsiderarFilters.length > 0 && !activeObraConsiderarFilters.includes(oc)) return false;

        const sec = item['Sector Informante'] || 'Desconocido';
        if (activeSectorFilters.length > 0 && !activeSectorFilters.includes(sec)) return false;

        return true;
    });

    const statsEl = document.getElementById('statsText');
    if (statsEl) statsEl.innerHTML = `<b>${filteredConsolidada.length}</b> de ${dataConsolidada.length} registros`;

    // --- RESUMEN INTERACTIVO ---
    const summaryData = {};
    filteredConsolidada.forEach(item => {
        const sector = item['Sector Informante'] || 'Desconocido';
        const obraCons = item['Obra a considerar'] || '-';
        const key = sector + '|' + obraCons;
        summaryData[key] = (summaryData[key] || 0) + 1;
    });

    const summaryBody = document.getElementById('interactiveSummaryBody');
    if (summaryBody) {
        summaryBody.innerHTML = '';
        const sortedKeys = Object.keys(summaryData).sort((a, b) => {
            const [secA, obsA] = a.split('|');
            const [secB, obsB] = b.split('|');
            if (secA !== secB) return secA.localeCompare(secB);
            return obsA.localeCompare(obsB);
        });

        sortedKeys.forEach(key => {
            const [sector, obraCons] = key.split('|');
            const count = summaryData[key];
            summaryBody.innerHTML += `
                <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td class="py-1.5 px-3 border-r border-slate-100">${sector}</td>
                    <td class="py-1.5 px-3 border-r border-slate-100 font-medium">${obraCons}</td>
                    <td class="py-1.5 px-3 text-center font-bold text-indigo-700 bg-indigo-50/30">${count}</td>
                </tr>
            `;
        });

        if (sortedKeys.length === 0) {
            summaryBody.innerHTML = `<tr><td colspan="3" class="py-3 text-center text-slate-500 italic">No hay datos para mostrar</td></tr>`;
        }
    }

    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    filteredConsolidada.slice(0, 500).forEach((item, idx) => {
        const obs = item['Acción Sugerida / Observación'] || '';
        const style = stateColorMap[item['Estado de Avance (Calculado)']] || stateColorMap['DEFAULT'];

        let modText = item['Modalidad de Liquidación Calculada'] || '';
        if (modText === '' && item['_ORIGEN'] === 'CORPORATIVO') modText = 'CORP';

        let modHtml = modText === '' || modText === 'SIN MODALIDAD'
            ? `<span class="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-red-200" title="Requiere registrar modalidad"><i class="fa-solid fa-triangle-exclamation mr-1 text-[9px]"></i>SIN MOD</span>`
            : `<span class="bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-bold border border-slate-300">${modText}</span>`;

        if (item['_MODIFICADO_MODALIDAD_']) {
            modHtml = `<span class="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-indigo-300" title="Modalidad Forzada"><i class="fa-solid fa-pen-nib mr-1 text-[8px]"></i>${modText}</span>`;
        }

        const isModificado = item['_MODIFICADO_'];
        const estadoRender = item['_MODIFICADO_ESTADO_']
            ? `<span class="text-indigo-600 font-bold" title="Original: ${item['Estado (Original Excel)']}"><i class="fa-solid fa-pen-nib mr-1 text-[10px]"></i> ${item['Estado (Motor)']}</span>`
            : item['Estado (Motor)'];

        const nodoVal = item['Nodo'] || item['NODO'] || item['Nodo Original'] || item['Motivo'] || item['MOTIVO'] || '';
        const nodoRender = item['_MODIFICADO_NODO_']
            ? `<span class="text-indigo-600 font-bold" title="Original: ${item['Nodo Original']}"><i class="fa-solid fa-spell-check mr-1 text-[10px]"></i> ${nodoVal || '-'}</span>`
            : `<span class="text-slate-800">${nodoVal || '-'}</span>`;

        const tr = document.createElement('tr');
        tr.className = "group border-b border-slate-200 transition-colors";
        tr.innerHTML = `
            <td class="py-2 px-3 border-r border-slate-200 font-medium">${nodoRender}</td>
            <td class="py-2 px-3 border-r border-slate-200 font-mono text-[10px] text-indigo-700 bg-indigo-50/20">${item['Obra BF'] || '-'}</td>
            <td class="py-2 px-3 border-r border-slate-200">${modHtml}</td>
            <td class="py-2 px-3 border-r border-slate-200 text-slate-500">${estadoRender || '-'}</td>
            <td class="py-2 px-3 border-r border-slate-200 text-indigo-600 font-mono text-[10px] bg-indigo-50/30">${item['_AUDIT_'] || '-'}</td>
            <td class="py-2 px-3 border-r border-slate-200 ${style.text}">${item['Estado de Avance (Calculado)'] || '-'}</td>
            <td class="py-2 px-3 border-r border-slate-200 text-[11px] font-semibold text-slate-700 bg-amber-50/20">${item['Estado de Entregas'] || '-'}</td>
            <td class="py-2 px-3 border-r border-slate-200 text-[11px] font-semibold text-blue-700 bg-blue-50/20">${item['Obra a considerar'] || '-'}</td>
            <td class="py-2 px-3 border-r border-slate-200 text-xs ${obs.includes('reclamar a Obras') || obs.includes('corregir el estado') || item['_ES_HUERFANO'] ? 'text-red-700 font-bold bg-red-50' : 'text-slate-600'} truncate max-w-[250px]" title="${obs}">${obs}</td>
            <td class="py-2 px-3 text-center flex justify-center gap-1">
                <button type="button" onclick="openEditModal('${item['Nodo Original'] || item['Nodo'] || item['NODO']}', '${item['Estado (Original Excel)']}', '${modText}')" class="text-slate-400 hover:text-indigo-600 bg-slate-50 border border-slate-200 hover:bg-slate-100 w-6 h-6 rounded flex items-center justify-center transition-colors" title="Forzar Corrección">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button type="button" onclick="showDetails(${idx})" class="text-slate-400 hover:text-emerald-600 bg-slate-50 border border-slate-200 hover:bg-emerald-50 w-6 h-6 rounded flex items-center justify-center transition-colors" title="Ver Campos">
                    <i class="fa-solid fa-eye"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    if (filteredConsolidada.length > 500) {
        tbody.innerHTML += `<tr><td colspan="9" class="py-3 px-3 text-center text-slate-500 text-xs italic bg-slate-50">Mostrando 500. Use exportar para ver el total.</td></tr>`;
    }
}

// --- EXPORTACIÓN EXCEL NATIVA ---
function exportToExcel() {
    if (!dataConsolidada.length) return;

    const auditorInput = document.getElementById('auditorName');
    const auditorStr = auditorInput && auditorInput.value.trim() ? auditorInput.value.trim() : 'Auditor Anónimo';

    const globalAuditDateInput = document.getElementById('globalAuditDate');
    const auditDate = globalAuditDateInput ? globalAuditDateInput.value : new Date().toISOString().split('T')[0];

    // 1. Exportar Maestro Ignorando Filtros
    const excludedHeaders = ['ZONA', 'PARTIDO', 'LOCALIDAD', 'ETAPA', 'ETAPA LOGICA', 'MZAS'];

    // Combinar cabeceras para ambos orígenes
    const allHeadersSet = new Set(headersAvance);
    if (dataAvanceCorporativo && dataAvanceCorporativo.length > 0) {
        Object.keys(dataAvanceCorporativo[0]).forEach(k => {
            if (!k.startsWith('_')) allHeadersSet.add(k);
        });
    }

    // Asegurar que las columnas clave y generadas dinámicamente estén en las cabeceras
    ['Sector Informante', 'ESTADO', 'INICIO', 'FIN', 'PUESTA EN M.', 'CIERRE TECNICO', 'CONTRATISTA'].forEach(h => allHeadersSet.add(h));

    const activeHeaders = Array.from(allHeadersSet);

    const data = dataConsolidada.map(row => {
        const r = {};
        // NODO siempre como primera columna
        r['Nodo'] = row['Nodo'] || row['NODO'] || '';
        activeHeaders.forEach(h => {
            const normalizedH = h.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            if (excludedHeaders.includes(normalizedH)) return;
            let v = row[h] !== undefined ? row[h] : row[`_N_${normalizedH.replace(/\s+/g, '_')}`];
            if (h.toUpperCase().includes('%') && typeof v === 'string') v = parseFloat(v.replace(',', '.')) / 100;
            if (v !== undefined) r[h] = v;
        });
        r['Obra BF'] = row['Obra BF'];
        if (row['_ORIGEN'] === 'CORPORATIVO') r['Cierre Calculado (Mínimo)'] = row['_N_FECHA_CIERRE_CALCULADA'];
        if (row['BCMO - % Consumo'] !== undefined) r['BCMO - % Consumo'] = row['BCMO - % Consumo'];
        if (row['BCMO - Estado Liquidacion']) r['BCMO - Estado Liquidacion'] = row['BCMO - Estado Liquidacion'];
        if (row['TAREA - Obra BF']) r['TAREA - Obra BF'] = row['TAREA - Obra BF'];
        if (row['TAREA - Resultado Final']) r['TAREA - Resultado Final'] = row['TAREA - Resultado Final'];
        r['Estado de Avance (Calculado)'] = row['Estado de Avance (Calculado)'];
        r['Estado de Entregas'] = row['Estado de Entregas'] || '-';
        r['Obra a considerar'] = row['Obra a considerar'] || '-';
        r['Acción Sugerida / Observación'] = row['Acción Sugerida / Observación'];
        return r;
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let C = range.s.c; C <= range.e.c; ++C) {
        const header = String(ws[XLSX.utils.encode_cell({ c: C, r: 0 })].v).toUpperCase();
        for (let R = 1; R <= range.e.r; ++R) {
            const cell = ws[XLSX.utils.encode_cell({ c: C, r: R })];
            if (!cell) continue;
            if (header.includes('%')) cell.z = "0.00%";
            if (header.includes('FECHA') || header.includes('INICIO')) cell.z = "dd/mm/yyyy";
        }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Consolidado Maestro");

    // 2. Exportar Registro de Cambios (Trazabilidad Inmutable)
    const logs = Object.values(stateOverrides).sort((a, b) => new Date(b.timestamp.replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$2-$1')) - new Date(a.timestamp.replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$2-$1')));
    const overridesList = logs.map(log => ({
        "Estado Registro": log.reverted ? "REVERTIDO" : "ACTIVO",
        "Nodo/Obra Original": log.nodo,
        "Nodo Corregido A": log.correctedNodo || "-",
        "Estado Original (Antes)": log.originalEstado || "-",
        "Estado Forzado A": log.newState || "-",
        "Modalidad Original (Antes)": log.originalModalidad || "-",
        "Modalidad Forzada A": log.newModality || "-",
        "Justificación de Descarte": log.orphanJustification || "-",
        "Fecha de Inicio Real": log.startDate || "-",
        "Fecha de Cierre Técnico": log.closeDate || "-",
        "Fecha Correo Respaldo": log.mailDate || "-",
        "Autorizado Por": log.validator || "-",
        "Auditor/Operador": log.auditor,
        "Detalle de Cambios (Campo: Antes -> Después)": (log.changes && log.changes.length > 0)
            ? log.changes.map(c => `${c.campo}: ${c.anterior} -> ${c.nuevo}`).join(" | ")
            : "-",
        "Fec/Hora Creación": log.timestamp,
        "Fec/Hora Reversión": log.revertedTimestamp || "-"
    }));
    const wsAudit = XLSX.utils.json_to_sheet(overridesList.length > 0 ? overridesList : [{ "Info": "No se registraron cambios manuales en esta sesión." }]);
    XLSX.utils.book_append_sheet(wb, wsAudit, "Trazabilidad de Cambios");

    // 3. Exportar Nodos sin Registro
    const orphans = dataConsolidada.filter(i => i['_ES_HUERFANO'] === true).map(i => ({
        "Origen": i['_ORIGEN'],
        "Nodo": i['Nodo Original'] || i['Nodo'] || i['NODO'],
        "Obra BF": i['Obra BF'],
        "Estado Original": i['Estado (Original Excel)'],
        "Contratista": i['Contratista'] || '-',
        "Estado Forzado (Actual)": i['_MODIFICADO_ESTADO_'] ? i['Estado (Motor)'] : 'Pendiente'
    }));
    const wsOrphans = XLSX.utils.json_to_sheet(orphans.length > 0 ? orphans : [{ "Info": "No hay nodos sin registro en la vista." }]);
    XLSX.utils.book_append_sheet(wb, wsOrphans, "Nodos Sin Registro");

    // 4. Exportar Info de Sesión
    const sessionInfo = [
        { "Dato": "Fecha de Reporte", "Valor": new Date().toLocaleString('es-AR') },
        { "Dato": "Usuario Auditor", "Valor": auditorStr },
        { "Dato": "Fecha de Corte (Auditoría)", "Valor": auditDate },
        { "Dato": "---", "Valor": "---" },
        { "Dato": "Fecha Archivo: Avance de Obras", "Valor": fileUploadDates.avance || "No cargado" },
        { "Dato": "Fecha Archivo: Avance Corporativo", "Valor": fileUploadDates.corporativo || "No cargado" },
        { "Dato": "Fecha Archivo: BCMO", "Valor": fileUploadDates.bcmo || "No cargado" },
        { "Dato": "Fecha Archivo: Sistema TAREA", "Valor": fileUploadDates.tarea || "No cargado" },
        { "Dato": "Fecha Archivo: PMOVXF", "Valor": fileUploadDates.pmovxf || "No cargado" }
    ];
    const wsSession = XLSX.utils.json_to_sheet(sessionInfo);
    XLSX.utils.book_append_sheet(wb, wsSession, "Info de Sesión");

    XLSX.writeFile(wb, `Auditoria_Obras_${new Date().getTime()}.xlsx`);
    showToast("Reporte Maestro Exportado Exitosamente.", "success");
}

// --- VISTA OBRAS SIN MODALIDAD (RECLAMO POR SECTOR) ---
function toggleSinModHeader() {
    const body = document.getElementById('sinModCollapsibleBody');
    const icon = document.getElementById('iconToggleSinModHeader');
    if (!body) return;

    const isHidden = body.classList.contains('hidden');
    if (isHidden) {
        body.classList.remove('hidden');
        if (icon) {
            icon.classList.remove('fa-chevron-down');
            icon.classList.add('fa-chevron-up');
        }
    } else {
        body.classList.add('hidden');
        if (icon) {
            icon.classList.remove('fa-chevron-up');
            icon.classList.add('fa-chevron-down');
        }
    }
}

function syncSinModSector(sectorVal) {
    const s = document.getElementById('sinModQuickSectorFilter');
    if (s && s.value !== sectorVal) s.value = sectorVal;
    renderSinModalidadTable();
}

function filterSinModBySector(sectorVal) {
    syncSinModSector(sectorVal);
}

function getFilteredSinModalidadList() {
    if (!dataConsolidada) return [];

    const sectorFilter = document.getElementById('sinModQuickSectorFilter')?.value || 'TODOS';
    const searchText = document.getElementById('sinModalidadSearch') ? document.getElementById('sinModalidadSearch').value.trim().toLowerCase() : '';

    const allSinMod = dataConsolidada.filter(item => {
        let m = (item['Modalidad de Liquidación Calculada'] || item['Modalidad de Liquidación'] || item['MODALIDAD DE LIQUIDACIÓN'] || '').toUpperCase().trim();
        m = m === '' ? (item['_ORIGEN'] === 'CORPORATIVO' ? 'CORPORATIVO' : 'SIN MODALIDAD') : m;

        // Excluir obras CANCELADAS
        const estadoOriginal = String(item['Estado (Original Excel)'] || item['Estado Original'] || item['_PRISTINE_ESTADO'] || '').toUpperCase();
        const estadoCalculado = String(item['Estado de Avance (Calculado)'] || item['Estado Calculado'] || item['_N_ESTADO'] || '').toUpperCase();

        if (estadoOriginal === 'CANCELADA' || estadoCalculado === 'CANCELADA') {
            return false;
        }

        return m === 'SIN MODALIDAD';
    });

    return allSinMod.filter(item => {
        const origen = String(item['_ORIGEN'] || '').toUpperCase();
        const sector = String(item['Sector Informante'] || '').toUpperCase();
        const esCorp = (origen === 'CORPORATIVO' || sector.includes('CORP'));

        if (sectorFilter === 'OBRAS' && esCorp) return false;
        if (sectorFilter === 'CORPORATIVO' && !esCorp) return false;

        if (searchText) {
            const nodo = String(item['Nodo'] || item['NODO'] || '').toLowerCase();
            const estOrig = String(item['Estado (Original Excel)'] || '').toLowerCase();
            const secInf = String(item['Sector Informante'] || '').toLowerCase();
            const combined = `${nodo} ${estOrig} ${secInf}`;
            if (!combined.includes(searchText)) return false;
        }
        return true;
    });
}

function exportSinModalidadToExcel() {
    const list = getFilteredSinModalidadList();
    if (!list || list.length === 0) {
        showToast("No hay obras sin modalidad para exportar.", "error");
        return;
    }

    const sector = (document.getElementById('sinModQuickSectorFilter')?.value || 'TODOS').toUpperCase();
    const rows = [
        ["#", "Sector Informante / Origen", "Nodo", "Estado Original", "Modalidad"]
    ];

    list.forEach((item, idx) => {
        const origen = String(item['_ORIGEN'] || '').toUpperCase();
        const secInf = item['Sector Informante'] || (origen === 'CORPORATIVO' ? 'Corporativo' : 'Obras');
        rows.push([
            idx + 1,
            secInf,
            item['Nodo'] || item['NODO'] || '-',
            item['Estado (Original Excel)'] || '-',
            "SIN MODALIDAD"
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sin Modalidad");

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Obras_Sin_Modalidad_${sector}_${today}.xlsx`);
    showToast("Excel de Obras sin Modalidad exportado exitosamente.", "success");
}

function enviarMailReclamoSinModalidad() {
    const list = getFilteredSinModalidadList();
    if (!list || list.length === 0) {
        showToast("No hay obras sin modalidad en la vista seleccionada.", "error");
        return;
    }

    const sector = (document.getElementById('sinModQuickSectorFilter')?.value || 'TODOS').toUpperCase();
    const sectorNombre = sector === 'OBRAS' ? 'Gerencia de Obras' : (sector === 'CORPORATIVO' ? 'Sector Corporativo' : 'Sectores Informantes (Obras / Corporativo)');

    const asunto = `URGENTE: Regularización de Modalidad de Liquidación (LEGAJO / TAREA) - ${sectorNombre}`;

    let cuerpo = `Estimados,\n\n`;
    cuerpo += `Se solicita la regularización urgente de la Modalidad de Liquidación para las siguientes obras informadas sin modalidad asignada.\n`;
    cuerpo += `Es condición necesaria definir si cada obra debe ser procesada bajo la modalidad de LEGAJO o TAREA:\n\n`;

    list.slice(0, 50).forEach((item, idx) => {
        const obra = item['Nodo'] || item['NODO'] || '-';
        const sec = item['Sector Informante'] || (item['_ORIGEN'] === 'CORPORATIVO' ? 'Corporativo' : 'Obras');
        cuerpo += `${idx + 1}. Sector Informante: ${sec} | Obra: ${obra}\n`;
    });

    if (list.length > 50) {
        cuerpo += `\n... y ${list.length - 50} obras adicionales (ver archivo adjunto o sistema).\n`;
    }

    cuerpo += `\nAgradecemos regularizar la asignación a la brevedad para poder avanzar con el analisis de la auditoria.\n`;

    const mailtoLink = `mailto:?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
    window.location.href = mailtoLink;
    showToast("Abriendo cliente de correo...", "info");
}

function renderSinModalidadTable() {
    if (!dataConsolidada) return;

    const sectorFilter = document.getElementById('sinModQuickSectorFilter')?.value || 'TODOS';
    const searchText = document.getElementById('sinModalidadSearch') ? document.getElementById('sinModalidadSearch').value.trim().toLowerCase() : '';

    const allSinMod = dataConsolidada.filter(item => {
        let m = (item['Modalidad de Liquidación Calculada'] || item['Modalidad de Liquidación'] || item['MODALIDAD DE LIQUIDACIÓN'] || '').toUpperCase().trim();
        m = m === '' ? (item['_ORIGEN'] === 'CORPORATIVO' ? 'CORPORATIVO' : 'SIN MODALIDAD') : m;

        // Excluir obras CANCELADAS
        const estadoOriginal = String(item['Estado (Original Excel)'] || item['Estado Original'] || item['_PRISTINE_ESTADO'] || '').toUpperCase();
        const estadoCalculado = String(item['Estado de Avance (Calculado)'] || item['Estado Calculado'] || item['_N_ESTADO'] || '').toUpperCase();

        if (estadoOriginal === 'CANCELADA' || estadoCalculado === 'CANCELADA') {
            return false;
        }

        return m === 'SIN MODALIDAD';
    });

    const totalCount = allSinMod.length;
    let obrasCount = 0;
    let corpCount = 0;

    allSinMod.forEach(item => {
        const origen = String(item['_ORIGEN'] || '').toUpperCase();
        const sector = String(item['Sector Informante'] || '').toUpperCase();
        if (origen === 'CORPORATIVO' || sector.includes('CORP')) {
            corpCount++;
        } else {
            obrasCount++;
        }
    });

    // Actualizar KPIs
    const elTotal = document.getElementById('sinModTotalCount');
    if (elTotal) elTotal.textContent = totalCount;
    const elObras = document.getElementById('sinModObrasCount');
    if (elObras) elObras.textContent = obrasCount;
    const elCorp = document.getElementById('sinModCorpCount');
    if (elCorp) elCorp.textContent = corpCount;
    const elText = document.getElementById('sinModCountText');
    if (elText) elText.textContent = `${totalCount} obras sin modalidad`;

    if (typeof setTabBadge === 'function') {
        setTabBadge('tabSinModalidadCount', totalCount);
    }

    // Filtrar según dropdown de sector y buscador
    const filtered = allSinMod.filter(item => {
        const origen = String(item['_ORIGEN'] || '').toUpperCase();
        const sector = String(item['Sector Informante'] || '').toUpperCase();
        const esCorp = (origen === 'CORPORATIVO' || sector.includes('CORP'));

        if (sectorFilter === 'OBRAS' && esCorp) return false;
        if (sectorFilter === 'CORPORATIVO' && !esCorp) return false;

        if (searchText) {
            const nodo = String(item['Nodo'] || item['NODO'] || '').toLowerCase();
            const estOrig = String(item['Estado (Original Excel)'] || '').toLowerCase();
            const secInf = String(item['Sector Informante'] || '').toLowerCase();
            const combined = `${nodo} ${estOrig} ${secInf}`;
            if (!combined.includes(searchText)) return false;
        }
        return true;
    });

    const tbody = document.getElementById('sinModalidadTableBody');
    const emptyState = document.getElementById('emptySinModalidadState');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (filtered.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    filtered.forEach((item, index) => {
        const origen = String(item['_ORIGEN'] || '').toUpperCase();
        const secInf = item['Sector Informante'] || (origen === 'CORPORATIVO' ? 'Corporativo' : 'Obras');
        const esCorp = (origen === 'CORPORATIVO' || String(secInf).toUpperCase().includes('CORP'));

        const sectorBadge = esCorp
            ? `<span class="bg-purple-100 text-purple-700 px-2.5 py-1 rounded-full text-[10px] font-bold border border-purple-200 inline-flex items-center gap-1.5"><i class="fa-solid fa-building"></i>Corporativo</span>`
            : `<span class="bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full text-[10px] font-bold border border-indigo-200 inline-flex items-center gap-1.5"><i class="fa-solid fa-hard-hat"></i>Obras</span>`;

        const nodoOrig = item['Nodo Original'] || item['Nodo'] || item['NODO'] || '';
        const estOrig = item['Estado (Original Excel)'] || item['Estado Original'] || item['_PRISTINE_ESTADO'] || '-';
        const contratista = item['Contratista'] || item['CONTRATISTA'] || item['_N_CONTRATISTA'] || item['Empresa'] || '-';

        // Badge estilizado de Estado de Avance
        const estInfo = (typeof stateColorMap !== 'undefined' && stateColorMap[estOrig])
            ? stateColorMap[estOrig]
            : null;
        const estBadge = estInfo
            ? `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold border ${estInfo.badge} inline-block">${estOrig}</span>`
            : `<span class="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full text-[10px] font-bold border border-slate-200 inline-block">${estOrig}</span>`;

        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100 hover:bg-slate-50 transition-colors text-xs';
        tr.innerHTML = `
            <td class="p-3 border-r border-slate-100 text-slate-400 font-mono text-center">${index + 1}</td>
            <td class="p-3 border-r border-slate-100 whitespace-nowrap">${sectorBadge}</td>
            <td class="p-3 border-r border-slate-100 font-mono font-bold text-slate-800 text-xs">${item['Nodo'] || item['NODO'] || '-'}</td>
            <td class="p-3 border-r border-slate-100 text-slate-700 text-xs">${contratista}</td>
            <td class="p-3 border-r border-slate-100 whitespace-nowrap">${estBadge}</td>
            <td class="p-3 border-r border-slate-100 text-center bg-rose-50/20 whitespace-nowrap">
                <span class="bg-rose-100 text-rose-800 px-2.5 py-1 rounded-full text-[10px] font-bold border border-rose-200 inline-flex items-center gap-1 shadow-2xs" title="Se requiere definir si liquida por LEGAJO o TAREA">
                    <i class="fa-solid fa-triangle-exclamation text-rose-600 text-[9px]"></i> Pendiente (LEGAJO / TAREA)
                </span>
            </td>
            <td class="p-3 text-center whitespace-nowrap">
                <button type="button" onclick="openEditModal('${nodoOrig}', '${estOrig}', '')" 
                    class="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 mx-auto"
                    title="Definir o forzar modalidad">
                    <i class="fa-solid fa-pen-to-square text-[10px]"></i> Asignar
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// =========================================================================
// PRE-AUDITORÍA: INCOHERENCIAS EN NOMBRE POR TAREA (BROWNFIELD)
// =========================================================================

function analizarIncoherenciaNombreTarea(item) {
    if (!item) return null;

    const modalidad = String(item['Modalidad de Liquidación Calculada'] || item['Modalidad de Liquidación'] || item['MODALIDAD DE LIQUIDACIÓN'] || item['_N_MODALIDAD'] || item['Modalidad'] || '').trim().toUpperCase();
    if (!modalidad.includes('TAREA')) {
        return null;
    }

    const estadoOriginal = String(item['Estado (Original Excel)'] || item['Estado Original'] || item['Estado'] || item['_PRISTINE_ESTADO'] || '').toUpperCase();
    const estadoCalculado = String(item['Estado de Avance (Calculado)'] || item['Estado Calculado'] || item['_N_ESTADO'] || '').toUpperCase();
    if (estadoOriginal === 'CANCELADA' || estadoCalculado === 'CANCELADA') {
        return null;
    }

    const nodoRaw = String(item['Nodo'] || item['NODO'] || item['nodo'] || item['Nodo Original'] || '').trim();
    const proyectoRaw = String(item['Proyecto'] || item['PROYECTO'] || '').trim();
    const etapaRaw = String(item['Etapa'] || item['ETAPA'] || '').trim();
    const nombreTareaRaw = String(item['Nombre por TAREA'] || item['NOMBRE POR TAREA'] || item['_N_NOMBRE_POR_TAREA'] || '').trim();

    if (!nodoRaw && !proyectoRaw) {
        return null;
    }

    let baseProyecto = proyectoRaw.toUpperCase();
    let baseEtapa = etapaRaw.toUpperCase();

    if (!baseProyecto && nodoRaw) {
        const parts = nodoRaw.split(/\s+/);
        baseProyecto = parts[0] ? parts[0].toUpperCase() : '';
        if (parts.length > 1) {
            baseEtapa = parts[1].toUpperCase();
        }
    }

    const nodoLimpio = nodoRaw.replace(/\s+/g, '').toUpperCase();
    const nodo7 = nodoLimpio.substring(0, 7);
    const ntUpper = nombreTareaRaw.toUpperCase().replace(/\s+/g, '');

    // Regla de Negocio: Si los primeros 7 caracteres de Nodo (sin espacios) coinciden con Nombre por TAREA, no está mal
    if (ntUpper && (ntUpper === nodo7 || ntUpper === nodoLimpio)) {
        return null;
    }

    let nombreEsperado = '';
    if (nodo7.length === 7) {
        nombreEsperado = nodo7;
    } else if (baseProyecto.length >= 7) {
        nombreEsperado = baseProyecto.substring(0, 7);
    } else if (baseProyecto) {
        let s = baseProyecto;
        if (baseEtapa) s += baseEtapa.replace(/[^A-Z0-9]/g, '');
        if (s.length < 7) s += 'FO';
        nombreEsperado = s.substring(0, 7);
    } else if (nodoRaw) {
        if (nodoLimpio.includes('FO')) {
            nombreEsperado = nodoLimpio.split('FO')[0] + 'FO';
        } else if (nodoLimpio.includes('OC')) {
            nombreEsperado = nodoLimpio.split('OC')[0] + 'FO';
        } else {
            nombreEsperado = nodoLimpio.substring(0, 5) + 'FO';
        }
    }

    const espUpper = nombreEsperado.toUpperCase().replace(/\s+/g, '');

    if (ntUpper && ntUpper === espUpper) {
        return null;
    }

    let tipoError = '';
    let detalleError = '';
    let badgeColor = '';

    const sufijoEsperado = nombreEsperado.length > baseProyecto.length 
        ? nombreEsperado.substring(baseProyecto.length) 
        : '';

    if (!nombreTareaRaw) {
        tipoError = 'SIN_NOMBRE_TAREA';
        detalleError = `Campo vacío (debe indicar '${nombreEsperado}')`;
        badgeColor = 'bg-slate-100 text-slate-700 border-slate-300';
    } else if (ntUpper.includes('OC') && espUpper.includes('FO')) {
        tipoError = 'ERROR_SUFIJO_OC';
        detalleError = `Pusieron 'OC' en lugar de 'FO' (figura '${nombreTareaRaw}', debe ser '${nombreEsperado}')`;
        badgeColor = 'bg-rose-100 text-rose-700 border-rose-300';
    } else if (ntUpper.includes('FO') && espUpper.includes('OC')) {
        tipoError = 'ERROR_SUFIJO_FO';
        detalleError = `Pusieron 'FO' en lugar de 'OC' (figura '${nombreTareaRaw}', debe ser '${nombreEsperado}')`;
        badgeColor = 'bg-rose-100 text-rose-700 border-rose-300';
    } else if (ntUpper === baseProyecto && sufijoEsperado) {
        tipoError = 'FALTA_SUFIJO';
        detalleError = `Falta sufijo '${sufijoEsperado}' (figura '${nombreTareaRaw}', debe ser '${nombreEsperado}')`;
        badgeColor = 'bg-amber-100 text-amber-800 border-amber-300';
    } else if (sufijoEsperado && !ntUpper.endsWith(sufijoEsperado)) {
        tipoError = 'FALTA_SUFIJO';
        detalleError = `No termina en '${sufijoEsperado}' (figura '${nombreTareaRaw}', debe ser '${nombreEsperado}')`;
        badgeColor = 'bg-amber-100 text-amber-800 border-amber-300';
    } else {
        tipoError = 'NOMBRE_DISCORDANTE';
        detalleError = `Discrepancia con Nodo (figura '${nombreTareaRaw}', debe ser '${nombreEsperado}')`;
        badgeColor = 'bg-indigo-100 text-indigo-700 border-indigo-300';
    }

    return {
        itemOriginal: item,
        zona: item['Zona'] || item['ZONA'] || '-',
        partido: item['Partido'] || item['PARTIDO'] || item['Localidad'] || item['LOCALIDAD'] || '-',
        proyecto: baseProyecto || '-',
        etapa: baseEtapa || '-',
        nodo: nodoRaw || '-',
        estado: item['Estado (Original Excel)'] || item['Estado Original'] || item['Estado'] || item['Estado de Avance (Calculado)'] || '-',
        avance: item['% Avance'] || item['% AVANCE'] || '0%',
        contratista: item['CONTRATISTA'] || item['Contratista'] || item['Empresa'] || item['_N_CONTRATISTA'] || '-',
        nombreTareaActual: nombreTareaRaw || '(Vacío)',
        nombreEsperado: nombreEsperado,
        tipoError: tipoError,
        detalleError: detalleError,
        badgeColor: badgeColor
    };
}

// --- CLASIFICACIÓN Y FILTRADO AVANZADO DE INCOHERENCIAS TAREA ---
let incoherenciasTareaActiveFilter = 'prioritarias';

function getItemCerrados(item) {
    if (!item) return 0;
    const orig = item.itemOriginal || {};
    let c = parseInt(orig['TAREA - Cerrados'] || orig['_N_CERRADOS'] || orig['Cerrados'] || 0) || 0;
    if (c === 0 && (typeof dataTarea !== 'undefined' && Array.isArray(dataTarea))) {
        const matchT = dataTarea.find(t => {
            const k = String(t['_N_OBRA_BF'] || t['Obra BF'] || t['OBRA_BF'] || '').trim().toUpperCase();
            return k === (item.nombreEsperado || '').toUpperCase() || k === (item.nodo || '').replace(/\s+/g, '').toUpperCase();
        });
        if (matchT) {
            c = parseInt(matchT['_N_CERRADOS'] || matchT['CERRADOS'] || matchT['Cerrados'] || 0) || 0;
        }
    }
    return c;
}

function classifyIncoherenciaTarea(item) {
    if (!item) return 'otro';
    // 1. Obras mal tipeadas (cualquiera sea el estado)
    if (item.tipoError !== 'SIN_NOMBRE_TAREA') {
        return 'mal_tipeadas';
    }

    const estNorm = String(item.estado || '').toUpperCase();
    const esIniciadaTerminada = estNorm.includes('EJECUCI') || 
                               estNorm.includes('TERMINAD') || 
                               estNorm.includes('FINALIZAD') || 
                               estNorm.includes('CIERRE') || 
                               estNorm.includes('TECNIC');

    // 2. Obras iniciadas / terminadas sin nombre
    if (esIniciadaTerminada) {
        return 'iniciadas_terminadas';
    }

    // 3. A EJECUTAR con tickets cerrados
    const cerrados = getItemCerrados(item);
    if (cerrados > 0) {
        return 'a_ejecutar_tickets';
    }

    // 4. A EJECUTAR sin tickets cerrados (informativas no prioritarias)
    return 'a_ejecutar_sin_tickets';
}

function setIncoherenciasTareaFilter(filterType) {
    incoherenciasTareaActiveFilter = filterType;
    
    // Conmutar estilos activos en las píldoras de filtrado
    const filters = ['prioritarias', 'mal_tipeadas', 'iniciadas_terminadas', 'a_ejecutar_tickets', 'a_ejecutar_sin_tickets', 'todas'];
    filters.forEach(f => {
        const btn = document.getElementById(`btnIncFiltro_${f}`);
        if (!btn) return;
        if (f === filterType) {
            btn.className = 'inc-filter-pill active px-3 py-1 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs border border-amber-500 bg-amber-600 text-white cursor-pointer';
        } else {
            btn.className = 'inc-filter-pill px-3 py-1 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer';
        }
    });

    renderIncoherenciasTareaTable();
}

function getFilteredIncoherenciasTareaList() {
    const data = (typeof dataConsolidada !== 'undefined' && Array.isArray(dataConsolidada)) 
        ? dataConsolidada 
        : (window.dataConsolidada || []);
    if (!data || data.length === 0) return [];

    const all = data.map(analizarIncoherenciaNombreTarea).filter(Boolean);

    // Filtrar según categoría seleccionada
    let list = all;
    if (incoherenciasTareaActiveFilter === 'prioritarias') {
        list = all.filter(item => {
            const cat = classifyIncoherenciaTarea(item);
            return cat === 'mal_tipeadas' || cat === 'iniciadas_terminadas' || cat === 'a_ejecutar_tickets';
        });
    } else if (incoherenciasTareaActiveFilter === 'mal_tipeadas') {
        list = all.filter(item => classifyIncoherenciaTarea(item) === 'mal_tipeadas');
    } else if (incoherenciasTareaActiveFilter === 'iniciadas_terminadas') {
        list = all.filter(item => classifyIncoherenciaTarea(item) === 'iniciadas_terminadas');
    } else if (incoherenciasTareaActiveFilter === 'a_ejecutar_tickets') {
        list = all.filter(item => classifyIncoherenciaTarea(item) === 'a_ejecutar_tickets');
    } else if (incoherenciasTareaActiveFilter === 'a_ejecutar_sin_tickets') {
        list = all.filter(item => classifyIncoherenciaTarea(item) === 'a_ejecutar_sin_tickets');
    }

    // Filtrar por término de búsqueda en tiempo real
    const searchInput = document.getElementById('incoherenciasTareaSearch');
    const q = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (!q) return list;

    return list.filter(item => {
        const combined = `${item.nodo} ${item.proyecto} ${item.etapa} ${item.nombreTareaActual} ${item.nombreEsperado} ${item.contratista} ${item.detalleError} ${item.estado}`.toLowerCase();
        return combined.includes(q);
    });
}

function renderIncoherenciasTareaTable() {
    const data = (typeof dataConsolidada !== 'undefined' && Array.isArray(dataConsolidada)) 
        ? dataConsolidada 
        : (window.dataConsolidada || []);
    if (!data) return;

    const allIncoherencias = data.map(analizarIncoherenciaNombreTarea).filter(Boolean);

    // Conteo por categorías
    let countMalTipeadas = 0;
    let countIniciadasTerm = 0;
    let countConTickets = 0;
    let countSinTickets = 0;

    allIncoherencias.forEach(item => {
        const cat = classifyIncoherenciaTarea(item);
        if (cat === 'mal_tipeadas') countMalTipeadas++;
        else if (cat === 'iniciadas_terminadas') countIniciadasTerm++;
        else if (cat === 'a_ejecutar_tickets') countConTickets++;
        else if (cat === 'a_ejecutar_sin_tickets') countSinTickets++;
    });

    const countPrioritarias = countMalTipeadas + countIniciadasTerm + countConTickets;

    // Actualizar badges en las píldoras de filtrado
    const bPrio = document.getElementById('badgeCountPrioritarias');
    if (bPrio) bPrio.textContent = countPrioritarias;
    const bMal = document.getElementById('badgeCountMalTipeadas');
    if (bMal) bMal.textContent = countMalTipeadas;
    const bIni = document.getElementById('badgeCountIniciadas');
    if (bIni) bIni.textContent = countIniciadasTerm;
    const bCon = document.getElementById('badgeCountConTickets');
    if (bCon) bCon.textContent = countConTickets;
    const bSin = document.getElementById('badgeCountSinTickets');
    if (bSin) bSin.textContent = countSinTickets;
    const bTodas = document.getElementById('badgeCountTodas');
    if (bTodas) bTodas.textContent = allIncoherencias.length;

    // Actualizar el badge de la solapa / dropdown EXCLUSIVAMENTE con el conteo de Prioritarias
    if (typeof setTabBadge === 'function') {
        setTabBadge('tabIncoherenciasTareaCount', countPrioritarias);
    }

    const filtered = getFilteredIncoherenciasTareaList();
    const countTextEl = document.getElementById('incoherenciasTareaCountText');
    if (countTextEl) {
        if (incoherenciasTareaActiveFilter === 'prioritarias') {
            countTextEl.textContent = `${countPrioritarias} inconsistencia${countPrioritarias === 1 ? '' : 's'} prioritaria${countPrioritarias === 1 ? '' : 's'}`;
        } else {
            countTextEl.textContent = `${filtered.length} visible${filtered.length === 1 ? '' : 's'} (${countPrioritarias} prioritarias)`;
        }
    }

    const tbody = document.getElementById('incoherenciasTareaTableBody');
    const emptyState = document.getElementById('emptyIncoherenciasTareaState');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (filtered.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    filtered.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100 hover:bg-slate-50 transition-colors text-xs';
        tr.innerHTML = `
            <td class="p-3 border-r border-slate-100 text-slate-400 font-mono text-center">${index + 1}</td>
            <td class="p-3 border-r border-slate-100 font-mono font-bold text-amber-900 bg-amber-50/30 text-xs">${item.nodo}</td>
            <td class="p-3 border-r border-slate-100 text-slate-700 text-xs">${item.proyecto} / ${item.etapa}</td>
            <td class="p-3 border-r border-slate-100 font-mono font-bold text-rose-700 bg-rose-50/20 text-xs">
                <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200">
                    <i class="fa-solid fa-xmark text-rose-500"></i> ${item.nombreTareaActual || '(Vacío)'}
                </span>
            </td>
            <td class="p-3 border-r border-slate-100 font-mono font-bold text-emerald-800 bg-emerald-50/20 text-xs">
                <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                    <i class="fa-solid fa-check text-emerald-600"></i> ${item.nombreEsperado}
                </span>
            </td>
            <td class="p-3 border-r border-slate-100 whitespace-nowrap">
                <span class="px-2.5 py-1 rounded-full text-[10px] font-bold border ${item.badgeColor} inline-flex items-center gap-1 shadow-2xs">
                    <i class="fa-solid fa-triangle-exclamation text-[9px]"></i> ${item.detalleError}
                </span>
            </td>
            <td class="p-3 border-r border-slate-100 text-slate-700 text-xs">${item.estado}</td>
            <td class="p-3 border-r border-slate-100 text-center font-semibold text-slate-700 text-xs">${item.avance}</td>
            <td class="p-3 text-slate-700 text-xs whitespace-nowrap">${item.contratista}</td>
        `;
        tbody.appendChild(tr);
    });
}

function exportIncoherenciasTareaToExcel() {
    const list = getFilteredIncoherenciasTareaList();
    if (!list || list.length === 0) {
        showToast("No hay inconsistencias en Nombre por TAREA para exportar.", "info");
        return;
    }

    const rows = [
        ["#", "Nodo (Oficial)", "Proyecto", "Etapa", "Nombre por TAREA (Informado)", "Nombre Esperado (Sugerido)", "Inconsistencia Detectada", "Estado", "% Avance", "Contratista"]
    ];

    list.forEach((item, idx) => {
        rows.push([
            idx + 1,
            item.nodo,
            item.proyecto,
            item.etapa,
            item.nombreTareaActual,
            item.nombreEsperado,
            item.detalleError,
            item.estado,
            item.avance,
            item.contratista
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Incoherencias TAREA");

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Incoherencias_Nombre_TAREA_${today}.xlsx`);
    showToast("Excel de Incoherencias Nombre por TAREA exportado exitosamente.", "success");
}

function enviarMailIncoherenciasTarea() {
    const list = getFilteredIncoherenciasTareaList();
    if (!list || list.length === 0) {
        showToast("No hay inconsistencias en la vista actual para notificar.", "info");
        return;
    }

    // 1. Obtener lista completa de incoherencias para conteos globales
    const allIncoherencias = (typeof dataConsolidada !== 'undefined' && Array.isArray(dataConsolidada))
        ? dataConsolidada.map(analizarIncoherenciaNombreTarea).filter(Boolean)
        : list;

    // Helper para verificar tickets cerrados
    const getCerrados = (item) => {
        const orig = item.itemOriginal || {};
        let c = parseInt(orig['TAREA - Cerrados'] || orig['_N_CERRADOS'] || orig['Cerrados'] || 0) || 0;
        if (c === 0 && (typeof dataTarea !== 'undefined' && Array.isArray(dataTarea))) {
            const matchT = dataTarea.find(t => {
                const k = String(t['_N_OBRA_BF'] || t['Obra BF'] || t['OBRA_BF'] || '').trim().toUpperCase();
                return k === item.nombreEsperado.toUpperCase() || k === item.nodo.replace(/\s+/g, '').toUpperCase();
            });
            if (matchT) {
                c = parseInt(matchT['_N_CERRADOS'] || matchT['CERRADOS'] || matchT['Cerrados'] || 0) || 0;
            }
        }
        return c;
    };

    // Clasificación de los 3 grupos sobre 'list'
    const grupo1MalTipeadas = [];
    const grupo2IniciadasTerminadas = [];
    const grupo3AEjecutarConTickets = [];

    list.forEach(item => {
        // Punto 1: Obras mal tipeadas (no vacías)
        if (item.tipoError !== 'SIN_NOMBRE_TAREA') {
            grupo1MalTipeadas.push(item);
            return;
        }

        // Para obras con campo vacío: evaluar estado de avance
        const estNorm = String(item.estado || '').toUpperCase();
        const esIniciadaTerminada = estNorm.includes('EJECUCI') || 
                                   estNorm.includes('TERMINAD') || 
                                   estNorm.includes('FINALIZAD') || 
                                   estNorm.includes('CIERRE') || 
                                   estNorm.includes('TECNIC');

        if (esIniciadaTerminada) {
            // Punto 2: Obras Iniciadas / Terminadas sin nombre informado
            grupo2IniciadasTerminadas.push(item);
            return;
        }

        // Punto 3: Obras que figuran 'A EJECUTAR' pero tienen tickets CERRADOS
        const esAEjecutar = estNorm.includes('A EJECUTAR');
        const cerrados = getCerrados(item);

        if (esAEjecutar && cerrados > 0) {
            grupo3AEjecutarConTickets.push({ ...item, cerrados: cerrados });
        }
    });

    // Conteo de obras A EJECUTAR sin nombre y sin tickets cerrados (global)
    const cantAEjecutarSinTickets = allIncoherencias.filter(item => {
        if (item.tipoError !== 'SIN_NOMBRE_TAREA') return false;
        const estNorm = String(item.estado || '').toUpperCase();
        if (!estNorm.includes('A EJECUTAR')) return false;
        return getCerrados(item) === 0;
    }).length;

    // Si no hay obras en ninguno de los 3 grupos, informar
    if (grupo1MalTipeadas.length === 0 && grupo2IniciadasTerminadas.length === 0 && grupo3AEjecutarConTickets.length === 0) {
        showToast("No hay inconsistencias operativas (mal tipeadas, iniciadas/terminadas o con tickets cerrados) para notificar por correo.", "info");
        return;
    }

    const contratista = list.find(i => i.contratista && i.contratista !== '-')?.contratista || 'CONTRATISTA';
    const asunto = `Regularización de 'Nombre por TAREA' y Estados de Avance - ${contratista}`;

    let currentIncoherenciasMailPayload = null;

    // --- 1. CUERPO LIGERO PARA mailto: (evita límite de 2048 caracteres en Windows/Outlook) ---
    let cuerpoMailto = `Estimados,\n\n`;
    cuerpoMailto += `Se solicita la revisión y regularización en la carga del campo 'Nombre por TAREA' y los estados de avance para las siguientes obras bajo modalidad TAREA de ${contratista}.\n\n`;
    cuerpoMailto += `Resumen de inconsistencias detectadas:\n`;
    cuerpoMailto += `• Obras con error de tipeo / sufijo: ${grupo1MalTipeadas.length} obras\n`;
    cuerpoMailto += `• Obras Iniciadas o Terminadas sin nombre informado: ${grupo2IniciadasTerminadas.length} obras\n`;
    cuerpoMailto += `• Obras 'A EJECUTAR' con tickets cerrados en curso: ${grupo3AEjecutarConTickets.length} obras\n`;
    cuerpoMailto += `• Total en 'A EJECUTAR' sin nombre: ${cantAEjecutarSinTickets} obras\n\n`;
    cuerpoMailto += `[El detalle completo con las tablas maquetadas ha sido copiado a su portapapeles. Presione Ctrl + V para insertarlas]\n\n`;
    cuerpoMailto += `Saludos cordiales.`;

    // --- 2. CUERPO COMPLETO EN TEXTO PLANO (para fallback) ---
    let cuerpo = `Estimados,\n\n`;
    cuerpo += `Se solicita la revisión y regularización en la carga del campo 'Nombre por TAREA' y los estados de avance para las siguientes obras bajo modalidad TAREA.\n`;
    cuerpo += `Se detalla a continuación el nombre estimado según nomenclatura de cada nodo para su validación y asignación correspondiente:\n\n`;

    // 1. Obras con error de tipeo
    cuerpo += `1. OBRAS CON DIFERENCIAS O ERROR DE TIPEO EN 'NOMBRE POR TAREA':\n`;
    if (grupo1MalTipeadas.length > 0) {
        grupo1MalTipeadas.slice(0, 30).forEach(item => {
            cuerpo += `• Nodo: ${item.nodo} | Informado: '${item.nombreTareaActual}' -> Nombre estimado según Nodo: '${item.nombreEsperado}' (validar) | Motivo: ${item.detalleError} | Estado: ${item.estado}\n`;
        });
        if (grupo1MalTipeadas.length > 30) {
            cuerpo += `  (... y ${grupo1MalTipeadas.length - 30} obras adicionales con error de tipeo)\n`;
        }
    } else {
        cuerpo += `No se registran obras con error de tipeo.\n`;
    }
    cuerpo += `\n`;

    // 2. Obras iniciadas / terminadas sin nombre
    cuerpo += `2. OBRAS INICIADAS / TERMINADAS SIN 'NOMBRE POR TAREA' INFORMADO:\n`;
    if (grupo2IniciadasTerminadas.length > 0) {
        grupo2IniciadasTerminadas.slice(0, 40).forEach(item => {
            cuerpo += `• ${item.nodo} (${item.estado}) -> Nombre estimado: ${item.nombreEsperado} (validar y asignar)\n`;
        });
        if (grupo2IniciadasTerminadas.length > 40) {
            cuerpo += `  (... y ${grupo2IniciadasTerminadas.length - 40} obras adicionales iniciadas/terminadas)\n`;
        }
    } else {
        cuerpo += `No se registran obras iniciadas o terminadas sin nombre informado.\n`;
    }
    cuerpo += `\nTotal de obras en estado 'A EJECUTAR' sin Nombre por TAREA informado (sin tickets cerrados aún): ${cantAEjecutarSinTickets} obras.\n\n`;

    // 3. Inconsistencia en avance (A EJECUTAR con tickets cerrados)
    cuerpo += `3. INCONSISTENCIA EN ESTADO DE AVANCE (INFORMADAS 'A EJECUTAR' CON TICKETS CERRADOS):\n`;
    cuerpo += `Las siguientes obras figuran en Avance como 'A EJECUTAR', pero registran tickets cerrados en el sistema TAREA (se encuentran efectivamente en curso):\n`;
    if (grupo3AEjecutarConTickets.length > 0) {
        grupo3AEjecutarConTickets.slice(0, 30).forEach(item => {
            cuerpo += `• Nodo: ${item.nodo} | Tickets Cerrados: ${item.cerrados} | Nombre estimado: ${item.nombreEsperado} (validar y regularizar avance)\n`;
        });
        if (grupo3AEjecutarConTickets.length > 30) {
            cuerpo += `  (... y ${grupo3AEjecutarConTickets.length - 30} obras adicionales en esta condición)\n`;
        }
    } else {
        cuerpo += `No se registran obras 'A EJECUTAR' con tickets cerrados.\n`;
    }
    cuerpo += `\n`;
    cuerpo += `Agradecemos gestionar las validaciones y correcciones correspondientes a la brevedad.\n\nSaludos cordiales.`;

    // --- 3. CUERPO EN HTML ENRIQUECIDO CON TABLAS ESTILIZADAS (para portapapeles) ---
    const tableStyle = 'border-collapse:collapse;width:100%;max-width:960px;font-family:Calibri,Segoe UI,Arial,sans-serif;font-size:12px;margin:8px 0 16px 0;';
    const thStyle = 'background-color:#ffffff;color:#0f172a;padding:8px 10px;border:1px solid #94a3b8;border-bottom:2px solid #0f172a;text-align:left;font-weight:bold;font-size:12px;';
    const tdStyle = 'padding:6px 10px;border:1px solid #cbd5e1;font-size:12px;color:#334155;';
    const tdAltStyle = 'padding:6px 10px;border:1px solid #cbd5e1;font-size:12px;color:#334155;background-color:#f8fafc;';

    let htmlCuerpo = `<div style="font-family:Calibri,Segoe UI,Arial,sans-serif;font-size:13px;color:#1e293b;line-height:1.5;">`;
    htmlCuerpo += `<p>Estimados,</p>`;
    htmlCuerpo += `<p>Se solicita la revisión y regularización en la carga del campo <strong>'Nombre por TAREA'</strong> y los estados de avance para las siguientes obras bajo modalidad TAREA.<br>`;
    htmlCuerpo += `Se detalla a continuación el <strong>nombre estimado según nomenclatura de cada nodo</strong> para su validación y asignación correspondiente:</p>`;

    // Tabla Punto 1
    htmlCuerpo += `<h3 style="color:#0f172a;margin:20px 0 6px 0;font-size:14px;border-bottom:2px solid #cbd5e1;padding-bottom:4px;">1. OBRAS CON DIFERENCIAS O ERROR DE TIPEO EN 'NOMBRE POR TAREA'</h3>`;
    if (grupo1MalTipeadas.length > 0) {
        htmlCuerpo += `<table style="${tableStyle}"><thead><tr>`;
        htmlCuerpo += `<th style="${thStyle}">Nodo</th>`;
        htmlCuerpo += `<th style="${thStyle}">Nombre Informado</th>`;
        htmlCuerpo += `<th style="${thStyle}">Nombre Estimado (Validar)</th>`;
        htmlCuerpo += `<th style="${thStyle}">Motivo / Diagnóstico</th>`;
        htmlCuerpo += `<th style="${thStyle}">Estado de Avance</th>`;
        htmlCuerpo += `</tr></thead><tbody>`;
        grupo1MalTipeadas.slice(0, 50).forEach((item, idx) => {
            const rowBg = idx % 2 === 1 ? tdAltStyle : tdStyle;
            htmlCuerpo += `<tr>`;
            htmlCuerpo += `<td style="${rowBg}font-weight:bold;color:#0f172a;">${item.nodo}</td>`;
            htmlCuerpo += `<td style="${rowBg}color:#dc2626;font-weight:bold;background-color:#fef2f2;">${item.nombreTareaActual || '(Vacío)'}</td>`;
            htmlCuerpo += `<td style="${rowBg}color:#15803d;font-weight:bold;background-color:#f0fdf4;">${item.nombreEsperado}</td>`;
            htmlCuerpo += `<td style="${rowBg}">${item.detalleError}</td>`;
            htmlCuerpo += `<td style="${rowBg}">${item.estado}</td>`;
            htmlCuerpo += `</tr>`;
        });
        htmlCuerpo += `</tbody></table>`;
        if (grupo1MalTipeadas.length > 50) {
            htmlCuerpo += `<p style="font-size:11px;color:#64748b;font-style:italic;">(... y ${grupo1MalTipeadas.length - 50} obras adicionales con error de tipeo)</p>`;
        }
    } else {
        htmlCuerpo += `<p style="color:#64748b;font-style:italic;">No se registran obras con error de tipeo.</p>`;
    }

    // Tabla Punto 2
    htmlCuerpo += `<h3 style="color:#0f172a;margin:22px 0 6px 0;font-size:14px;border-bottom:2px solid #cbd5e1;padding-bottom:4px;">2. OBRAS INICIADAS / TERMINADAS SIN 'NOMBRE POR TAREA' INFORMADO</h3>`;
    if (grupo2IniciadasTerminadas.length > 0) {
        htmlCuerpo += `<table style="${tableStyle}"><thead><tr>`;
        htmlCuerpo += `<th style="${thStyle}">Nodo</th>`;
        htmlCuerpo += `<th style="${thStyle}">Estado de Avance</th>`;
        htmlCuerpo += `<th style="${thStyle}">Nombre Estimado según Nodo (Validar y Asignar)</th>`;
        htmlCuerpo += `</tr></thead><tbody>`;
        grupo2IniciadasTerminadas.slice(0, 60).forEach((item, idx) => {
            const rowBg = idx % 2 === 1 ? tdAltStyle : tdStyle;
            htmlCuerpo += `<tr>`;
            htmlCuerpo += `<td style="${rowBg}font-weight:bold;color:#0f172a;">${item.nodo}</td>`;
            htmlCuerpo += `<td style="${rowBg}font-weight:600;color:#0369a1;">${item.estado}</td>`;
            htmlCuerpo += `<td style="${rowBg}color:#15803d;font-weight:bold;background-color:#f0fdf4;">${item.nombreEsperado}</td>`;
            htmlCuerpo += `</tr>`;
        });
        htmlCuerpo += `</tbody></table>`;
        if (grupo2IniciadasTerminadas.length > 60) {
            htmlCuerpo += `<p style="font-size:11px;color:#64748b;font-style:italic;">(... y ${grupo2IniciadasTerminadas.length - 60} obras adicionales iniciadas/terminadas)</p>`;
        }
    } else {
        htmlCuerpo += `<p style="color:#64748b;font-style:italic;">No se registran obras iniciadas o terminadas sin nombre informado.</p>`;
    }
    htmlCuerpo += `<p style="margin:10px 0 16px 0;color:#475569;"><strong>Total de obras en estado 'A EJECUTAR' sin Nombre por TAREA informado (sin tickets cerrados aún):</strong> ${cantAEjecutarSinTickets} obras.</p>`;

    // Tabla Punto 3
    htmlCuerpo += `<h3 style="color:#0f172a;margin:22px 0 6px 0;font-size:14px;border-bottom:2px solid #cbd5e1;padding-bottom:4px;">3. INCONSISTENCIA EN ESTADO DE AVANCE (INFORMADAS 'A EJECUTAR' CON TICKETS CERRADOS)</h3>`;
    htmlCuerpo += `<p style="margin:4px 0 8px 0;color:#475569;">Las siguientes obras figuran en Avance como 'A EJECUTAR', pero registran tickets cerrados en el sistema TAREA (se encuentran efectivamente en curso):</p>`;
    if (grupo3AEjecutarConTickets.length > 0) {
        htmlCuerpo += `<table style="${tableStyle}"><thead><tr>`;
        htmlCuerpo += `<th style="${thStyle}">Nodo</th>`;
        htmlCuerpo += `<th style="${thStyle}">Tickets Cerrados en TAREA</th>`;
        htmlCuerpo += `<th style="${thStyle}">Nombre Estimado (Validar)</th>`;
        htmlCuerpo += `<th style="${thStyle}">Acción Requerida</th>`;
        htmlCuerpo += `</tr></thead><tbody>`;
        grupo3AEjecutarConTickets.slice(0, 50).forEach((item, idx) => {
            const rowBg = idx % 2 === 1 ? tdAltStyle : tdStyle;
            htmlCuerpo += `<tr>`;
            htmlCuerpo += `<td style="${rowBg}font-weight:bold;color:#0f172a;">${item.nodo}</td>`;
            htmlCuerpo += `<td style="${rowBg}text-align:center;font-weight:bold;color:#b91c1c;background-color:#fef2f2;">${item.cerrados}</td>`;
            htmlCuerpo += `<td style="${rowBg}color:#15803d;font-weight:bold;background-color:#f0fdf4;">${item.nombreEsperado}</td>`;
            htmlCuerpo += `<td style="${rowBg}color:#b45309;font-weight:600;">Validar y regularizar estado de avance</td>`;
            htmlCuerpo += `</tr>`;
        });
        htmlCuerpo += `</tbody></table>`;
        if (grupo3AEjecutarConTickets.length > 50) {
            htmlCuerpo += `<p style="font-size:11px;color:#64748b;font-style:italic;">(... y ${grupo3AEjecutarConTickets.length - 50} obras adicionales en esta condición)</p>`;
        }
    } else {
        htmlCuerpo += `<p style="color:#64748b;font-style:italic;">No se registran obras 'A EJECUTAR' con tickets cerrados.</p>`;
    }

    htmlCuerpo += `<p style="margin-top:20px;">Agradecemos gestionar las validaciones y correcciones correspondientes a la brevedad.</p>`;
    htmlCuerpo += `<p style="margin-top:10px;">Saludos cordiales.</p>`;
    htmlCuerpo += `</div>`;

    // Guardar payload global para recopiar o reabrir
    window._lastIncoherenciasMailPayload = {
        contratista,
        asunto,
        cuerpoMailto,
        cuerpoCompletoTexto: cuerpo,
        htmlCuerpo
    };

    // --- 4. COPIAR HTML AL PORTAPAPELES (Con soporte dual ClipboardItem + Fallback DOM) ---
    copiarTablasIncoherenciasAlPortapapeles(htmlCuerpo, cuerpo);

    // --- 5. ABRIR CARTEL / MODAL PROFESIONAL DE NOTIFICACIÓN ---
    const modalEl = document.getElementById('incoherenciasMailModal');
    if (modalEl) {
        const contrEl = document.getElementById('incoherenciasModalContratistaText');
        if (contrEl) contrEl.textContent = `Contratista: ${contratista}`;
        const p1El = document.getElementById('incoherenciasModalCountP1');
        if (p1El) p1El.textContent = grupo1MalTipeadas.length;
        const p2El = document.getElementById('incoherenciasModalCountP2');
        if (p2El) p2El.textContent = grupo2IniciadasTerminadas.length;
        const p3El = document.getElementById('incoherenciasModalCountP3');
        if (p3El) p3El.textContent = grupo3AEjecutarConTickets.length;
        modalEl.classList.remove('hidden');
    }

    // --- 6. ABRIR CLIENTE DE CORREO (mailto: seguro < 2048 chars) ---
    const mailtoLink = `mailto:?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpoMailto)}`;
    window.location.href = mailtoLink;
}

// Helper robusto para copiado al portapapeles enriquecido con fallback
function copiarTablasIncoherenciasAlPortapapeles(htmlCuerpo, textoPlano) {
    if (navigator.clipboard && window.ClipboardItem) {
        try {
            const textBlob = new Blob([textoPlano], { type: 'text/plain' });
            const htmlBlob = new Blob([htmlCuerpo], { type: 'text/html' });
            const item = new ClipboardItem({
                'text/plain': textBlob,
                'text/html': htmlBlob
            });
            navigator.clipboard.write([item]).then(() => {
                showToast("¡Tablas con formato copiadas! Dale 'Ctrl + V' en el cuerpo del correo.", "success", 6000);
            }).catch(err => {
                console.warn("ClipboardItem write falló, usando fallback DOM:", err);
                copiarHtmlFallbackDOM(htmlCuerpo, textoPlano);
            });
            return;
        } catch (e) {
            console.warn("Excepción en ClipboardItem:", e);
        }
    }
    copiarHtmlFallbackDOM(htmlCuerpo, textoPlano);
}

// Fallback universal mediante selección DOM temporal (funciona incluso en file:///)
function copiarHtmlFallbackDOM(htmlCuerpo, textoPlano) {
    try {
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = '-9999px';
        container.style.top = '0';
        container.style.opacity = '0';
        container.style.pointerEvents = 'none';
        container.innerHTML = htmlCuerpo;
        document.body.appendChild(container);

        const range = document.createRange();
        range.selectNodeContents(container);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        const success = document.execCommand('copy');
        selection.removeAllRanges();
        document.body.removeChild(container);

        if (success) {
            showToast("¡Tablas con formato copiadas! Dale 'Ctrl + V' en el cuerpo del correo.", "success", 6000);
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(textoPlano);
            showToast("Texto copiado al portapapeles.", "info");
        }
    } catch (err) {
        console.error("Error en copiarHtmlFallbackDOM:", err);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(textoPlano);
        }
    }
}

// Manejadores del Modal de Notificación de Incoherencias
function closeIncoherenciasMailModal() {
    const modalEl = document.getElementById('incoherenciasMailModal');
    if (modalEl) modalEl.classList.add('hidden');
}

function copiarTablasIncoherenciasNuevamente() {
    const p = window._lastIncoherenciasMailPayload;
    if (p && p.htmlCuerpo) {
        copiarTablasIncoherenciasAlPortapapeles(p.htmlCuerpo, p.cuerpoCompletoTexto);
        showToast("¡Tablas recopiladas en el portapapeles exitosamente!", "success");
    } else {
        showToast("No hay tablas activas para copiar.", "warning");
    }
}

function reabrirMailIncoherencias() {
    const p = window._lastIncoherenciasMailPayload;
    if (p && p.asunto) {
        const mailtoLink = `mailto:?subject=${encodeURIComponent(p.asunto)}&body=${encodeURIComponent(p.cuerpoMailto)}`;
        window.location.href = mailtoLink;
        showToast("Reabriendo cliente de correo...", "info");
    } else {
        showToast("No hay datos de correo preparados.", "warning");
    }
}

// --- AUTO-EXPORTS FOR HTML EVENT HANDLERS ---
if (typeof procesarConsolidacion !== 'undefined') window.procesarConsolidacion = procesarConsolidacion;
if (typeof limpiarEtapa2 !== 'undefined') window.limpiarEtapa2 = limpiarEtapa2;
if (typeof exportSinModalidadToExcel !== 'undefined') window.exportSinModalidadToExcel = exportSinModalidadToExcel;
if (typeof enviarMailReclamoSinModalidad !== 'undefined') window.enviarMailReclamoSinModalidad = enviarMailReclamoSinModalidad;
if (typeof toggleSinModHeader !== 'undefined') window.toggleSinModHeader = toggleSinModHeader;
if (typeof filterSinModBySector !== 'undefined') window.filterSinModBySector = filterSinModBySector;
if (typeof renderIncoherenciasTareaTable !== 'undefined') window.renderIncoherenciasTareaTable = renderIncoherenciasTareaTable;
if (typeof exportIncoherenciasTareaToExcel !== 'undefined') window.exportIncoherenciasTareaToExcel = exportIncoherenciasTareaToExcel;
if (typeof enviarMailIncoherenciasTarea !== 'undefined') window.enviarMailIncoherenciasTarea = enviarMailIncoherenciasTarea;
if (typeof closeIncoherenciasMailModal !== 'undefined') window.closeIncoherenciasMailModal = closeIncoherenciasMailModal;
if (typeof copiarTablasIncoherenciasNuevamente !== 'undefined') window.copiarTablasIncoherenciasNuevamente = copiarTablasIncoherenciasNuevamente;
if (typeof reabrirMailIncoherencias !== 'undefined') window.reabrirMailIncoherencias = reabrirMailIncoherencias;
if (typeof setIncoherenciasTareaFilter !== 'undefined') window.setIncoherenciasTareaFilter = setIncoherenciasTareaFilter;
