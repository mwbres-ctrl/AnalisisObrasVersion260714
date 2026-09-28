        /* ==========================================================================
   Módulo: Etapa 3 · Modalidad TAREA (modules/etapa3Logic.js)
   Unifica e integra:
     1 - Analizador Estado de Obra BF v9.3.3
     2 - Analizador Avance de Obras v2.0
     3 - Analizador Estado BF vs Avance v.7 (Matriz de 20 reglas de consistencia)
     4 - Materiales Obras BF v1.8 (Cruce PMOVXF y Tareas en Desc Mat / Saldos Reales)
   ========================================================================== */

(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // 1. ESTADO GLOBAL DE ETAPA 3
    // -------------------------------------------------------------------------
    let s3_dataAvanceTarea = [];          // Filas de Avance filtradas por TAREA
    let s3_dataConsolidadaBF = [];        // Cruce BF vs Avance (resultado de matriz)
    let s3_unmatchedData = [];            // Obras en Avance sin Ticket (sobrantes)
    let s3_dataPMFiltrada = [];           // PMOVXF filtrado por contratista y estado
    let s3_reporteMateriales = [];        // Cruce de PMOVXF con obras 'SI'
    let s3_dataDescargosBrutos = [];      // Datos de "Tareas en Desc Mat"
    let s3_mapaCantidadesDescargadas = {};// Mapa [ObraBF|Articulo] -> total descargado
    let s3_contratistaDescargos = '';     // Empresa seleccionada para descargos
    let s3_activeTab = 'MATRIZ';          // 'MATRIZ' | 'SOBRANTES' | 'MATERIALES'

    // Filtros activos en la tabla de la matriz
    let s3_filtroTexto = '';
    let s3_filtroDetalleBF = 'ALL';
    let s3_filtroEstado = 'ALL';
    let s3_filtroConsidera = 'ALL';

    // -------------------------------------------------------------------------
    // 2. MATRIZ DE REGLAS DE NEGOCIO (20 Reglas Oficiales)
    // -------------------------------------------------------------------------
    const s3_matrixRules = [
        { res: "A EJECUTAR", est: "A EJECUTAR", dateCond: "1900", a: "La Obra se encontraba sin iniciar antes de la auditoría", c: "No Considerar: Materiales auditados en depósito", cons: "NO", i: "En caso de inconsistencia con el estado informado por Obras, ponerse en contacto con ellos para actualizar el estado e informar" },
        { res: "A EJECUTAR", est: "EN EJECUCION", dateCond: "ANTES", a: "La Obra se encontraba iniciada antes de la auditoría, ninguno de sus tkts se encontraban consumidos", c: "Considerar: Entrega + Pendiente", cons: "SI", i: "Finalizar la descarga de los materiales en cada TKT" },
        { res: "A EJECUTAR", est: "EN EJECUCION", dateCond: "DESPUES", a: "La Obra no se encontraba iniciada antes de la auditoría", c: "No Considerar: Materiales auditados en depósito", cons: "NO", i: "En caso de inconsistencia con el estado informado por Obras, ponerse en contacto con ellos para actualizar el estado e informar" },
        { res: "A EJECUTAR", est: "TERMINADO", dateCond: "ANTES", a: "La Obra se encontraba iniciada antes de la auditoría, ninguno de sus tkts se encontraban consumidos", c: "Considerar: Entrega + Pendiente", cons: "SI", i: "Una vez finalizada y aprobada por Obras completar la descarga de los materiales de todos los TKTs" },
        { res: "A EJECUTAR", est: "TERMINADO", dateCond: "DESPUES", a: "La Obra no se encontraba iniciada antes de la auditoría", c: "No Considerar: Materiales auditados en depósito", cons: "NO", i: "Finalizar la descarga de los materiales en cada TKT" },

        { res: "EN CURSO", est: "EN EJECUCION", dateCond: "ANTES", a: "La Obra se encontraba iniciada antes de la auditoría, ninguno de sus tkts se encontraban consumidos", c: "Considerar: Entrega + Pendiente", cons: "SI", i: "Una vez finalizada y aprobada por Obras completar la descarga de los materiales de todos los TKTs" },
        { res: "EN CURSO", est: "EN EJECUCION", dateCond: "DESPUES", a: "La Obra no se encontraba iniciada antes de la auditoría", c: "No se considera", cons: "NO", i: "En caso de inconsistencia en la fecha de inicio informada por Obras, ponerse en contacto con ellos para actualizar el estado e informar" },
        { res: "EN CURSO", est: "TERMINADO", dateCond: "ANTES", a: "La Obra se encontraba iniciada antes de la auditoría, ninguno de sus tkts se encontraban consumidos", c: "Considerar: Entrega + Pendiente", cons: "SI", i: "Finalizar la descarga de los materiales en cada TKT" },
        { res: "EN CURSO", est: "TERMINADO", dateCond: "DESPUES", a: "La Obra no se encontraba iniciada antes de la auditoría", c: "No se considera", cons: "NO", i: "En caso de inconsistencia en la fecha de inicio informada por Obras, ponerse en contacto con ellos para actualizar el estado e informar" },

        { res: "EN CURSO CON CONSUMO PARCIAL", est: "EN EJECUCION", dateCond: "ANTES", a: "La Obra se encontraba iniciada antes de la auditoría", c: "Considerar: Entrega + Pdte y Restar Consumo (Solo TKT CERRADOS)", cons: "SI", i: "Una vez finalizada y aprobada por Obras completar la descarga de los materiales de todos los TKTs" },
        { res: "EN CURSO CON CONSUMO PARCIAL", est: "EN EJECUCION", dateCond: "DESPUES", a: "La Obra no se encontraba iniciada antes de la auditoría", c: "No se considera", cons: "NO", i: "En caso de inconsistencia en la fecha de inicio informada por Obras, ponerse en contacto con ellos para actualizar el estado e informar" },
        { res: "EN CURSO CON CONSUMO PARCIAL", est: "TERMINADO", dateCond: "ANTES", a: "La Obra se encontraba iniciada antes de la auditoría", c: "Considerar: Entrega + Pdte y Restar Consumo (Solo TKT CERRADOS)", cons: "SI", i: "Una vez finalizada y aprobada por Obras completar la descarga de los materiales de todos los TKTs" },
        { res: "EN CURSO CON CONSUMO PARCIAL", est: "TERMINADO", dateCond: "DESPUES", a: "La Obra no se encontraba iniciada antes de la auditoría", c: "No se considera", cons: "NO", i: "En caso de inconsistencia en la fecha de inicio informada por Obras, ponerse en contacto con ellos para actualizar el estado e informar" },

        { res: "FINALIZADA CON CONSUMO TOTAL", est: "EN EJECUCION", dateCond: "ANTES", a: "La Obra se encontraba iniciada antes de la auditoría, todos sus Tkts se encontraban consumidos", c: "No Considerar: Tickets en estado CERRADO (consumo previo)", cons: "NO", i: "Reclamar a Obras para que actualice el informe de avance de obras" },
        { res: "FINALIZADA CON CONSUMO TOTAL", est: "EN EJECUCION", dateCond: "DESPUES", a: "La Obra no se encontraba iniciada antes de la auditoría", c: "No se considera", cons: "NO", i: "En caso de inconsistencia en la fecha de inicio informada por Obras, ponerse en contacto con ellos para actualizar el estado e informar" },
        { res: "FINALIZADA CON CONSUMO TOTAL", est: "TERMINADO", dateCond: "ANTES", a: "La Obra se encontraba iniciada antes de la auditoría, todos sus Tkts se encontraban consumidos", c: "No Considerar: Tickets en estado CERRADO (consumo previo)", cons: "NO", i: "-" },
        { res: "FINALIZADA CON CONSUMO TOTAL", est: "TERMINADO", dateCond: "DESPUES", a: "La Obra no se encontraba iniciada antes de la auditoría", c: "No se considera", cons: "NO", i: "En caso de inconsistencia en la fecha de inicio informada por Obras, ponerse en contacto con ellos para actualizar el estado e informar" },

        { res: "FINALIZADA CON CONSUMO PARCIAL", est: "EN EJECUCION", dateCond: "ANTES", a: "La Obra se encontraba iniciada antes de la auditoría", c: "Considerar: Entrega + Pdte y Restar Consumo (Solo TKT CERRADOS)", cons: "SI", i: "Una vez finalizada y aprobada por Obras completar la descarga de los materiales de todos los TKTs" },
        { res: "FINALIZADA CON CONSUMO PARCIAL", est: "EN EJECUCION", dateCond: "DESPUES", a: "La Obra no se encontraba iniciada antes de la auditoría", c: "No se considera", cons: "NO", i: "En caso de inconsistencia en la fecha de inicio informada por Obras, ponerse en contacto con ellos para actualizar el estado e informar" },
        { res: "FINALIZADA CON CONSUMO PARCIAL", est: "TERMINADO", dateCond: "ANTES", a: "La Obra se encontraba iniciada antes de la auditoría", c: "Considerar: Entrega + Pdte y Restar Consumo (Solo TKT CERRADOS)", cons: "SI", i: "Una vez finalizada y aprobada por Obras completar la descarga de los materiales de todos los TKTs" },
        { res: "FINALIZADA CON CONSUMO PARCIAL", est: "TERMINADO", dateCond: "DESPUES", a: "La Obra no se encontraba iniciada antes de la auditoría", c: "No se considera", cons: "NO", i: "En caso de inconsistencia en la fecha de inicio informada por Obras, ponerse en contacto con ellos para actualizar el estado e informar" }
    ];

    // -------------------------------------------------------------------------
    // 3. HELPERS DE EXTRACCIÓN Y NORMALIZACIÓN
    // -------------------------------------------------------------------------

    /**
     * Deduce la Obra BF a 7 caracteres según la lógica oficial de la Herramienta 2:
     * Si 'Nombre por TAREA' existe, se usa directamente.
     * De lo contrario: Proyecto + Etapa hasta completar 7 caracteres en mayúsculas.
     */
    function s3_extraerObraBF(row) {
        if (!row) return '';
        const nt = row["Nombre por TAREA"] || row["NOMBRE POR TAREA"] || row["_N_NOMBRE_POR_TAREA"] || row["OBRA_BF"] || row["Obra BF"];
        if (nt && String(nt).trim() !== '') {
            return String(nt).trim().toUpperCase();
        }
        const p = String(row["Proyecto"] || row["PROYECTO"] || row["_N_PROYECTO"] || "").trim();
        const et = String(row["Etapa"] || row["ETAPA"] || row["_N_ETAPA"] || "").trim();
        let ob = p;
        if (ob.length < 7) {
            ob += et.substring(0, 7 - ob.length);
        }
        return ob.substring(0, 7).toUpperCase();
    }

    /**
     * Parsea fechas heterogéneas (Excel serial, Date, DD/MM/YYYY, YYYY-MM-DD)
     */
    function s3_parseDate(val) {
        if (!val) return null;
        if (val instanceof Date) {
            if (isNaN(val.getTime())) return null;
            return new Date(val.getFullYear(), val.getMonth(), val.getDate());
        }
        if (typeof val === 'number') {
            const d = new Date(Math.round((val - 25569) * 86400 * 1000));
            return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        }
        const str = String(val).trim();
        if (!str) return null;

        // DD/MM/YYYY
        if (str.includes('/')) {
            const parts = str.split('/');
            if (parts.length === 3) {
                const day = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10) - 1;
                const year = parseInt(parts[2], 10);
                if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                    return new Date(year, month, day);
                }
            }
        }
        // YYYY-MM-DD
        if (str.includes('-')) {
            const parts = str.split('-');
            if (parts.length === 3) {
                const year = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10) - 1;
                const day = parseInt(parts[2], 10);
                if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                    return new Date(year, month, day);
                }
            }
        }
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    function s3_formatDateStr(dateVal) {
        const d = s3_parseDate(dateVal);
        if (!d) return '-';
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }

    function s3_getColValue(row, possibleKeys) {
        if (!row) return '';
        const rowKeys = Object.keys(row);
        for (const targetKey of possibleKeys) {
            const foundKey = rowKeys.find(k => k.trim().toUpperCase() === targetKey.toUpperCase());
            if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null) {
                return row[foundKey];
            }
        }
        return '';
    }

    // -------------------------------------------------------------------------
    // 4. MOTOR PRINCIPAL DE CRUCE TAREA (Herramientas 1, 2, 3 y 4)
    // -------------------------------------------------------------------------

    /**
     * Ejecuta el análisis consolidado de la Modalidad TAREA usando los insumos
     * cargados en Etapa 1 y Etapa 2.
     */
    function s3_ejecutarCruceTarea() {
        const inputEmp = document.getElementById('s3_inputEmpresa');
        const empresaAuditada = (inputEmp && inputEmp.value ? inputEmp.value : (window.s1_empresaAuditada || window.s1_empresaAuditadaAvance || (typeof window.s1_getEmpresaAuditadaActual === 'function' ? window.s1_getEmpresaAuditadaActual() : ''))).trim().toUpperCase();

        // Obtener el avance general filtrado por la empresa auditada identificada en Etapa 1
        let avanceGen = window.s1_dataAvanceGeneral || window.dataAvance || window.dataConsolidada || [];
        if (empresaAuditada && window.s1_dataAvanceGeneral && window.s1_dataAvanceGeneral.length > 0) {
            const matchFn = window.s1_esMismaEmpresa;
            const filtradoPorEmpresa = window.s1_dataAvanceGeneral.filter(r => {
                const rEmp = String(r['CONTRATISTA'] || r['Contratista'] || r['EMPRESA'] || r['Empresa'] || r['_N_CONTRATISTA'] || '').trim().toUpperCase();
                if (typeof matchFn === 'function') return matchFn(rEmp, empresaAuditada);
                return rEmp.includes(empresaAuditada) || empresaAuditada.includes(rEmp);
            });
            if (filtradoPorEmpresa.length > 0) {
                avanceGen = filtradoPorEmpresa;
            }
        }

        const dataTarea = window.dataTarea || [];
        const rawTarea = window.s2_rawTareaData || window.rawTarea || [];
        const materiales = window.s1_dataMateriales || window.dataMateriales || [];
        const localizadorMap = window.s1_localizadorMap || new Map();
        const localizadorSubinvMap = window.s1_localizadorSubinvMap || new Map();

        // 1. Obtener Fecha de Referencia
        const inputFecha = document.getElementById('s3_inputFechaCorte');
        let refDateAbs = null;
        if (inputFecha && inputFecha.value) {
            refDateAbs = s3_parseDate(inputFecha.value);
        } else {
            const dateInput = document.getElementById('globalAuditDate') || document.getElementById('s1_inputFechaReferencia');
            if (dateInput && dateInput.value) {
                refDateAbs = s3_parseDate(dateInput.value);
            }
        }
        if (!refDateAbs) {
            refDateAbs = new Date(); // fallback fecha actual si no está definida
        }

        // =====================================================================
        // DELEGACIÓN A LOS 4 SISTEMAS MODULARES INDEPENDIENTES (archivos_tarea)
        // =====================================================================

        // [SISTEMA 2 · v2.0]: Normalización y filtrado de Avance de Obras TAREA (Empresa Auditada en Etapa 1)
        if (typeof window.s3_s2_normalizarAvanceTarea === 'function') {
            s3_dataAvanceTarea = window.s3_s2_normalizarAvanceTarea(avanceGen, empresaAuditada);
        } else {
            s3_dataAvanceTarea = avanceGen.filter(row => {
                const mod = String(row["Modalidad de Liquidación"] || row["MODALIDAD"] || "").trim().toUpperCase();
                return mod === "TAREA";
            });
        }

        // [SISTEMA 1 · v9.3.3]: Agrupación y clasificación de Tickets TAREA
        let mapaTicketsBF = new Map();
        if (typeof window.s3_s1_procesarTicketsTarea === 'function') {
            const rawFuente = (rawTarea && rawTarea.length > 0) ? rawTarea : dataTarea;
            const resS1 = window.s3_s1_procesarTicketsTarea(rawFuente);
            mapaTicketsBF = resS1.mapaObrasBF;
        }
        // Fallback garantizado: si mapaTicketsBF está vacío y dataTarea tiene datos consolidados
        if ((!mapaTicketsBF || mapaTicketsBF.size === 0) && dataTarea && dataTarea.length > 0) {
            if (!mapaTicketsBF) mapaTicketsBF = new Map();
            dataTarea.forEach(t => {
                const id = String(t._N_OBRA_BF || t["Obra BF"] || t["OBRA_BF"] || "").trim().toUpperCase();
                if (id) mapaTicketsBF.set(id, t);
            });
        }

        // [SISTEMA 3 · v.7]: Matriz Oficial de Consistencia (20 Reglas) y Sobrantes
        if (typeof window.s3_s3_evaluarMatrizConsistencia === 'function') {
            const resS3 = window.s3_s3_evaluarMatrizConsistencia(mapaTicketsBF, s3_dataAvanceTarea, refDateAbs);
            s3_dataConsolidadaBF = resS3.resultadoConsolidado;
            s3_unmatchedData = window.s3_s3_detectarSobrantes(s3_dataAvanceTarea, resS3.matchedObrasSet, refDateAbs);
        }

        // [SISTEMA 4 · v1.8]: Conciliación de Materiales PMOVXF y Descargos (Saldos Reales)
        const obrasSI = s3_dataConsolidadaBF.filter(r => r['¿CONSIDERA?'] === "SI");
        if (typeof window.s3_s4_conciliarMateriales === 'function') {
            const mapaDesc = (typeof window.s3_s4_procesarDescargos === 'function')
                ? window.s3_s4_procesarDescargos(s3_dataDescargosBrutos, empresaAuditada)
                : {};
            s3_reporteMateriales = window.s3_s4_conciliarMateriales(materiales, obrasSI, mapaDesc, localizadorMap, empresaAuditada);
        } else {
            s3_ejecutarCruceMateriales(materiales, localizadorMap, localizadorSubinvMap, empresaAuditada);
        }

        // 7. Actualizar Interfaz
        s3_actualizarUI();
    }

    /**
     * Cruza el PMOVXF con las obras cuyo resultado es "SI", aplicando doble match
     * por NODO u Obra BF calculada.
     */
    function s3_ejecutarCruceMateriales(materiales, localizadorMap, localizadorSubinvMap, empresaAuditada) {
        s3_dataPMFiltrada = [];
        s3_reporteMateriales = [];

        if (!materiales || materiales.length === 0) return;

        // Obras habilitadas con resultado "SI"
        const obrasSI = s3_dataConsolidadaBF.filter(r => r['¿CONSIDERA?'] === "SI");
        if (obrasSI.length === 0) return;

        // Filtrar PMOVXF por contratista y descartar cancelados
        materiales.forEach(row => {
            const estado = String(row['Estado_de_Linea'] || row['ESTADO_DE_LINEA'] || row['Estado'] || '').trim().toUpperCase();
            if (estado === 'CANCELADO') return;

            const loc = String(row['Localizador_Destino'] || row['LOCALIZADOR_DESTINO'] || row['Localizador'] || '').trim();
            const provMap = localizadorMap.get(loc.toUpperCase()) || '';

            // Si hay empresa auditada, verificar que corresponda
            if (empresaAuditada) {
                const matchEmpFn = window.s1_esMismaEmpresa;
                let coincide = false;
                if (typeof matchEmpFn === 'function') {
                    coincide = matchEmpFn(provMap, empresaAuditada);
                } else {
                    coincide = provMap.toUpperCase().includes(empresaAuditada) || empresaAuditada.includes(provMap.toUpperCase());
                }
                if (!coincide) return;
            }

            const motivoOriginal = String(row['Motivo'] || row['MOTIVO'] || '');
            const obraBfPM = motivoOriginal.replace(/\s+/g, '').substring(0, 7).toUpperCase();

            const sol = parseFloat(String(row['Cantidad_Solicitada'] || row['CANTIDAD_SOLICITADA'] || 0).replace(',', '.')) || 0;
            const ent = parseFloat(String(row['Cantidad_Entregada'] || row['CANTIDAD_ENTREGADA'] || 0).replace(',', '.')) || 0;
            const maxCant = Math.max(sol, ent);

            const rowPM = {
                ...row,
                _OBRA_BF_PM_CALC: obraBfPM,
                _CANTIDAD_CONSIDERAR: maxCant,
                _MOTIVO_CLEAN: motivoOriginal
            };
            s3_dataPMFiltrada.push(rowPM);
        });

        // Doble match contra obrasSI
        s3_dataPMFiltrada.forEach(pm => {
            const motivoPM = pm._MOTIVO_CLEAN.toUpperCase();
            const obraBfPM = pm._OBRA_BF_PM_CALC;
            let obraEncontrada = "";

            const esMatch = obrasSI.some(obA => {
                const nodoA = String(obA['NODO'] || '').trim().toUpperCase();
                const obraBfA = String(obA['Obra BF'] || '').trim().toUpperCase();

                const matchNodo = (nodoA !== '' && motivoPM.includes(nodoA));
                const matchBF = (obraBfA !== '' && obraBfPM === obraBfA);

                if (matchNodo || matchBF) {
                    obraEncontrada = obraBfA || obraBfPM;
                    return true;
                }
                return false;
            });

            if (esMatch) {
                const art = String(pm['Articulo'] || pm['ARTICULO'] || '').trim();
                const key = `${obraEncontrada}|${art}`;
                const descontado = s3_mapaCantidadesDescargadas[key] || 0;
                const cantConsiderar = pm._CANTIDAD_CONSIDERAR;
                const cantFinal = Math.max(0, cantConsiderar - descontado);

                s3_reporteMateriales.push({
                    'Articulo': art,
                    'Subinv_Destino': pm['Subinv_Destino'] || pm['SUBINV_DESTINO'] || '',
                    'Localizador_Destino': pm['Localizador_Destino'] || pm['LOCALIZADOR_DESTINO'] || '',
                    'UDM': pm['UDM'] || '',
                    'Cantidad_Solicitada': pm['Cantidad_Solicitada'] || 0,
                    'Cantidad_Entregada': pm['Cantidad_Entregada'] || 0,
                    'Cantidad a considerar': cantConsiderar,
                    'Motivo': pm['Motivo'] || '',
                    'Estado_de_Linea': pm['Estado_de_Linea'] || '',
                    'Fecha_Trx': pm['Fecha_Trx'] || '',
                    'Obra BF - PM': obraBfPM,
                    'Obra BF (Cruce SI)': obraEncontrada,
                    'Resultado': 'SI',
                    'Mat_Cantidad_Total': descontado,
                    'CANTIDAD FINAL': cantFinal
                });
            }
        });
    }

    // -------------------------------------------------------------------------
    // 5. CARGA Y CÁLCULO DE DESCARGOS ("Tareas en Desc Mat" / Saldos Reales)
    // -------------------------------------------------------------------------

    function s3_handleFileDescargos(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: false });

                s3_dataDescargosBrutos = json;

                // Extraer empresas del archivo para selección si es necesario
                const empresasSet = new Set();
                json.forEach(row => {
                    const provKey = Object.keys(row).find(k => {
                        const ku = k.trim().toUpperCase();
                        return ku === 'CONTRATISTA' || ku === 'EMPRESA' || ku === 'PROVEEDOR' || ku === 'NOMBRE_PROV';
                    });
                    if (provKey && row[provKey]) {
                        empresasSet.add(String(row[provKey]).trim().toUpperCase());
                    }
                });

                // Auto-seleccionar empresa auditada de Etapa 1
                const auditada = (window.s1_empresaAuditada || window.s1_empresaAuditadaAvance || (typeof window.s1_getEmpresaAuditadaActual === 'function' ? window.s1_getEmpresaAuditadaActual() : '')).trim().toUpperCase();
                let matchEmp = '';
                if (auditada) {
                    const fnMatch = window.s1_esMismaEmpresa;
                    matchEmp = [...empresasSet].find(e => {
                        if (typeof fnMatch === 'function' && fnMatch(e, auditada)) return true;
                        return e.includes(auditada) || auditada.includes(e);
                    }) || '';
                }
                if (!matchEmp && empresasSet.size > 0) {
                    matchEmp = [...empresasSet][0];
                }
                s3_contratistaDescargos = matchEmp;

                s3_procesarSaldosFinales();
                s3_actualizarEstadoTarjetasInsumos();
                s3_actualizarTarjetasEtapa3();

                if (typeof showToastGlobal === 'function') {
                    showToastGlobal(`Descargos procesados (${json.length} filas). Empresa: ${s3_contratistaDescargos || 'Todas'}`, 'success');
                }
            } catch (err) {
                if (typeof showToastGlobal === 'function') {
                    showToastGlobal(`Error al leer archivo de descargos: ${err.message}`, 'error');
                }
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function s3_procesarSaldosFinales() {
        if (!s3_dataDescargosBrutos || s3_dataDescargosBrutos.length === 0) return;

        const auditada = s3_contratistaDescargos || (window.s1_empresaAuditada || window.s1_empresaAuditadaAvance || (typeof window.s1_getEmpresaAuditadaActual === 'function' ? window.s1_getEmpresaAuditadaActual() : '')).trim().toUpperCase();

        // 1. Delegar generación del mapa de consumos cerrados al módulo Paso 4 oficial
        if (typeof window.s3_s4_procesarDescargos === 'function') {
            s3_mapaCantidadesDescargadas = window.s3_s4_procesarDescargos(s3_dataDescargosBrutos, auditada);
        } else {
            // Fallback directo
            s3_mapaCantidadesDescargadas = {};
            const fnMatch = window.s1_esMismaEmpresa;
            s3_dataDescargosBrutos.forEach(row => {
                if (auditada) {
                    const provKey = Object.keys(row).find(k => {
                        const ku = k.trim().toUpperCase();
                        return ku === 'CONTRATISTA' || ku === 'EMPRESA' || ku === 'PROVEEDOR' || ku === 'NOMBRE_PROV';
                    });
                    const cFila = provKey ? String(row[provKey] || '').trim().toUpperCase() : '';
                    if (typeof fnMatch === 'function') {
                        if (cFila && !fnMatch(cFila, auditada)) return;
                    } else if (cFila && !cFila.includes(auditada) && !auditada.includes(cFila)) {
                        return;
                    }
                }

                const estadoKey = Object.keys(row).find(k => {
                    const ku = k.trim().toUpperCase();
                    return ku.includes('ESTADO DECLARACI') || ku.includes('ESTADO_DECLARACI') || ku === 'ESTADO';
                });
                const estado = estadoKey ? String(row[estadoKey]).trim().toUpperCase() : '';
                if (estado && estado !== 'CERRADO') return;

                const obraKey = Object.keys(row).find(k => {
                    const ku = k.trim().toUpperCase();
                    return ku === 'OBRA BF' || ku === 'OBRA_BF' || ku === 'OBRA' || ku === 'PROYECTO';
                });
                const obraBF = obraKey ? String(row[obraKey] || '').replace(/\s+/g, '').trim().toUpperCase() : '';

                const artKey = Object.keys(row).find(k => {
                    const ku = k.trim().toUpperCase();
                    return ku === 'ID MATERIAL' || ku === 'ID_MATERIAL' || ku === 'ARTICULO' || ku === 'ARTÍCULO' || ku === 'ITEM' || ku === 'CODIGO';
                });
                const idMat = artKey ? String(row[artKey] || '').trim().toUpperCase() : '';

                const cantKey = Object.keys(row).find(k => {
                    const ku = k.trim().toUpperCase();
                    return ku === 'MAT_CANTIDAD' || ku === 'MAT CANTIDAD' || ku === 'CANTIDAD_DESCARGADA' || ku === 'CANTIDAD' || ku === 'CONSUMO';
                });
                const cantText = cantKey ? String(row[cantKey] || 0).replace(',', '.') : '0';
                const cant = parseFloat(cantText) || 0;

                if (obraBF && idMat && cant > 0) {
                    const key = `${obraBF}|${idMat}`;
                    s3_mapaCantidadesDescargadas[key] = (s3_mapaCantidadesDescargadas[key] || 0) + cant;
                }
            });
        }

        // 2. Actualizar reporte de materiales en memoria y en pantalla si ya estaba calculado
        if (s3_reporteMateriales && s3_reporteMateriales.length > 0) {
            s3_reporteMateriales.forEach(row => {
                const obraA = String(row['Obra BF (Cruce SI)'] || row['Obra BF - PM'] || '').replace(/\s+/g, '').trim().toUpperCase();
                const obraPM = String(row['Obra BF - PM'] || '').replace(/\s+/g, '').trim().toUpperCase();
                const art = String(row['Articulo'] || '').trim().toUpperCase();
                const cantCons = parseFloat(row['Cantidad a considerar']) || 0;

                const keyA = `${obraA}|${art}`;
                const keyPM = `${obraPM}|${art}`;
                const descontado = (s3_mapaCantidadesDescargadas[keyA] !== undefined)
                    ? s3_mapaCantidadesDescargadas[keyA]
                    : (s3_mapaCantidadesDescargadas[keyPM] || 0);

                row['Mat_Cantidad_Total'] = descontado;
                row['CANTIDAD FINAL'] = Math.max(0, cantCons - descontado);
            });

            s3_renderTablaMateriales();
            s3_actualizarMetricas();
        }
    }

    // -------------------------------------------------------------------------
    // 6. RENDERIZADO DE TABLAS Y FILTROS
    // -------------------------------------------------------------------------

    function s3_actualizarUI() {
        s3_actualizarMetricas();
        s3_poblarFiltrosMatriz();
        s3_renderTablaMatriz();
        s3_renderTablaSobrantes();
        s3_renderTablaMateriales();
        s3_actualizarTarjetasEtapa3();
    }

    function s3_actualizarMetricas() {
        const totalMatriz = s3_dataConsolidadaBF.length;
        const totalSI = s3_dataConsolidadaBF.filter(r => r['¿CONSIDERA?'] === "SI").length;
        const totalNO = s3_dataConsolidadaBF.filter(r => r['¿CONSIDERA?'] === "NO").length;
        const totalSobrantes = s3_unmatchedData.length;
        const totalMateriales = s3_reporteMateriales.length;

        const setTxt = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val.toLocaleString('es-AR');
        };

        setTxt('s3_badgeTotalMatriz', totalMatriz);
        setTxt('s3_badgeTotalSI', totalSI);
        setTxt('s3_badgeTotalNO', totalNO);
        setTxt('s3_badgeTotalSobrantes', totalSobrantes);
        setTxt('s3_badgeTotalMateriales', totalMateriales);

        // Chip de empresa y fecha en navbar del módulo
        const chipEmpresa = document.getElementById('s3_chipEmpresa');
        if (chipEmpresa) {
            chipEmpresa.textContent = window.s1_empresaAuditada || window.s1_empresaAuditadaAvance || 'Sin Contratista Asignada';
        }
        const chipFecha = document.getElementById('s3_chipFecha');
        if (chipFecha) {
            const fVal = document.getElementById('globalAuditDate') ? document.getElementById('globalAuditDate').value : '';
            chipFecha.textContent = fVal ? s3_formatDateStr(fVal) : 'Sin Fecha de Auditoría';
        }
    }

    function s3_poblarFiltrosMatriz() {
        const selDetalle = document.getElementById('s3_filterDetalleBF');
        const selEstado = document.getElementById('s3_filterEstado');

        if (selDetalle && selDetalle.options.length <= 1) {
            const detalles = [...new Set(s3_dataConsolidadaBF.map(r => r['DETALLE OBRA BF']))].filter(Boolean).sort();
            detalles.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d;
                opt.textContent = d;
                selDetalle.appendChild(opt);
            });
        }

        if (selEstado && selEstado.options.length <= 1) {
            const estados = [...new Set(s3_dataConsolidadaBF.map(r => r['ESTADO']))].filter(Boolean).sort();
            estados.forEach(e => {
                const opt = document.createElement('option');
                opt.value = e;
                opt.textContent = e;
                selEstado.appendChild(opt);
            });
        }
    }

    function s3_filtrarDatosMatriz() {
        return s3_dataConsolidadaBF.filter(row => {
            if (s3_filtroConsidera !== 'ALL' && row['¿CONSIDERA?'] !== s3_filtroConsidera) return false;
            if (s3_filtroDetalleBF !== 'ALL' && row['DETALLE OBRA BF'] !== s3_filtroDetalleBF) return false;
            if (s3_filtroEstado !== 'ALL' && row['ESTADO'] !== s3_filtroEstado) return false;

            if (s3_filtroTexto) {
                const q = s3_filtroTexto.toUpperCase();
                const str = `${row['Obra BF']} ${row['NODO']} ${row['DETALLE OBRA BF']} ${row['ESTADO']} ${row['ANALISIS']}`.toUpperCase();
                if (!str.includes(q)) return false;
            }
            return true;
        });
    }

    function s3_renderTablaMatriz() {
        const tbody = document.getElementById('s3_tablaMatrizBody');
        if (!tbody) return;

        const data = s3_filtrarDatosMatriz();
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-slate-400 italic text-xs">No se encontraron obras para los criterios seleccionados.</td></tr>`;
            return;
        }

        let html = '';
        data.slice(0, 400).forEach(r => {
            const esSI = r['¿CONSIDERA?'] === "SI";
            const badgeClass = esSI
                ? "bg-emerald-50 text-emerald-700 border-emerald-300 font-bold"
                : "bg-rose-50 text-rose-700 border-rose-300 font-bold";

            const rawAvance = r['% AVANCE'] ?? r['AVANCE_PORC'] ?? r['AVANCE'];
            const avanceVal = (rawAvance !== undefined && rawAvance !== null && String(rawAvance) !== 'undefined') ? String(rawAvance) : '-';

            const rawIndicacion = r['INDICACION A CONTRATISTA'] ?? r['INDICACION'];
            const indicacionVal = (rawIndicacion !== undefined && rawIndicacion !== null && String(rawIndicacion) !== 'undefined') ? String(rawIndicacion) : '-';

            html += `
                <tr class="hover:bg-slate-50/80 transition-colors border-b border-slate-100 text-xs">
                    <td class="p-2.5 font-bold text-slate-800 font-mono select-all">${r['Obra BF']}</td>
                    <td class="p-2.5 font-semibold text-slate-700">${r['DETALLE OBRA BF']}</td>
                    <td class="p-2.5 font-mono text-slate-600">${r['NODO'] || '-'}</td>
                    <td class="p-2.5 font-medium text-slate-700">${r['ESTADO']}</td>
                    <td class="p-2.5 text-center font-mono">${avanceVal}</td>
                    <td class="p-2.5 text-center text-slate-600 font-mono">${r['FECHA_INICIO'] || '-'}</td>
                    <td class="p-2.5 text-center">
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] border ${badgeClass}">
                            ${esSI ? '<i class="fa-solid fa-check mr-1 text-[10px]"></i>' : '<i class="fa-solid fa-xmark mr-1 text-[10px]"></i>'}
                            ${r['¿CONSIDERA?']}
                        </span>
                    </td>
                    <td class="p-2.5 text-slate-600 text-[11px] max-w-xs truncate" title="${r['ANALISIS'] || '-'}">${r['ANALISIS'] || '-'}</td>
                    <td class="p-2.5 text-slate-600 text-[11px] max-w-xs truncate" title="${indicacionVal}">${indicacionVal}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    }

    function s3_renderTablaSobrantes() {
        const tbody = document.getElementById('s3_tablaSobrantesBody');
        if (!tbody) return;

        if (s3_unmatchedData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400 italic text-xs">No hay obras en Avance sin tickets asociados.</td></tr>`;
            return;
        }

        let html = '';
        s3_unmatchedData.slice(0, 300).forEach(r => {
            const hasError = r['VERIFICAR'] && r['VERIFICAR'].includes('POSIBLE ERROR');
            const alertBadge = hasError
                ? `<span class="bg-rose-100 text-rose-800 border border-rose-300 px-2 py-0.5 rounded font-bold text-[10px] inline-flex items-center gap-1">
                     <i class="fa-solid fa-triangle-exclamation"></i> ${r['VERIFICAR']}
                   </span>`
                : `<span class="text-slate-400 italic text-[11px]">-</span>`;

            html += `
                <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 text-xs">
                    <td class="p-2.5 font-bold font-mono text-slate-800">${r['Obra BF']}</td>
                    <td class="p-2.5 font-mono text-slate-600">${r['NODO'] || '-'}</td>
                    <td class="p-2.5 font-semibold text-slate-700">${r['ESTADO']}</td>
                    <td class="p-2.5 text-center font-mono">${typeof r['% AVANCE'] === 'number' ? r['% AVANCE'].toFixed(1) + '%' : r['% AVANCE']}</td>
                    <td class="p-2.5 text-center font-mono text-slate-600">${r['FECHA_INICIO']}</td>
                    <td class="p-2.5 text-slate-700">${r['CONTRATISTA']}</td>
                    <td class="p-2.5">${alertBadge}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    }

    function s3_renderTablaMateriales() {
        const tbody = document.getElementById('s3_tablaMaterialesBody');
        if (!tbody) return;

        if (s3_reporteMateriales.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="p-8 text-center text-slate-400 italic text-xs">No hay registros de materiales conciliados para las obras con resultado SI.</td></tr>`;
            return;
        }

        let html = '';
        s3_reporteMateriales.slice(0, 300).forEach(r => {
            const cantFinal = r['CANTIDAD FINAL'] !== undefined ? r['CANTIDAD FINAL'] : r['Cantidad a considerar'];
            html += `
                <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 text-xs">
                    <td class="p-2.5 font-bold font-mono text-indigo-700">${r['Articulo']}</td>
                    <td class="p-2.5 font-mono text-slate-700">${r['Localizador_Destino'] || '-'}</td>
                    <td class="p-2.5 text-slate-600 text-[11px]">${r['UDM'] || '-'}</td>
                    <td class="p-2.5 text-right font-mono text-slate-600">${r['Cantidad_Solicitada']}</td>
                    <td class="p-2.5 text-right font-mono text-slate-600">${r['Cantidad_Entregada']}</td>
                    <td class="p-2.5 text-right font-mono font-bold text-slate-800 bg-slate-50">${r['Cantidad a considerar']}</td>
                    <td class="p-2.5 text-right font-mono text-purple-700 font-semibold">${r['Mat_Cantidad_Total'] || 0}</td>
                    <td class="p-2.5 text-right font-mono font-bold text-emerald-700 bg-emerald-50/50">${cantFinal}</td>
                    <td class="p-2.5 text-slate-600 font-mono text-[11px]">${r['Obra BF - PM']}</td>
                    <td class="p-2.5 font-bold font-mono text-slate-800">${r['Obra BF (Cruce SI)']}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    }

    // -------------------------------------------------------------------------
    // 7. TARJETA EN SETUP SECTION (Dashboard unificado)
    // -------------------------------------------------------------------------

    
    function s3_actualizarFichaEtapa3() {
        const tieneTarea = Boolean(
            (window.dataTarea && Array.isArray(window.dataTarea) && window.dataTarea.length > 0) ||
            (window.rawTarea && Array.isArray(window.rawTarea) && window.rawTarea.length > 0) ||
            (window.s2_rawTareaData && Array.isArray(window.s2_rawTareaData) && window.s2_rawTareaData.length > 0)
        );

        const card = document.getElementById('s3_cardSetupSection');
        const accent = document.getElementById('s3_cardAccentBar');
        const badge = document.getElementById('s3_badgeCardEtapa3');
        const msg = document.getElementById('s3_msgCardEtapa3');
        const btnAbrir = document.getElementById('s3_btnAbrirTarea');
        const btnExportar = document.getElementById('s3_btnExportarMaestroCard');
        const stepEtapa3 = document.getElementById('stepperStepEtapa3');
        const stepDot2 = document.getElementById('stepDot2');
        const stepLabel2 = document.getElementById('stepLabel2');

        const totalTkts = (window.rawTarea || window.dataTarea || window.s2_rawTareaData || []).length;

        if (!tieneTarea) {
            // ESTADO BLOQUEADO
            if (card) {
                card.classList.add('opacity-65', 'bg-slate-50', 'border-slate-300');
                card.classList.remove('bg-white', 'border-slate-200');
            }
            if (accent) {
                accent.className = 'absolute top-0 left-0 w-1.5 h-full bg-slate-300 transition-colors';
            }
            if (badge) {
                badge.className = 'bg-slate-200 text-slate-600 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1';
                badge.innerHTML = '<i class="fa-solid fa-lock text-[10px]"></i> Bloqueada';
            }
            if (msg) {
                msg.className = 'text-xs text-amber-700 font-medium flex items-center gap-1.5';
                msg.innerHTML = '<i class="fa-solid fa-lock text-amber-500"></i> No requerida / Bloqueada: Cargue el archivo de Sistema TAREA en la Etapa 2 para habilitar este módulo.';
            }
            if (btnAbrir) {
                btnAbrir.disabled = true;
                btnAbrir.className = 'bg-slate-200 text-slate-400 text-sm font-bold flex items-center gap-2 px-6 py-3 rounded-lg border border-slate-300 cursor-not-allowed shadow-none';
                btnAbrir.title = 'Etapa 3 Bloqueada: Para habilitarla, primero debe cargar el archivo de Sistema TAREA en la Etapa 2.';
                btnAbrir.innerHTML = '<i class="fa-solid fa-lock text-xs"></i> Módulo Bloqueado';
            }
            if (btnExportar) {
                btnExportar.disabled = true;
                btnExportar.classList.add('opacity-40', 'cursor-not-allowed');
            }
            if (stepEtapa3) {
                stepEtapa3.classList.add('opacity-40');
                stepEtapa3.style.cursor = 'not-allowed';
                stepEtapa3.title = 'Etapa 3 Bloqueada: Requiere cargar el archivo TAREA en la Etapa 2';
            }
            if (stepDot2) {
                stepDot2.classList.add('border-dashed');
            }
            if (stepLabel2) {
                stepLabel2.innerHTML = 'Etapa 3 · TAREA <i class="fa-solid fa-lock text-[10px] text-slate-400 ml-1"></i>';
            }
        } else {
            // ESTADO HABILITADO
            if (card) {
                card.classList.remove('opacity-65', 'bg-slate-50', 'border-slate-300');
                card.classList.add('bg-white', 'border-slate-200');
            }
            if (accent) {
                accent.className = 'absolute top-0 left-0 w-1.5 h-full bg-purple-600 transition-colors';
            }
            if (badge) {
                badge.className = 'bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1';
                badge.innerHTML = '<i class="fa-solid fa-check text-[10px]"></i> Etapa 3 · Habilitada';
            }
            if (msg) {
                msg.className = 'text-xs text-emerald-700 font-semibold flex items-center gap-1.5';
                msg.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-600"></i> Archivo TAREA cargado en Etapa 2 (${totalTkts.toLocaleString()} registros). Módulo habilitado.`;
            }
            if (btnAbrir) {
                btnAbrir.disabled = false;
                btnAbrir.className = 'bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold transition-all flex items-center gap-2 px-6 py-3 rounded-lg shadow-md border border-purple-700 hover:shadow-lg whitespace-nowrap cursor-pointer';
                btnAbrir.title = 'Abrir el Conciliador de Obras Modalidad TAREA';
                btnAbrir.innerHTML = '<i class="fa-solid fa-clipboard-check"></i> Abrir Módulo TAREA';
            }
            if (btnExportar) {
                btnExportar.disabled = false;
                btnExportar.classList.remove('opacity-40', 'cursor-not-allowed');
            }
            if (stepEtapa3) {
                stepEtapa3.classList.remove('opacity-40');
                stepEtapa3.style.cursor = 'pointer';
                stepEtapa3.title = 'Ir a la Etapa 3 · TAREA';
            }
            if (stepDot2) {
                stepDot2.classList.remove('border-dashed');
            }
            if (stepLabel2) {
                stepLabel2.innerHTML = 'Etapa 3 · TAREA';
            }
        }
    }

    function s3_actualizarTarjetasEtapa3() {
        s3_actualizarFichaEtapa3();
        const totalSI = s3_dataConsolidadaBF.filter(r => r['¿CONSIDERA?'] === "SI").length;
        const totalMatriz = s3_dataConsolidadaBF.length;

        const txtRes = document.getElementById('s3_cardResumenObras');
        if (txtRes) {
            if (totalMatriz > 0) {
                txtRes.innerHTML = `<span class="text-emerald-700 font-bold">${totalSI} Obras a Considerar (SI)</span> de ${totalMatriz} analizadas`;
            } else {
                txtRes.textContent = "Pendiente de procesamiento";
            }
        }

        const badgeDescargos = document.getElementById('s3_cardBadgeDescargos');
        if (badgeDescargos) {
            if (s3_dataDescargosBrutos && s3_dataDescargosBrutos.length > 0) {
                badgeDescargos.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300";
                badgeDescargos.textContent = "Descargos Cargados";
            } else {
                badgeDescargos.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-300";
                badgeDescargos.textContent = "Descargos Opcionales";
            }
        }
    }

    // -------------------------------------------------------------------------
    // 8. EXPORTACIONES A EXCEL (SheetJS)
    // -------------------------------------------------------------------------

    
    // -------------------------------------------------------------------------
    // EXPORTACIÓN PRINCIPAL TAREA: Analisis_Vista_Consolidada.xlsx
    // (Coincide exactamente con el sistema original: tarea_paso3)
    // -------------------------------------------------------------------------
    function s3_exportarMaestroConsolidadoTarea() {
        if (!s3_dataConsolidadaBF || s3_dataConsolidadaBF.length === 0) {
            s3_ejecutarCruceTarea();
        }

        if (!s3_dataConsolidadaBF || s3_dataConsolidadaBF.length === 0) {
            if (typeof showToastGlobal === 'function') {
                showToastGlobal("No hay datos analizados de modalidad TAREA disponibles para exportar.", "error");
            } else {
                alert("No hay datos analizados de modalidad TAREA disponibles para exportar. Cargue los insumos y ejecute el cruce.");
            }
            return;
        }

        // Estructura oficial de 11 columnas idéntica a "Analisis_Vista_Consolidada.xlsx" (Paso 3)
        const exportData = s3_dataConsolidadaBF.map(row => ({
            'Obra BF': row['Obra BF'] || '',
            'DETALLE OBRA BF': row['DETALLE OBRA BF'] || '',
            'NODO': row['NODO'] || '',
            'ESTADO': row['ESTADO'] || '',
            'AVANCE_PORC': (row['AVANCE_PORC'] !== undefined && row['AVANCE_PORC'] !== null && String(row['AVANCE_PORC']) !== 'undefined') ? row['AVANCE_PORC'] : (row['AVANCE'] || '-'),
            'FECHA_INICIO': row['FECHA_INICIO'] || '-',
            'FECHA_CIERRE': row['FECHA_CIERRE'] || '-',
            'ANALISIS': row['ANALISIS'] || '',
            'CONCLUSION': row['CONCLUSION'] || row['CRITERIO'] || '',
            '¿CONSIDERA?': row['¿CONSIDERA?'] || '',
            'INDICACION A CONTRATISTA': row['INDICACION A CONTRATISTA'] || row['INDICACION'] || ''
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);
        XLSX.utils.book_append_sheet(wb, ws, "Vista Consolidada");
        XLSX.writeFile(wb, "Analisis_Vista_Consolidada.xlsx");

        if (typeof showToastGlobal === 'function') {
            showToastGlobal("Archivo Analisis_Vista_Consolidada.xlsx exportado correctamente.", "success");
        }
    }

    function s3_exportarExcelMatriz() {
        // Enlaza a la exportación oficial Analisis_Vista_Consolidada.xlsx
        s3_exportarMaestroConsolidadoTarea();
    }

    function s3_getColValue(row, possibleNames) {
        if (!row) return '';
        const keys = Object.keys(row);
        for (let name of possibleNames) {
            const searchName = name.trim().toLowerCase();
            const matchedKey = keys.find(k => k.trim().toLowerCase() === searchName);
            if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null) return row[matchedKey];
        }
        return '';
    }

    // -------------------------------------------------------------------------
    // EXPORTAR 2: Exportar_2_Detalle.xlsx (Datos combinados de Tickets y Avance)
    // Coincide exactamente con btn-export-2 del sistema original
    // -------------------------------------------------------------------------
    function s3_exportarDetalle2() {
        if (!s3_dataConsolidadaBF || s3_dataConsolidadaBF.length === 0) {
            s3_ejecutarCruceTarea();
        }

        if (!s3_dataConsolidadaBF || s3_dataConsolidadaBF.length === 0) {
            if (typeof showToastGlobal === 'function') {
                showToastGlobal("No hay datos analizados de modalidad TAREA disponibles para exportar.", "error");
            } else {
                alert("No hay datos analizados de modalidad TAREA disponibles para exportar. Cargue los insumos y ejecute el cruce.");
            }
            return;
        }

        const exportData = s3_dataConsolidadaBF.map(row => {
            const bf = row.RAW_BF || row._ORIGEN_ROW_TICKETS || {};
            const av = row.RAW_OBRA || row._ORIGEN_ROW_AVANCE || {};
            return {
                'Obra BF': s3_getColValue(bf, ['Obra BF', 'ID_OBRA', 'Obra_BF', '_OBRA_BF_CALC']) || row['Obra BF'] || '',
                'Contratista': s3_getColValue(bf, ['Contratista', 'EMPRESA', 'Empresa']) || window.s1_empresaAuditada || '',
                'Detalle Tkt (Con Consumo)': s3_getColValue(bf, ['Detalle Tkt (Con Consumo)', 'Detalle Tkt', 'DETALLE TKT']) || '',
                'Detalle Obra BF': s3_getColValue(bf, ['Detalle Obra BF', 'Resultado Final', '_N_RESULTADO_FINAL']) || row['DETALLE OBRA BF'] || '',
                'Tkt Material': s3_getColValue(bf, ['Tkt Material', 'Ticket Material', 'TKT MATERIAL']) || '',
                'Cerrados': s3_getColValue(bf, ['Cerrados', 'Cerrado', 'CERRADOS']) || '',
                'Resultado Final': s3_getColValue(bf, ['Resultado Final', '_N_RESULTADO_FINAL', 'ESTADO_FINAL']) || row['DETALLE OBRA BF'] || '',
                'ID_OBRA': s3_getColValue(av, ['ID_OBRA', 'ID OBRA', 'Obra BF', '_OBRA_BF_CALC']) || (row.RAW_OBRA ? row['Obra BF'] : ''),
                'NODO': s3_getColValue(av, ['NODO', 'Nodo', '_NODO_CALC']) || row['NODO'] || '',
                'ESTADO': s3_getColValue(av, ['ESTADO', 'Estado', '_ESTADO_CALC']) || (row.RAW_OBRA ? row['ESTADO'] : ''),
                'AVANCE_PORC': s3_getColValue(av, ['AVANCE_PORC', 'Avance %', 'Avance', '_AVANCE_CALC']) || (row.RAW_OBRA ? row['AVANCE_PORC'] : ''),
                'CONTRATISTA (Avance)': s3_getColValue(av, ['CONTRATISTA', 'Contratista', '_CONTRATISTA_CALC']) || (row.RAW_OBRA ? (window.s1_empresaAuditada || '') : ''),
                'FECHA_INICIO': s3_formatDateStr(s3_getColValue(av, ['FECHA_INICIO', 'Fecha Inicio', '_FECHA_INICIO_CALC']) || (row.RAW_OBRA ? row['FECHA_INICIO'] : '')),
                'FECHA_CIERRE': s3_formatDateStr(s3_getColValue(av, ['FECHA_CIERRE', 'Fecha Cierre', '_FECHA_CIERRE_CALC']) || (row.RAW_OBRA ? row['FECHA_CIERRE'] : '')),
                'MODALIDAD': s3_getColValue(av, ['MODALIDAD', 'Modalidad', 'Modalidad de Liquidación']) || (row.RAW_OBRA ? 'TAREA' : '')
            };
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);
        XLSX.utils.book_append_sheet(wb, ws, "Exportar 2");
        XLSX.writeFile(wb, "Exportar_2_Detalle.xlsx");

        if (typeof showToastGlobal === 'function') {
            showToastGlobal("Archivo Exportar_2_Detalle.xlsx exportado correctamente.", "success");
        }
    }

    // -------------------------------------------------------------------------
    // EXPORTAR 3: Exportar_3_Nodos.xlsx (ID, Nodo y Contratista de Avance)
    // Coincide con btn-export-3 del sistema original
    // -------------------------------------------------------------------------
    function s3_exportarNodos3() {
        if (!s3_dataConsolidadaBF || s3_dataConsolidadaBF.length === 0) {
            s3_ejecutarCruceTarea();
        }

        if (!s3_dataConsolidadaBF || s3_dataConsolidadaBF.length === 0) {
            if (typeof showToastGlobal === 'function') {
                showToastGlobal("No hay datos analizados de modalidad TAREA disponibles para exportar.", "error");
            }
            return;
        }

        const exportData = s3_dataConsolidadaBF.map(row => {
            const av = row.RAW_OBRA || row._ORIGEN_ROW_AVANCE || {};
            return {
                'ID_OBRA': s3_getColValue(av, ['ID_OBRA', 'ID OBRA', 'Obra BF', '_OBRA_BF_CALC']) || (row.RAW_OBRA ? row['Obra BF'] : ''),
                'NODO': s3_getColValue(av, ['NODO', 'Nodo', '_NODO_CALC']) || row['NODO'] || '',
                'CONTRATISTA': s3_getColValue(av, ['CONTRATISTA', 'Contratista', '_CONTRATISTA_CALC']) || (row.RAW_OBRA ? (window.s1_empresaAuditada || '') : '')
            };
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);
        XLSX.utils.book_append_sheet(wb, ws, "Exportar 3");
        XLSX.writeFile(wb, "Exportar_3_Nodos.xlsx");

        if (typeof showToastGlobal === 'function') {
            showToastGlobal("Archivo Exportar_3_Nodos.xlsx exportado correctamente.", "success");
        }
    }

    function s3_exportarObrasSI() {
        const obrasSI = s3_dataConsolidadaBF.filter(r => r['¿CONSIDERA?'] === "SI");
        if (obrasSI.length === 0) {
            if (typeof showToastGlobal === 'function') showToastGlobal("No hay obras con resultado SI para exportar.", "error");
            return;
        }

        const cleanData = obrasSI.map(r => ({
            'Obra BF': r['Obra BF'],
            'DETALLE OBRA BF': r['DETALLE OBRA BF'],
            'NODO': r['NODO'],
            'ESTADO': r['ESTADO'],
            'AVANCE_PORC': r['AVANCE_PORC'] || '-',
            'FECHA_INICIO': r['FECHA_INICIO'] || '-',
            'FECHA_CIERRE': r['FECHA_CIERRE'] || '-',
            'ANALISIS': r['ANALISIS'] || '',
            'CONCLUSION': r['CONCLUSION'] || '',
            '¿CONSIDERA?': 'SI',
            'INDICACION A CONTRATISTA': r['INDICACION A CONTRATISTA'] || ''
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(cleanData);
        XLSX.utils.book_append_sheet(wb, ws, "Obras_Considerar_SI");
        XLSX.writeFile(wb, "Obras_TAREA_Considerar_SI.xlsx");
        if (typeof showToastGlobal === 'function') showToastGlobal("Obras SI exportadas exitosamente.", "success");
    }

    function s3_exportarSobrantes() {
        if (!s3_unmatchedData || s3_unmatchedData.length === 0) {
            if (typeof showToastGlobal === 'function') showToastGlobal("No hay sobrantes para exportar.", "error");
            return;
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(s3_unmatchedData);
        XLSX.utils.book_append_sheet(wb, ws, "Sobrantes Avance");
        XLSX.writeFile(wb, "Avance_Sobrantes.xlsx");
        if (typeof showToastGlobal === 'function') showToastGlobal("Sobrantes exportados exitosamente (Avance_Sobrantes.xlsx).", "success");
    }

    function s3_exportarMateriales() {
        if (!s3_reporteMateriales || s3_reporteMateriales.length === 0) {
            if (typeof showToastGlobal === 'function') showToastGlobal("No hay reporte de materiales para exportar.", "error");
            return;
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(s3_reporteMateriales);
        XLSX.utils.book_append_sheet(wb, ws, "Materiales_TAREA_Saldos");
        XLSX.writeFile(wb, `Materiales_TAREA_Conciliacion_${new Date().toISOString().slice(0, 10)}.xlsx`);
        if (typeof showToastGlobal === 'function') showToastGlobal("Reporte de materiales exportado exitosamente.", "success");
    }

    // -------------------------------------------------------------------------
    // 8.1. MANEJO DE INSUMOS Y CARGA DE ARCHIVOS ETAPA 3
    // -------------------------------------------------------------------------
    function s3_actualizarEstadoTarjetasInsumos() {
        // 1. Tickets TAREA
        const tkts = window.rawTarea || window.dataTarea || [];
        const badgeTkts = document.getElementById('s3_badgeStatusTarea');
        const descTkts = document.getElementById('s3_descStatusTarea');
        if (badgeTkts && descTkts) {
            if (tkts.length > 0) {
                badgeTkts.className = 'text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full';
                badgeTkts.textContent = '✓ Listo';
                descTkts.innerHTML = `<span class="text-emerald-700 font-bold">✓ ${tkts.length.toLocaleString()} tickets cargados</span>`;
            } else {
                badgeTkts.className = 'text-[10px] font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full';
                badgeTkts.textContent = 'Pendiente';
                descTkts.innerHTML = `<span class="italic text-slate-400">Sin archivo cargado</span>`;
            }
        }

        // 2. Avance de Obras (sincronización y filtrado automático por la empresa auditada identificada en Etapa 1)
        const empAudit = (window.s1_empresaAuditada || window.s1_empresaAuditadaAvance || (typeof window.s1_getEmpresaAuditadaActual === 'function' ? window.s1_getEmpresaAuditadaActual() : '')).trim().toUpperCase();

        if (window.s1_dataAvanceGeneral && window.s1_dataAvanceGeneral.length > 0) {
            let avanceFiltrado = window.s1_dataAvanceGeneral;
            if (empAudit) {
                const matchFn = window.s1_esMismaEmpresa;
                const f = window.s1_dataAvanceGeneral.filter(r => {
                    const rEmp = String(r['CONTRATISTA'] || r['Contratista'] || r['EMPRESA'] || r['Empresa'] || r['_N_CONTRATISTA'] || '').trim().toUpperCase();
                    if (typeof matchFn === 'function') return matchFn(rEmp, empAudit);
                    return rEmp.includes(empAudit) || empAudit.includes(rEmp);
                });
                avanceFiltrado = f;
            }
            if (typeof normalizarDataset === 'function') {
                window.dataAvance = normalizarDataset(avanceFiltrado);
            } else {
                window.dataAvance = avanceFiltrado;
            }
        }

        // 3. PMOVXF (con auto-sincronización desde Etapa 1)
        if ((!window.dataMateriales || window.dataMateriales.length === 0) && window.s1_dataMateriales && window.s1_dataMateriales.length > 0) {
            window.dataMateriales = window.s1_dataMateriales;
        }

        const avance = window.dataAvance || [];
        const badgeAvance = document.getElementById('s3_badgeStatusAvance');
        const descAvance = document.getElementById('s3_descStatusAvance');
        if (badgeAvance && descAvance) {
            if (avance.length > 0) {
                badgeAvance.className = 'text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full';
                badgeAvance.textContent = '✓ Listo';
                const detalleEmp = empAudit ? `<span class="block text-[10px] text-purple-700 font-semibold truncate mt-0.5">Empresa auditada (Etapa 1): <strong>${empAudit}</strong></span>` : '';
                descAvance.innerHTML = `<span class="text-emerald-700 font-bold">✓ ${avance.length.toLocaleString()} obras</span>${detalleEmp}`;
            } else if (empAudit && window.s1_dataAvanceGeneral && window.s1_dataAvanceGeneral.length > 0) {
                badgeAvance.className = 'text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full';
                badgeAvance.textContent = '0 Obras';
                descAvance.innerHTML = `<span class="text-amber-700 font-medium text-[11px]">0 obras para "${empAudit}"</span>`;
            } else if (!empAudit) {
                badgeAvance.className = 'text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full';
                badgeAvance.textContent = 'Sin Empresa';
                descAvance.innerHTML = `<span class="text-amber-600 text-[11px]">Identifique la empresa en Etapa 1</span>`;
            } else {
                badgeAvance.className = 'text-[10px] font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full';
                badgeAvance.textContent = 'Pendiente';
                descAvance.innerHTML = `<span class="italic text-slate-400">Sin archivo cargado</span>`;
            }
        }

        // 3. Reporte PM / PMOVXF
        const pm = window.dataMateriales || [];
        const badgePM = document.getElementById('s3_badgeStatusPM');
        const descPM = document.getElementById('s3_descStatusPM');
        if (badgePM && descPM) {
            if (pm.length > 0) {
                badgePM.className = 'text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full';
                badgePM.textContent = '✓ Listo';
                descPM.innerHTML = `<span class="text-emerald-700 font-bold">✓ ${pm.length.toLocaleString()} registros PM</span>`;
            } else {
                badgePM.className = 'text-[10px] font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full';
                badgePM.textContent = 'Pendiente';
                descPM.innerHTML = `<span class="italic text-slate-400">Sin archivo cargado</span>`;
            }
        }

        // 4. Descargos (Tareas en Desc Mat)
        const desc = s3_dataDescargosBrutos || [];
        const badgeDesc = document.getElementById('s3_badgeStatusDescargos');
        const descDesc = document.getElementById('s3_descStatusDescargos');
        const tagDesc = document.getElementById('s3_tagFileDescargos');
        const cardDesc = document.getElementById('s3_cardFileDescargos');
        if (badgeDesc && descDesc) {
            if (desc.length > 0) {
                badgeDesc.className = 'text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full';
                badgeDesc.textContent = '✓ Listo';
                descDesc.innerHTML = `<span class="text-emerald-700 font-bold">✓ ${desc.length.toLocaleString()} descargos listos</span>`;
                if (tagDesc) {
                    tagDesc.className = 'text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-200';
                }
                if (cardDesc) {
                    cardDesc.className = 'border border-emerald-300 rounded-xl p-4 bg-emerald-50/20 hover:bg-white hover:border-emerald-400 transition-all flex flex-col justify-between relative group';
                }
            } else {
                badgeDesc.className = 'text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full';
                badgeDesc.textContent = 'Opcional';
                descDesc.innerHTML = `<span class="italic text-slate-400">Sin descargos cargados</span>`;
                if (tagDesc) {
                    tagDesc.className = 'text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 px-2 py-0.5 rounded';
                }
                if (cardDesc) {
                    cardDesc.className = 'border border-slate-200 rounded-xl p-4 bg-slate-50 hover:bg-white hover:border-purple-300 transition-all flex flex-col justify-between relative group';
                }
            }
        }

        // Sincronizar chips del encabezado superior con la auditoría general
        const chipEmp = document.getElementById('s3_chipEmpresa');
        if (chipEmp) {
            const empNombre = (window.s1_empresaAuditada || window.s1_empresaAuditadaAvance || (window.s1_getEmpresaAuditadaActual ? window.s1_getEmpresaAuditadaActual() : 'Contratista'));
            chipEmp.textContent = empNombre;
        }
        const chipFecha = document.getElementById('s3_chipFecha');
        if (chipFecha) {
            const gDate = document.getElementById('globalAuditDate') || document.getElementById('s1_inputFechaReferencia');
            if (gDate && gDate.value) {
                const parts = gDate.value.split('-');
                if (parts.length === 3) chipFecha.textContent = `${parts[2]}/${parts[1]}/${parts[0]}`;
                else chipFecha.textContent = gDate.value;
            } else {
                chipFecha.textContent = new Date().toLocaleDateString('es-AR');
            }
        }
    }

    function s3_handleFileInputTarea(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const firstSheet = workbook.SheetNames[0];
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '' });
                window.rawTarea = json;
                if (typeof procesarHistorialTareas === 'function') {
                    window.dataTarea = procesarHistorialTareas(json);
                } else {
                    window.dataTarea = json;
                }
                s3_actualizarEstadoTarjetasInsumos();
                if (typeof showToastGlobal === 'function') showToastGlobal(`Tickets TAREA cargados: ${json.length} registros`, 'success');
            } catch(err) {
                console.error("Error al procesar Tickets TAREA:", err);
                alert("Error al leer el archivo de Tickets TAREA: " + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function s3_handleFileInputAvance(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const firstSheet = workbook.SheetNames[0];
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '' });
                window.s1_dataAvanceGeneral = json;
                const empAudit = (window.s1_empresaAuditada || window.s1_empresaAuditadaAvance || '').trim().toUpperCase();
                let fData = json;
                if (empAudit) {
                    const matchFn = window.s1_esMismaEmpresa;
                    const f = json.filter(r => {
                        const rEmp = String(r['CONTRATISTA'] || r['Contratista'] || r['EMPRESA'] || r['Empresa'] || r['_N_CONTRATISTA'] || '').trim().toUpperCase();
                        if (typeof matchFn === 'function') return matchFn(rEmp, empAudit);
                        return rEmp.includes(empAudit) || empAudit.includes(rEmp);
                    });
                    if (f.length > 0) fData = f;
                }
                window.dataAvance = fData;
                s3_actualizarEstadoTarjetasInsumos();
                if (typeof showToastGlobal === 'function') showToastGlobal(`Avance de Obras cargado (${fData.length} registros para ${empAudit || 'todas'})`, 'success');
            } catch(err) {
                console.error("Error al procesar Avance:", err);
                alert("Error al leer el archivo de Avance de Obras: " + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function s3_handleFileInputPM(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const firstSheet = workbook.SheetNames[0];
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '' });
                window.dataMateriales = json;
                s3_actualizarEstadoTarjetasInsumos();
                if (typeof showToastGlobal === 'function') showToastGlobal(`Reporte PM cargado: ${json.length} registros`, 'success');
            } catch(err) {
                console.error("Error al procesar PM:", err);
                alert("Error al leer el archivo de PM: " + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function s3_handleFileInputDescargos(file, inputElement) {
        if (!file) return;
        s3_handleFileDescargos(file);
        if (inputElement) {
            try { inputElement.value = ''; } catch(e) {}
        }
    }

    function s3_mostrarPantalla(pantalla) {
        const panelInsumos = document.getElementById('s3_panelInsumos');
        const panelResultados = document.getElementById('s3_panelResultados');
        const btnNavInsumos = document.getElementById('s3_navBtnInsumos');
        const btnNavResultados = document.getElementById('s3_navBtnResultados');

        if (pantalla === 'resultados') {
            if (s3_dataConsolidadaBF.length === 0) {
                s3_ejecutarCruceTarea();
            }
            if (panelInsumos) panelInsumos.classList.add('hidden');
            if (panelResultados) panelResultados.classList.remove('hidden');

            if (btnNavInsumos) {
                btnNavInsumos.className = 'px-3 py-1 text-xs font-semibold rounded-md transition-all text-slate-600 hover:text-slate-900 cursor-pointer';
            }
            if (btnNavResultados) {
                btnNavResultados.className = 'px-3 py-1 text-xs font-bold rounded-md transition-all bg-white text-purple-700 shadow-2xs cursor-pointer';
            }
            const scrollArea = document.querySelector('#s3_tareaModule .overflow-y-auto');
            if (scrollArea) scrollArea.scrollTop = 0;
        } else {
            // Pantalla 'insumos'
            if (panelInsumos) panelInsumos.classList.remove('hidden');
            if (panelResultados) panelResultados.classList.add('hidden');

            if (btnNavInsumos) {
                btnNavInsumos.className = 'px-3 py-1 text-xs font-bold rounded-md transition-all bg-white text-purple-700 shadow-2xs cursor-pointer';
            }
            if (btnNavResultados) {
                btnNavResultados.className = 'px-3 py-1 text-xs font-semibold rounded-md transition-all text-slate-600 hover:text-slate-900 cursor-pointer';
            }
            const scrollArea = document.querySelector('#s3_tareaModule .overflow-y-auto');
            if (scrollArea) scrollArea.scrollTop = 0;
        }
    }

    function s3_procesarCruceTareaUsuario() {
        const tkts = window.rawTarea || window.dataTarea || [];
        const avance = window.dataAvance || window.dataConsolidada || [];

        if (tkts.length === 0 && avance.length === 0) {
            if (typeof showToastGlobal === 'function') {
                showToastGlobal("Cargue al menos Tickets TAREA y Avance de Obras para procesar.", "warning");
            } else {
                alert("Por favor cargue los archivos de Tickets TAREA y Avance de Obras antes de procesar.");
            }
            return;
        }

        s3_ejecutarCruceTarea();

        // Mostrar exclusivamente la Pantalla 2 (Resultados) y ocultar Pantalla 1 (Insumos)
        s3_mostrarPantalla('resultados');

        const btnToggle = document.getElementById('s3_btnToggleResultadosRapido');
        if (btnToggle) {
            btnToggle.classList.remove('hidden');
        }

        if (typeof showToastGlobal === 'function') {
            showToastGlobal("Análisis TAREA procesado exitosamente.", "success");
        }
    }

    function s3_toggleVerResultados() {
        const panelRes = document.getElementById('s3_panelResultados');
        if (panelRes && !panelRes.classList.contains('hidden')) {
            s3_mostrarPantalla('insumos');
        } else {
            s3_mostrarPantalla('resultados');
        }
    }

    // -------------------------------------------------------------------------
    // 9. NAVEGACIÓN Y APERTURA DE MÓDULOS
    // -------------------------------------------------------------------------

    function openTareaModule() {
        const tieneTarea = Boolean(
            (window.dataTarea && Array.isArray(window.dataTarea) && window.dataTarea.length > 0) ||
            (window.rawTarea && Array.isArray(window.rawTarea) && window.rawTarea.length > 0) ||
            (window.s2_rawTareaData && Array.isArray(window.s2_rawTareaData) && window.s2_rawTareaData.length > 0)
        );
        if (!tieneTarea) {
            const msgBloqueo = "La Etapa 3 está bloqueada: Esta empresa no requiere modalidad TAREA o aún no se ha cargado el archivo de Sistema TAREA en la Etapa 2.";
            if (typeof showToastGlobal === 'function') {
                showToastGlobal(msgBloqueo, "warning");
            } else if (typeof showToast === 'function') {
                showToast(msgBloqueo, "warning");
            } else {
                alert(msgBloqueo);
            }
            return;
        }

        const bcmoEl = document.getElementById('s1_bcmoModule');
        const consEl = document.getElementById('s2_consolidacionModule');
        const setupEl = document.getElementById('setupSection');
        const resultsEl = document.getElementById('resultsSection');

        if (bcmoEl) bcmoEl.classList.add('hidden');
        if (consEl) consEl.classList.add('hidden');
        if (setupEl) setupEl.classList.add('hidden');
        if (resultsEl) resultsEl.classList.add('hidden');

        const el = document.getElementById('s3_tareaModule');
        if (!el) return;
        el.classList.remove('hidden');
        el.classList.add('flex', 'fade-out-active');
        requestAnimationFrame(() => requestAnimationFrame(() => {
            el.classList.remove('fade-out-active');
            el.classList.add('fade-in-active');
        }));

        if (typeof window.updateStepper === 'function') {
            window.updateStepper(2);
        }

        // Actualizamos estado de archivos en tarjetas
        s3_actualizarEstadoTarjetasInsumos();

        // Mostrar exclusivamente la pantalla correspondiente (nunca mezcladas)
        if (s3_dataConsolidadaBF && s3_dataConsolidadaBF.length > 0) {
            s3_mostrarPantalla('resultados');
        } else {
            s3_mostrarPantalla('insumos');
        }
    }

    function closeTareaModule() {
        const el = document.getElementById('s3_tareaModule');
        if (!el) return;
        el.classList.add('fade-out-active');
        setTimeout(() => {
            el.classList.add('hidden');
            el.classList.remove('flex', 'fade-out-active', 'fade-in-active');
        }, 180);

        const setupEl = document.getElementById('setupSection');
        if (setupEl) setupEl.classList.remove('hidden');

        if (typeof window.updateStepper === 'function') {
            window.updateStepper(1);
        }
    }

    function s3_switchTab(tab) {
        s3_activeTab = tab;
        const tabMatriz = document.getElementById('s3_btnTabMatriz');
        const tabSobrantes = document.getElementById('s3_btnTabSobrantes');
        const tabMateriales = document.getElementById('s3_btnTabMateriales');

        const secMatriz = document.getElementById('s3_secMatriz');
        const secSobrantes = document.getElementById('s3_secSobrantes');
        const secMateriales = document.getElementById('s3_secMateriales');

        const actionsMatriz = document.getElementById('s3_actionsMatriz');
        const actionsSobrantes = document.getElementById('s3_actionsSobrantes');
        const actionsMateriales = document.getElementById('s3_actionsMateriales');

        const setActive = (btn, active) => {
            if (!btn) return;
            if (active) {
                btn.className = "pb-3 text-xs font-bold text-indigo-600 border-b-2 border-indigo-600 transition-colors flex items-center gap-2";
            } else {
                btn.className = "pb-3 text-xs font-medium text-slate-500 hover:text-slate-800 border-b-2 border-transparent transition-colors flex items-center gap-2";
            }
        };

        setActive(tabMatriz, tab === 'MATRIZ');
        setActive(tabSobrantes, tab === 'SOBRANTES');
        setActive(tabMateriales, tab === 'MATERIALES');

        if (secMatriz) secMatriz.classList.toggle('hidden', tab !== 'MATRIZ');
        if (secSobrantes) secSobrantes.classList.toggle('hidden', tab !== 'SOBRANTES');
        if (secMateriales) secMateriales.classList.toggle('hidden', tab !== 'MATERIALES');

        if (actionsMatriz) actionsMatriz.classList.toggle('hidden', tab !== 'MATRIZ');
        if (actionsSobrantes) actionsSobrantes.classList.toggle('hidden', tab !== 'SOBRANTES');
        if (actionsMateriales) actionsMateriales.classList.toggle('hidden', tab !== 'MATERIALES');
    }

    // -------------------------------------------------------------------------
    // 10. GENERADOR DE CORREOS (Herramientas 2 y 3)
    // -------------------------------------------------------------------------

    function s3_generarMailConsultaObras() {
        const sinEstado = s3_dataConsolidadaBF.filter(r => r['ESTADO'].includes('Sin estado') || r['ESTADO'].includes('No figura'));
        const auditor = (document.getElementById('auditorName') ? document.getElementById('auditorName').value : '') || 'Auditor';
        const contratista = window.s1_empresaAuditada || window.s1_empresaAuditadaAvance || 'Contratista';

        const subject = encodeURIComponent(`Consulta Estado de Obras TAREA - ${contratista}`);
        const bodyLines = [
            `Estimado equipo de Obras,`,
            ``,
            `En el marco de la auditoría de inventario de la contratista ${contratista}, detectamos las siguientes obras con tickets informados que requieren confirmación de estado en el avance:`,
            ``,
            sinEstado.slice(0, 25).map(o => `- Obra BF: ${o['Obra BF']} (Detalle Ticket: ${o['DETALLE OBRA BF']})`).join('\n'),
            ``,
            sinEstado.length > 25 ? `... y ${sinEstado.length - 25} obra(s) adicionales.` : ``,
            ``,
            `Agradecemos su pronta respuesta para proceder con el cierre del inventario.`,
            ``,
            `Saludos cordiales,`,
            `${auditor}`
        ].join('\n');

        window.open(`mailto:?subject=${subject}&body=${encodeURIComponent(bodyLines)}`, '_blank');
    }

    function s3_generarMailVerificarSobrantes() {
        const conAlerta = s3_unmatchedData.filter(r => r['VERIFICAR'] && r['VERIFICAR'].includes('POSIBLE ERROR'));
        const auditor = (document.getElementById('auditorName') ? document.getElementById('auditorName').value : '') || 'Auditor';
        const contratista = window.s1_empresaAuditada || window.s1_empresaAuditadaAvance || 'Contratista';

        const subject = encodeURIComponent(`URGENTE: Obras en Avance sin Ticket TAREA - ${contratista}`);
        const bodyLines = [
            `Estimado equipo de Obras,`,
            ``,
            `Se detectaron ${conAlerta.length} obras en ejecución/terminadas en el reporte de avance que NO registran tickets generados en el Sistema TAREA:`,
            ``,
            conAlerta.slice(0, 25).map(o => `- Obra BF: ${o['Obra BF']} | Nodo: ${o['NODO']} | Estado: ${o['ESTADO']} | Inicio: ${o['FECHA_INICIO']}`).join('\n'),
            ``,
            conAlerta.length > 25 ? `... y ${conAlerta.length - 25} obra(s) adicionales.` : ``,
            ``,
            `Por favor regularizar la emisión de tickets o confirmar si corresponde ajustar la fecha de inicio.`,
            ``,
            `Saludos cordiales,`,
            `${auditor}`
        ].join('\n');

        window.open(`mailto:?subject=${subject}&body=${encodeURIComponent(bodyLines)}`, '_blank');
    }

    // -------------------------------------------------------------------------
    // 11. EXPOSICIÓN GLOBAL
    // -------------------------------------------------------------------------
    window.s3_ejecutarCruceTarea = s3_ejecutarCruceTarea;
    window.s3_handleFileDescargos = s3_handleFileDescargos;
    window.openTareaModule = openTareaModule;
    window.closeTareaModule = closeTareaModule;
    window.s3_switchTab = s3_switchTab;
    window.s3_exportarMaestroConsolidadoTarea = s3_exportarMaestroConsolidadoTarea;
    window.s3_exportarExcelMatriz = s3_exportarExcelMatriz;
    window.s3_exportarDetalle2 = s3_exportarDetalle2;
    window.s3_exportarNodos3 = s3_exportarNodos3;
    window.s3_exportarObrasSI = s3_exportarObrasSI;
    window.s3_exportarSobrantes = s3_exportarSobrantes;
    window.s3_exportarMateriales = s3_exportarMateriales;
    window.s3_generarMailConsultaObras = s3_generarMailConsultaObras;
    window.s3_generarMailVerificarSobrantes = s3_generarMailVerificarSobrantes;
    window.s3_actualizarTarjetasEtapa3 = s3_actualizarTarjetasEtapa3;
    window.s3_actualizarFichaEtapa3 = s3_actualizarFichaEtapa3;
    window.s3_actualizarEstadoTarjetasInsumos = s3_actualizarEstadoTarjetasInsumos;
    window.s3_handleFileInputTarea = s3_handleFileInputTarea;
    window.s3_handleFileInputAvance = s3_handleFileInputAvance;
    window.s3_handleFileInputPM = s3_handleFileInputPM;
    window.s3_handleFileInputDescargos = s3_handleFileInputDescargos;
    window.s3_procesarCruceTareaUsuario = s3_procesarCruceTareaUsuario;
    window.s3_toggleVerResultados = s3_toggleVerResultados;
    window.s3_mostrarPantalla = s3_mostrarPantalla;

    // Filtros UI
    window.s3_setFiltroTexto = function (txt) { s3_filtroTexto = txt; s3_renderTablaMatriz(); };
    window.s3_setFiltroDetalleBF = function (val) { s3_filtroDetalleBF = val; s3_renderTablaMatriz(); };
    window.s3_setFiltroEstado = function (val) { s3_filtroEstado = val; s3_renderTablaMatriz(); };
    window.s3_setFiltroConsidera = function (val) { s3_filtroConsidera = val; s3_renderTablaMatriz(); };

})();
