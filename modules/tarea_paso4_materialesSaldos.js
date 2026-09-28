/* ==========================================================================
   PASO 4 · Materiales Obras BF v1.8 (modules/tarea_paso4_materialesSaldos.js)
   Origen: archivos_tarea/4- Materiales Obras BF v1.8.html
   Responsabilidad:
     - Procesar y normalizar reporte PM / PMOVXF de Oracle EBS.
     - Cruce de materiales con las obras habilitadas (¿CONSIDERA? === 'SI').
     - Procesamiento de archivo de Descargos ("Tareas en Desc Mat").
     - Conciliación de cantidades y cálculo de la CANTIDAD FINAL neta (Saldos Reales).
   ========================================================================== */

(function () {
    'use strict';

    /**
     * Parsea y genera mapa de consumos cerrados desde "Tareas en Desc Mat"
     */
    function s3_s4_procesarDescargos(rawDescargos, contratistaFiltro = '') {
        const mapaDescargos = {};
        const cTarget = String(contratistaFiltro || '').trim().toUpperCase();

        if (!rawDescargos || !Array.isArray(rawDescargos) || rawDescargos.length === 0) {
            return mapaDescargos;
        }

        rawDescargos.forEach(row => {
            // 1. Filtrar por contratista si fue especificada
            if (cTarget) {
                const provKey = Object.keys(row).find(k => {
                    const ku = k.trim().toUpperCase();
                    return ku === 'CONTRATISTA' || ku === 'EMPRESA' || ku === 'PROVEEDOR' || ku === 'NOMBRE_PROV';
                });
                const cFila = provKey ? String(row[provKey] || '').trim().toUpperCase() : '';
                const fnMatch = window.s1_esMismaEmpresa;
                if (typeof fnMatch === 'function') {
                    if (cFila && !fnMatch(cFila, cTarget)) return;
                } else if (cFila && !cFila.includes(cTarget) && !cTarget.includes(cFila)) {
                    return;
                }
            }

            // 2. Filtrar estado de declaración materiales == CERRADO (excluir pendientes / abiertos)
            const estadoKey = Object.keys(row).find(k => {
                const ku = k.trim().toUpperCase();
                return ku.includes('ESTADO DECLARACI') || ku.includes('ESTADO_DECLARACI') || ku === 'ESTADO';
            });
            const estado = estadoKey ? String(row[estadoKey]).trim().toUpperCase() : '';
            if (estado && estado !== 'CERRADO') return;

            // 3. Obra BF
            const obraKey = Object.keys(row).find(k => {
                const ku = k.trim().toUpperCase();
                return ku === 'OBRA BF' || ku === 'OBRA_BF' || ku === 'OBRA' || ku === 'PROYECTO';
            });
            const rawObra = obraKey ? String(row[obraKey] || '').replace(/\s+/g, '').trim().toUpperCase() : '';

            // 4. Artículo / ID Material
            const artKey = Object.keys(row).find(k => {
                const ku = k.trim().toUpperCase();
                return ku === 'ID MATERIAL' || ku === 'ID_MATERIAL' || ku === 'ARTICULO' || ku === 'ARTÍCULO' || ku === 'ITEM' || ku === 'CODIGO';
            });
            const rawArticulo = artKey ? String(row[artKey] || '').trim().toUpperCase() : '';

            // 5. Cantidad descargada / MAT_CANTIDAD
            const cantKey = Object.keys(row).find(k => {
                const ku = k.trim().toUpperCase();
                return ku === 'MAT_CANTIDAD' || ku === 'MAT CANTIDAD' || ku === 'CANTIDAD_DESCARGADA' || ku === 'CANTIDAD' || ku === 'CONSUMO';
            });
            const cantStr = cantKey ? String(row[cantKey] || 0).replace(',', '.') : '0';
            const rawCant = parseFloat(cantStr) || 0;

            if (rawObra && rawArticulo && rawCant > 0) {
                const key = `${rawObra}|${rawArticulo}`;
                mapaDescargos[key] = (mapaDescargos[key] || 0) + rawCant;
            }
        });

        return mapaDescargos;
    }

    /**
     * Cruza el reporte PM / PMOVXF con las obras 'SI' de la matriz y deduce descargos
     */
    function s3_s4_conciliarMateriales(dataMateriales, obrasSI, mapaDescargos = {}, localizadorMap = new Map(), empresaAuditada = '') {
        const reporteMateriales = [];
        if (!dataMateriales || !Array.isArray(dataMateriales) || dataMateriales.length === 0) {
            return reporteMateriales;
        }

        if (!obrasSI || !Array.isArray(obrasSI) || obrasSI.length === 0) {
            return reporteMateriales;
        }

        const cAuditada = String(empresaAuditada || '').trim().toUpperCase();

        dataMateriales.forEach(row => {
            const estado = String(row['Estado_de_Linea'] || row['ESTADO_DE_LINEA'] || row['_N_ESTADO_DE_LINEA'] || row['Estado'] || '').trim().toUpperCase();
            if (estado === 'CANCELADO') return;

            const loc = String(row['Localizador_Destino'] || row['LOCALIZADOR_DESTINO'] || row['Localizador Destino'] || row['_N_LOCALIZADOR_DESTINO'] || row['Localizador'] || '').trim();
            if (cAuditada && localizadorMap && localizadorMap.size > 0 && loc) {
                const prov = localizadorMap.get(loc.toUpperCase());
                if (prov) {
                    const fnMatch = window.s1_esMismaEmpresa;
                    let coincide = false;
                    if (typeof fnMatch === 'function') {
                        coincide = fnMatch(prov, cAuditada);
                    } else {
                        const pUpper = prov.toUpperCase();
                        coincide = pUpper.includes(cAuditada) || cAuditada.includes(pUpper);
                    }
                    if (!coincide) return;
                }
            }

            const motivoOriginal = String(row['Motivo'] || row['MOTIVO'] || row['_N_MOTIVO'] || '');
            const motivoPM = motivoOriginal.toUpperCase();
            const obraBfPM = motivoOriginal.replace(/\s+/g, '').substring(0, 7).toUpperCase();

            const sol = parseFloat(String(row['Cantidad_Solicitada'] || row['CANTIDAD_SOLICITADA'] || row['Cantidad Solicitada'] || row['_N_CANTIDAD_SOLICITADA'] || 0).replace(',', '.')) || 0;
            const ent = parseFloat(String(row['Cantidad_Entregada'] || row['CANTIDAD_ENTREGADA'] || row['Cantidad Entregada'] || row['_N_CANTIDAD_ENTREGADA'] || 0).replace(',', '.')) || 0;
            const cantConsiderar = Math.max(sol, ent);

            let obraEncontrada = '';
            const esMatch = obrasSI.some(obA => {
                const nodoA = String(obA['NODO'] || obA['Nodo'] || obA['nodo'] || '').trim().toUpperCase();
                const obraBfA = String(obA['Obra BF'] || obA['OBRA BF'] || obA['Obra'] || obA['OBRA'] || '').trim().toUpperCase();

                const matchNodo = (nodoA !== '' && motivoPM.includes(nodoA));
                const matchBF = (obraBfA !== '' && obraBfPM === obraBfA);

                if (matchNodo || matchBF) {
                    obraEncontrada = obraBfA || obraBfPM;
                    return true;
                }
                return false;
            });

            if (esMatch) {
                const art = String(row['Articulo'] || row['ARTICULO'] || row['Artículo'] || row['_N_ARTICULO'] || row['ITEM'] || row['CODIGO'] || '').trim();
                const artUpper = art.toUpperCase();
                const key = `${obraEncontrada.replace(/\s+/g, '')}|${artUpper}`;
                const keyPM = `${obraBfPM.replace(/\s+/g, '')}|${artUpper}`;
                const descargado = (mapaDescargos[key] !== undefined) ? mapaDescargos[key] : (mapaDescargos[keyPM] || 0);
                const cantFinal = Math.max(0, cantConsiderar - descargado);

                reporteMateriales.push({
                    'Articulo': art,
                    'Subinv_Destino': row['Subinv_Destino'] || row['SUBINV_DESTINO'] || row['Subinventario'] || row['_N_SUBINV_DESTINO'] || '',
                    'Localizador_Destino': loc,
                    'UDM': row['UDM'] || row['UOM'] || row['_N_UDM'] || 'UN',
                    'Cantidad_Solicitada': sol,
                    'Cantidad_Entregada': ent,
                    'Cantidad a considerar': cantConsiderar,
                    'Motivo': motivoOriginal,
                    'Estado_de_Linea': estado,
                    'Fecha_Trx': row['Fecha_Trx'] || row['FECHA_TRX'] || row['_N_FECHA_TRX'] || '',
                    'Obra BF - PM': obraBfPM,
                    'Obra BF (Cruce SI)': obraEncontrada,
                    'Resultado': 'SI',
                    'Mat_Cantidad_Total': descargado,
                    'CANTIDAD FINAL': cantFinal,
                    _SISTEMA_ORIGEN: "4 - Materiales Obras BF v1.8"
                });
            }
        });

        return reporteMateriales;
    }

    // Exposición global
    window.s3_s4_procesarDescargos = s3_s4_procesarDescargos;
    window.s3_s4_conciliarMateriales = s3_s4_conciliarMateriales;
    window.tareaMaterialesSaldos = {
        paso: 4,
        sistema: "4 - Materiales Obras BF (Saldos Reales)",
        version: "v1.8",
        procesarDescargos: s3_s4_procesarDescargos,
        conciliarMateriales: s3_s4_conciliarMateriales
    };
    window.tarea_paso4_materialesSaldos = window.tareaMaterialesSaldos;
    window.paso4_tareaMaterialesSaldos = window.tareaMaterialesSaldos;

})();
