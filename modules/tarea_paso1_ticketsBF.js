/* ==========================================================================
   PASO 1 · Analizador Estado de Obra BF v9.3.3 (modules/tarea_paso1_ticketsBF.js)
   Origen: archivos_tarea/1 - Analizador Estado de Obra BF v9.3.3.html
   Responsabilidad:
     - Procesar historial y órdenes de trabajo del Sistema TAREA (Tableau).
     - Filtrar por 'Permite Declarar Material' y descartar anuladas/canceladas.
     - Agrupar tickets por Obra BF y clasificar el estado de liquidación de tickets:
       * A EJECUTAR
       * EN CURSO
       * EN CURSO CON CONSUMO PARCIAL
       * FINALIZADA CON CONSUMO TOTAL
       * FINALIZADA CON CONSUMO PARCIAL
   ========================================================================== */

(function () {
    'use strict';

    /**
     * Deduce y normaliza la clave de Obra BF a 7 caracteres para tickets
     */
    function extraerObraBFTickets(row) {
        if (!row) return '';
        const direct = row["Obra BF"] || row["OBRA_BF"] || row["_N_OBRA_BF"] || row["Nombre por TAREA"] || row["NOMBRE POR TAREA"];
        if (direct && String(direct).trim() !== '') {
            return String(direct).trim().toUpperCase();
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
     * Procesa y agrupa el dataset de tickets según las reglas del Sistema 1 v9.3.3
     */
    function s3_s1_procesarTicketsTarea(rawTickets, cfg = {}) {
        if (!rawTickets || !Array.isArray(rawTickets) || rawTickets.length === 0) {
            return { mapaObrasBF: new Map(), listaObrasBF: [] };
        }

        const palabraCerrado = (cfg.palabraCerrado || "CERRADO").toUpperCase().trim();
        const excluirEstados = (cfg.excluirEstados || [
            "CANCELAD", "CANCELADA", "CANCELADO", "CANCEL",
            "ANULAD", "ANULADA", "ANULADO", "ANUL",
            "DUPLICAD", "DUPLICADA", "DUPLICADO", "DUPLIC",
            "BAJA", "RECHAZAD"
        ]).map(e => e.toUpperCase().trim());

        const sample = rawTickets[0] || {};
        const keys = Object.keys(sample);
        const normalize = (s) => String(s || '').trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_');

        const colPermitirKey = keys.find(k => {
            const norm = normalize(k);
            return norm.includes("PERMITE_DECLARAR") || norm.includes("PERMITIR_DECLARAR") || (norm.includes("PERMITE") && norm.includes("MATERIAL"));
        });
        const hasColPermitir = !!colPermitirKey;
        const colPermitir = colPermitirKey || "Permite Declarar Material";

        // 1. Detectar si el dataset ya viene consolidado por Obra BF
        // (ejemplo: window.dataTarea generado en Etapa 2 o exportado de Sistema 1 Analisis_BF_*.xlsx)
        const isAlreadyConsolidated = rawTickets.some(r => 
            r._N_RESULTADO_FINAL || r["Resultado Final"] || r["DETALLE OBRA BF"] || r["Detalle Obra BF"] || (r._N_OBRA_BF && !r["Estado Tarea"])
        );

        if (isAlreadyConsolidated && !hasColPermitir) {
            const mapaObrasBF = new Map();
            const listaObrasBF = [];

            rawTickets.forEach(r => {
                const id = String(r._N_OBRA_BF || r["Obra BF"] || r["OBRA_BF"] || r.obra || extraerObraBFTickets(r) || "").trim().toUpperCase();
                if (!id) return;

                const resultadoFinal = String(
                    r._N_RESULTADO_FINAL || r["Resultado Final"] || r["DETALLE OBRA BF"] || r["Detalle Obra BF"] || r.resultado || "EN CURSO"
                ).trim().toUpperCase();

                const totalTkts = parseInt(r._N_TOTAL_TKTS || r["Tkt Material"] || r.totalTickets) || 0;
                const cerrados = parseInt(r._N_CERRADOS || r["Cerrados"] || r.totalCerrados) || 0;
                const contratista = String(r.Contratista || r["Contratista"] || r.contratista || "S/D").trim();
                const nodo = String(r.Nodo || r["Nodo"] || r.nodo || "").trim();

                const item = {
                    _N_OBRA_BF: id,
                    "Obra BF": id,
                    "OBRA_BF": id,
                    "DETALLE OBRA BF": resultadoFinal,
                    "Detalle Obra BF": resultadoFinal,
                    _N_RESULTADO_FINAL: resultadoFinal,
                    "Resultado Final": resultadoFinal,
                    _N_TOTAL_TKTS: totalTkts,
                    "Tkt Material": totalTkts,
                    _N_CERRADOS: cerrados,
                    "Cerrados": cerrados,
                    statsTarea: r.statsTarea || {},
                    statsObra: r.statsObra || {},
                    totalTickets: totalTkts,
                    "Nodo": nodo,
                    "Contratista": contratista,
                    _SISTEMA_ORIGEN: "1 - Analizador Estado de Obra BF v9.3.3"
                };

                mapaObrasBF.set(id, item);
                listaObrasBF.push(item);
            });

            return { mapaObrasBF, listaObrasBF };
        }

        const colEstadoDecl = keys.find(k => {
            const norm = normalize(k);
            return (norm.includes("ESTADO") && (norm.includes("DECL") || norm.includes("DECLARA"))) || norm === "ESTADO_DECLARACION";
        }) || "Estado Declaración";
        const colEstadoTarea = keys.find(k => {
            const norm = normalize(k);
            return norm === "ESTADO_TAREA" || (norm.includes("ESTADO") && norm.includes("TAREA"));
        }) || "Estado Tarea";
        const colEstadoObraBF = keys.find(k => normalize(k) === "ESTADO_OBRA_BF") || "Estado Obra BF";
        const colCuenta = keys.find(k => normalize(k).includes("CUENTA_DE_TAREA") || normalize(k).includes("CUENTA_TAREA")) || "Cuenta de Tarea";

        const mapaAgrupado = new Map();

        rawTickets.forEach(r => {
            // Validar filtro estricto de "Permite Declarar Material" === "SI" si la columna existe
            if (hasColPermitir) {
                const permiteDec = String(r[colPermitir] || r["Permite Declarar Material"] || "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                if (permiteDec !== "SI") return;
            }

            // Exclusión de estados cancelados/anulados
            const estadoTicket = String(r[colEstadoTarea] || r["Estado Tarea"] || "").trim().toUpperCase();
            const estObra = String(r[colEstadoObraBF] || r["Estado Obra BF"] || "").trim().toUpperCase();
            const declEstado = String(r[colEstadoDecl] || r["Estado Declaración"] || "").trim().toUpperCase();

            const contieneExcluido = excluirEstados.some(ex =>
                estadoTicket.includes(ex) || estObra.includes(ex) || declEstado.includes(ex)
            );
            if (contieneExcluido) return;

            const obraBF = extraerObraBFTickets(r);
            if (!obraBF) return;

            if (!mapaAgrupado.has(obraBF)) {
                mapaAgrupado.set(obraBF, {
                    obraBF: obraBF,
                    nodo: String(r["Nodo"] || r["NODO"] || r["_N_NODO"] || "").trim(),
                    contratista: String(r["Contratista"] || r["CONTRATISTA"] || r["PROVEEDOR"] || r["NOMBRE_PROV"] || "").trim(),
                    tickets: [],
                    totalTickets: 0,
                    cerrados: 0,
                    statsTarea: {},
                    statsObra: {}
                });
            }

            const cant = parseInt(r[colCuenta]) || 1;
            const isCerrado = declEstado.includes(palabraCerrado);
            const isTktCompletado = estadoTicket === "COMPLETADA" || estadoTicket === "COMPLETADO";

            const grupo = mapaAgrupado.get(obraBF);
            grupo.tickets.push({
                estadoTarea: estadoTicket,
                declEstado: declEstado,
                isCerrado: isCerrado,
                isTktCompletado: isTktCompletado,
                cant: cant
            });
            grupo.totalTickets += cant;

            if (isCerrado) {
                grupo.cerrados += cant;
            }

            const tktKey = estadoTicket || "(VACÍO)";
            const obraKey = estObra || "(VACÍO)";
            grupo.statsTarea[tktKey] = (grupo.statsTarea[tktKey] || 0) + cant;
            grupo.statsObra[obraKey] = (grupo.statsObra[obraKey] || 0) + cant;
        });

        // Clasificación final de cada Obra BF según la matriz v9.3.3
        const mapaObrasBF = new Map();
        const listaObrasBF = [];

        mapaAgrupado.forEach((g, obraBF) => {
            const tickets = g.tickets;
            const todasTareasCompletadas = tickets.every(t => t.isTktCompletado);
            const todasTareasCerradas = tickets.every(t => t.isCerrado);
            const algunasTareasCerradas = tickets.some(t => t.isCerrado);
            const todoEnAsignada = tickets.every(t => t.estadoTarea === "ASIGNADA" || t.estadoTarea === "AGENDADA");

            let resultadoFinal = "EN CURSO";

            // Reglas oficiales Sistema 1 (Analizador Estado de Obra BF v9.3.3)
            if (todoEnAsignada && !algunasTareasCerradas) {
                resultadoFinal = "A EJECUTAR";
            } else if (todasTareasCerradas || (todasTareasCompletadas && todasTareasCerradas)) {
                // Si todos los tickets están cerrados, la obra se informa como FINALIZADA CON CONSUMO TOTAL
                resultadoFinal = "FINALIZADA CON CONSUMO TOTAL";
            } else if (todasTareasCompletadas && algunasTareasCerradas) {
                resultadoFinal = "FINALIZADA CON CONSUMO PARCIAL";
            } else if (algunasTareasCerradas) {
                resultadoFinal = "EN CURSO CON CONSUMO PARCIAL";
            } else {
                resultadoFinal = "EN CURSO";
            }

            const item = {
                _N_OBRA_BF: obraBF,
                "Obra BF": obraBF,
                "OBRA_BF": obraBF,
                "DETALLE OBRA BF": resultadoFinal,
                "Detalle Obra BF": resultadoFinal,
                _N_RESULTADO_FINAL: resultadoFinal,
                "Resultado Final": resultadoFinal,
                _N_TOTAL_TKTS: g.totalTickets,
                "Tkt Material": g.totalTickets,
                _N_CERRADOS: g.cerrados,
                "Cerrados": g.cerrados,
                statsTarea: g.statsTarea,
                statsObra: g.statsObra,
                totalTickets: g.totalTickets,
                "Nodo": g.nodo,
                "Contratista": g.contratista,
                _SISTEMA_ORIGEN: "1 - Analizador Estado de Obra BF v9.3.3"
            };

            mapaObrasBF.set(obraBF, item);
            listaObrasBF.push(item);
        });

        return { mapaObrasBF, listaObrasBF };
    }

    // Exposición global
    window.s3_s1_extraerObraBFTickets = extraerObraBFTickets;
    window.s3_s1_procesarTicketsTarea = s3_s1_procesarTicketsTarea;
    window.tareaTicketsBF = {
        paso: 1,
        sistema: "1 - Analizador Estado de Obra BF",
        version: "v9.3.3",
        extraerObraBFTickets,
        procesarTicketsTarea: s3_s1_procesarTicketsTarea
    };
    window.tarea_paso1_ticketsBF = window.tareaTicketsBF;
    window.paso1_tareaTicketsBF = window.tareaTicketsBF;

})();
