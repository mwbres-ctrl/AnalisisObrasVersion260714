/* ==========================================================================
   PASO 3 · Analizador Estado BF vs Avance v.7 (modules/tarea_paso3_matrizConsistencia.js)
   Origen: archivos_tarea/3- Analizador Estado BF vs Avance v.7.html
   Responsabilidad:
     - Matriz Oficial de Consistencia de 20 Reglas de Negocio.
     - Cruce automático entre Órdenes TAREA y Avance de Obras.
     - Determinación de ¿CONSIDERA? (SI / NO), Análisis y Criterio.
     - Detección de Obras en Avance sin Ticket (Sobrantes) y diagnósticos.
   ========================================================================== */

(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // 1. MATRIZ OFICIAL DE 20 REGLAS DE NEGOCIO
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

    /**
     * Evalúa la matriz de 20 reglas cruzando los Tickets con el Avance
     */
    function s3_s3_evaluarMatrizConsistencia(mapaTicketsBF, dataAvanceTarea, refDate) {
        const resultadoConsolidado = [];
        const matchedObrasSet = new Set();
        const parseDateFn = window.s3_s2_parseDate || function (d) { return d ? new Date(d) : null; };

        mapaTicketsBF.forEach((rowBF, idObra) => {
            let resultado = String(rowBF._N_RESULTADO_FINAL || rowBF["DETALLE OBRA BF"] || rowBF["ESTADO_FINAL"] || "").trim().toUpperCase();
            if (!resultado) resultado = "EN CURSO";

            const rowObra = dataAvanceTarea.find(r => r._OBRA_BF_CALC === idObra);

            let nodo = "";
            let estado = "";
            let avancePct = "";
            let fechaInicioRaw = "";
            let fechaInicioStr = "";
            let fechaCierreRaw = "";
            let fechaCierreStr = "";
            let dIni = null;

            if (rowObra) {
                matchedObrasSet.add(idObra);
                nodo = rowObra._NODO_CALC || "";
                estado = rowObra._ESTADO_CALC || "";
                avancePct = (rowObra._AVANCE_CALC !== undefined && rowObra._AVANCE_CALC !== null && !isNaN(rowObra._AVANCE_CALC)) ? `${rowObra._AVANCE_CALC}%` : "-";
                fechaInicioRaw = rowObra._FECHA_INICIO_CALC || "";
                dIni = parseDateFn(fechaInicioRaw);
                fechaInicioStr = dIni ? dIni.toLocaleDateString('es-AR') : String(fechaInicioRaw || '-');
                fechaCierreRaw = rowObra._FECHA_CIERRE_CALC || rowObra['FECHA_CIERRE'] || rowObra['Fecha Cierre'] || "";
                const dCierre = parseDateFn(fechaCierreRaw);
                fechaCierreStr = dCierre ? dCierre.toLocaleDateString('es-AR') : String(fechaCierreRaw || '-');
            }

            // Normalización para búsqueda en matriz
            const estNorm = estado.toUpperCase();
            let estCat = "";
            if (estNorm.includes("EJECUC") || estNorm.includes("CURSO")) estCat = "EN EJECUCION";
            else if (estNorm.includes("TERMIN") || estNorm.includes("FINALIZ") || estNorm.includes("CERRAD")) estCat = "TERMINADO";
            else if (estNorm.includes("A EJECUTAR") || estNorm.includes("PENDIENTE") || estNorm.includes("ASIGN")) estCat = "A EJECUTAR";

            let dateCond = "DESPUES";
            if (dIni && refDate) {
                if (dIni.getTime() <= refDate.getTime()) {
                    dateCond = "ANTES";
                }
            } else if (!dIni && estCat === "A EJECUTAR") {
                dateCond = "1900";
            }

            if (dateCond === "1900") {
                fechaInicioStr = "0/1/1900";
            }

            // Matching en la matriz de 20 reglas
            let regla = s3_matrixRules.find(r => r.res === resultado && r.est === estCat && r.dateCond === dateCond);

            if (!regla && estCat) {
                regla = s3_matrixRules.find(r => r.res === resultado && r.est === estCat);
            }

            let considera = "NO";
            let analisis = "Sin coincidencia exacta en matriz de reglas.";
            let criterio = "-";
            let conclusion = "-";
            let indicacion = "-";

            if (regla) {
                considera = regla.cons;
                analisis = regla.a;
                criterio = regla.c;
                conclusion = regla.c;
                indicacion = regla.i;
            } else if (!rowObra) {
                analisis = "Obra informada con Tickets TAREA pero no figura en el reporte de Avance.";
                criterio = "No figura en Avance de Obras";
                conclusion = "No figura en Avance de Obras";
                indicacion = "Consultar con el sector de Obras la vigencia del proyecto";
                estado = "No figura en Avance";
            }

            resultadoConsolidado.push({
                'Obra BF': idObra,
                'OBRA_BF': idObra,
                'DETALLE OBRA BF': resultado || "Sin clasificar",
                'NODO': nodo,
                'ESTADO': estado || 'Sin estado informado',
                'AVANCE_PORC': avancePct || '-',
                'AVANCE': avancePct || '-',
                '% AVANCE': avancePct || '-',
                'FECHA_INICIO': fechaInicioStr || '-',
                'FECHA_CIERRE': fechaCierreStr || '-',
                'ANALISIS': analisis || '-',
                'CONCLUSION': conclusion || '-',
                'CRITERIO': conclusion || '-',
                '¿CONSIDERA?': considera,
                'INDICACION': indicacion || '-',
                'INDICACION A CONTRATISTA': indicacion || '-',
                RAW_BF: rowBF,
                RAW_OBRA: rowObra,
                _ORIGEN_ROW_AVANCE: rowObra || null,
                _ORIGEN_ROW_TICKETS: rowBF,
                _SISTEMA_ORIGEN: "3 - Analizador Estado BF vs Avance v.7"
            });
        });

        return { resultadoConsolidado, matchedObrasSet };
    }

    /**
     * Detecta obras registradas en el Avance que no registran Tickets (Sobrantes)
     */
    function s3_s3_detectarSobrantes(dataAvanceTarea, matchedObrasSet, refDate) {
        const unmatchedList = [];
        const parseDateFn = window.s3_s2_parseDate || function (d) { return d ? new Date(d) : null; };

        dataAvanceTarea.forEach(rowObra => {
            const idObra = rowObra._OBRA_BF_CALC;
            if (!idObra || matchedObrasSet.has(idObra)) return;

            const estado = rowObra._ESTADO_CALC || "";
            const dIni = parseDateFn(rowObra._FECHA_INICIO_CALC);
            const fIniStr = dIni ? dIni.toLocaleDateString('es-AR') : String(rowObra._FECHA_INICIO_CALC || '-');

            let alerta = "-";
            const estUpper = estado.toUpperCase();

            if (estUpper.includes("EJECUC") || estUpper.includes("TERMIN")) {
                if (dIni && refDate && dIni.getTime() <= refDate.getTime()) {
                    alerta = "POSIBLE ERROR POR TICKET NO GENERADO, CONSULTAR CON OBRAS";
                } else if (!dIni) {
                    alerta = "VERIFICAR CON OBRAS (Sin fecha inicio registrada)";
                }
            }

            unmatchedList.push({
                'Obra BF': idObra,
                'OBRA_BF': idObra,
                'NODO': rowObra._NODO_CALC || '-',
                'ESTADO': estado,
                'AVANCE': rowObra._AVANCE_CALC !== undefined ? `${rowObra._AVANCE_CALC}%` : '-',
                'FECHA_INICIO': fIniStr,
                'CONTRATISTA': rowObra._CONTRATISTA_CALC || '-',
                'VERIFICAR': alerta,
                _SISTEMA_ORIGEN: "3 - Analizador Estado BF vs Avance v.7 (Sobrantes)"
            });
        });

        return unmatchedList;
    }

    // Exposición global
    window.s3_matrixRules = s3_matrixRules;
    window.s3_s3_evaluarMatrizConsistencia = s3_s3_evaluarMatrizConsistencia;
    window.s3_s3_detectarSobrantes = s3_s3_detectarSobrantes;
    window.tareaMatrizConsistencia = {
        paso: 3,
        sistema: "3 - Analizador Estado BF vs Avance",
        version: "v.7",
        rules: s3_matrixRules,
        evaluarMatrizConsistencia: s3_s3_evaluarMatrizConsistencia,
        detectarSobrantes: s3_s3_detectarSobrantes
    };
    window.tarea_paso3_matrizConsistencia = window.tareaMatrizConsistencia;
    window.paso3_tareaMatrizConsistencia = window.tareaMatrizConsistencia;

})();
