/* ==========================================================================
   Módulo: Procesador de Historial de Tareas (modules/procesadorTarea.js)
   ========================================================================== */

function procesarHistorialTareas(rawData) {
    const config = {
        cerradoValue: "CERRADO",
        columnaPermitir: "Permite Declarar Material",
        valorPermitir: "Si",
        excluirEstados: ["CANCELADA", "ANULADA", "DUPLICADA"]
    };

    if (!rawData || rawData.length === 0) return [];

    // Helper para buscar claves ignorando mayúsculas, espacios y acentos
    function normalizeKey(str) {
        return String(str || '').trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_');
    }

    // Identificar las columnas reales
    const sample = rawData[0];
    const keys = Object.keys(sample);

    const colPermitir = keys.find(k => normalizeKey(k) === "PERMITE_DECLARAR_MATERIAL") || "Permite Declarar Material";
    const colObraBF = keys.find(k => normalizeKey(k) === "OBRA_BF") || "Obra BF";
    const colEstadoDecl = keys.find(k => normalizeKey(k) === "ESTADO_DECLARACION") || "Estado Declaración";
    const colEstadoTarea = keys.find(k => normalizeKey(k) === "ESTADO_TAREA") || "Estado Tarea";
    const colEstadoObraBF = keys.find(k => normalizeKey(k) === "ESTADO_OBRA_BF") || "Estado Obra BF";
    const colContratista = keys.find(k => normalizeKey(k) === "CONTRATISTA" || normalizeKey(k) === "NOMBRE_PROV" || normalizeKey(k) === "PROVEEDOR") || "Contratista";

    // Agrupar
    const grupos = {};

    rawData.forEach(row => {
        // 2. Filtrar donde "Permite Declarar Material" sea "Si"
        const valPermitir = String(row[colPermitir] || '').trim();
        if (valPermitir !== config.valorPermitir) return;

        // 3. Excluir registros por estados
        const valEstadoTarea = String(row[colEstadoTarea] || '').trim().toUpperCase();
        const valEstadoObraBF = String(row[colEstadoObraBF] || '').trim().toUpperCase();
        const valEstadoDecl = String(row[colEstadoDecl] || '').trim().toUpperCase();
        const valContratista = String(row[colContratista] || '').trim();

        const contieneExcluido = config.excluirEstados.some(ex => 
            valEstadoTarea.includes(ex) || 
            valEstadoObraBF.includes(ex) || 
            valEstadoDecl.includes(ex)
        );

        if (contieneExcluido) return;

        // 4. Agrupar por "Obra BF"
        const obraBF = String(row[colObraBF] || '').trim();
        if (!obraBF) return;

        if (!grupos[obraBF]) {
            grupos[obraBF] = {
                tickets: [],
                contratistas: new Set(),
                statsTarea: {},
                statsObra: {}
            };
        }

        const isCerrado = valEstadoDecl.includes(config.cerradoValue);

        grupos[obraBF].tickets.push({
            estadoTarea: valEstadoTarea,
            isCerrado: isCerrado
        });

        if (valContratista) {
            grupos[obraBF].contratistas.add(valContratista);
        }

        if (valEstadoTarea) {
            grupos[obraBF].statsTarea[valEstadoTarea] = (grupos[obraBF].statsTarea[valEstadoTarea] || 0) + 1;
        }

        if (valEstadoObraBF) {
            grupos[obraBF].statsObra[valEstadoObraBF] = (grupos[obraBF].statsObra[valEstadoObraBF] || 0) + 1;
        }
    });

    const resultado = [];

    // 5. Evaluar cada grupo (obra)
    for (const [obraBF, data] of Object.entries(grupos)) {
        const tickets = data.tickets;
        if (tickets.length === 0) continue;

        const totalCerrados = tickets.filter(t => t.isCerrado).length;

        const allAsignadaOrAgendada = tickets.every(t => t.estadoTarea === "ASIGNADA" || t.estadoTarea === "AGENDADA");
        const anyCerrado = tickets.some(t => t.isCerrado);
        const allClosed = tickets.every(t => t.isCerrado);
        const allCompletada = tickets.every(t => t.estadoTarea === "COMPLETADA");

        let resultadoFinal = "EN CURSO";

        // Lógica condicional estricta
        if (allAsignadaOrAgendada && !anyCerrado) {
            resultadoFinal = "A EJECUTAR";
        } else if (allCompletada && allClosed) {
            resultadoFinal = "FINALIZADA CON CONSUMO TOTAL";
        } else if (allCompletada && !allClosed && anyCerrado) {
            resultadoFinal = "FINALIZADA CON CONSUMO PARCIAL";
        } else if (anyCerrado && !allCompletada) {
            resultadoFinal = "EN CURSO CON CONSUMO PARCIAL";
        } else {
            resultadoFinal = "EN CURSO";
        }

        const contratista = data.contratistas.size > 0 ? Array.from(data.contratistas)[0] : "S/D";

        resultado.push({
            _N_OBRA_BF: obraBF,
            _N_RESULTADO_FINAL: resultadoFinal,
            _N_CERRADOS: totalCerrados,
            Contratista: contratista,
            statsTarea: data.statsTarea,
            statsObra: data.statsObra,
            totalTickets: tickets.length
        });
    }

    return resultado;
}
