/* ==========================================================================
   Módulo: Procesador de Historial de Tareas (modules/procesadorTarea.js)
   ========================================================================== */

function procesarHistorialTareas(rawData) {
    const config = {
        cerradoValue: "CERRADO",
        columnaPermitir: "Permite Declarar Material",
        valorPermitir: "Si",
        excluirEstados: [
            "CANCELAD", "CANCELADA", "CANCELADO", "CANCEL",
            "ANULAD", "ANULADA", "ANULADO", "ANUL",
            "DUPLICAD", "DUPLICADA", "DUPLICADO", "DUPLIC",
            "BAJA", "RECHAZAD"
        ]
    };

    if (!rawData || rawData.length === 0) return [];

    // Helper para buscar claves ignorando mayúsculas, espacios y acentos
    function normalizeKey(str) {
        return String(str || '').trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_');
    }

    // Identificar las columnas reales
    const sample = rawData[0];
    const keys = Object.keys(sample);

    const colPermitir = keys.find(k => {
        const norm = normalizeKey(k);
        return norm.includes("PERMITE_DECLARAR") || norm.includes("PERMITIR_DECLARAR") || (norm.includes("PERMITE") && norm.includes("MATERIAL"));
    }) || "Permite Declarar Material";

    const colObraBF = keys.find(k => normalizeKey(k) === "OBRA_BF" || normalizeKey(k) === "OBRA") || "Obra BF";
    const colEstadoDecl = keys.find(k => {
        const norm = normalizeKey(k);
        return (norm.includes("ESTADO") && (norm.includes("DECL") || norm.includes("DECLARA"))) || norm === "ESTADO_DECLARACION";
    }) || "Estado Declaración";
    const colEstadoTarea = keys.find(k => {
        const norm = normalizeKey(k);
        return norm === "ESTADO_TAREA" || (norm.includes("ESTADO") && norm.includes("TAREA"));
    }) || "Estado Tarea";
    const colEstadoObraBF = keys.find(k => normalizeKey(k) === "ESTADO_OBRA_BF") || "Estado Obra BF";
    const colContratista = keys.find(k => normalizeKey(k) === "CONTRATISTA" || normalizeKey(k) === "NOMBRE_PROV" || normalizeKey(k) === "PROVEEDOR") || "Contratista";
    const colCuenta = keys.find(k => normalizeKey(k).includes("CUENTA_DE_TAREA") || normalizeKey(k).includes("CUENTA_TAREA")) || "Cuenta de Tarea";

    // Agrupar
    const grupos = {};

    rawData.forEach(row => {
        // 2. Filtrar donde "Permite Declarar Material" sea estrictamente "Si" (alineado con Sistema 1 v9.3.3)
        const valPermitir = String(row[colPermitir] || '').trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (valPermitir !== "SI") return;

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

        const cant = parseInt(row[colCuenta]) || 1;
        const isCerrado = valEstadoDecl.includes(config.cerradoValue);
        const isTktCompletado = valEstadoTarea === "COMPLETADA" || valEstadoTarea === "COMPLETADO";

        grupos[obraBF].tickets.push({
            estadoTarea: valEstadoTarea,
            declEstado: valEstadoDecl,
            isCerrado: isCerrado,
            isTktCompletado: isTktCompletado,
            cant: cant
        });

        if (valContratista) {
            grupos[obraBF].contratistas.add(valContratista);
        }

        const tktKey = valEstadoTarea || "(VACÍO)";
        const obraKey = valEstadoObraBF || "(VACÍO)";
        grupos[obraBF].statsTarea[tktKey] = (grupos[obraBF].statsTarea[tktKey] || 0) + cant;
        grupos[obraBF].statsObra[obraKey] = (grupos[obraBF].statsObra[obraKey] || 0) + cant;
    });

    const resultado = [];

    // 5. Evaluar cada grupo (obra) según matriz Sistema 1 v9.3.3
    for (const [obraBF, data] of Object.entries(grupos)) {
        const tickets = data.tickets;
        if (tickets.length === 0) continue;

        const totalCerrados = tickets.filter(t => t.isCerrado).reduce((acc, t) => acc + (t.cant || 1), 0);
        const totalTickets = tickets.reduce((acc, t) => acc + (t.cant || 1), 0);

        const todasTareasCompletadas = tickets.every(t => t.isTktCompletado);
        const todasTareasCerradas = tickets.every(t => t.isCerrado);
        const algunasTareasCerradas = tickets.some(t => t.isCerrado);
        const todoEnAsignada = tickets.every(t => t.estadoTarea === "ASIGNADA" || t.estadoTarea === "AGENDADA");

        let resultadoFinal = "EN CURSO";

        // Reglas oficiales Sistema 1 (Analizador Estado de Obra BF v9.3.3)
        if (todoEnAsignada && !algunasTareasCerradas) {
            resultadoFinal = "A EJECUTAR";
        } else if (todasTareasCerradas || (todasTareasCompletadas && todasTareasCerradas)) {
            // Si todos los tickets están cerrados, la obra es FINALIZADA CON CONSUMO TOTAL
            resultadoFinal = "FINALIZADA CON CONSUMO TOTAL";
        } else if (todasTareasCompletadas && algunasTareasCerradas) {
            resultadoFinal = "FINALIZADA CON CONSUMO PARCIAL";
        } else if (algunasTareasCerradas) {
            resultadoFinal = "EN CURSO CON CONSUMO PARCIAL";
        } else {
            resultadoFinal = "EN CURSO";
        }

        const contratista = data.contratistas.size > 0 ? Array.from(data.contratistas)[0] : "S/D";

        resultado.push({
            _N_OBRA_BF: obraBF,
            "Obra BF": obraBF,
            "OBRA_BF": obraBF,
            _N_RESULTADO_FINAL: resultadoFinal,
            "Resultado Final": resultadoFinal,
            "DETALLE OBRA BF": resultadoFinal,
            "Detalle Obra BF": resultadoFinal,
            _N_CERRADOS: totalCerrados,
            "Cerrados": totalCerrados,
            "Tkt Material": totalTickets,
            Contratista: contratista,
            statsTarea: data.statsTarea,
            statsObra: data.statsObra,
            totalTickets: totalTickets
        });
    }

    return resultado;
}
