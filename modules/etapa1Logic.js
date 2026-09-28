// ============================================================================
        // LÓGICA ETAPA 1 (ANALIZADOR BCMO - ENCAPSULADA PARA NO AFECTAR ETAPA 2)
        // ============================================================================
        const s1_defaultTasks = ["BERISSO", "DEPO", "DEVO", "DEVOEDIF", "DEVOIMP", "DEVORED", "EDARM", "EDCORP", "EDIF", "HUB", "IMP", "INST", "MOVI", "MRED", "OTROS", "REDCORP", "REFRED", "RIMP", "RINST", "RMRED", "RSERV", "SERV", "SORED", "TPRO", "UHF"];
        const s1_defaultMats = ["Precintos", "Separador de linga", "Manguitos protectores"];
        const s1_defaultInvalid = ["PM-ETIQUETASTAPCAISA", "ETIQUETAS-CAISA", "STOCK PASAR A CONSUMIDO"];

        let s1_currentRawData = [];
        let s1_processedData = [];
        let s1_filteredData = [];
        let s1_manualOverrides = {};
        let s1_invalidData = [];
        let s1_dataMateriales = null;
        let s1_fileUploadDates = { bcmo: null, pmovxf: null };
        // --- Avance General / Obras Reasignadas ---
        let s1_dataAvanceGeneral = null;
        let s1_empresaAuditada = '';
        let s1_empresaAuditadaAvance = '';
        let s1_localizadoresEmpresaAuditada = new Set();
        let s1_auditTrail = {}; // { [Contratista|Obra]: { auditor, fecha, accion, estadoAnterior, estadoNuevo } }

        function s1_normalizarEmpresa(str) {
            if (!str) return '';
            let s = String(str).toUpperCase().trim();
            // Normalizar acentos y diacríticos
            s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            // Homogeneizar abreviatura CIA / COMPANIA
            s = s.replace(/\bCIA\.?\b/g, 'COMPANIA');
            // Quitar tipos societarios comunes
            s = s.replace(/\bS\.?\s*A\.?\s*C\.?\s*I\.?\b/g, '')
                 .replace(/\bS\.?\s*A\.?\s*U\.?\b/g, '')
                 .replace(/\bS\.?\s*A\.?\b/g, '')
                 .replace(/\bS\.?\s*R\.?\s*L\.?\b/g, '')
                 .replace(/\bS\.?\s*E\.?\b/g, '')
                 .replace(/\bLTDA\.?\b/g, '')
                 .replace(/\bSOCIEDAD\s+ANONIMA\b/g, '');
            // Limpiar signos de puntuación y dobles espacios
            return s.replace(/[^A-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
        }

        function s1_esMismaEmpresa(empA, empB) {
            if (!empA || !empB) return false;
            const nA = s1_normalizarEmpresa(empA);
            const nB = s1_normalizarEmpresa(empB);
            if (!nA || !nB) return false;
            return nA === nB || nA.includes(nB) || nB.includes(nA);
        }
        window.s1_normalizarEmpresa = s1_normalizarEmpresa;
        window.s1_esMismaEmpresa = s1_esMismaEmpresa;

        // --- Reporte de Localizadores (obligatorio) / Bloque Secundario (otras razones sociales) ---
        let s1_dataLocalizadores = null;          // Datos crudos del Reporte de Localizadores
        let s1_localizadorMap = null;              // Map: LOCALIZADOR.toUpperCase() -> NOMBRE PROV
        let s1_secundarioIndex = {};               // { OBRA_UPPER: [ {Contratista, LocalizadorCod, Item, Descripcion, Entregado, Consumido, Diferencia}, ... ] }
        let s1_otraECData = [];                    // Resultado de la búsqueda transversal ("Consumo en Otra EC")
        let s1_obrasReasignadasData = [];
        // --- Obras Excluidas por Tarea (nueva solapa) ---
        let s1_excluidasPorTareaData = [];      // Array de grupos: { Contratista, Obra, Tarea, Entregado, Consumido, Diferencia, Detalles }
        let s1_excluidasAutorizadas = new Set(); // Set de claves "Contratista|Obra" autorizadas manualmente

        document.addEventListener("DOMContentLoaded", () => {
            const sTasks = localStorage.getItem('excludedTasks');
            const sMats = localStorage.getItem('excludedMaterials');
            const sUmb = localStorage.getItem('umbralVerificacion');
            const sInvalid = localStorage.getItem('invalidNomenclatures');

            document.getElementById('s1_excludedTasks').value = sTasks !== null ? sTasks : s1_defaultTasks.join('\n');
            document.getElementById('s1_excludedMaterials').value = sMats !== null ? sMats : s1_defaultMats.join('\n');
            document.getElementById('s1_invalidNomenclaturesInput').value = sInvalid !== null ? sInvalid : s1_defaultInvalid.join('\n');
            if (sUmb !== null) document.getElementById('s1_umbralVerificacion').value = sUmb;

            s1_setupDragAndDrop();
        });

        function s1_toggleConfigPanel() {
            const p = document.getElementById('s1_configPanel');
            const bd = document.getElementById('s1_configBackdrop');
            if (p.classList.contains('translate-x-full')) {
                p.classList.remove('translate-x-full'); bd.classList.remove('hidden');
                setTimeout(() => bd.classList.remove('opacity-0'), 10);
            } else {
                p.classList.add('translate-x-full'); bd.classList.add('opacity-0');
                setTimeout(() => bd.classList.add('hidden'), 300);
            }
        }

        function s1_exportMemory() {
            const d = new Date(); const str = `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}`;
            document.getElementById('s1_exportFileName').value = "Memoria_BCMO_" + str;
            document.getElementById('s1_exportModal').classList.remove('hidden');
        }

        function s1_closeExportModal() { document.getElementById('s1_exportModal').classList.add('hidden'); }

        function s1_confirmExport() {
            let fn = document.getElementById('s1_exportFileName').value.trim() || "Memoria_BCMO";
            const data = {
                version: "1.0",
                excludedTasks: document.getElementById('s1_excludedTasks').value,
                excludedMaterials: document.getElementById('s1_excludedMaterials').value,
                umbralVerificacion: document.getElementById('s1_umbralVerificacion').value,
                manualOverrides: s1_manualOverrides,
                auditTrail: s1_auditTrail
            };
            const dStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
            const a = document.createElement('a'); a.setAttribute("href", dStr); a.setAttribute("download", fn.endsWith(".json") ? fn : fn + ".json");
            document.body.appendChild(a); a.click(); a.remove();
            s1_closeExportModal(); showToastGlobal("Memoria exportada correctamente", "success");
        }

        function s1_importMemory(event) {
            const f = event.target.files[0]; if (!f) return;
            const r = new FileReader();
            r.onload = function (e) {
                try {
                    const mem = JSON.parse(e.target.result);
                    if (mem.excludedTasks !== undefined) document.getElementById('s1_excludedTasks').value = mem.excludedTasks;
                    if (mem.excludedMaterials !== undefined) document.getElementById('s1_excludedMaterials').value = mem.excludedMaterials;
                    if (mem.umbralVerificacion !== undefined) document.getElementById('s1_umbralVerificacion').value = mem.umbralVerificacion;
                    if (mem.manualOverrides !== undefined) s1_manualOverrides = mem.manualOverrides;
                    if (mem.auditTrail !== undefined) s1_auditTrail = mem.auditTrail;
                    showToastGlobal("Memoria BCMO cargada.", "success");
                    localStorage.setItem('excludedTasks', document.getElementById('s1_excludedTasks').value);
                    localStorage.setItem('excludedMaterials', document.getElementById('s1_excludedMaterials').value);
                    localStorage.setItem('umbralVerificacion', document.getElementById('s1_umbralVerificacion').value);
                    if (s1_currentRawData && s1_currentRawData.length > 0) { s1_analyzeData(s1_currentRawData); }
                } catch (err) { showToastGlobal("Error al leer JSON de memoria BCMO.", "error"); }
                event.target.value = "";
            };
            r.readAsText(f);
        }

        function s1_switchTabEtapa1(tab) {
            const elDash = document.getElementById('s1_tabDashboard'); const elVerif = document.getElementById('s1_tabVerification'); const elInvalid = document.getElementById('s1_tabInvalid'); const elReas = document.getElementById('s1_tabReasignadas'); const elOtraEC = document.getElementById('s1_tabOtraEC'); const elExcluidas = document.getElementById('s1_tabExcluidas');
            const btnDash = document.getElementById('s1_btnTabDashboard'); const btnVerif = document.getElementById('s1_btnTabVerification'); const btnNovedades = document.getElementById('s1_btnTabNovedades'); const btnInvalid = document.getElementById('s1_btnTabInvalid'); const btnReas = document.getElementById('s1_btnTabReasignadas'); const btnOtraEC = document.getElementById('s1_btnTabOtraEC'); const btnExcluidas = document.getElementById('s1_btnTabExcluidas');

            s1_closeNovedadesMenu();

            // Bloquear acceso a Verificar si no hay PM cargado
            if (tab === 'verification' && (!s1_dataMateriales || s1_dataMateriales.length === 0)) {
                showToastGlobal("El PMOVXF es obligatorio para acceder a \"Obras a Verificar\". Cárguelo antes de analizar.", "error");
                return;
            }

            // Ocultar todos los paneles
            [elDash, elVerif, elInvalid, elReas, elOtraEC, elExcluidas].forEach(el => { if (el) el.classList.add('hidden'); });

            // Resetear todos los botones a inactivo (clases unificadas)
            [btnDash, btnVerif, btnNovedades, btnInvalid, btnReas, btnOtraEC, btnExcluidas].forEach(btn => {
                if (btn) {
                    btn.classList.remove('active');
                }
            });

            // Activar el tab seleccionado
            if (tab === 'dashboard') {
                elDash.classList.remove('hidden');
                btnDash.classList.add('active');
            } else if (tab === 'verification') {
                elVerif.classList.remove('hidden');
                btnVerif.classList.add('active');
            } else if (tab === 'invalid') {
                if (elInvalid) elInvalid.classList.remove('hidden');
                if (btnNovedades) btnNovedades.classList.add('active');
                if (btnInvalid) btnInvalid.classList.add('active');
            } else if (tab === 'reasignadas') {
                if (elReas) elReas.classList.remove('hidden');
                if (btnNovedades) btnNovedades.classList.add('active');
                if (btnReas) btnReas.classList.add('active');
            } else if (tab === 'otraec') {
                if (elOtraEC) elOtraEC.classList.remove('hidden');
                if (btnNovedades) btnNovedades.classList.add('active');
                if (btnOtraEC) btnOtraEC.classList.add('active');
            } else if (tab === 'excluidas') {
                if (elExcluidas) elExcluidas.classList.remove('hidden');
                if (btnExcluidas) btnExcluidas.classList.add('active');
                s1_renderExcluidasPorTareaTable();
            }
        }

        function s1_applyLocalConfig() {
            localStorage.setItem('excludedTasks', document.getElementById('s1_excludedTasks').value);
            localStorage.setItem('excludedMaterials', document.getElementById('s1_excludedMaterials').value);
            localStorage.setItem('umbralVerificacion', document.getElementById('s1_umbralVerificacion').value);
            if (s1_currentRawData && s1_currentRawData.length > 0) {
                s1_toggleConfigPanel();
                document.getElementById('s1_resultsWorkspace').classList.add('hidden');
                document.getElementById('s1_loader').classList.remove('hidden');
                setTimeout(() => s1_analyzeData(s1_currentRawData), 200);
                showToastGlobal("Configuración BCMO aplicada.", "success");
            } else {
                s1_toggleConfigPanel(); showToastGlobal("Configuración BCMO guardada.", "success");
            }
        }

        function s1_setupDragAndDrop() {
            const dz = document.getElementById('s1_dropZone'); const fi = document.getElementById('s1_fileInput');
            if (dz) {
                dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
                dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
                dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('dragover'); if (e.dataTransfer.files.length) s1_handleFiles(e.dataTransfer.files); });
            }
            if (fi) fi.addEventListener('change', (e) => { if (e.target.files.length) { s1_handleFiles(e.target.files); e.target.value = ''; } });
            // Listener para Avance General
            const avInput = document.getElementById('s1_avanceGeneralInput');
            if (avInput) avInput.addEventListener('change', (e) => { if (e.target.files.length) { s1_handleAvanceGeneralFile(e.target.files[0]); e.target.value = ''; } });
            // Listener para el Reporte de Localizadores (obligatorio)
            const locInput = document.getElementById('s1_localizadoresInput');
            if (locInput) locInput.addEventListener('change', (e) => { if (e.target.files.length) { s1_handleLocalizadoresFile(e.target.files[0]); e.target.value = ''; } });
            // Listener para PMOVXF (Paso 4)
            const pmovxfInput = document.getElementById('s1_pmovxfInput');
            if (pmovxfInput) pmovxfInput.addEventListener('change', (e) => { if (e.target.files.length) { s1_handleFiles(e.target.files); e.target.value = ''; } });
        }

        function s1_handleFiles(files) {
            Array.from(files).forEach(file => {
                const ext = file.name.split('.').pop().toLowerCase();
                if (ext === 'csv' || ext === 'txt') {
                    const textReader = new FileReader();
                    textReader.onload = (e) => {
                        try {
                            const text = e.target.result; let delim = ',';
                            const firstLine = text.split('\n')[0]; if (firstLine.includes('\t')) delim = '\t'; else if (firstLine.includes(';')) delim = ';';
                            const lines = text.split('\n'); const headers = lines[0].split(delim).map(h => h.trim());
                            const hStr = headers.join(' ').toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                            const isBCMO = hStr.includes('ESTADO DE LIQUIDACION') || (hStr.includes('ENTREGADO') && hStr.includes('CONSUMIDO') && hStr.includes('TAREA'));
                            const json = [];

                            if (isBCMO) {
                                const normalize = (s) => String(s || '').trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\.$/, '');
                                const kLocCod = headers.findIndex(k => normalize(k) === 'LOCALIZADOR_COD' || normalize(k) === 'LOCALIZADOR COD' || normalize(k) === 'LOCALIZADOR');
                                const kLocDesc = headers.findIndex(k => normalize(k) === 'LOCALIZADOR_DESC' || normalize(k) === 'LOCALIZADOR DESC' || normalize(k) === 'NOMBRE_PROV');
                                const kTarea = headers.findIndex(k => normalize(k) === 'TAREA');
                                const kObra = headers.findIndex(k => normalize(k) === 'MOTIVO_DE_OBRA' || normalize(k) === 'MOTIVO DE OBRA' || normalize(k) === 'MOTIVO' || normalize(k) === 'OBRA');
                                const kItem = headers.findIndex(k => normalize(k) === 'ITEM' || normalize(k) === 'CODIGO');
                                const kDesc = headers.findIndex(k => normalize(k) === 'DESCRIPCION');
                                const kUM = headers.findIndex(k => normalize(k) === 'UM');
                                const kEnt = headers.findIndex(k => normalize(k) === 'ENTREGADO');
                                const kCon = headers.findIndex(k => normalize(k) === 'CONSUMIDO');
                                const kDif = headers.findIndex(k => normalize(k) === 'DIFERENCIA');
                                const kFecha = headers.findIndex(k => normalize(k) === 'FECHA_TRX' || normalize(k) === 'FECHA');

                                for (let i = 1; i < lines.length; i++) {
                                    const line = lines[i].trim();
                                    if (!line) continue;
                                    const values = line.split(delim);
                                    const locCod = kLocCod !== -1 && values[kLocCod] ? values[kLocCod].trim() : '';
                                    if (locCod.endsWith('.3001') || locCod.endsWith('.4001') || (/\.1\d{3}$/.test(locCod) && !locCod.endsWith('.1001'))) continue;

                                    const locDesc = kLocDesc !== -1 && values[kLocDesc] ? values[kLocDesc].trim() : '';
                                    if (locDesc.toUpperCase().includes('SOBRANTES')) continue;

                                    json.push({
                                        LOCALIZADOR_COD: locCod,
                                        LOCALIZADOR_DESC: locDesc,
                                        TAREA: kTarea !== -1 && values[kTarea] ? values[kTarea].trim() : '',
                                        MOTIVO_DE_OBRA: kObra !== -1 && values[kObra] ? values[kObra].trim() : '',
                                        ITEM: kItem !== -1 && values[kItem] ? values[kItem].trim() : '',
                                        DESCRIPCION: kDesc !== -1 && values[kDesc] ? values[kDesc].trim() : '',
                                        UM: kUM !== -1 && values[kUM] ? values[kUM].trim() : '',
                                        ENTREGADO: kEnt !== -1 && values[kEnt] !== undefined ? values[kEnt].trim() : 0,
                                        CONSUMIDO: kCon !== -1 && values[kCon] !== undefined ? values[kCon].trim() : 0,
                                        DIFERENCIA: kDif !== -1 && values[kDif] !== undefined ? values[kDif].trim() : 0,
                                        FECHA_TRX: kFecha !== -1 && values[kFecha] ? values[kFecha].trim() : ''
                                    });
                                }
                            } else {
                                for (let i = 1; i < lines.length; i++) {
                                    if (!lines[i].trim()) continue;
                                    const values = lines[i].split(delim); const row = {};
                                    for (let j = 0; j < headers.length; j++) row[headers[j]] = values[j] ? values[j].trim() : "";
                                    json.push(row);
                                }
                            }
                            s1_clasificarArchivo(json, headers, file.name);
                        } catch (error) { showToastGlobal("Error al procesar CSV en Etapa 1.", "error"); }
                    };
                    textReader.readAsText(file, 'ISO-8859-1');
                } else {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        try {
                            const data = new Uint8Array(e.target.result);
                            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                            const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
                            s1_clasificarArchivo(json, Object.keys(json[0] || {}), file.name);
                        } catch (error) { showToastGlobal("Error al leer Excel en Etapa 1.", "error"); }
                    };
                    reader.readAsArrayBuffer(file);
                }
            });
        }

        function s1_adelgazarDatasetBCMO(rawRows) {
            if (!rawRows || rawRows.length === 0) return [];
            // Si ya viene adelgazado (por ejemplo desde el parseo CSV temprano)
            if (rawRows.length > 0 && 'LOCALIZADOR_COD' in rawRows[0] && Object.keys(rawRows[0]).length <= 12) {
                return rawRows;
            }
            const sample = rawRows[0];
            const keys = Object.keys(sample);
            const normalize = (s) => String(s || '').trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\.$/, '');

            const kLocCod = keys.find(k => normalize(k) === 'LOCALIZADOR_COD' || normalize(k) === 'LOCALIZADOR COD' || normalize(k) === 'LOCALIZADOR') || 'LOCALIZADOR_COD';
            const kLocDesc = keys.find(k => normalize(k) === 'LOCALIZADOR_DESC' || normalize(k) === 'LOCALIZADOR DESC' || normalize(k) === 'NOMBRE_PROV') || 'LOCALIZADOR_DESC';
            const kTarea = keys.find(k => normalize(k) === 'TAREA') || 'TAREA';
            const kObra = keys.find(k => normalize(k) === 'MOTIVO_DE_OBRA' || normalize(k) === 'MOTIVO DE OBRA' || normalize(k) === 'MOTIVO' || normalize(k) === 'OBRA') || 'MOTIVO_DE_OBRA';
            const kItem = keys.find(k => normalize(k) === 'ITEM' || normalize(k) === 'CODIGO') || 'ITEM';
            const kDesc = keys.find(k => normalize(k) === 'DESCRIPCION') || 'DESCRIPCION';
            const kUM = keys.find(k => normalize(k) === 'UM') || 'UM';
            const kEnt = keys.find(k => normalize(k) === 'ENTREGADO') || 'ENTREGADO';
            const kCon = keys.find(k => normalize(k) === 'CONSUMIDO') || 'CONSUMIDO';
            const kDif = keys.find(k => normalize(k) === 'DIFERENCIA') || 'DIFERENCIA';
            const kFecha = keys.find(k => normalize(k) === 'FECHA_TRX' || normalize(k) === 'FECHA') || 'FECHA_TRX';

            const slim = [];
            const len = rawRows.length;
            for (let i = 0; i < len; i++) {
                const r = rawRows[i];
                const locCod = String(r[kLocCod] || '').trim();
                // Poda temprana: .3001, .4001 y familia sobrantes .1XXX (excepto .1001)
                if (locCod.endsWith('.3001') || locCod.endsWith('.4001') || (/\.1\d{3}$/.test(locCod) && !locCod.endsWith('.1001'))) continue;

                const locDesc = String(r[kLocDesc] || '').trim();
                if (locDesc.toUpperCase().includes('SOBRANTES')) continue;

                slim.push({
                    LOCALIZADOR_COD: locCod,
                    LOCALIZADOR_DESC: locDesc,
                    TAREA: String(r[kTarea] || '').trim(),
                    MOTIVO_DE_OBRA: String(r[kObra] || '').trim(),
                    ITEM: String(r[kItem] || '').trim(),
                    DESCRIPCION: String(r[kDesc] || '').trim(),
                    UM: String(r[kUM] || '').trim(),
                    ENTREGADO: r[kEnt] !== undefined ? r[kEnt] : 0,
                    CONSUMIDO: r[kCon] !== undefined ? r[kCon] : 0,
                    DIFERENCIA: r[kDif] !== undefined ? r[kDif] : 0,
                    FECHA_TRX: r[kFecha] || ''
                });
            }
            return slim;
        }

        function s1_clasificarArchivo(data, headers, filename) {
            if (data.length === 0) return;
            const hStr = headers.join(' ').toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const dateStr = new Date().toLocaleString('es-AR');

            if (hStr.includes('MOTIVO') && hStr.includes('FECHA_TRX')) {
                // Es el PMOVXF - requiere que el Avance General ya esté cargado (secuencia obligatoria, es el paso 4)
                if (!s1_dataAvanceGeneral || s1_dataAvanceGeneral.length === 0) {
                    showToastGlobal("Cargue primero el Avance General (paso 3) antes del PMOVXF.", "error");
                    return;
                }
                s1_dataMateriales = normalizarDataset(data);
                window.s1_dataMateriales = s1_dataMateriales;
                if (typeof window.s3_ejecutarCruceTarea === 'function') window.s3_ejecutarCruceTarea();
                s1_fileUploadDates.pmovxf = dateStr;
                s1_actualizarEstadoUI('s1_statusMateriales', true, dateStr);
                s1_checkReadyToAnalyze();
                showToastGlobal("PMOVXF cargado exitosamente en Etapa 1.", "success");
            } else if (hStr.includes('ESTADO DE LIQUIDACION') || (hStr.includes('ENTREGADO') && hStr.includes('CONSUMIDO') && hStr.includes('TAREA'))) {
                // Es el BCMO - requiere que el Reporte de Localizadores ya esté cargado (secuencia obligatoria)
                if (!s1_localizadorMap || s1_localizadorMap.size === 0) {
                    showToastGlobal("Cargue primero el Reporte de Localizadores (paso 1) antes del BCMO.", "error");
                    return;
                }
                s1_currentRawData = s1_adelgazarDatasetBCMO(data);
                data = null; // Liberar memoria del dataset crudo original
                s1_fileUploadDates.bcmo = dateStr;
                s1_actualizarEstadoUI('s1_statusBCMO', true, dateStr);
                s1_checkReadyToAnalyze();
                showToastGlobal(`BCMO optimizado cargado (${s1_currentRawData.length.toLocaleString('es-AR')} registros útiles).`, "success");
            } else if (hStr.includes('MODALIDAD DE LIQUIDACION') || hStr.includes('ETAPA LOGICA') || (hStr.includes('MOTIVO') && (hStr.includes('EMPRESA') || hStr.includes('CONTRATISTA')))) {
                // Es el Avance General
                s1_handleAvanceGeneralFileRaw(data, dateStr);
            } else if (hStr.includes('SUBINVENTARIO') && hStr.includes('LOCALIZADOR') && hStr.includes('NOMBRE PROV')) {
                // Es el Reporte de Localizadores
                s1_handleLocalizadoresFileRaw(data, dateStr);
            } else {
                showToastGlobal(`El archivo ${filename} no es válido para la Etapa 1 (Se requiere BCMO, PMOVXF, Avance General o Reporte de Localizadores).`, "error");
            }
        }

        function s1_handleLocalizadoresFileRaw(data, dateStr) {
            if (!data || data.length === 0) { showToastGlobal("El Reporte de Localizadores está vacío.", "error"); return; }

            const headers = Object.keys(data[0]);
            const campoLocalizador = headers.find(h => h.trim().toUpperCase() === 'LOCALIZADOR') || headers.find(h => h.toUpperCase().includes('LOCALIZADOR'));
            const campoNombreProv = headers.find(h => h.trim().toUpperCase() === 'NOMBRE PROV') || headers.find(h => h.toUpperCase().includes('NOMBRE') && h.toUpperCase().includes('PROV'));

            if (!campoLocalizador || !campoNombreProv) {
                showToastGlobal("El Reporte de Localizadores no tiene las columnas LOCALIZADOR / NOMBRE PROV esperadas.", "error");
                return;
            }

            s1_localizadorMap = new Map();
            window.s1_localizadorMap = s1_localizadorMap;
            if (typeof window.s3_ejecutarCruceTarea === 'function') window.s3_ejecutarCruceTarea();
            data.forEach(row => {
                const loc = String(row[campoLocalizador] || '').trim().toUpperCase();
                const nombreProv = String(row[campoNombreProv] || '').trim();
                if (loc && nombreProv) s1_localizadorMap.set(loc, nombreProv);
            });

            s1_dataLocalizadores = null; // No retenemos el array completo en RAM
            data = null;

            s1_actualizarEstadoUI('s1_statusLocalizadores', true, dateStr);
            s1_checkReadyToAnalyze();
            showToastGlobal(`Reporte de Localizadores cargado. ${s1_localizadorMap.size} localizadores mapeados.`, "success");

            // Extraer razones sociales únicas y abrir el modal de selección de empresa auditada
            const empresas = [...new Set(Array.from(s1_localizadorMap.values()))].filter(Boolean).sort();
            s1_abrirModalEmpresa(empresas, 'localizadores');
        }

        function s1_handleLocalizadoresFile(file) {
            const dateStr = new Date().toLocaleString('es-AR');
            const ext = file.name.split('.').pop().toLowerCase();
            if (ext === 'csv' || ext === 'txt') {
                const r = new FileReader();
                r.onload = (e) => {
                    try {
                        const text = e.target.result;
                        const firstLine = text.split('\n')[0];
                        let delim = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
                        const lines = text.split('\n');
                        const headers = lines[0].split(delim).map(h => h.trim());
                        const campoLocalizador = headers.find(h => h.trim().toUpperCase() === 'LOCALIZADOR') || headers.find(h => h.toUpperCase().includes('LOCALIZADOR')) || 'LOCALIZADOR';
                        const campoNombreProv = headers.find(h => h.trim().toUpperCase() === 'NOMBRE PROV') || headers.find(h => h.toUpperCase().includes('NOMBRE') && h.toUpperCase().includes('PROV')) || 'NOMBRE PROV';
                        const idxLoc = headers.indexOf(campoLocalizador);
                        const idxProv = headers.indexOf(campoNombreProv);

                        const json = [];
                        for (let i = 1; i < lines.length; i++) {
                            if (!lines[i].trim()) continue;
                            const values = lines[i].split(delim);
                            const row = {};
                            row[campoLocalizador] = idxLoc !== -1 && values[idxLoc] ? values[idxLoc].trim() : '';
                            row[campoNombreProv] = idxProv !== -1 && values[idxProv] ? values[idxProv].trim() : '';
                            json.push(row);
                        }
                        s1_handleLocalizadoresFileRaw(json, dateStr);
                    } catch (err) { showToastGlobal("Error al leer el Reporte de Localizadores (CSV/TXT).", "error"); }
                };
                r.readAsText(file, 'ISO-8859-1');
            } else {
                const r = new FileReader();
                r.onload = (e) => {
                    try {
                        const data = new Uint8Array(e.target.result);
                        const wb = XLSX.read(data, { type: 'array', cellDates: true });
                        const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
                        s1_handleLocalizadoresFileRaw(json, dateStr);
                    } catch (err) { showToastGlobal("Error al leer el Reporte de Localizadores (Excel).", "error"); }
                };
                r.readAsArrayBuffer(file);
            }
        }

        function s1_handleAvanceGeneralFileRaw(data, dateStr) {
            if (!s1_currentRawData || s1_currentRawData.length === 0) {
                showToastGlobal("Cargue primero el archivo BCMO (paso 2) antes del Avance General.", "error");
                return;
            }
            s1_dataAvanceGeneral = data;
            window.s1_dataAvanceGeneral = data; // Exponemos globalmente para acceso desde Etapa 2 y 3
            if (typeof window.s3_ejecutarCruceTarea === 'function') window.s3_ejecutarCruceTarea();
            const headers = Object.keys(data[0]);
            const campoEmpresa = headers.find(h => {
                const hu = h.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                return hu.includes('EMPRESA') || hu.includes('CONTRATISTA') || hu.includes('RAZON SOCIAL') || hu.includes('LOCALIZADOR_DESC') || hu.includes('LOCALIZADOR DESC');
            }) || headers[0];
            window._s1_campoEmpresaAvance = campoEmpresa;
            const empresas = [...new Set(data.map(r => String(r[campoEmpresa] || '').trim()).filter(Boolean))].sort();
            s1_actualizarEstadoUI('s1_statusAvanceGeneral', true, dateStr);
            s1_checkReadyToAnalyze();
            showToastGlobal(`Avance General cargado. ${data.length} registros.`, "success");
            s1_abrirModalEmpresa(empresas, 'avance');
        }

        function s1_handleAvanceGeneralFile(file) {
            const procesar = (json) => {
                if (!json || json.length === 0) { showToastGlobal("El archivo Avance General está vacío.", "error"); return; }
                if (!s1_currentRawData || s1_currentRawData.length === 0) {
                    showToastGlobal("Cargue primero el archivo BCMO (paso 2) antes del Avance General.", "error");
                    return;
                }
                s1_dataAvanceGeneral = json;
                window.s1_dataAvanceGeneral = json; // Exponemos globalmente para acceso desde Etapa 2
                const headers = Object.keys(json[0]);
                const campoEmpresa = headers.find(h => {
                    const hu = h.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    return hu.includes('EMPRESA') || hu.includes('CONTRATISTA') || hu.includes('RAZON SOCIAL') || hu.includes('LOCALIZADOR_DESC') || hu.includes('LOCALIZADOR DESC');
                }) || headers[0];
                window._s1_campoEmpresaAvance = campoEmpresa;
                const empresas = [...new Set(json.map(r => String(r[campoEmpresa] || '').trim()).filter(Boolean))].sort();
                const dateStr = new Date().toLocaleString('es-AR');
                s1_actualizarEstadoUI('s1_statusAvanceGeneral', true, dateStr);
                s1_checkReadyToAnalyze();
                showToastGlobal(`Avance General cargado. ${json.length} registros detectados.`, "success");
                s1_abrirModalEmpresa(empresas, 'avance');
            };

            const ext = file.name.split('.').pop().toLowerCase();
            if (ext === 'csv' || ext === 'txt') {
                const r = new FileReader();
                r.onload = (e) => {
                    const text = e.target.result;
                    const firstLine = text.split('\n')[0];
                    let delim = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
                    const lines = text.split('\n');
                    const headers = lines[0].split(delim).map(h => h.trim());
                    const json = [];
                    for (let i = 1; i < lines.length; i++) {
                        if (!lines[i].trim()) continue;
                        const values = lines[i].split(delim); const row = {};
                        for (let j = 0; j < headers.length; j++) row[headers[j]] = values[j] ? values[j].trim() : '';
                        json.push(row);
                    }
                    procesar(json);
                };
                r.readAsText(file, 'ISO-8859-1');
            } else {
                const r = new FileReader();
                r.onload = (e) => {
                    try {
                        const data = new Uint8Array(e.target.result);
                        const wb = XLSX.read(data, { type: 'array', cellDates: true });
                        const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
                        procesar(json);
                    } catch (err) { showToastGlobal("Error al leer el Avance General.", "error"); }
                };
                r.readAsArrayBuffer(file);
            }
        }

        let s1_modalEmpresaOrigen = 'localizadores';
        function s1_abrirModalEmpresa(empresas, origen = 'localizadores') {
            s1_modalEmpresaOrigen = origen;
            const sel = document.getElementById('s1_empresaAuditadaSelect');
            if (!sel) return;
            sel.innerHTML = empresas.map(e => `<option value="${e}">${e}</option>`).join('');

            // Preselección inteligente:
            if (s1_empresaAuditada) {
                // 1. Coincidencia exacta
                let opt = [...sel.options].find(o => o.value === s1_empresaAuditada);
                // 2. Coincidencia canónica flexible (sin tildes, CIA = COMPANIA, sin S.A.)
                if (!opt) {
                    const normEmp = s1_normalizarEmpresa(s1_empresaAuditada);
                    opt = [...sel.options].find(o => s1_normalizarEmpresa(o.value) === normEmp);
                }
                // 3. Coincidencia por inclusión de raíces
                if (!opt) {
                    opt = [...sel.options].find(o => s1_esMismaEmpresa(o.value, s1_empresaAuditada));
                }
                if (opt) {
                    opt.selected = true;
                }
            }
            const modal = document.getElementById('s1_avanceModal');
            if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
        }

        function s1_cancelarAvanceModal() {
            const modal = document.getElementById('s1_avanceModal');
            if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
        }

        function s1_cambiarEmpresaAuditada() {
            if (s1_localizadorMap && s1_localizadorMap.size > 0) {
                const empresas = [...new Set(Array.from(s1_localizadorMap.values()))].filter(Boolean).sort();
                s1_abrirModalEmpresa(empresas, 'localizadores');
                return;
            }
            if (!s1_dataAvanceGeneral) { showToastGlobal("Primero cargue el Reporte de Localizadores.", "error"); return; }
            const headers = Object.keys(s1_dataAvanceGeneral[0]);
            const campoEmpresa = window._s1_campoEmpresaAvance || headers[0];
            const empresas = [...new Set(s1_dataAvanceGeneral.map(r => String(r[campoEmpresa] || '').trim()).filter(Boolean))].sort();
            s1_abrirModalEmpresa(empresas, 'avance');
        }

        function s1_confirmarEmpresaAuditada() {
            const sel = document.getElementById('s1_empresaAuditadaSelect');
            if (!sel || !sel.value) return;
            const valorSel = sel.value;

            if (s1_modalEmpresaOrigen === 'avance') {
                s1_empresaAuditadaAvance = valorSel;
                if (!s1_empresaAuditada) s1_empresaAuditada = valorSel;
            } else {
                s1_empresaAuditada = valorSel;
                s1_empresaAuditadaAvance = valorSel;
            }
            window.s1_empresaAuditada = s1_empresaAuditada;
            window.s1_empresaAuditadaAvance = s1_empresaAuditadaAvance;

            // Población del conjunto de localizadores unívocos correspondientes a la empresa seleccionada
            s1_localizadoresEmpresaAuditada = new Set();
            if (s1_localizadorMap && s1_localizadorMap.size > 0) {
                s1_localizadorMap.forEach((nombreProv, locCod) => {
                    if (s1_esMismaEmpresa(nombreProv, s1_empresaAuditada)) {
                        s1_localizadoresEmpresaAuditada.add(locCod.toUpperCase());
                    }
                });
            }

            s1_cancelarAvanceModal();
            const tag = document.getElementById('s1_empresaAuditadaTag');
            const lbl = document.getElementById('s1_empresaAuditadaLabel');
            if (tag) tag.classList.remove('hidden');
            if (lbl) lbl.textContent = s1_empresaAuditada;
            showToastGlobal(`Empresa auditada establecida: ${s1_empresaAuditada} (${s1_localizadoresEmpresaAuditada.size} localizadores identificados)`, "success");

            // Solo re-analizar si el workspace ya estaba visualizado previamente
            const resultsWorkspace = document.getElementById('s1_resultsWorkspace');
            const yaAnalizado = resultsWorkspace && !resultsWorkspace.classList.contains('hidden');
            if (yaAnalizado && s1_currentRawData && s1_currentRawData.length > 0 && s1_dataMateriales && s1_dataMateriales.length > 0) {
                s1_lanzarAnalisisBCMO();
            }

            if (typeof window.s3_actualizarEstadoTarjetasInsumos === 'function') {
                window.s3_actualizarEstadoTarjetasInsumos();
            }
            if (typeof window.actualizarTarjetasEtapa2UI === 'function') {
                window.actualizarTarjetasEtapa2UI();
            }
        }

        function s1_renderReasignadasTable() {
            const tbody = document.getElementById('s1_reasignadasTableBody');
            const empty = document.getElementById('s1_reasignadasEmpty');
            if (!tbody) return;
            tbody.innerHTML = '';
            if (s1_obrasReasignadasData.length === 0) {
                if (empty) empty.classList.remove('hidden');
                return;
            }
            if (empty) empty.classList.add('hidden');
            s1_obrasReasignadasData.forEach(item => {
                const tr = document.createElement('tr');
                tr.className = "border-b border-slate-100 hover:bg-orange-50";
                tr.innerHTML = `
                    <td class="p-3 text-sm text-slate-700">${item.Contratista}</td>
                    <td class="p-3 text-sm font-bold text-orange-700">${item.Obra}</td>
                    <td class="p-3 text-sm text-slate-600"><span class="bg-orange-100 text-orange-800 text-xs font-semibold px-2 py-0.5 rounded">${item.EmpresaEnAvance || 'Otra empresa'}</span></td>
                    <td class="p-3 text-sm text-slate-700 text-right">${s1_formatLocalNumber(item.Entregado || 0)}</td>
                    <td class="p-3 text-sm text-slate-700 text-right">${s1_formatLocalNumber(item.Consumido || 0)}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        /**
         * Verifica si los archivos REQUERIDOS de la Etapa 1 están cargados
         * (BCMO + Reporte de Localizadores) y actualiza el estado del botón Analizar.
         */
        function s1_checkReadyToAnalyze() {
            const btn = document.getElementById('s1_btnAnalizar');
            if (!btn) return;
            const tieneLocalizadores = s1_localizadorMap && s1_localizadorMap.size > 0;
            const tieneBCMO = s1_currentRawData && s1_currentRawData.length > 0;
            const tieneAvance = s1_dataAvanceGeneral && s1_dataAvanceGeneral.length > 0;
            const tienePM = s1_dataMateriales && s1_dataMateriales.length > 0;

            const faltantes = [];
            if (!tieneLocalizadores) faltantes.push('Reporte de Localizadores');
            if (!tieneBCMO) faltantes.push('archivo BCMO');
            if (!tieneAvance) faltantes.push('Avance General');
            if (!tienePM) faltantes.push('PMOVXF');

            if (faltantes.length === 0) {
                btn.disabled = false;
                btn.className = 'w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 text-xs sm:text-sm border border-blue-800 shadow-sm animate-pulse';
                btn.innerHTML = '<i class="fa-solid fa-magnifying-glass-chart"></i> Analizar BCMO';
            } else {
                btn.disabled = true;
                btn.className = 'w-full bg-amber-500 text-white font-bold py-2 px-4 rounded-xl transition-all cursor-not-allowed flex items-center justify-center gap-2 text-xs sm:text-sm border border-amber-600';
                btn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Falta: ${faltantes[0]}`;
            }

            s1_actualizarSecuenciaCarga();

            // Sincronizar indicadores visuales del panel de "Reglas de Negocio"
            const updateRule = (iconId, labelId, isReady, optText) => {
                const icon = document.getElementById(iconId);
                const label = document.getElementById(labelId);
                if (!icon || !label) return;
                if (isReady) {
                    icon.className = 'fa-solid fa-circle text-emerald-400 text-[6px]';
                    label.className = 'text-[10px] sm:text-[11px] font-bold text-emerald-400';
                    label.textContent = 'Cargado';
                } else if (optText) {
                    icon.className = 'fa-regular fa-circle text-indigo-700 text-[6px]';
                    label.className = 'text-[10px] sm:text-[11px] font-semibold text-slate-500';
                    label.textContent = optText;
                } else {
                    icon.className = 'fa-solid fa-circle text-slate-600 text-[6px]';
                    label.className = 'text-[10px] sm:text-[11px] font-bold text-rose-400';
                    label.textContent = 'Pendiente';
                }
            };

            updateRule('s1_ruleIconLoc', 's1_ruleLabelLoc', tieneLocalizadores);
            updateRule('s1_ruleIconBCMO', 's1_ruleLabelBCMO', tieneBCMO);
            updateRule('s1_ruleIconAvance', 's1_ruleLabelAvance', tieneAvance);
            updateRule('s1_ruleIconPM', 's1_ruleLabelPM', tienePM, 'Opcional');
        }

        // Secuencia obligatoria de carga: 1) Reporte de Localizadores -> 2) BCMO -> 3) Avance General -> 4) PMOVXF.
        // No es una dependencia de datos (cada archivo se guarda independiente al parsearse), es un orden de
        // flujo guiado: Localizadores dispara la selección de empresa auditada (paso de "configuración inicial"),
        // BCMO es el archivo central, Avance General se usa durante el análisis del BCMO, y PMOVXF es lo último
        // que se necesita (Verificar Consumo / Etapa 2). Se bloquea tanto visualmente (botones grises,
        // pointer-events-none) como a nivel de validación (ver gates en s1_clasificarArchivo /
        // s1_handleAvanceGeneralFileRaw / s1_handleLocalizadoresFileRaw), para que no se pueda saltear el orden.
        function s1_actualizarSecuenciaCarga() {
            const tieneLocalizadores = s1_localizadorMap && s1_localizadorMap.size > 0;
            const tieneBCMO = s1_currentRawData && s1_currentRawData.length > 0;
            const tieneAvance = s1_dataAvanceGeneral && s1_dataAvanceGeneral.length > 0;

            const setEnabled = (id, enabled) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.classList.toggle('opacity-40', !enabled);
                el.classList.toggle('pointer-events-none', !enabled);
            };

            // Paso 2 (BCMO/PM, dropzone compartida): habilitada recién con Localizadores cargado
            setEnabled('s1_dropZoneWrapper', tieneLocalizadores);
            // Paso 3 (Avance General): habilitado recién con BCMO cargado
            setEnabled('s1_avanceGeneralWrapper', tieneBCMO);
            setEnabled('s1_pmovxfWrapper', tieneAvance);
            // Paso 4 (PMOVXF): comparte dropzone con BCMO, pero visualmente se avisa que hace falta Avance
            const pmHint = document.getElementById('s1_pmSecuenciaHint');
            if (pmHint) pmHint.classList.toggle('hidden', tieneAvance);
        }

        function s1_lanzarAnalisisBCMO() {
            if (!s1_localizadorMap || s1_localizadorMap.size === 0) {
                showToastGlobal("Debe cargar el Reporte de Localizadores (paso 1) antes de analizar.", "error"); return;
            }
            if (!s1_currentRawData || s1_currentRawData.length === 0) {
                showToastGlobal("Cargue el archivo BCMO (paso 2) antes de analizar.", "error"); return;
            }
            if (!s1_dataAvanceGeneral || s1_dataAvanceGeneral.length === 0) {
                showToastGlobal("Cargue el Avance General (paso 3) antes de analizar.", "error"); return;
            }
            if (!s1_dataMateriales || s1_dataMateriales.length === 0) {
                showToastGlobal("Cargue el PMOVXF (paso 4) antes de analizar.", "error"); return;
            }
            if (!s1_empresaAuditada) {
                const empresas = [...new Set(Array.from(s1_localizadorMap.values()))].filter(Boolean).sort();
                s1_abrirModalEmpresa(empresas);
                showToastGlobal("Seleccione la empresa auditada para continuar.", "info");
                return;
            }
            document.getElementById('s1_uploadWrapper').classList.add('hidden');
            document.getElementById('s1_loader').classList.remove('hidden');
            document.getElementById('s1_resultsWorkspace').classList.add('hidden');
            setTimeout(() => s1_analyzeData(s1_currentRawData), 200);
        }

        function s1_volverACargarArchivos() {
            const uploadWrapper = document.getElementById('s1_uploadWrapper');
            const resultsWorkspace = document.getElementById('s1_resultsWorkspace');
            const btnVolver = document.getElementById('s1_btnVolverResultados');
            if (uploadWrapper) uploadWrapper.classList.remove('hidden');
            if (resultsWorkspace) resultsWorkspace.classList.add('hidden');
            if (btnVolver) btnVolver.classList.remove('hidden');
            s1_actualizarSecuenciaCarga();
            s1_checkReadyToAnalyze();
        }
        window.s1_volverACargarArchivos = s1_volverACargarArchivos;

        function s1_mostrarResultadosWorkspace() {
            const uploadWrapper = document.getElementById('s1_uploadWrapper');
            const resultsWorkspace = document.getElementById('s1_resultsWorkspace');
            if (uploadWrapper) uploadWrapper.classList.add('hidden');
            if (resultsWorkspace) {
                resultsWorkspace.classList.remove('hidden');
                resultsWorkspace.classList.add('flex');
            }
        }
        window.s1_mostrarResultadosWorkspace = s1_mostrarResultadosWorkspace;

        function s1_actualizarEstadoUI(id, success, date) {
            const el = document.getElementById(id);
            if (!el) return;
            if (success) {
                el.classList.remove('text-slate-400', 'border-slate-100', 'bg-slate-50');
                el.classList.add('text-emerald-700', 'border-emerald-200', 'bg-emerald-50');
                const i = el.querySelector('i');
                if (i) i.className = 'fa-solid fa-check-circle text-emerald-500 mr-1.5 text-xs sm:text-sm align-middle';
                const span = el.querySelector('span');
                if (span) span.textContent = date ? `Cargado (${date})` : 'Cargado';
            }
        }

        function s1_resetUI() {
            s1_currentRawData = [];
            s1_dataMateriales = null;
            s1_dataAvanceGeneral = null;
            s1_empresaAuditada = '';
            s1_empresaAuditadaAvance = '';
            s1_localizadoresEmpresaAuditada = new Set();
            s1_auditTrail = {};
            s1_obrasReasignadasData = [];
            s1_excluidasPorTareaData = [];
            s1_excluidasAutorizadas = new Set();
            s1_dataLocalizadores = null;
            s1_localizadorMap = null;
            s1_secundarioIndex = {};
            s1_otraECData = [];
            window._s1_campoEmpresaAvance = null;
            s1_fileUploadDates = { bcmo: null, pmovxf: null };
            document.getElementById('s1_uploadWrapper').classList.remove('hidden');
            document.getElementById('s1_loader').classList.add('hidden');
            document.getElementById('s1_resultsWorkspace').classList.add('hidden');
            document.getElementById('s1_filtersPanel').classList.add('opacity-50', 'pointer-events-none');
            document.getElementById('s1_fileInput').value = "";
            const avInput = document.getElementById('s1_avanceGeneralInput'); if (avInput) avInput.value = "";
            const locInput = document.getElementById('s1_localizadoresInput'); if (locInput) locInput.value = "";
            document.getElementById('s1_searchObraDashboard').value = ""; document.getElementById('s1_searchObraVerif').value = "";
            if (document.getElementById('s1_massiveTotal')) document.getElementById('s1_massiveTotal').value = "";
            if (document.getElementById('s1_massiveParcial')) document.getElementById('s1_massiveParcial').value = "";
            // Restablecer botón Analizar
            s1_checkReadyToAnalyze();
            // Limpiar tag empresa auditada
            const tag = document.getElementById('s1_empresaAuditadaTag');
            if (tag) tag.classList.add('hidden');

            ['s1_statusBCMO', 's1_statusMateriales', 's1_statusAvanceGeneral', 's1_statusLocalizadores'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.classList.add('text-slate-400');
                    el.classList.remove('text-emerald-700', 'border-emerald-200', 'bg-emerald-50');
                    const i = el.querySelector('i');
                    if (i) i.className = 'fa-regular fa-circle text-slate-300';
                    const span = el.querySelector('span');
                    if (span) span.textContent = (id === 's1_statusMateriales') ? 'No cargado (Opcional)' : 'Sin cargar';
                }
            });

            ['s1_invalidCountBadge', 's1_reasignadasCountBadge', 's1_otraECCountBadge', 's1_novedadesCountBadge', 's1_verifCountBadge'].forEach(id => {
                setTabBadge(id, 0);
            });

            s1_checkReadyToAnalyze();
        }

        function s1_formatLocalNumber(num) { return num.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }

        function s1_analyzeData(data) {
            const tasksToExclude = document.getElementById('s1_excludedTasks').value.split('\n').map(t => t.trim().toUpperCase()).filter(t => t);
            const materialsToExclude = document.getElementById('s1_excludedMaterials').value.split('\n').map(m => m.trim().toLowerCase()).filter(m => m);
            const invalidNomenclatures = document.getElementById('s1_invalidNomenclaturesInput').value.split('\n').map(n => n.trim().toUpperCase()).filter(n => n);

            const groupedRaw = {};
            const invalidGroupedRaw = {};
            const contratistasSet = new Set();

            // Bloque Secundario: índice de otras razones sociales (obra -> [items con consumo])
            // Se usa después para la búsqueda transversal "Consumo en Otra EC"
            const secundarioIndexLocal = {};
            const empresaAuditadaNorm = String(s1_empresaAuditada || '').trim().toUpperCase();

            // PRIMERA PASADA: Agrupar todo sin omitir por lógica matemática (solo exclusión base .4001 y tareas nulas)
            // Preparar Set de obras reasignadas si hay Avance General
            const obrasOtrasEmpresasSet = new Set(); // clave: obraKey
            const obrasEmpresaAvanceMap = {}; // obraKey -> empresa del avance
            if (s1_dataAvanceGeneral && s1_empresaAuditada) {
                const campoEmpresa = window._s1_campoEmpresaAvance || Object.keys(s1_dataAvanceGeneral[0])[0];
                const headers = Object.keys(s1_dataAvanceGeneral[0]);


                const campoObra = headers.find(h => h.toUpperCase().includes('NODO')) ||
                    headers.find(h => {
                        const hu = h.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                        return hu.includes('MOTIVO') || hu.includes('OBRA') || (hu.includes('TAREA') && !hu.includes('EXTRA'));
                    }) || headers[1];



                //   const campoObra = headers.find(h => {
                //       const hu = h.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                //       return hu.includes('MOTIVO') || hu.includes('OBRA') || (hu.includes('TAREA') && !hu.includes('EXTRA'));
                //   }) || headers[1];
                s1_dataAvanceGeneral.forEach(row => {
                    const empresa = String(row[campoEmpresa] || '').trim();
                    const obra = String(row[campoObra] || '').trim().toUpperCase();
                    if (!obra || !empresa) return;
                    const esEmpresaActual = s1_esMismaEmpresa(empresa, s1_empresaAuditadaAvance || s1_empresaAuditada);
                    if (!esEmpresaActual) {
                        obrasOtrasEmpresasSet.add(obra);
                        if (!obrasEmpresaAvanceMap[obra]) obrasEmpresaAvanceMap[obra] = empresa;
                    }
                });
            }
            s1_obrasReasignadasData = [];
            s1_excluidasPorTareaData = [];
            // Mapa temporal para acumular grupos de obras excluidas por tarea
            const excluidasPorTareaRaw = {};

            data.forEach(row => {
                const nR = row;

                // REGLA 1.A: EXCLUSIÓN DINÁMICA DE LOCALIZADORES (.3001, .4001 y familia .1XXX)
                const locCod = String(nR['LOCALIZADOR_COD'] || nR['LOCALIZADOR COD'] || '').trim();

                // Patrón: Termina en .1 seguido de exactamente 3 dígitos. Excepción: .1001 (usado por SORED)
                const esFamiliaSobrantes = /\.1\d{3}$/.test(locCod) && !locCod.endsWith('.1001');

                if (locCod.endsWith('.3001') || locCod.endsWith('.4001') || esFamiliaSobrantes) return;

                // Razón Social real: cruce Localizador Cod (BCMO) -> LOCALIZADOR (Reporte de Localizadores) -> NOMBRE PROV
                const contratistaReal = (s1_localizadorMap && s1_localizadorMap.get(locCod.toUpperCase())) || nR['LOCALIZADOR_DESC'] || nR['LOCALIZADOR DESC'] || nR['NOMBRE_PROV'] || 'Sin Contratista';
                const localizadorDescBCMO = String(nR['LOCALIZADOR_DESC'] || nR['LOCALIZADOR DESC'] || '');
                const tarea = String(nR['TAREA'] || '').trim();
                const obra = String(nR['MOTIVO_DE_OBRA'] || nR['MOTIVO DE OBRA'] || nR['MOTIVO'] || 'Sin Obra').trim();

                // REGLA 1.B: Filtro de seguridad por texto en la descripción original del localizador (BCMO)
                if (localizadorDescBCMO.toUpperCase().includes('SOBRANTES')) return;

                // --- DETERMINACIÓN DE PERTENENCIA A LA EMPRESA AUDITADA ---
                // 1) Si s1_localizadoresEmpresaAuditada tiene códigos cargados del Reporte de Localizadores, se verifica pertenencia unívoca
                // 2) Fallback por coincidencia canónica flexible de la razón social
                const locCodUpper = locCod.toUpperCase();
                let perteneceAEmpresa = false;
                if (s1_localizadoresEmpresaAuditada && s1_localizadoresEmpresaAuditada.size > 0) {
                    perteneceAEmpresa = s1_localizadoresEmpresaAuditada.has(locCodUpper);
                }
                if (!perteneceAEmpresa && s1_empresaAuditada) {
                    perteneceAEmpresa = s1_esMismaEmpresa(contratistaReal, s1_empresaAuditada) || s1_esMismaEmpresa(localizadorDescBCMO, s1_empresaAuditada);
                }

                if (s1_empresaAuditada && !perteneceAEmpresa) {
                    if (invalidNomenclatures.includes(obra.toUpperCase())) return;
                    if (tasksToExclude.includes(tarea.toUpperCase())) return;
                    const descSec = String(nR['DESCRIPCION'] || '');
                    let esMatExcluidoSec = false;
                    for (let mat of materialsToExclude) { if (descSec.toLowerCase().includes(mat)) { esMatExcluidoSec = true; break; } }
                    if (esMatExcluidoSec) return;

                    const conSec = parseDecimalGlobal(nR['CONSUMIDO']);
                    if (conSec > 0) {
                        const obraKey = obra.toUpperCase();
                        if (!secundarioIndexLocal[obraKey]) secundarioIndexLocal[obraKey] = [];
                        secundarioIndexLocal[obraKey].push({
                            Contratista: contratistaReal,
                            LocalizadorCod: locCod,
                            Item: nR['ITEM'] || nR['CODIGO'] || '',
                            Descripcion: descSec.trim(),
                            UM: nR['UM'] || '',
                            Entregado: parseDecimalGlobal(nR['ENTREGADO']),
                            Consumido: conSec,
                            Diferencia: parseDecimalGlobal(nR['DIFERENCIA'])
                        });
                    }
                    return;
                }

                const contratista = s1_empresaAuditada || contratistaReal;





                if (invalidNomenclatures.includes(obra.toUpperCase())) {
                    const gK = `${contratista}|${obra}`;
                    if (!invalidGroupedRaw[gK]) {
                        invalidGroupedRaw[gK] = { Contratista: contratista, Obra: obra, Entregado: 0, Consumido: 0, Detalles: [] };
                    }
                    invalidGroupedRaw[gK].Entregado += parseDecimalGlobal(nR['ENTREGADO']);
                    invalidGroupedRaw[gK].Consumido += parseDecimalGlobal(nR['CONSUMIDO']);

                    invalidGroupedRaw[gK].Detalles.push({
                        "Ítem": nR['ITEM'] || nR['CODIGO'] || '',
                        "Descripción": String(nR['DESCRIPCION'] || '').trim(),
                        "UM": nR['UM'] || '',
                        "Entregado": parseDecimalGlobal(nR['ENTREGADO']),
                        "Consumido": parseDecimalGlobal(nR['CONSUMIDO']),
                        "Diferencia": parseDecimalGlobal(nR['DIFERENCIA']),
                        "Excluido": false,
                        "Ignorado": false,
                        "FallbackRescatado": false
                    });
                    return;
                }
                const desc = String(nR['DESCRIPCION'] || '');
                const descLower = desc.toLowerCase();
                const ent = parseDecimalGlobal(nR['ENTREGADO']);
                const con = parseDecimalGlobal(nR['CONSUMIDO']);
                const dif = parseDecimalGlobal(nR['DIFERENCIA']);

                if (!obra && !tarea) return;

                // Interceptación de la tarea "SORED" para verificar condiciones de descarte/interruptor
                if (tarea.toUpperCase() === 'SORED') {
                    if (locCod.endsWith('.1001') && con > 0) {
                        const gK = `${contratista}|${obra}`;
                        if (!groupedRaw[gK]) {
                            groupedRaw[gK] = { Contratista: contratista, Obra: obra, LocalizadorCod: locCod, items: [], tieneSoredConsumido: true };
                            contratistasSet.add(contratista);
                        } else {
                            groupedRaw[gK].tieneSoredConsumido = true;
                        }
                    }
                    return; // Siempre se descarta de la suma de materiales
                }

                if (tasksToExclude.includes(tarea.toUpperCase())) {
                    // Capturar obra excluida por tarea: solo si pertenece a la empresa auditada
                    // y no está en nomenclatura inválida ni en reasignadas.
                    if (!invalidNomenclatures.includes(obra.toUpperCase()) &&
                        !(s1_dataAvanceGeneral && s1_empresaAuditada && obrasOtrasEmpresasSet.has(obra.toUpperCase()))) {
                        const gKExc = `${contratista}|${obra}`;
                        if (!excluidasPorTareaRaw[gKExc]) {
                            excluidasPorTareaRaw[gKExc] = {
                                Contratista: contratista,
                                Obra: obra,
                                Tarea: tarea,
                                LocalizadorCod: locCod,
                                Entregado: 0,
                                Consumido: 0,
                                Diferencia: 0,
                                Detalles: []
                            };
                        }
                        const excEntry = excluidasPorTareaRaw[gKExc];
                        excEntry.Entregado += ent;
                        excEntry.Consumido += con;
                        excEntry.Diferencia += dif;
                        excEntry.Detalles.push({
                            'Ítem': nR['ITEM'] || nR['CODIGO'] || '',
                            'Descripción': String(nR['DESCRIPCION'] || '').trim(),
                            'UM': nR['UM'] || '',
                            'Tarea': tarea,
                            'Entregado': ent,
                            'Consumido': con,
                            'Diferencia': dif
                        });
                    }
                    return;
                }

                let isExcludedMat = false;
                for (let mat of materialsToExclude) { if (descLower.includes(mat)) { isExcludedMat = true; break; } }

                const gK = `${contratista}|${obra}`;

                // REGLA: Si hay Avance General y la obra pertenece a otra empresa, es REASIGNADA
                if (s1_dataAvanceGeneral && s1_empresaAuditada && obrasOtrasEmpresasSet.has(obra.toUpperCase())) {
                    let existente = s1_obrasReasignadasData.find(r => r.Obra === obra);
                    if (!existente) {
                        s1_obrasReasignadasData.push({
                            Contratista: contratista, Obra: obra,
                            EmpresaEnAvance: obrasEmpresaAvanceMap[obra.toUpperCase()] || 'Otra empresa',
                            Entregado: ent, Consumido: con
                        });
                    } else {
                        existente.Entregado += ent;
                        existente.Consumido += con;
                    }
                    return;
                }

                if (!groupedRaw[gK]) {
                    groupedRaw[gK] = { Contratista: contratista, Obra: obra, LocalizadorCod: locCod, items: [] };
                    contratistasSet.add(contratista);
                }

                groupedRaw[gK].items.push({
                    "Ítem": nR['ITEM'] || nR['CODIGO'] || '',
                    "Descripción": desc.trim(),
                    "UM": nR['UM'] || '',
                    "Entregado": ent,
                    "Consumido": con,
                    "Diferencia": dif,
                    "Excluido": isExcludedMat
                });
            });

            // SEGUNDA PASADA: Aplicación estricta de la regla matemática
            const grouped = {};
            for (const gK in groupedRaw) {
                const group = groupedRaw[gK];
                const totalItems = group.items.length;
                const excludedItemsCount = group.items.filter(i => i.Excluido).length;

                // Si la cantidad de ítems excluidos es IGUAL a la cantidad total de la obra, entonces SOLO tiene excluidos.
                const onlyExcluded = (totalItems > 0 && excludedItemsCount === totalItems);

                let finalEntregado = 0;
                let finalConsumido = 0;
                let finalDiferencia = 0;
                const finalDetalles = [];

                // Determinar si hay consumo de material ignorado/excluido
                let tieneConsumoIgnorado = false;

                group.items.forEach(item => {
                    let ignorarCalculo = false;

                    // REGLA MATEMÁTICA: Si es un escenario MIXTO, los artículos excluidos se ignoran en la suma.
                    if (!onlyExcluded && item.Excluido) {
                        ignorarCalculo = true;
                    }

                    if (item.Excluido && item.Consumido > 0) {
                        tieneConsumoIgnorado = true;
                    }

                    if (!ignorarCalculo) {
                        finalEntregado += item.Entregado;
                        finalConsumido += item.Consumido;
                        finalDiferencia += item.Diferencia;
                    }

                    finalDetalles.push({ ...item, Ignorado: ignorarCalculo });
                });

                // REGLA DE FALLBACK: En escenario MIXTO, si los artículos activos tienen
                // entrega=0 Y consumo=0 (no aportan datos reales), recalcular incluyendo
                // los artículos excluidos para obtener un estado de liquidación verídico.
                const hayItemsIgnorados = finalDetalles.some(i => i.Ignorado);
                const activosEnCero = (finalEntregado === 0 && finalConsumido === 0);
                let fallbackExcluidos = false;

                if (!onlyExcluded && activosEnCero && hayItemsIgnorados) {
                    // Recalcular sumando TODOS los ítems (activos + excluidos)
                    finalEntregado = 0; finalConsumido = 0; finalDiferencia = 0;
                    group.items.forEach(item => {
                        finalEntregado += item.Entregado;
                        finalConsumido += item.Consumido;
                        finalDiferencia += item.Diferencia;
                    });
                    // Re-marcar todos los detalles: los antes-ignorados ya no se ignoran
                    finalDetalles.forEach(d => { if (d.Ignorado) { d.Ignorado = false; d.FallbackRescatado = true; } });
                    fallbackExcluidos = true;
                }

                grouped[gK] = {
                    Contratista: group.Contratista,
                    Obra: group.Obra,
                    LocalizadorCod: group.LocalizadorCod,
                    Entregado: finalEntregado,
                    Consumido: finalConsumido,
                    Diferencia: finalDiferencia,
                    Detalles: finalDetalles,
                    onlyExcluded: onlyExcluded,
                    fallbackExcluidos: fallbackExcluidos,
                    tieneConsumoIgnorado: tieneConsumoIgnorado,
                    tieneSoredConsumido: !!group.tieneSoredConsumido
                };
            }

            s1_processedData = Object.values(grouped).map(item => {
                item.Entregado = Math.round(item.Entregado * 100) / 100;
                item.Consumido = Math.round(item.Consumido * 100) / 100;
                item.Diferencia = Math.round(item.Diferencia * 100) / 100;

                let p = 0;
                if (item.Entregado > 0) {
                    p = item.Consumido / item.Entregado;
                } else if (item.Consumido > 0) {
                    // Sin entrega registrada pero con consumo: se considera 100% consumido
                    p = 1;
                }

                item.OriginalPorcentajeReal = p;
                item.PorcentajeReal = p;
                item['% Consumo'] = (p * 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';

                return item;
            });

            s1_populateContratistasDropdown(Array.from(contratistasSet).sort());

            s1_invalidData = Object.values(invalidGroupedRaw);
            setTabBadge('s1_invalidCountBadge', s1_invalidData.length);
            s1_renderInvalidTable();

            // Render Obras Reasignadas
            setTabBadge('s1_reasignadasCountBadge', s1_obrasReasignadasData.length);
            s1_renderReasignadasTable();

            // Obras Excluidas por Tarea: filtrar las que ya están en alguna otra pestaña
            const obrasEnOtrasPestanas = new Set();
            s1_invalidData.forEach(d => obrasEnOtrasPestanas.add(`${d.Contratista}|${d.Obra}`));
            s1_obrasReasignadasData.forEach(d => obrasEnOtrasPestanas.add(`${d.Contratista}|${d.Obra}`));
            s1_processedData.forEach(d => obrasEnOtrasPestanas.add(`${d.Contratista}|${d.Obra}`));
            s1_excluidasPorTareaData = Object.values(excluidasPorTareaRaw).filter(d => {
                const key = `${d.Contratista}|${d.Obra}`;
                return !obrasEnOtrasPestanas.has(key);
            });
            // Redondear valores
            s1_excluidasPorTareaData.forEach(d => {
                d.Entregado = Math.round(d.Entregado * 100) / 100;
                d.Consumido = Math.round(d.Consumido * 100) / 100;
                d.Diferencia = Math.round(d.Diferencia * 100) / 100;
                const p = d.Entregado > 0 ? d.Consumido / d.Entregado : (d.Consumido > 0 ? 1 : 0);
                d.PorcentajeReal = p;
                d['% Consumo'] = (p * 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
            });
            setTabBadge('s1_excluidasCountBadge', s1_excluidasPorTareaData.length);

            // RESCATE AUTOMÁTICO: si una obra excluida por tarea tiene MOTIVO_TAREA = ORED en el PMOVXF,
            // se promueve al Dashboard Principal (con badge de trazabilidad), en vez de quedar oculta.
            //
            // IMPORTANTE: el objeto de "excluida" (Contratista, Obra, Tarea, LocalizadorCod, Entregado,
            // Consumido, Diferencia, Detalles) NO tiene la misma forma que un item normal de
            // s1_processedData. Si se empuja tal cual, s1_recalculateStates() —que corre a continuación,
            // y de nuevo cada vez que cambia el umbral de verificación— lee item.OriginalPorcentajeReal
            // para calcular '% Consumo', y al no existir muestra "NaN%" en el Dashboard. Por eso se
            // completan acá los campos faltantes antes de promoverlo.
            if (s1_dataMateriales && s1_dataMateriales.length > 0) {
                const cleanStr = s => String(s || '').trim().toUpperCase().replace(/[\s\-_]/g, '');
                const rescued = [];
                const stillExcluded = [];

                s1_excluidasPorTareaData.forEach(excl => {
                    const obraKey = cleanStr(excl.Obra);
                    const tieneOred = s1_dataMateriales.some(row => {
                        const motivoTarea = String(row['_N_MOTIVO_TAREA'] || row['MOTIVO_TAREA'] || '').trim().toUpperCase();
                        const motivo = cleanStr(row['_N_MOTIVO'] || row['MOTIVO'] || '');
                        return motivoTarea === 'ORED' && (motivo === obraKey || motivo.includes(obraKey) || obraKey.includes(motivo));
                    });

                    if (tieneOred) {
                        // Completar los campos que le faltan para comportarse como un item normal del Dashboard
                        excl.OriginalPorcentajeReal = excl.Entregado > 0 ? (excl.Consumido / excl.Entregado) : (excl.Consumido > 0 ? 1 : 0);
                        excl.PorcentajeReal = excl.OriginalPorcentajeReal;
                        excl.tieneSoredConsumido = false;
                        excl.tieneConsumoIgnorado = false;
                        excl.onlyExcluded = false;
                        excl.fallbackExcluidos = false;
                        excl._rescatadaOred = true; // Flag de trazabilidad para el badge
                        s1_processedData.push(excl);
                        rescued.push(excl.Obra);
                    } else {
                        stillExcluded.push(excl);
                    }
                });

                s1_excluidasPorTareaData = stillExcluded;
                setTabBadge('s1_excluidasCountBadge', s1_excluidasPorTareaData.length);
                if (rescued.length > 0) {
                    showToastGlobal(`${rescued.length} obra(s) rescatadas automáticamente por TAREA ORED en PMOVXF.`, 'success');
                }
            }

            // Guardar el índice del Bloque Secundario (otras razones sociales) para la búsqueda transversal.
            // La tabla "Consumo en Otra EC" se termina de calcular en s1_recalculateStates(), una vez
            // que cada obra del Bloque Principal ya tiene su naturalState ("Sin Consumo", etc.) asignado.
            s1_secundarioIndex = secundarioIndexLocal;

            document.getElementById('s1_filtersPanel').classList.remove('opacity-50', 'pointer-events-none');
            document.getElementById('s1_loader').classList.add('hidden');
            document.getElementById('s1_resultsWorkspace').classList.remove('hidden');
            document.getElementById('s1_resultsWorkspace').classList.add('flex');
            s1_recalculateStates();
        }

        // =====================================================================
        // FUNCIONES: OBRAS EXCLUIDAS POR TAREA
        // =====================================================================

        function s1_renderExcluidasPorTareaTable() {
            const tbody = document.getElementById('s1_excluidasTableBody');
            const emptyEl = document.getElementById('s1_excluidasEmpty');
            const resumenEl = document.getElementById('s1_excluidasResumen');
            const bannerEl = document.getElementById('s1_excluidasBannerAutorizadas');
            const bannerTextEl = document.getElementById('s1_excluidasBannerText');
            if (!tbody) return;

            const query = (document.getElementById('s1_searchExcluidas')?.value || '').toLowerCase().trim();
            const autorizadasCount = s1_excluidasAutorizadas.size;

            // Banner de autorizadas
            if (autorizadasCount > 0) {
                bannerEl?.classList.remove('hidden');
                if (bannerTextEl) bannerTextEl.textContent = `${autorizadasCount} obra(s) autorizada(s) — se incluyeron en el Dashboard Principal.`;
            } else {
                bannerEl?.classList.add('hidden');
            }

            const filtered = s1_excluidasPorTareaData.filter(item => {
                if (!query) return true;
                return item.Obra.toLowerCase().includes(query) || item.Contratista.toLowerCase().includes(query);
            });

            if (resumenEl) resumenEl.textContent = `${s1_excluidasPorTareaData.length} obra${s1_excluidasPorTareaData.length !== 1 ? 's' : ''} excluida${s1_excluidasPorTareaData.length !== 1 ? 's' : ''}`;

            tbody.innerHTML = '';
            if (filtered.length === 0) {
                emptyEl?.classList.remove('hidden');
                return;
            }
            emptyEl?.classList.add('hidden');

            // Estados badge colors (igual que Dashboard)
            const s1_excluidaStateColors = {
                'Consumido': { badge: 'bg-emerald-100 text-emerald-800 border border-emerald-200' },
                'Sin Consumo': { badge: 'bg-slate-100 text-slate-700 border border-slate-300' },
                'Verificar Consumo': { badge: 'bg-amber-100 text-amber-800 border border-amber-200' },
                'DEFAULT': { badge: 'bg-purple-100 text-purple-800 border border-purple-200' }
            };

            filtered.forEach(item => {
                const key = `${item.Contratista}|${item.Obra}`;
                const autorizado = s1_excluidasAutorizadas.has(key);
                const pct = item.PorcentajeReal || 0;
                const estado = pct >= 0.99 ? 'Consumido' : (pct <= 0 ? 'Sin Consumo' : 'Verificar Consumo');
                const colors = s1_excluidaStateColors[estado] || s1_excluidaStateColors['DEFAULT'];

                const pctFmt = item['% Consumo'] || '0,00%';
                const pctBar = Math.min(Math.round(pct * 100), 100);
                const pctColor = pct >= 0.99 ? 'bg-emerald-500' : (pct >= 0.5 ? 'bg-amber-400' : 'bg-rose-400');

                const tr = document.createElement('tr');
                tr.className = `border-b border-slate-100 hover:bg-amber-50 transition-colors ${autorizado ? 'bg-emerald-50' : ''}`;
                tr.innerHTML = `
                    <td class="p-3 text-sm text-slate-700">${item.Contratista}</td>
                    <td class="p-3 text-sm font-bold text-amber-800">${item.Obra}</td>
                    <td class="p-3 text-sm">
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                            <i class="fa-solid fa-ban text-[10px]"></i> ${item.Tarea}
                        </span>
                    </td>
                    <td class="p-3 text-sm text-slate-700 text-right">${s1_formatLocalNumber(item.Entregado)}</td>
                    <td class="p-3 text-sm text-slate-700 text-right">${s1_formatLocalNumber(item.Consumido)}</td>
                    <td class="p-3 text-sm text-slate-700 text-right ${item.Diferencia < 0 ? 'text-emerald-700 font-semibold' : ''}">${s1_formatLocalNumber(item.Diferencia)}</td>
                    <td class="p-3 text-center">
                        <div class="flex flex-col items-center gap-0.5">
                            <span class="text-xs font-bold text-slate-700">${pctFmt}</span>
                            <div class="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                <div class="h-full ${pctColor} rounded-full" style="width:${pctBar}%"></div>
                            </div>
                        </div>
                    </td>
                    <td class="p-3">
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${colors.badge}">${estado}</span>
                    </td>
                    <td class="p-3 text-center">
                        <button onclick="s1_showUnifiedDetails('${key.replace(/'/g, "\\'")}')" class="text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors font-semibold text-xs inline-flex items-center gap-1 shadow-sm" title="Analizar integralmente la obra (BCMO + PMOVXF)">
                            <i class="fa-solid fa-microscope"></i> Analizar Obra
                        </button>
                    </td>
                    <td class="p-3 text-center">
                        <label class="relative inline-flex items-center cursor-pointer" title="${autorizado ? 'Quitar del Dashboard Principal' : 'Incluir en Dashboard Principal'}">
                            <input type="checkbox" class="sr-only peer" ${autorizado ? 'checked' : ''}
                                onchange="s1_toggleAutorizarExcluida('${key.replace(/'/g, "\\'")}')"
                                id="chk_excl_${CSS.escape(key)}">
                            <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                        </label>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        function s1_toggleAutorizarExcluida(key) {
            if (s1_excluidasAutorizadas.has(key)) {
                // Desautorizar: quitar del Dashboard
                s1_excluidasAutorizadas.delete(key);
                s1_processedData = s1_processedData.filter(d => `${d.Contratista}|${d.Obra}` !== key);
                showToastGlobal('Obra removida del Dashboard Principal.', 'info');
            } else {
                // Autorizar: buscar el item en excluidas y promoverlo al Dashboard
                const excItem = s1_excluidasPorTareaData.find(d => `${d.Contratista}|${d.Obra}` === key);
                if (!excItem) return;
                s1_excluidasAutorizadas.add(key);
                // Crear entrada compatible con s1_processedData
                const p = excItem.Entregado > 0 ? excItem.Consumido / excItem.Entregado : (excItem.Consumido > 0 ? 1 : 0);
                const umb = parseFloat(document.getElementById('s1_umbralVerificacion')?.value || '50') / 100;
                let ns = 'Sin Consumo';
                if (excItem.Consumido <= 0.01) ns = 'Sin Consumo';
                else if (p >= umb) ns = 'Consumido';
                else ns = 'Verificar Consumo';
                s1_processedData.push({
                    Contratista: excItem.Contratista,
                    Obra: excItem.Obra,
                    LocalizadorCod: '',
                    Entregado: excItem.Entregado,
                    Consumido: excItem.Consumido,
                    Diferencia: excItem.Diferencia,
                    Detalles: excItem.Detalles,
                    PorcentajeReal: p,
                    OriginalPorcentajeReal: p,
                    '% Consumo': excItem['% Consumo'],
                    naturalState: ns,
                    'Estado de liquidacion': ns,
                    onlyExcluded: false,
                    fallbackExcluidos: false,
                    tieneConsumoIgnorado: false,
                    tieneSoredConsumido: false,
                    _autorizadaDesdeExcluidas: true
                });
                showToastGlobal(`Obra "${excItem.Obra}" incluida en el Dashboard Principal.`, 'success');
            }
            s1_renderTable();
            s1_renderVerificationTable();
            s1_renderExcluidasPorTareaTable();
        }

        function s1_showExcluidaDetails(key) {
            const item = s1_excluidasPorTareaData.find(d => `${d.Contratista}|${d.Obra}` === key);
            if (!item) return;
            const modal = document.getElementById('s1_detailsModal');
            const title = document.getElementById('s1_modalTitle');
            const subtitle = document.getElementById('s1_modalSubtitle');
            const tbody = document.getElementById('s1_modalTableBody');
            if (!modal || !tbody) return;
            title.textContent = `Detalle: ${item.Obra}`;
            subtitle.textContent = `Contratista: ${item.Contratista} | Tarea excluida: ${item.Tarea}`;
            tbody.innerHTML = (item.Detalles || []).map(d => `
                <tr class="border-b border-slate-100 hover:bg-amber-50">
                    <td class="p-2 px-4 text-xs">${d['Ítem'] || ''}</td>
                    <td class="p-2 px-4 text-xs">${d['Descripción'] || ''}</td>
                    <td class="p-2 px-4 text-xs">${d['UM'] || ''}</td>
                    <td class="p-2 px-4 text-xs">
                        <span class="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-[10px] font-bold border border-amber-200">${d['Tarea'] || ''}</span>
                    </td>
                    <td class="p-2 px-4 text-xs text-right">${s1_formatLocalNumber(d['Entregado'] || 0)}</td>
                    <td class="p-2 px-4 text-xs text-right">${s1_formatLocalNumber(d['Consumido'] || 0)}</td>
                    <td class="p-2 px-4 text-xs text-right">${s1_formatLocalNumber(d['Diferencia'] || 0)}</td>
                </tr>
            `).join('');
            // Agregar encabezado dinámico al modal
            const existingThead = modal.querySelector('table thead');
            if (existingThead) {
                existingThead.innerHTML = `<tr>
                    <th class="p-2 px-4 text-xs font-semibold border-b">Ítem</th>
                    <th class="p-2 px-4 text-xs font-semibold border-b">Descripción</th>
                    <th class="p-2 px-4 text-xs font-semibold border-b">UM</th>
                    <th class="p-2 px-4 text-xs font-semibold border-b">Tarea</th>
                    <th class="p-2 px-4 text-xs font-semibold border-b text-right">Entregado</th>
                    <th class="p-2 px-4 text-xs font-semibold border-b text-right">Consumido</th>
                    <th class="p-2 px-4 text-xs font-semibold border-b text-right">Diferencia</th>
                </tr>`;
            }
            modal.classList.remove('hidden');
        }

        function s1_closeUnifiedModal() {
            document.getElementById('s1_unifiedDetailsModal')?.classList.add('hidden');
        }

        function s1_switchUniTab(tab) {
            const btnBcmo = document.getElementById('s1_uniTabBtn_bcmo');
            const btnPm = document.getElementById('s1_uniTabBtn_pm');
            const contBcmo = document.getElementById('s1_uniContent_bcmo');
            const contPm = document.getElementById('s1_uniContent_pm');

            if (!btnBcmo || !btnPm || !contBcmo || !contPm) return;

            // Resetear estilos
            btnBcmo.className = "px-4 py-2 text-sm font-bold rounded-t-lg transition-colors text-slate-500 hover:text-blue-700 hover:bg-blue-50";
            btnPm.className = "px-4 py-2 text-sm font-bold rounded-t-lg transition-colors text-slate-500 hover:text-teal-700 hover:bg-teal-50";
            contBcmo.classList.add('hidden');
            contPm.classList.add('hidden');

            if (tab === 'bcmo') {
                btnBcmo.className = "px-4 py-2 text-sm font-bold rounded-t-lg transition-colors bg-white text-blue-700 border border-b-0 border-slate-200";
                contBcmo.classList.remove('hidden');
            } else if (tab === 'pm') {
                btnPm.className = "px-4 py-2 text-sm font-bold rounded-t-lg transition-colors bg-white text-teal-700 border border-b-0 border-slate-200";
                contPm.classList.remove('hidden');
            }
        }

        let s1_uniModalIsMaximized = false;
        function s1_toggleMaximizeUnifiedModal() {
            const win = document.getElementById('s1_uniModalWindow');
            const icon = document.getElementById('s1_uniModalMaxIcon');
            if (!win || !icon) return;

            if (s1_uniModalIsMaximized) {
                // Restaurar
                win.classList.remove('w-screen', 'h-screen', 'max-w-none', 'max-h-none', 'rounded-none');
                win.classList.add('max-w-6xl', 'max-h-[90vh]', 'rounded-xl');
                win.style.height = '80vh';
                win.style.transform = 'translate(0px, 0px)';
                icon.className = 'fa-solid fa-expand';
                s1_uniModalIsMaximized = false;
            } else {
                // Maximizar
                win.classList.remove('max-w-6xl', 'max-h-[90vh]', 'rounded-xl');
                win.classList.add('w-screen', 'h-screen', 'max-w-none', 'max-h-none', 'rounded-none');
                win.style.height = '100vh';
                win.style.transform = 'translate(0px, 0px)';
                icon.className = 'fa-solid fa-compress';
                s1_uniModalIsMaximized = true;
            }
        }

        function s1_initUnifiedModalDrag() {
            const header = document.getElementById('s1_uniModalHeader');
            const win = document.getElementById('s1_uniModalWindow');
            if (!header || !win) return;

            let isDragging = false;
            let currentX;
            let currentY;
            let initialX;
            let initialY;
            let xOffset = 0;
            let yOffset = 0;

            // Limpiar eventos previos si los hay
            const newHeader = header.cloneNode(true);
            header.parentNode.replaceChild(newHeader, header);

            newHeader.addEventListener('mousedown', dragStart);
            document.addEventListener('mousemove', drag);
            document.addEventListener('mouseup', dragEnd);

            function dragStart(e) {
                if (s1_uniModalIsMaximized) return; // No arrastrar si está maximizado
                // No arrastrar si se hace clic en botones
                if (e.target.closest('button')) return;

                initialX = e.clientX - xOffset;
                initialY = e.clientY - yOffset;
                isDragging = true;
            }

            function drag(e) {
                if (!isDragging) return;
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
                xOffset = currentX;
                yOffset = currentY;
                setTranslate(currentX, currentY, win);
            }

            function dragEnd(e) {
                isDragging = false;
            }

            function setTranslate(xPos, yPos, el) {
                el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
            }

            // Guardar para resetear
            win.dataset.xOffset = 0;
            win.dataset.yOffset = 0;
        }

        function s1_showUnifiedDetails(key) {
            const item = s1_excluidasPorTareaData.find(d => `${d.Contratista}|${d.Obra}` === key);
            if (!item) return;

            const modal = document.getElementById('s1_unifiedDetailsModal');
            if (!modal) return;

            const win = document.getElementById('s1_uniModalWindow');
            if (win) {
                win.style.transform = 'translate3d(0px, 0px, 0)';
                if (s1_uniModalIsMaximized) s1_toggleMaximizeUnifiedModal();
            }
            s1_initUnifiedModalDrag();

            const obra = item.Obra;
            const contratista = item.Contratista;

            document.getElementById('s1_uniModalTitle').textContent = `Análisis Integral: ${obra}`;
            document.getElementById('s1_uniModalSubtitle').textContent = `Contratista: ${contratista} | Tarea Excluida Principal: ${item.Tarea}`;

            // --- Llenar Tab BCMO ---
            const tbodyBcmo = document.getElementById('s1_uniModalTableBody_bcmo');
            tbodyBcmo.innerHTML = (item.Detalles || []).map(d => `
                <tr class="border-b border-slate-100 hover:bg-blue-50 transition-colors">
                    <td class="p-2 px-4 text-xs font-mono font-semibold text-slate-700">${d['Ítem'] || ''}</td>
                    <td class="p-2 px-4 text-xs text-slate-600">${d['Descripción'] || ''}</td>
                    <td class="p-2 px-4 text-xs text-slate-500">${d['UM'] || ''}</td>
                    <td class="p-2 px-4 text-xs">
                        <span class="bg-amber-200 text-amber-900 px-2 py-1 rounded-md text-xs font-bold border border-amber-400 shadow-sm inline-block uppercase tracking-wide">${d['Tarea'] || ''}</span>
                    </td>
                    <td class="p-2 px-4 text-xs text-right text-slate-600">${s1_formatLocalNumber(d['Entregado'] || 0)}</td>
                    <td class="p-2 px-4 text-xs text-right text-slate-600">${s1_formatLocalNumber(d['Consumido'] || 0)}</td>
                    <td class="p-2 px-4 text-xs text-right text-slate-700 font-semibold ${d['Diferencia'] < 0 ? 'text-emerald-600' : ''}">${s1_formatLocalNumber(d['Diferencia'] || 0)}</td>
                </tr>
            `).join('');

            // --- Llenar Tab PM ---
            const matchObra = (motivoRaw, obraRaw) => {
                const cleanStr = (s) => String(s || '').trim().toUpperCase().replace(/[\s-_]/g, '');
                const m = cleanStr(motivoRaw);
                const o = cleanStr(obraRaw);
                if (!m || !o) return false;
                return m === o || m.includes(o) || o.includes(m);
            };

            let movimientosPM = [];
            if (s1_dataMateriales && s1_dataMateriales.length > 0) {
                movimientosPM = s1_dataMateriales.filter(row => {
                    const motivo = String(row['_N_MOTIVO'] || row['MOTIVO'] || row['Motivo'] || '');
                    return matchObra(motivo, obra);
                });
            }

            const badgePm = document.getElementById('s1_uniBadge_pm');
            if (badgePm) {
                badgePm.textContent = movimientosPM.length;
                badgePm.className = movimientosPM.length > 0 ? "ml-1 px-1.5 py-0.5 bg-teal-100 text-teal-800 rounded-full text-[10px] font-bold" : "ml-1 px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded-full text-[10px]";
            }

            const tbodyPm = document.getElementById('s1_uniModalTableBody_pm');
            const emptyPm = document.getElementById('s1_uniEmpty_pm');
            const tablePm = document.getElementById('s1_uniTable_pm');

            if (movimientosPM.length === 0) {
                emptyPm.classList.remove('hidden');
                tablePm.classList.add('hidden');
            } else {
                emptyPm.classList.add('hidden');
                tablePm.classList.remove('hidden');

                tbodyPm.innerHTML = movimientosPM.map(row => {
                    const numero = row['_N_NUMERO'] || row['NUMERO'] || row['Numero'] || row['Número'] || '-';
                    const articulo = row['_N_ARTICULO'] || row['ARTICULO'] || row['Articulo'] || row['Artículo'] || '-';
                    const subinv = row['_N_SUBINV_DESTINO'] || row['SUBINV_DESTINO'] || row['Subinv_Destino'] || '-';
                    const loc = row['_N_LOCALIZADOR_DESTINO'] || row['LOCALIZADOR_DESTINO'] || row['Localizador_Destino'] || '-';
                    const ctdPend = row['_N_CTD_PENDIENTE'] || row['CTD_PENDIENTE'] || row['Ctd_Pendiente'] || '0';
                    const cantSol = row['_N_CANTIDAD_SOLICITADA'] || row['CANTIDAD_SOLICITADA'] || row['Cantidad_Solicitada'] || '0';
                    const cantEnt = row['_N_CANTIDAD_ENTREGADA'] || row['CANTIDAD_ENTREGADA'] || row['Cantidad_Entregada'] || row['_N_CANTIDAD'] || row['CANTIDAD'] || '0';
                    const motivo = row['_N_MOTIVO'] || row['MOTIVO'] || row['Motivo'] || '-';
                    const estadoLinea = row['_N_ESTADO_DE_LINEA'] || row['ESTADO_DE_LINEA'] || row['Estado_De_Linea'] || '-';
                    const fechaEnt = row['_N_FECHA_TRX'] || row['FECHA_TRX'] || row['Fecha_Trx'] || row['FECHA_ENTREGA'] || row['Fecha Entrega'] || '-';
                    const motivoTarea = row['_N_MOTIVO_TAREA'] || row['MOTIVO_TAREA'] || row['Motivo_Tarea'] || '-';

                    let fechaStr = '-';
                    if (fechaEnt instanceof Date) {
                        fechaStr = fechaEnt.toLocaleDateString('es-AR');
                    } else if (fechaEnt) {
                        fechaStr = String(fechaEnt);
                    }

                    const cantSolNum = parseFloat(String(cantSol).replace(',', '.')) || 0;
                    const cantEntNum = parseFloat(String(cantEnt).replace(',', '.')) || 0;
                    const ctdPendNum = parseFloat(String(ctdPend).replace(',', '.')) || 0;

                    const transaccion = `${numero} <span class="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200 ml-1 shadow-sm whitespace-nowrap">${estadoLinea}</span>`;
                    const ubicacion = `<span class="text-slate-500">${subinv}</span> <i class="fa-solid fa-angle-right mx-1 text-slate-300 text-[10px]"></i> <span class="text-slate-700 font-medium">${loc}</span>`;

                    const p = s1_formatLocalNumber(ctdPendNum);
                    const s = s1_formatLocalNumber(cantSolNum);
                    const e = s1_formatLocalNumber(cantEntNum);
                    const cantidades = `<div class="flex flex-col gap-0.5 text-[10px]"><span class="text-slate-500">Sol: <b class="text-slate-700 text-xs">${s}</b></span><span class="text-slate-500">Ent: <b class="text-teal-700 text-xs">${e}</b></span><span class="text-slate-400">Pend: ${p}</span></div>`;

                    const tareaBadge = `<span class="bg-teal-200 text-teal-900 px-2 py-1 rounded-md text-xs font-bold border border-teal-400 shadow-sm inline-block uppercase tracking-wide">${motivoTarea}</span>`;

                    return `
                        <tr class="hover:bg-teal-50 transition-colors border-b border-slate-100">
                            <td class="p-2 px-4 text-xs font-medium text-slate-700">${transaccion}</td>
                            <td class="p-2 px-4 text-xs font-mono font-semibold text-slate-700">${articulo}</td>
                            <td class="p-2 px-4 text-xs">${ubicacion}</td>
                            <td class="p-2 px-4 text-xs">${cantidades}</td>
                            <td class="p-2 px-4 text-xs text-slate-700 font-medium">${motivo}</td>
                            <td class="p-2 px-4 text-xs text-slate-500">${fechaStr}</td>
                            <td class="p-2 px-4">${tareaBadge}</td>
                        </tr>
                    `;
                }).join('');
            }

            s1_switchUniTab('bcmo');
            modal.classList.remove('hidden');
        }

        function s1_renderInvalidTable() {
            const tbody = document.getElementById('s1_invalidTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';
            s1_invalidData.forEach(item => {
                const tr = document.createElement('tr');
                tr.className = "border-b border-slate-100 hover:bg-slate-50";
                tr.innerHTML = `
                    <td class="p-3 text-sm text-slate-700">${item.Contratista}</td>
                    <td class="p-3 text-sm font-bold text-rose-700">${item.Obra}</td>
                    <td class="p-3 text-sm text-slate-700 text-right">${s1_formatLocalNumber(item.Entregado)}</td>
                    <td class="p-3 text-sm text-slate-700 text-right">${s1_formatLocalNumber(item.Consumido)}</td>
                    <td class="p-3 text-sm text-center">
                        <button onclick="s1_showInvalidDetails('${item.Contratista}|${item.Obra}')" class="text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 p-2 rounded-lg" title="Ver detalle de materiales excluidos">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        function s1_populateContratistasDropdown(contratistas) {
            const s = document.getElementById('s1_filterContratista'); s.innerHTML = '<option value="ALL">Todos los contratistas</option>';
            contratistas.forEach(c => s.appendChild(new Option(c, c)));
        }

        function s1_recalculateStates() {
            let umb = parseFloat(document.getElementById('s1_umbralVerificacion').value); if (isNaN(umb)) umb = 50;
            let umbDec = umb / 100;
            s1_processedData.forEach(item => {
                let ns = "";
                if (item.tieneSoredConsumido) {
                    ns = "Consumido";
                } else if (item.tieneConsumoIgnorado) {
                    ns = "Consumido";
                } else if (item.Diferencia <= 0.01 && item.Consumido > 0) {
                    ns = "Consumido";
                } else if (item.Consumido <= 0.01) {
                    ns = "Sin Consumo";
                } else if (item.OriginalPorcentajeReal >= umbDec) {
                    ns = "Consumido";
                } else {
                    ns = "Verificar Consumo";
                }
                item.naturalState = ns;
                const gK = `${item.Contratista}|${item.Obra}`;
                item['Estado de liquidacion'] = s1_manualOverrides[gK] || ns;
                if (item.Entregado < 0 && (item['Estado de liquidacion'] === 'Consumido' || item['Estado de liquidacion'] === 'Consumo Total')) {
                    item.PorcentajeReal = 1.0; item['% Consumo'] = "100,00%";
                } else {
                    item.PorcentajeReal = item.OriginalPorcentajeReal;
                    item['% Consumo'] = (item.OriginalPorcentajeReal * 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
                }
            });
            s1_renderTable(); s1_renderVerificationTable();
            s1_buildOtraECData();
        }

        // Búsqueda transversal: para cada obra del Bloque Principal con estado "Sin Consumo",
        // busca en el índice del Bloque Secundario (otras razones sociales) si esa misma obra
        // registra consumo real en otra empresa. Los materiales se agrupan por Contratista+LocalizadorCod.


        //	function s1_buildOtraECData() {
        //            const gruposMap = {};
        //            s1_processedData.forEach(item => {
        //                if (item.naturalState !== 'Sin Consumo') return;
        //                const matches = s1_secundarioIndex[String(item.Obra || '').toUpperCase()];
        //                if (!matches || matches.length === 0) return;

        function s1_buildOtraECData() {
            const gruposMap = {};
            s1_processedData.forEach(item => {
                // 1. Limpiamos la bandera por si los datos se recalcularon
                item._enOtraEC = false;

                if (item.naturalState !== 'Sin Consumo') return;
                const matches = s1_secundarioIndex[String(item.Obra || '').toUpperCase()];
                if (!matches || matches.length === 0) return;

                // 2. Marcamos la obra original para excluirla del Dashboard Principal
                item._enOtraEC = true;

                matches.forEach(m => {
                    const gK = `${m.Contratista}|${m.LocalizadorCod}`;
                    if (!gruposMap[gK]) {
                        gruposMap[gK] = {
                            Obra: item.Obra,
                            EmpresaOriginal: item.Contratista,
                            RazonSocialOtraEC: m.Contratista,
                            LocalizadorCod: m.LocalizadorCod,
                            Detalles: []
                        };
                    }
                    gruposMap[gK].Detalles.push({
                        Articulo: m.Item,
                        DescripcionArticulo: m.Descripcion,
                        UM: m.UM,
                        CantidadEntrega: m.Entregado,
                        CantidadConsumida: m.Consumido,
                        Diferencia: m.Diferencia
                    });
                });
            });
            s1_otraECData = Object.values(gruposMap);
            setTabBadge('s1_otraECCountBadge', s1_otraECData.length);
            s1_renderOtraECTable();
        }

        function s1_renderOtraECTable() {
            const tbody = document.getElementById('s1_otraECTableBody');
            const empty = document.getElementById('s1_otraECEmpty');
            if (!tbody) return;
            tbody.innerHTML = '';
            if (s1_otraECData.length === 0) {
                if (empty) empty.classList.remove('hidden');
                return;
            }
            if (empty) empty.classList.add('hidden');
            s1_otraECData.forEach((grupo, index) => {
                const tr = document.createElement('tr');
                tr.className = "border-b border-slate-100 hover:bg-purple-50";
                tr.innerHTML = `
                    <td class="p-3 text-sm font-bold text-purple-700">${grupo.Obra}</td>
                    <td class="p-3 text-sm text-slate-700">${grupo.EmpresaOriginal}</td>
                    <td class="p-3 text-sm text-slate-700"><span class="bg-purple-100 text-purple-800 text-xs font-semibold px-2 py-0.5 rounded">${grupo.RazonSocialOtraEC}</span></td>
                    <td class="p-3 text-sm font-mono text-slate-600">${grupo.LocalizadorCod}</td>
                    <td class="p-3 text-center">
                        <button onclick="s1_showOtraECDetails(${index})" class="bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 w-8 h-8 rounded-lg flex items-center justify-center transition-colors mx-auto" title="Ver detalle de materiales">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        function s1_showOtraECDetails(index) {
            const grupo = s1_otraECData[index];
            if (!grupo) return;

            document.getElementById('s1_modalTitle').textContent = `Detalles: ${grupo.Obra}`;
            document.getElementById('s1_modalSubtitle').textContent = `Empresa Original: ${grupo.EmpresaOriginal} | Consumido bajo: ${grupo.RazonSocialOtraEC}`;

            const tbody = document.getElementById('s1_modalTableBody'); tbody.innerHTML = '';
            grupo.Detalles.forEach(det => {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-slate-50 transition-colors";
                tr.innerHTML = `
                    <td class="p-2 px-4 text-xs text-slate-500 font-mono">${det.Articulo}</td>
                    <td class="p-2 px-4 text-xs text-slate-700 font-medium">${det.DescripcionArticulo}</td>
                    <td class="p-2 px-4 text-xs text-slate-500 text-center">${det.UM}</td>
                    <td class="p-2 px-4 text-xs text-slate-600 text-right">${s1_formatLocalNumber(det.CantidadEntrega)}</td>
                    <td class="p-2 px-4 text-xs text-slate-600 text-right">${s1_formatLocalNumber(det.CantidadConsumida)}</td>
                    <td class="p-2 px-4 text-xs font-semibold text-slate-600 text-right">${s1_formatLocalNumber(det.Diferencia)}</td>
                `;
                tbody.appendChild(tr);
            });
            document.getElementById('s1_detailsModal').classList.remove('hidden');
        }

        function s1_toggleMassivePanel() {
            const c = document.getElementById('s1_massivePanelContent'); const i = document.getElementById('s1_massivePanelIcon');
            if (c.classList.contains('hidden')) { c.classList.remove('hidden'); i.classList.add('rotate-180'); }
            else { c.classList.add('hidden'); i.classList.remove('rotate-180'); }
        }

        function s1_applyMassiveOverrides() {
            const tLines = document.getElementById('s1_massiveTotal').value.split('\n').map(l => l.trim().toUpperCase()).filter(l => l);
            const pLines = document.getElementById('s1_massiveParcial').value.split('\n').map(l => l.trim().toUpperCase()).filter(l => l);
            const scInput = document.getElementById('s1_massiveSinConsumo');
            const scLines = scInput ? scInput.value.split('\n').map(l => l.trim().toUpperCase()).filter(l => l) : [];

            if (tLines.length === 0 && pLines.length === 0 && scLines.length === 0) {
                showToastGlobal("No hay obras ingresadas.", "error");
                return;
            }

            // Doble validación para obras a marcar masivamente como Sin Consumo
            if (scLines.length > 0) {
                const confirmed = confirm(`⚠️ Doble Validación de Auditoría:\n\nSe marcarán ${scLines.length} obra(s) con estado "Sin Consumo".\n\n¿Confirma que desea imputar CERO consumo a estos legajos?`);
                if (!confirmed) {
                    showToastGlobal("Asignación masiva cancelada por el usuario.", "info");
                    return;
                }
            }

            let count = 0;
            s1_processedData.forEach(item => {
                const oU = item.Obra.toUpperCase(); const gK = `${item.Contratista}|${item.Obra}`;
                if (tLines.includes(oU)) { s1_manualOverrides[gK] = "Consumo Total"; count++; }
                else if (pLines.includes(oU)) { s1_manualOverrides[gK] = "Consumo Parcial"; count++; }
                else if (scLines.includes(oU)) { s1_manualOverrides[gK] = "Sin Consumo"; count++; }
            });
            showToastGlobal(`Asignadas ${count} obras correctamente.`, "success");
            s1_recalculateStates();
            document.getElementById('s1_massiveTotal').value = '';
            document.getElementById('s1_massiveParcial').value = '';
            if (scInput) scInput.value = '';
            s1_toggleMassivePanel();
        }

        function s1_handleManualDecision(selectElement) {
            const gK = selectElement.getAttribute('data-key');
            const d = selectElement.value;
            const prev = s1_manualOverrides[gK] || "";

            // Doble validación obligatoria al marcar una obra como "Sin Consumo"
            if (d === "Sin Consumo") {
                const obraNombre = gK.split('|')[1] || gK;
                const confirmed = confirm(`⚠️ Confirmación de Auditoría (Doble Validación):\n\n¿Está seguro de marcar la obra "${obraNombre}" como "Sin Consumo"?\n\nEsta decisión indicará que NO se auditarán consumos de materiales para este legajo.`);
                if (!confirmed) {
                    // Restaurar el valor previo en el selector
                    selectElement.value = prev;
                    return;
                }
            }

            if (d === "" || d === "Verificar Consumo") {
                delete s1_manualOverrides[gK];
            } else {
                s1_manualOverrides[gK] = d;
            }
            s1_recalculateStates();
            if (d === "Sin Consumo") {
                showToastGlobal(`Obra marcada como "Sin Consumo" exitosamente.`, "success");
            }
        }

        // NUEVA FUNCIÓN PARA SINCRONIZAR FILTRO DEL DASHBOARD
        function s1_syncFromDashboard() {
            const val = document.getElementById('s1_dashboardFilterEstado').value;
            document.getElementById('s1_filterEstado').value = val;
            s1_renderTable();
        }

        function s1_syncFromPanel() {
            const val = document.getElementById('s1_filterEstado').value;
            document.getElementById('s1_dashboardFilterEstado').value = val;
            s1_renderTable();
        }

        function s1_clearFilters() {
            document.getElementById('s1_filterContratista').value = 'ALL';
            document.getElementById('s1_filterEstado').value = 'ALL';
            document.getElementById('s1_dashboardFilterEstado').value = 'ALL';
            document.getElementById('s1_searchObraDashboard').value = '';
            s1_renderTable();
        }

        //        function s1_renderTable() {
        //            const fC = document.getElementById('s1_filterContratista').value;
        //            const fE = document.getElementById('s1_filterEstado').value;
        //            const fS = document.getElementById('s1_searchObraDashboard').value.trim().toLowerCase();

        //            s1_filteredData = s1_processedData.filter(i => {
        //                if (fC !== 'ALL' && i.Contratista !== fC) return false;
        //                if (fE !== 'ALL' && i['Estado de liquidacion'] !== fE) return false;
        //                if (fS !== '' && !i.Obra.toLowerCase().includes(fS)) return false;
        //                return true;
        //            });


        function s1_renderTable() {
            const fC = document.getElementById('s1_filterContratista').value;
            const fE = document.getElementById('s1_filterEstado').value;
            const fS = document.getElementById('s1_searchObraDashboard').value.trim().toLowerCase();

            s1_filteredData = s1_processedData.filter(i => {
                // 3. Si la obra fue absorbida por "Otra EC", la ocultamos de esta vista
                if (i._enOtraEC) return false;

                if (fC !== 'ALL' && i.Contratista !== fC) return false;
                if (fE !== 'ALL' && i['Estado de liquidacion'] !== fE) return false;
                if (fS !== '' && !i.Obra.toLowerCase().includes(fS)) return false;
                return true;
            });



            document.getElementById('s1_statsText').innerHTML = `Mostrando <b>${s1_filteredData.length}</b> obras.`;
            const sC = { 'Consumido': 0, 'Sin Consumo': 0, 'Verificar Consumo': 0, 'Consumo Total': 0, 'Consumo Parcial': 0 };
            s1_filteredData.forEach(i => { if (sC[i['Estado de liquidacion']] !== undefined) sC[i['Estado de liquidacion']]++; });

            document.getElementById('s1_dashboardStateSummary').innerHTML = `
                <span class="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200"><i class="fa-solid fa-check-circle mr-1"></i>Consumido: <b>${sC['Consumido'] + sC['Consumo Total']}</b></span>
                <span class="px-2 py-1 rounded-md bg-slate-100 text-slate-600 border border-slate-200"><i class="fa-solid fa-minus-circle mr-1"></i>Sin Consumo: <b>${sC['Sin Consumo']}</b></span>
                <span class="px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200"><i class="fa-solid fa-exclamation-triangle mr-1"></i>Verificar: <b>${sC['Verificar Consumo']}</b></span>
                <span class="px-2 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-200"><i class="fa-solid fa-clock-rotate-left mr-1"></i>Parcial: <b>${sC['Consumo Parcial']}</b></span>
            `;

            const tbody = document.getElementById('s1_tableBody'); tbody.innerHTML = '';
            s1_filteredData.forEach((item) => {
                const tr = document.createElement('tr'); tr.className = "hover:bg-slate-50";
                let bC = "bg-slate-100 text-slate-700", iC = "fa-circle-question", eS = item['Estado de liquidacion'];
                if (eS === 'Consumido' || eS === 'Consumo Total') { bC = "bg-emerald-100 text-emerald-800 border-emerald-200"; iC = "fa-check-circle"; }
                else if (eS === 'Verificar Consumo') { bC = "bg-amber-100 text-amber-800 border-amber-200"; iC = "fa-exclamation-triangle"; }
                else if (eS === 'Sin Consumo') { bC = "bg-slate-100 text-slate-600 border-slate-200"; iC = "fa-minus-circle"; }
                else if (eS === 'Consumo Parcial') { bC = "bg-blue-100 text-blue-800 border-blue-200"; iC = "fa-clock-rotate-left"; }
                const isMan = s1_manualOverrides[`${item.Contratista}|${item.Obra}`];
                const gK = `${item.Contratista}|${item.Obra}`;
                const auditInfo = s1_auditTrail[gK];

                let auditBadge = '';
                if (auditInfo) {
                    auditBadge = `<span class="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-emerald-50 text-emerald-700 rounded border border-emerald-200 font-semibold cursor-help" title="Modificado por: ${auditInfo.auditor} el ${auditInfo.fecha}"><i class="fa-solid fa-user-check text-[9px]"></i> ${auditInfo.auditor}</span>`;
                } else if (isMan) {
                    auditBadge = `<i class="fa-solid fa-brain text-[10px] ml-1 opacity-70" title="Decisión manual"></i>`;
                }

                // Botón interactivo para "Sin Consumo" o reversión
                let actionBtn = '';
                if (eS === 'Sin Consumo') {
                    actionBtn = `<button onclick="s1_pasarAConsumidoDesdeDashboard('${gK.replace(/'/g, "\\'")}')" class="text-emerald-600 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 p-2 rounded-lg transition-colors shadow-2xs" title="Pasar a Consumido (Doble Validación de Auditoría)"><i class="fa-solid fa-circle-check"></i></button>`;
                } else if (isMan && auditInfo) {
                    actionBtn = `<button onclick="s1_revertirConsumidoDesdeDashboard('${gK.replace(/'/g, "\\'")}')" class="text-amber-600 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 p-2 rounded-lg transition-colors shadow-2xs" title="Revertir a Sin Consumo (cambio registrado por ${auditInfo.auditor})"><i class="fa-solid fa-rotate-left"></i></button>`;
                }

                const exclAlert = item.onlyExcluded
                    ? `<i class="fa-solid fa-triangle-exclamation text-amber-500 ml-2" title="Alerta: La obra solo tiene entregas de artículos excluidos"></i>`
                    : '';
                // Badge de fallback: activos en cero, se usaron los excluidos para calcular
                const fallbackAlert = item.fallbackExcluidos
                    ? `<i class="fa-solid fa-recycle text-violet-500 ml-2" title="Fallback aplicado: artículos activos en cero, se recalculó con artículos excluidos"></i>`
                    : '';
                // Badge de trazabilidad: la obra fue rescatada automáticamente desde "Excluidas por Tarea"
                // por registrar MOTIVO_TAREA = ORED en el PMOVXF.
                const rescatadaBadge = item._rescatadaOred
                    ? `<span class="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800 border border-teal-300" title="Incluida automáticamente por registrar TAREA ORED en PMOVXF">
                           <i class="fa-solid fa-rotate-right"></i> ORED
                       </span>`
                    : '';

                tr.innerHTML = `
                    <td class="p-3 text-sm text-slate-700">${item.Contratista}</td><td class="p-3 text-sm font-medium text-blue-700 flex items-center">${item.Obra}${exclAlert}${fallbackAlert}${rescatadaBadge}</td>
                    <td class="p-3 text-sm text-slate-600 text-right">${s1_formatLocalNumber(item.Entregado)}</td><td class="p-3 text-sm text-slate-600 text-right">${s1_formatLocalNumber(item.Consumido)}</td><td class="p-3 text-sm text-slate-600 text-right font-medium">${s1_formatLocalNumber(item.Diferencia)}</td>
                    <td class="p-3 text-sm text-slate-600 text-center"><div class="w-full bg-slate-200 rounded-full h-2 mt-1 mb-1"><div class="bg-blue-600 h-2 rounded-full" style="width: ${Math.min(item.PorcentajeReal * 100, 100)}%"></div></div>${item['% Consumo']}</td>
                    <td class="p-3 text-sm"><span class="px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1 border ${bC}"><i class="fa-solid ${iC}"></i> ${eS} ${auditBadge}</span></td>
                    <td class="p-3 text-sm text-center">
                        <div class="flex items-center justify-center gap-1.5">
                            <button onclick="s1_showDetails('${gK.replace(/'/g, "\\'")}')" class="text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 p-2 rounded-lg" title="Ver detalle BCMO"><i class="fa-solid fa-eye"></i></button>
                            <button onclick="s1_showPMDetails('${item.Contratista.replace(/'/g, "\\'")}', '${item.Obra.replace(/'/g, "\\'")}')" class="text-teal-600 hover:text-teal-800 bg-teal-50 hover:bg-teal-100 p-2 rounded-lg" title="Ver detalle PMOVXF"><i class="fa-solid fa-eye"></i></button>
                            ${actionBtn}
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        function s1_pasarAConsumidoDesdeDashboard(gK) {
            const item = s1_processedData.find(i => `${i.Contratista}|${i.Obra}` === gK);
            if (!item) return;

            const obraNombre = item.Obra;
            const contratista = item.Contratista;
            const defaultAuditor = (document.getElementById('auditorName')?.value || '').trim();

            // PASO 1 DE DOBLE VALIDACIÓN: Identificación del Auditor Responsable
            let auditor = prompt(
                `⚠️ DOBLE VALIDACIÓN (Paso 1 de 2) - Auditor Responsable:\n\n` +
                `Obra: "${obraNombre}"\n` +
                `Contratista: ${contratista}\n` +
                `Estado actual: Sin Consumo\n\n` +
                `Por favor, ingrese o confirme su Nombre / Legajo de Auditor para autorizar esta decisión:`,
                defaultAuditor
            );

            if (auditor === null) {
                showToastGlobal("Operación cancelada.", "info");
                return;
            }
            auditor = auditor.trim();
            if (!auditor) {
                showToastGlobal("Operación cancelada: Se requiere indicar el auditor responsable.", "error");
                return;
            }

            // Sincronizar input general de la barra superior si estaba vacío
            const generalAuditorInput = document.getElementById('auditorName');
            if (generalAuditorInput && !generalAuditorInput.value.trim()) {
                generalAuditorInput.value = auditor;
            }

            // PASO 2 DE DOBLE VALIDACIÓN: Confirmación Final de Impacto
            const confirmado = confirm(
                `⚠️ DOBLE VALIDACIÓN (Paso 2 de 2) - Confirmación Definitiva:\n\n` +
                `Auditor Responsable: ${auditor}\n` +
                `Obra: "${obraNombre}"\n` +
                `Nuevo Estado: Consumo Total / Consumido\n\n` +
                `¿Confirma definitivamente registrar el paso de "Sin Consumo" a "Consumido"?\n` +
                `Esta acción quedará grabada con su firma y fecha en el historial de auditoría.`
            );

            if (!confirmado) {
                showToastGlobal("Operación cancelada por el usuario.", "info");
                return;
            }

            // Aplicar decisión manual y registrar en audit trail
            s1_manualOverrides[gK] = "Consumo Total";
            s1_auditTrail[gK] = {
                auditor: auditor,
                fecha: new Date().toLocaleString('es-AR'),
                accion: 'Pasar a Consumido',
                estadoAnterior: 'Sin Consumo',
                estadoNuevo: 'Consumo Total'
            };

            s1_recalculateStates();
            showToastGlobal(`Obra "${obraNombre}" pasada a Consumido por ${auditor}.`, "success");
        }

        function s1_revertirConsumidoDesdeDashboard(gK) {
            const item = s1_processedData.find(i => `${i.Contratista}|${i.Obra}` === gK);
            if (!item) return;

            const obraNombre = item.Obra;
            const auditInfo = s1_auditTrail[gK];
            const responsableStr = auditInfo ? ` (registrado por ${auditInfo.auditor})` : '';

            const conf = confirm(`¿Desea revertir la obra "${obraNombre}" a su estado original (Sin Consumo)?${responsableStr}`);
            if (!conf) return;

            delete s1_manualOverrides[gK];
            delete s1_auditTrail[gK];
            s1_recalculateStates();
            showToastGlobal(`Se restauró el estado original de la obra "${obraNombre}".`, "info");
        }

        function s1_renderVerificationTable() {
            const fS = document.getElementById('s1_searchObraVerif').value.trim().toLowerCase();
            const tbody = document.getElementById('s1_verificationTableBody'); tbody.innerHTML = '';

            let list = s1_processedData.filter(i => i.naturalState === 'Verificar Consumo');
            setTabBadge('s1_verifCountBadge', list.length);
            if (fS !== '') list = list.filter(i => i.Obra.toLowerCase().includes(fS));

            document.getElementById('s1_statsVerifText').innerHTML = `Mostrando <b>${list.length}</b> obras en revisión.`;

            let cP = 0, cT = 0, cPar = 0, cSC = 0;
            list.forEach(i => {
                const o = s1_manualOverrides[`${i.Contratista}|${i.Obra}`] || "";
                if (o === "Consumo Total") cT++;
                else if (o === "Consumo Parcial") cPar++;
                else if (o === "Sin Consumo") cSC++;
                else cP++;
            });

            document.getElementById('s1_verifStateSummary').innerHTML = `
                <span class="px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Pendientes: <b>${cP}</b></span>
                <span class="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200"><i class="fa-solid fa-check-circle mr-1"></i>Total: <b>${cT}</b></span>
                <span class="px-2 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-200"><i class="fa-solid fa-clock-rotate-left mr-1"></i>Parcial: <b>${cPar}</b></span>
                <span class="px-2 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-300"><i class="fa-solid fa-minus-circle mr-1 text-slate-500"></i>Sin Consumo: <b>${cSC}</b></span>
            `;

            const hasPM = s1_dataMateriales && s1_dataMateriales.length > 0;

            list.forEach(i => {
                const tr = document.createElement('tr'); tr.className = "hover:bg-slate-50";
                const gK = `${i.Contratista}|${i.Obra}`; const cO = s1_manualOverrides[gK] || "";
                let selClass = "w-full text-sm font-semibold p-2 border rounded-lg transition-colors ";
                if (cO === "Consumo Total") selClass += "border-emerald-400 bg-emerald-50 text-emerald-800";
                else if (cO === "Consumo Parcial") selClass += "border-blue-400 bg-blue-50 text-blue-800";
                else if (cO === "Sin Consumo") selClass += "border-slate-400 bg-slate-100 text-slate-700";
                else selClass += "border-slate-300 bg-white text-slate-600";

                const exclAlert = i.onlyExcluded
                    ? `<i class="fa-solid fa-triangle-exclamation text-amber-500 ml-2" title="Alerta: La obra solo tiene entregas de artículos excluidos"></i>`
                    : '';
                const fallbackAlert = i.fallbackExcluidos
                    ? `<i class="fa-solid fa-recycle text-violet-500 ml-2" title="Fallback: artículos activos en cero, recalculado con excluidos"></i>`
                    : '';

                const pmBtn = hasPM
                    ? `<button onclick="s1_showPMDetails('${i.Contratista.replace(/'/g, "\\'").replace(/"/g, '&quot;')}', '${i.Obra.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')" class="text-teal-600 hover:text-teal-800 bg-teal-50 hover:bg-teal-100 p-2 rounded-lg" title="Ver movimientos PM (PMOVXF)"><i class="fa-solid fa-eye"></i></button>`
                    : `<span class="text-slate-300 p-2" title="Cargue el PMOVXF para ver este detalle"><i class="fa-solid fa-eye-slash"></i></span>`;

                tr.innerHTML = `
                    <td class="p-3 text-sm text-slate-700">${i.Contratista}</td>
                    <td class="p-3 text-sm font-medium text-blue-700 flex items-center">${i.Obra}${exclAlert}${fallbackAlert}</td>
                    <td class="p-3 text-sm text-slate-600 text-center font-mono bg-slate-100 rounded">${i['% Consumo']}</td>
                    <td class="p-3 text-sm">
                        <select onchange="s1_handleManualDecision(this)" data-key="${gK}" class="${selClass}">
                            <option value="" ${cO === "" ? "selected" : ""}>⚠️ Verificar Consumo (Pendiente)</option>
                            <option value="Consumo Total" ${cO === "Consumo Total" ? "selected" : ""}>✅ Consumo Total</option>
                            <option value="Consumo Parcial" ${cO === "Consumo Parcial" ? "selected" : ""}>⏳ Consumo Parcial</option>
                            <option value="Sin Consumo" ${cO === "Sin Consumo" ? "selected" : ""}>⚪ Sin Consumo</option>
                        </select>
                    </td>
                    <td class="p-3 text-sm text-center"><button onclick="s1_showDetails('${gK}')" class="text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 p-2 rounded-lg" title="Ver detalle de materiales BCMO"><i class="fa-solid fa-eye"></i></button></td>
                    <td class="p-3 text-sm text-center">${pmBtn}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        function s1_toggleInvalidConfigPanel() {
            document.getElementById('s1_invalidConfigPanel').classList.toggle('hidden');
        }

        function s1_applyInvalidNomenclatures() {
            localStorage.setItem('invalidNomenclatures', document.getElementById('s1_invalidNomenclaturesInput').value);
            if (s1_currentRawData && s1_currentRawData.length > 0) {
                document.getElementById('s1_resultsWorkspace').classList.add('hidden');
                document.getElementById('s1_loader').classList.remove('hidden');
                setTimeout(() => s1_analyzeData(s1_currentRawData), 200);
                showToastGlobal("Reglas de exclusión aplicadas y datos recalculados.", "success");
            } else {
                showToastGlobal("Reglas guardadas exitosamente.", "success");
            }
        }

        function s1_showInvalidDetails(gK) {
            const dRow = s1_invalidData.find(i => `${i.Contratista}|${i.Obra}` === gK);
            if (!dRow) return;

            document.getElementById('s1_modalTitle').textContent = `Detalles: ${dRow.Obra}`;
            document.getElementById('s1_modalSubtitle').textContent = `Contratista: ${dRow.Contratista} | Estado: Nomenclatura Inválida`;

            const tbody = document.getElementById('s1_modalTableBody'); tbody.innerHTML = '';
            dRow.Detalles.forEach(det => {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-slate-50 transition-colors bg-rose-50/20";
                tr.innerHTML = `
                    <td class="p-2 px-4 text-xs text-slate-500 font-mono">${det['Ítem']}</td>
                    <td class="p-2 px-4 text-xs text-slate-700 font-medium">${det['Descripción']}</td>
                    <td class="p-2 px-4 text-xs text-slate-500 text-center">${det['UM']}</td>
                    <td class="p-2 px-4 text-xs text-slate-600 text-right">${s1_formatLocalNumber(det['Entregado'])}</td>
                    <td class="p-2 px-4 text-xs text-slate-600 text-right">${s1_formatLocalNumber(det['Consumido'])}</td>
                    <td class="p-2 px-4 text-xs font-semibold text-slate-600 text-right">${s1_formatLocalNumber(det['Diferencia'])}</td>
                `;
                tbody.appendChild(tr);
            });
            document.getElementById('s1_detailsModal').classList.remove('hidden');
        }

        function s1_showDetails(gK) {
            const dRow = s1_processedData.find(i => `${i.Contratista}|${i.Obra}` === gK);
            if (!dRow) return;

            document.getElementById('s1_modalTitle').textContent = `Detalles: ${dRow.Obra}`;
            document.getElementById('s1_modalSubtitle').textContent = `Contratista: ${dRow.Contratista} | Estado: ${dRow['Estado de liquidacion']}`;

            const tbody = document.getElementById('s1_modalTableBody'); tbody.innerHTML = '';
            dRow.Detalles.forEach(det => {
                const tr = document.createElement('tr');
                tr.className = det['Ignorado'] ? "bg-slate-50 transition-colors" : "hover:bg-slate-50 transition-colors";

                let exclBadge = '';
                if (det['FallbackRescatado']) {
                    exclBadge = `<span class="bg-violet-100 text-violet-800 px-1.5 py-0.5 rounded text-[10px] font-bold ml-2 border border-violet-300" title="Artículo excluido rescatado por fallback: activos en cero">Fallback</span>`;
                } else if (det['Ignorado']) {
                    exclBadge = `<span class="bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded text-[10px] font-bold ml-2 border border-slate-300" title="Item ignorado para el porcentaje de avance">Ignorado</span>`;
                } else if (det['Excluido']) {
                    exclBadge = `<span class="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-[10px] font-bold ml-2 border border-amber-200" title="Único material excluido que fue rescatado">Rescatado</span>`;
                }

                const textClass = det['Ignorado'] ? "text-slate-400 line-through" : "text-slate-700 font-medium";
                const numClass = det['Ignorado'] ? "text-slate-400" : "text-slate-600";

                tr.innerHTML = `
                    <td class="p-2 px-4 text-xs text-slate-500 font-mono ${det['Ignorado'] ? 'line-through' : ''}">${det['Ítem']}</td>
                    <td class="p-2 px-4 text-xs ${textClass}">${det['Descripción']}${exclBadge}</td>
                    <td class="p-2 px-4 text-xs text-slate-500 text-center">${det['UM']}</td>
                    <td class="p-2 px-4 text-xs ${numClass} text-right">${s1_formatLocalNumber(det['Entregado'])}</td>
                    <td class="p2 px-4 text-xs ${numClass} text-right">${s1_formatLocalNumber(det['Consumido'])}</td>
                    <td class="p-2 px-4 text-xs font-semibold ${numClass} text-right">${s1_formatLocalNumber(det['Diferencia'])}</td>
                `;
                tbody.appendChild(tr);
            });
            document.getElementById('s1_detailsModal').classList.remove('hidden');
        }

        function s1_closeModal() { document.getElementById('s1_detailsModal').classList.add('hidden'); }

        function s1_showPMDetails(contratista, obra) {
            if (!s1_dataMateriales || s1_dataMateriales.length === 0) {
                showToastGlobal("No hay datos del PMOVXF cargados.", "error"); return;
            }

            // Buscar el registro de BCMO para obtener las diferencias de los artículos
            const cleanCode = (code) => {
                let str = String(code || '').trim().toUpperCase();
                // Quitar ceros a la izquierda si es puramente numérico para evitar descalces entre formato texto/número
                if (/^\d+$/.test(str)) {
                    str = String(parseInt(str, 10));
                }
                return str;
            };

            // Comparación flexible de nombres de obras
            const matchObra = (motivoRaw, obraRaw) => {
                const cleanStr = (s) => String(s || '').trim().toUpperCase().replace(/[\s-_]/g, '');
                const m = cleanStr(motivoRaw);
                const o = cleanStr(obraRaw);
                if (!m || !o) return false;
                return m === o || m.includes(o) || o.includes(m);
            };

            const dRow = s1_processedData.find(item => item.Contratista === contratista && item.Obra === obra);
            const articulosConDiferencia = {};
            if (dRow && dRow.Detalles) {
                dRow.Detalles.forEach(det => {
                    const itemCod = cleanCode(det['Ítem']);
                    const dif = parseFloat(det['Diferencia']) || 0;
                    if (itemCod && dif > 0) {
                        articulosConDiferencia[itemCod] = String(det['Descripción'] || '').trim();
                    }
                });
            }

            // Buscar todos los movimientos del PM para esta obra
            const movimientos = s1_dataMateriales.filter(row => {
                const motivo = String(row['_N_MOTIVO'] || row['MOTIVO'] || row['Motivo'] || '');
                return matchObra(motivo, obra);
            });

            document.getElementById('s1_pmModalTitle').textContent = `PM — ${obra}`;
            document.getElementById('s1_pmModalSubtitle').textContent = `${movimientos.length} movimiento(s) filtrado(s) del PMOVXF`;

            const tbody = document.getElementById('s1_pmModalTableBody');
            tbody.innerHTML = '';
            const emptyMsg = document.getElementById('s1_pmModalEmpty');

            if (movimientos.length === 0) {
                emptyMsg.classList.remove('hidden');
            } else {
                emptyMsg.classList.add('hidden');
                movimientos.forEach(row => {
                    const numero = row['_N_NUMERO'] || row['NUMERO'] || row['Numero'] || row['Número'] || '-';
                    const articulo = row['_N_ARTICULO'] || row['ARTICULO'] || row['Articulo'] || row['Artículo'] || '-';
                    const subinv = row['_N_SUBINV_DESTINO'] || row['SUBINV_DESTINO'] || row['Subinv_Destino'] || '-';
                    const loc = row['_N_LOCALIZADOR_DESTINO'] || row['LOCALIZADOR_DESTINO'] || row['Localizador_Destino'] || '-';
                    const ctdPend = row['_N_CTD_PENDIENTE'] || row['CTD_PENDIENTE'] || row['Ctd_Pendiente'] || '0';
                    const cantSol = row['_N_CANTIDAD_SOLICITADA'] || row['CANTIDAD_SOLICITADA'] || row['Cantidad_Solicitada'] || '0';
                    const cantEnt = row['_N_CANTIDAD_ENTREGADA'] || row['CANTIDAD_ENTREGADA'] || row['Cantidad_Entregada'] || row['_N_CANTIDAD'] || row['CANTIDAD'] || '0';
                    const motivo = row['_N_MOTIVO'] || row['MOTIVO'] || row['Motivo'] || '-';
                    const estadoLinea = row['_N_ESTADO_DE_LINEA'] || row['ESTADO_DE_LINEA'] || row['Estado_De_Linea'] || '-';
                    const fechaEnt = row['_N_FECHA_TRX'] || row['FECHA_TRX'] || row['Fecha_Trx'] || row['FECHA_ENTREGA'] || row['Fecha Entrega'] || '-';
                    const motivoTarea = row['_N_MOTIVO_TAREA'] || row['MOTIVO_TAREA'] || row['Motivo_Tarea'] || '-';

                    let fechaStr = '-';
                    if (fechaEnt instanceof Date) {
                        fechaStr = fechaEnt.toLocaleDateString('es-AR');
                    } else if (fechaEnt) {
                        fechaStr = String(fechaEnt);
                    }

                    const cantSolNum = parseFloat(String(cantSol).replace(',', '.')) || 0;
                    const cantEntNum = parseFloat(String(cantEnt).replace(',', '.')) || 0;
                    const ctdPendNum = parseFloat(String(ctdPend).replace(',', '.')) || 0;

                    const tr = document.createElement('tr');
                    tr.className = 'hover:bg-teal-50 transition-colors';
                    tr.innerHTML = `
                        <td class="p-2 px-4 text-xs text-slate-700 font-medium">${numero}</td>
                        <td class="p-2 px-4 text-xs text-slate-700 font-mono font-semibold">${articulo}</td>
                        <td class="p-2 px-4 text-xs text-slate-600">${subinv}</td>
                        <td class="p-2 px-4 text-xs text-slate-600">${loc}</td>
                        <td class="p-2 px-4 text-xs text-slate-600 text-right font-mono">${s1_formatLocalNumber(ctdPendNum)}</td>
                        <td class="p-2 px-4 text-xs text-slate-600 text-right font-mono">${s1_formatLocalNumber(cantSolNum)}</td>
                        <td class="p-2 px-4 text-xs text-teal-700 text-right font-mono font-semibold">${s1_formatLocalNumber(cantEntNum)}</td>
                        <td class="p-2 px-4 text-xs text-slate-700 font-medium">${motivo}</td>
                        <td class="p-2 px-4 text-xs text-slate-600">${estadoLinea}</td>
                        <td class="p-2 px-4 text-xs text-slate-500">${fechaStr}</td>
                        <td class="p-2 px-4 text-xs text-slate-600">${motivoTarea}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }

            document.getElementById('s1_pmDetailsModal').classList.remove('hidden');
        }

        function s1_closePMModal() { document.getElementById('s1_pmDetailsModal').classList.add('hidden'); }

        function s1_exportToExcel_Etapa1() {
            if (s1_processedData.length === 0) { showToastGlobal("No hay datos para exportar.", "error"); return; }
            const d1 = s1_filteredData.map(i => {
                const gK = `${i.Contratista}|${i.Obra}`;
                const audit = s1_auditTrail[gK];
                return {
                    "Contratista": i.Contratista,
                    "Tarea / Obra": i.Obra,
                    "Entregado": i.Entregado,
                    "Consumido": i.Consumido,
                    "Diferencia": i.Diferencia,
                    "% Consumo": i.PorcentajeReal,
                    "Estado de Liquidacion": i['Estado de liquidacion'],
                    "Auditor Responsable": audit ? audit.auditor : (s1_manualOverrides[gK] ? "Manual" : "-"),
                    "Fecha Modificación": audit ? audit.fecha : "-"
                };
            });
            const lVerif = s1_processedData.filter(i => i.naturalState === 'Verificar Consumo');
            const d2 = lVerif.map(i => ({ "Contratista": i.Contratista, "Tarea / Obra": i.Obra, "% Consumo": i.PorcentajeReal, "Estado Automático": i.naturalState, "Obra Consumida (Decisión)": s1_manualOverrides[`${i.Contratista}|${i.Obra}`] || "Pendiente", "Estado Final de Liquidación": i['Estado de liquidacion'] }));
            const d3 = []; s1_filteredData.forEach(i => { i.Detalles.forEach(d => { d3.push({ "Contratista": i.Contratista, "Tarea / Obra": i.Obra, "Estado de Liquidacion": i['Estado de liquidacion'], "Ítem": d['Ítem'], "Descripción": d['Descripción'], "UM": d['UM'], "Entregado": d['Entregado'], "Consumido": d['Consumido'], "Diferencia": d['Diferencia'] }); }); });

            const ws1 = XLSX.utils.json_to_sheet(d1); const ws2 = XLSX.utils.json_to_sheet(d2); const ws3 = XLSX.utils.json_to_sheet(d3);
            const fmt = (ws, isV = false) => {
                const r = XLSX.utils.decode_range(ws['!ref']);
                for (let R = r.s.r + 1; R <= r.e.r; ++R) {
                    for (let C = r.s.c; C <= r.e.c; ++C) {
                        const cRef = XLSX.utils.encode_cell({ c: C, r: R });
                        if (ws[cRef] && typeof ws[cRef].v === 'number') { if ((!isV && C === 5) || (isV && C === 2)) ws[cRef].z = "0.00%"; else ws[cRef].z = "#,##0.00"; }
                    }
                }
            };
            fmt(ws1, false); fmt(ws2, true); fmt(ws3, false);

            const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws1, "Dinamica BCMO");
            if (d2.length > 0) XLSX.utils.book_append_sheet(wb, ws2, "3 - VERIFICAR CONSUMO");
            XLSX.utils.book_append_sheet(wb, ws3, "Detalle BCMO");
            const d = new Date(); const dS = `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}`;
            XLSX.writeFile(wb, `Analisis_BCMO_${dS}.xlsx`);
        }

        function openFaqModal() {
            document.getElementById('faqModal').classList.remove('hidden');
        }

        function closeFaqModal() {
            document.getElementById('faqModal').classList.add('hidden');
        }

// Exposición de funciones para handlers HTML de Etapa 1
window.openFaqModal = openFaqModal;
window.closeFaqModal = closeFaqModal;
window.s1_lanzarAnalisisBCMO = s1_lanzarAnalisisBCMO;
window.s1_toggleConfigPanel = s1_toggleConfigPanel;
window.s1_exportMemory = s1_exportMemory;
window.s1_clearFilters = s1_clearFilters;
window.s1_applyLocalConfig = s1_applyLocalConfig;
window.s1_switchTabEtapa1 = s1_switchTabEtapa1;
window.s1_resetUI = s1_resetUI;
window.s1_exportToExcel_Etapa1 = s1_exportToExcel_Etapa1;
window.s1_volverACargarArchivos = s1_volverACargarArchivos;
window.s1_toggleMassivePanel = s1_toggleMassivePanel;
window.s1_applyMassiveOverrides = s1_applyMassiveOverrides;
window.s1_cambiarEmpresaAuditada = s1_cambiarEmpresaAuditada;
window.s1_toggleInvalidConfigPanel = s1_toggleInvalidConfigPanel;
window.s1_applyInvalidNomenclatures = s1_applyInvalidNomenclatures;
window.s1_closePMModal = s1_closePMModal;
window.s1_closeUnifiedModal = s1_closeUnifiedModal;
window.s1_toggleMaximizeUnifiedModal = s1_toggleMaximizeUnifiedModal;
window.s1_switchUniTab = s1_switchUniTab;
window.s1_cancelarAvanceModal = s1_cancelarAvanceModal;
window.s1_confirmarEmpresaAuditada = s1_confirmarEmpresaAuditada;
window.s1_closeModal = s1_closeModal;
window.s1_closeExportModal = s1_closeExportModal;
window.s1_confirmExport = s1_confirmExport;
window.s1_handleLocalizadoresFile = s1_handleLocalizadoresFile;
window.s1_handleFiles = s1_handleFiles;
window.s1_handleAvanceGeneralFile = s1_handleAvanceGeneralFile;
