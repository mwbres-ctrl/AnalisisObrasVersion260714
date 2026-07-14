/* ==========================================================================
   Módulo: Estandarización y Recategorización (modules/recategorizacion.js)
   Lógica de las reglas condicionales y de estandarización directa.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Dependencias Globales Esperadas:
   - standardizationRules, conditionalRules, standardizationDateLimit
   - dataAvance, ctRecategorizadosData
   - showToast, procesarConsolidacion, aplicarEstandarizacionInPlace
   -------------------------------------------------------------------------- */

window.aplicarEstandarizacionInPlace = function(arrayData) {
    ctRecategorizadosData = [];
    const limitDateStr = standardizationDateLimit;
    let parts = limitDateStr.split('-');
    const limitDate = new Date(parts[0], parts[1] - 1, parts[2]); // local date correct to avoid timezone shifts
    limitDate.setHours(0, 0, 0, 0);

    arrayData.forEach(row => {
        let eKey = null;
        if (row.hasOwnProperty('ESTADO')) eKey = 'ESTADO';
        else if (row.hasOwnProperty('Estado')) eKey = 'Estado';
        else if (row.hasOwnProperty('estado')) eKey = 'estado';
        else {
            const keyOriginal = Object.keys(row).find(k => k.trim().toUpperCase() === 'ESTADO');
            if (keyOriginal) eKey = keyOriginal;
        }

        if (eKey) {
            let valOri = row['_PRISTINE_ESTADO'] || String(row[eKey]).trim().toUpperCase();
            let valFinal = valOri;

            const activeCondRule = conditionalRules.find(r => r.org === valOri);
            if (activeCondRule) {
                let fIniRaw = row['_N_FECHA_INICIO'] || row['_N_FECHA_DE_INICIO'] || row['Fecha Inicio'] || row['FECHA INICIO'] || row['Inicio'] || row['INICIO'];
                if (fIniRaw) {
                    let fDate = null;
                    if (fIniRaw instanceof Date) { fDate = fIniRaw; }
                    else if (typeof fIniRaw === 'string') {
                        let fParts = fIniRaw.split('/');
                        if (fParts.length === 3) fDate = new Date(fParts[2], fParts[1] - 1, fParts[0]);
                        else fDate = new Date(fIniRaw);
                    } else if (typeof fIniRaw === 'number') {
                        fDate = new Date(Math.round((fIniRaw - 25569) * 86400 * 1000));
                    }
                    if (fDate && !isNaN(fDate.getTime())) {
                        fDate.setHours(0, 0, 0, 0);
                        if (fDate >= limitDate) valFinal = activeCondRule.gte;
                        else if (fDate < limitDate) {
                            valFinal = activeCondRule.lt;
                        }
                        ctRecategorizadosData.push({ ...row, '_EVAL_DATE': fDate.toLocaleDateString('es-AR'), '_ORIG_VAL': valOri, '_FINAL_VAL': valFinal });
                    }
                }
            } else if (standardizationRules.hasOwnProperty(valOri)) {
                valFinal = standardizationRules[valOri];
            }

            row[eKey] = valFinal;
            row['_N_ESTADO'] = valFinal;
        }
    });
};

window.openConfigReglas = function () {
    document.getElementById('configCTDate').value = standardizationDateLimit;
    renderStandardizationRules();
    renderConditionalRules();
    document.getElementById('modalEstandarizacion').classList.remove('hidden');
};

window.renderConditionalRules = function () {
    const tbody = document.getElementById('condRulesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    conditionalRules.forEach((r, i) => {
        tbody.innerHTML += `
        <tr class="hover:bg-purple-50 transition-colors">
            <td class="p-1 px-3 border-r border-purple-100 text-[11px] font-bold text-slate-700 bg-white">${r.org}</td>
            <td class="p-1 px-3 border-r border-purple-100 text-[11px] font-bold text-emerald-700 bg-emerald-50/20">${r.lt}</td>
            <td class="p-1 px-3 border-r border-purple-100 text-[11px] font-bold text-amber-700 bg-amber-50/20">${r.gte}</td>
            <td class="p-1 text-center bg-white"><button onclick="removeCondRule(${i})" class="text-rose-400 hover:text-rose-600 w-5 h-5 rounded" title="Eliminar Variante"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`;
    });
};

window.addCondRule = function () {
    const org = document.getElementById('newCondOrg').value.trim().toUpperCase();
    const lt = document.getElementById('newCondLt').value.trim().toUpperCase();
    const gte = document.getElementById('newCondGte').value.trim().toUpperCase();
    if (org && lt && gte) {
        if (conditionalRules.some(r => r.org === org)) {
            showToast("Ese Estado Original ya tiene una regla condicional.", "error"); return;
        }
        conditionalRules.push({ org, lt, gte });
        document.getElementById('newCondOrg').value = '';
        document.getElementById('newCondLt').value = '';
        document.getElementById('newCondGte').value = '';
        renderConditionalRules();
        showToast("Regla Condicional añadida.", "success");
    } else {
        showToast("Complete los tres campos de la regla condicional.", "error");
    }
};

window.removeCondRule = function (index) {
    conditionalRules.splice(index, 1);
    renderConditionalRules();
    showToast("Regla Condicional removida.", "success");
};

window.renderStandardizationRules = function () {
    const tbody = document.getElementById('rulesTableBody');
    tbody.innerHTML = '';
    for (const [k, v] of Object.entries(standardizationRules)) {
        tbody.innerHTML += `
        <tr class="hover:bg-indigo-50/50">
            <td class="p-2 border-r border-slate-100 text-xs font-semibold text-slate-600 bg-white">${k}</td>
            <td class="p-2 text-xs font-bold text-indigo-700 bg-indigo-50/30">${v}</td>
            <td class="p-2 text-center"><button onclick="removeRule('${k}')" class="text-rose-400 hover:text-rose-600 w-6 h-6 rounded" title="Eliminar regla"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`;
    }
};

window.addStandardizationRule = function () {
    const inf = document.getElementById('newRuleIn').value.trim().toUpperCase();
    const outf = document.getElementById('newRuleOut').value.trim().toUpperCase();
    if (inf && outf) {
        standardizationRules[inf] = outf;
        document.getElementById('newRuleIn').value = '';
        document.getElementById('newRuleOut').value = '';
        renderStandardizationRules();
        showToast("Regla añadida correctamente.", "success");
    } else {
        showToast("Por favor complete ambos campos para la regla.", "error");
    }
};

window.removeRule = function (k) {
    delete standardizationRules[k];
    renderStandardizationRules();
    showToast("Regla removida.", "success");
};

window.actualizarCorteCT = function (e) {
    if (e.target.value) {
        standardizationDateLimit = e.target.value;
        showToast("Fecha límite para CT PARCIAL actualizada.", "success");
    }
};

window.reEstandarizarTodaLaBase = function () {
    if (!dataAvance || dataAvance.length === 0) {
        showToast("No hay archivo de Avances (Principal) cargado en memoria.", "error"); return;
    }
    showToast("Recalculando Estandarización sobre la memoria...", "info");
    document.getElementById('modalEstandarizacion').classList.add('hidden');
    setTimeout(() => {
        if (dataAvance) aplicarEstandarizacionInPlace(dataAvance);
        procesarConsolidacion();
        renderRecatTable(); // FORZAR update de UI y contador de solapa
        showToast("Reestandarización completa. Se actualizaron los campos y las tablas calculadas.", "success");
    }, 300);
};

window.renderRecatTable = function () {
    const tbody = document.getElementById('recatTableBody');
    const emptyState = document.getElementById('emptyRecatState');
    tbody.innerHTML = '';

    if (ctRecategorizadosData.length === 0) {
        emptyState.classList.remove('hidden');
        setTabBadge('tabRecatCount', 0);
        return;
    }
    emptyState.classList.add('hidden');

    setTabBadge('tabRecatCount', ctRecategorizadosData.length);

    ctRecategorizadosData.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="p-3 border-r border-slate-100"><span class="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-[10px] font-bold">PRINCIPAL</span></td>
            <td class="p-3 text-sm text-slate-800 font-bold border-r border-slate-100">${item['_N_NODO'] || item['NODO'] || item['Nodo'] || '-'}</td>
            <td class="p-3 text-xs font-mono text-indigo-700 border-r border-slate-100 bg-indigo-50/20">${item['_N_OBRA_BF'] || item['Obra BF'] || '-'}</td>
            <td class="p-3 text-xs text-slate-600 border-r border-slate-100 text-center font-semibold"><i class="fa-regular fa-calendar-check mr-1"></i>${item['_EVAL_DATE']}</td>
            <td class="p-3 text-xs text-slate-600 border-r border-slate-100 text-center"><i class="fa-solid fa-calendar-xmark mr-1 text-rose-500"></i>${new Date(standardizationDateLimit + 'T00:00:00').toLocaleDateString('es-AR')}</td>
            <td class="p-3 text-xs text-purple-700 bg-purple-50 font-bold border-r border-slate-100 text-center">${item['_ORIG_VAL']}</td>
            <td class="p-3 text-xs text-emerald-700 bg-emerald-50 font-bold text-center"><i class="fa-solid fa-arrow-right-long text-slate-300 mr-2"></i>${item['_FINAL_VAL']}</td>
        `;
        tbody.appendChild(tr);
    });
};
