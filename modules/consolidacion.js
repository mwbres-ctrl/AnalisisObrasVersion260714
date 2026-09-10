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
                    return new Date(parts[2], parts[1]-1, parts[0]).getTime() || 0;
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
            const k = String(rowCopy['_N_NODO'] || '').trim().toUpperCase();
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

        let nodo = String(rowAvance['_N_NODO'] || '').trim();
        let estadoAvance = String(rowAvance['_N_ESTADO'] || '').trim().toUpperCase();
        let modalidad = String(rowAvance['_N_MODALIDAD_DE_LIQUIDACION'] || '').trim().toUpperCase();

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
                    observacion = "Sector de auditoría de control de contratista debe reclamar a Obras";
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
            } else if (tieneEntregas &&
                estadoParaObra === "TERMINADO" &&
                estBCMO === "SIN CONSUMO" &&
                (modalidad === "" || modalidad === "SIN MODALIDAD")) {
                obraAConsiderar = "ERROR: Definir Modalidad (TERMINADO/CT - Sin Consumo)";
            } else if (tieneEntregas && estadoParaObra === "A EJECUTAR") {
                if (modalidad === "TAREA" || modalidad === "LEGAJO") {
                    obraAConsiderar = "Considerar en Hoja: A EJECUTAR (lo entregado vs conteo)";
                } else if (modalidad === "" || modalidad === "SIN MODALIDAD") {
                    obraAConsiderar = "ERROR: Definir Modalidad (A EJECUTAR - Entregado vs Conteo)";
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
    document.getElementById('btnGoToResults').classList.remove('hidden');
    updateStepper(2);

    // Actualizar solapa de estandarizacion si estamos mostrando "Recategorizados"
    if (document.getElementById('tabRecatContent') && !document.getElementById('tabRecatContent').classList.contains('hidden')) {
        renderRecatTable();
    }

    renderPreview();
    renderAuditTable();
    renderOrphansTable();
    renderBcmoSinCruceTable();
    renderCaducidadTable();
    hideLoadingOverlay();
}

// Funciones Pop-up Resumen Interactivo
window.openSummaryModal = function() {
    const modal = document.getElementById('summaryModal');
    if (modal) modal.classList.remove('hidden');
};

window.closeSummaryModal = function() {
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
        if(!container) return;
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
    if(statsEl) statsEl.innerHTML = `<b>${filteredConsolidada.length}</b> de ${dataConsolidada.length} registros`;

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
    if(!tbody) return;
    tbody.innerHTML = '';

    filteredConsolidada.slice(0, 500).forEach((item, idx) => {
        const obs = item['Acción Sugerida / Observación'] || '';
        const style = stateColorMap[item['Estado de Avance (Calculado)']] || stateColorMap['DEFAULT'];

        let modText = item['Modalidad de Liquidación Calculada'] || '';
        if (modText === '' && item['_ORIGEN'] === 'CORPORATIVO') modText = 'CORP';

        let modHtml = modText === '' || modText === 'SIN MODALIDAD'
            ? `<span class="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-red-200">SIN MOD</span>`
            : `<span class="bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-bold border border-slate-300">${modText}</span>`;

        if (item['_MODIFICADO_MODALIDAD_']) {
            modHtml = `<span class="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-indigo-300" title="Modalidad Forzada"><i class="fa-solid fa-pen-nib mr-1 text-[8px]"></i>${modText}</span>`;
        }

        const isModificado = item['_MODIFICADO_'];
        const estadoRender = item['_MODIFICADO_ESTADO_']
            ? `<span class="text-indigo-600 font-bold" title="Original: ${item['Estado (Original Excel)']}"><i class="fa-solid fa-pen-nib mr-1 text-[10px]"></i> ${item['Estado (Motor)']}</span>`
            : item['Estado (Motor)'];

        const nodoRender = item['_MODIFICADO_NODO_']
            ? `<span class="text-indigo-600 font-bold" title="Original: ${item['Nodo Original']}"><i class="fa-solid fa-spell-check mr-1 text-[10px]"></i> ${item['Nodo'] || item['NODO']}</span>`
            : `<span class="text-slate-800">${item['Nodo'] || item['NODO']}</span>`;

        const tr = document.createElement('tr');
        tr.className = "group border-b border-slate-200 transition-colors";
        tr.innerHTML = `
            <td class="py-2 px-3 border-r border-slate-200 font-medium">${nodoRender}</td>
            <td class="py-2 px-3 border-r border-slate-200 font-mono text-[10px] text-indigo-700 bg-indigo-50/20">${item['Obra BF']}</td>
            <td class="py-2 px-3 border-r border-slate-200">${modHtml}</td>
            <td class="py-2 px-3 border-r border-slate-200 text-slate-500">${estadoRender}</td>
            <td class="py-2 px-3 border-r border-slate-200 text-indigo-600 font-mono text-[10px] bg-indigo-50/30">${item['_AUDIT_']}</td>
            <td class="py-2 px-3 border-r border-slate-200 ${style.text}">${item['Estado de Avance (Calculado)']}</td>
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
