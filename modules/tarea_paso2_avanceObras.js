/* ==========================================================================
   PASO 2 · Analizador Avance de Obras v2.0 (modules/tarea_paso2_avanceObras.js)
   Origen: archivos_tarea/2 - Analizador Avance de Obras v2.0.html
   Responsabilidad:
     - Normalizar y procesar la planilla de Avance de Obras.
     - Extraer la clave Obra BF a 7 dígitos (Proyecto + Etapa o Nombre por TAREA).
     - Filtrar por Modalidad de Liquidación 'TAREA'.
     - Filtrar por la Contratista Auditada activa.
     - Homologar porcentajes, estados y fechas de inicio y cierre técnico.
   ========================================================================== */

(function () {
    'use strict';

    /**
     * Parsea fechas heterogéneas (Excel serial, Date, DD/MM/YYYY, YYYY-MM-DD)
     */
    function s3_s2_parseDate(val) {
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
        if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(str)) {
            const parts = str.split(/[\/\-]/);
            const d = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10) - 1;
            const y = parseInt(parts[2], 10);
            return new Date(y, m, d);
        }
        if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(str)) {
            const parts = str.split(/[\/\-]/);
            const y = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10) - 1;
            const d = parseInt(parts[2], 10);
            return new Date(y, m, d);
        }
        const dt = new Date(str);
        if (!isNaN(dt.getTime())) {
            return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
        }
        return null;
    }

    /**
     * Deduce la Obra BF a 7 caracteres según la lógica oficial de la Herramienta 2:
     * Si 'Nombre por TAREA' existe, se usa directamente.
     * De lo contrario: Proyecto + Etapa hasta completar 7 caracteres en mayúsculas.
     */
    function s3_s2_extraerObraBF(row) {
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
     * Obtiene de forma reactiva la empresa auditada establecida en Etapa 1
     */
    function s3_s2_obtenerEmpresaAuditadaEtapa1() {
        return (window.s1_empresaAuditada || 
                window.s1_empresaAuditadaAvance || 
                (typeof window.s1_getEmpresaAuditadaActual === 'function' ? window.s1_getEmpresaAuditadaActual() : '') || 
                (document.getElementById('s3_inputEmpresa') ? document.getElementById('s3_inputEmpresa').value : '') || 
                '').trim().toUpperCase();
    }

    /**
     * Filtra y normaliza el avance general para aislar las obras en modalidad TAREA
     * de la empresa auditada identificada en la Etapa 1.
     */
    function s3_s2_normalizarAvanceTarea(dataAvance, empresaAuditada = '') {
        const fuente = (dataAvance && Array.isArray(dataAvance) && dataAvance.length > 0)
            ? dataAvance
            : (window.dataAvance || window.s1_dataAvanceGeneral || window.dataConsolidada || []);

        if (!fuente || !Array.isArray(fuente) || fuente.length === 0) {
            return [];
        }

        // Obtener la empresa auditada (prioriza el argumento, o lee de Etapa 1)
        const empTarget = String(empresaAuditada || s3_s2_obtenerEmpresaAuditadaEtapa1()).trim().toUpperCase();

        return fuente.filter(row => {
            const mod = String(row["Modalidad de Liquidación"] || row["MODALIDAD"] || row["_N_MODALIDAD_DE_LIQUIDACION"] || "").trim().toUpperCase();
            if (mod !== "TAREA") return false;

            // Filtro por la empresa auditada identificada en Etapa 1
            if (empTarget) {
                const empOriginal = String(row["CONTRATISTA"] || row["Contratista"] || row["EMPRESA"] || row["Empresa"] || row["_N_CONTRATISTA"] || "").trim().toUpperCase();
                const fnMatch = window.s1_esMismaEmpresa;
                if (typeof fnMatch === 'function') {
                    if (!fnMatch(empOriginal, empTarget)) return false;
                } else if (!empOriginal.includes(empTarget) && !empTarget.includes(empOriginal)) {
                    return false;
                }
            }
            return true;
        }).map(row => {
            const obraBF = s3_s2_extraerObraBF(row);
            const nodo = String(row["Nodo"] || row["NODO"] || row["_N_NODO"] || "").trim();
            const estado = String(row["Estado"] || row["ESTADO"] || row["_N_ESTADO"] || "").trim().toUpperCase();
            let pct = parseFloat(row["% Avance"] || row["AVANCE"] || row["Avance"]) || 0;
            if (pct <= 1 && pct > 0) pct *= 100;
            const contratista = String(row["CONTRATISTA"] || row["Contratista"] || row["EMPRESA"] || row["_N_CONTRATISTA"] || "SIN CONTRATISTA").trim().toUpperCase();
            const fechaInicio = row["Fecha Inicio"] || row["INICIO"] || row["FECHA INICIO"] || "";
            const fechaCierre = row["Fecha Cierre Tecnico"] || row["CIERRE"] || row["Fecha Cierre Técnico"] || "";

            return {
                ...row,
                _OBRA_BF_CALC: obraBF,
                _NODO_CALC: nodo,
                _ESTADO_CALC: estado,
                _AVANCE_CALC: pct,
                _CONTRATISTA_CALC: contratista,
                _FECHA_INICIO_CALC: fechaInicio,
                _FECHA_CIERRE_CALC: fechaCierre,
                _EMPRESA_AUDITADA_ETAPA1: empTarget,
                _SISTEMA_ORIGEN: "2 - Analizador Avance de Obras v2.0"
            };
        });
    }

    // Exposición global
    window.s3_s2_extraerObraBF = s3_s2_extraerObraBF;
    window.s3_s2_parseDate = s3_s2_parseDate;
    window.s3_s2_normalizarAvanceTarea = s3_s2_normalizarAvanceTarea;
    window.s3_s2_obtenerEmpresaAuditadaEtapa1 = s3_s2_obtenerEmpresaAuditadaEtapa1;
    window.tareaAvanceObras = {
        paso: 2,
        sistema: "2 - Analizador Avance de Obras",
        version: "v2.0",
        extraerObraBF: s3_s2_extraerObraBF,
        parseDate: s3_s2_parseDate,
        normalizarAvanceTarea: s3_s2_normalizarAvanceTarea,
        obtenerEmpresaAuditadaEtapa1: s3_s2_obtenerEmpresaAuditadaEtapa1
    };
    window.tarea_paso2_avanceObras = window.tareaAvanceObras;
    window.paso2_tareaAvanceObras = window.tareaAvanceObras;

})();
