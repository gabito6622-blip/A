// Simulación en memoria de FormApp, SpreadsheetApp, DriveApp y demás servicios de
// Google Apps Script, SOLO para probar la lógica del script en Node. No reemplaza
// la prueba real en Google (probarEnEntornoAislado), pero detecta errores de
// lógica, de filas/columnas y de flujo antes de ejecutarlo en tu cuenta.
// Los nombres de métodos se verifican aparte contra @types/google-apps-script.

let secuencia = 0;
const nuevoId = (p) => `${p}_${++secuencia}`;

/** Objeto encadenable: cualquier método desconocido (formato, etc.) devuelve el mismo objeto. */
function crearEncadenable(base) {
  const p = new Proxy(base, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (typeof prop === 'symbol') return undefined;
      return () => p;
    }
  });
  return p;
}

export function crearGoogleFalso() {
  const archivos = new Map(); // id → { tipo, nombre, papelera, padres, objeto }
  const carpetas = new Map(); // id → { nombre, papelera, objeto }
  const registro = [];
  const disparadores = [];
  const propiedades = new Map();

  // ------------------------------------------------------------ Sheets
  function crearHoja(ss, nombre) {
    const hoja = {
      _nombre: nombre,
      _datos: [],
      _graficos: [],
      _formUrl: null,
      _notas: [],
      getName: () => hoja._nombre,
      setName: (n) => { hoja._nombre = n; return proxyHoja; },
      getFormUrl: () => hoja._formUrl,
      getLastRow: () => {
        for (let r = hoja._datos.length - 1; r >= 0; r--) {
          if ((hoja._datos[r] || []).some((c) => c !== '' && c != null)) return r + 1;
        }
        return 0;
      },
      getLastColumn: () => hoja._datos.reduce((m, f) => {
        let u = 0;
        (f || []).forEach((c, i) => { if (c !== '' && c != null) u = i + 1; });
        return Math.max(m, u);
      }, 0),
      getMaxRows: () => Math.max(1000, hoja._datos.length),
      getMaxColumns: () => 26,
      getRange: (fila, col, nf = 1, nc = 1) => crearRango(hoja, fila, col, nf, nc),
      getDataRange: () => crearRango(hoja, 1, 1, Math.max(hoja.getLastRow(), 1), Math.max(hoja.getLastColumn(), 1)),
      clear: () => { hoja._datos = []; return proxyHoja; },
      getCharts: () => hoja._graficos.slice(),
      removeChart: (g) => { hoja._graficos = hoja._graficos.filter((x) => x !== g); },
      insertChart: (g) => { hoja._graficos.push(g); },
      newChart: () => {
        const conf = { rangos: [], opciones: {} };
        const b = crearEncadenable({
          addRange: (r) => { conf.rangos.push(r); return b; },
          setOption: (k, v) => { conf.opciones[k] = v; return b; },
          setChartType: (t) => { conf.tipo = t; return b; },
          setPosition: (f, c) => { conf.posicion = [f, c]; return b; },
          build: () => ({ ...conf })
        });
        return b;
      }
    };
    const proxyHoja = crearEncadenable(hoja);
    return proxyHoja;
  }

  function crearRango(hoja, fila, col, nf, nc) {
    if (fila < 1 || col < 1 || nf < 1 || nc < 1) throw new Error(`Rango inválido ${fila},${col},${nf},${nc}`);
    const rango = {
      _hoja: hoja,
      setValues: (vals) => {
        if (vals.length !== nf || vals.some((f) => f.length !== nc)) {
          throw new Error(`setValues: dimensiones ${vals.length}x${vals[0] && vals[0].length} ≠ ${nf}x${nc}`);
        }
        vals.forEach((f, i) => f.forEach((v, j) => escribir(hoja, fila + i, col + j, v)));
        return proxyRango;
      },
      setValue: (v) => { escribir(hoja, fila, col, v); return proxyRango; },
      getValues: () => {
        const out = [];
        for (let i = 0; i < nf; i++) {
          const f = [];
          for (let j = 0; j < nc; j++) {
            const v = (hoja._datos[fila - 1 + i] || [])[col - 1 + j];
            f.push(v == null ? '' : v);
          }
          out.push(f);
        }
        return out;
      },
      setNote: (n) => { hoja._notas.push(n); return proxyRango; }
    };
    const proxyRango = crearEncadenable(rango);
    return proxyRango;
  }

  function escribir(hoja, fila, col, v) {
    if (typeof v === 'string' && /^=/.test(v)) throw new Error(`Se escribió una fórmula sin querer: ${v}`);
    if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1); // Sheets guarda el texto sin el apóstrofo
    while (hoja._datos.length < fila) hoja._datos.push([]);
    const f = hoja._datos[fila - 1];
    while (f.length < col) f.push('');
    f[col - 1] = v;
  }

  function crearLibro(nombre) {
    const id = nuevoId('hoja');
    const ss = {
      _hojas: [],
      getId: () => id,
      getName: () => nombre,
      getUrl: () => `https://docs.google.com/spreadsheets/d/${id}/edit`,
      getSheets: () => ss._hojas.slice(),
      getSheetByName: (n) => ss._hojas.find((h) => h.getName() === n) || null,
      insertSheet: (n) => { const h = crearHoja(ss, n); ss._hojas.push(h); return h; },
      deleteSheet: (h) => {
        if (ss._hojas.length === 1) throw new Error('No se puede borrar la única hoja');
        ss._hojas = ss._hojas.filter((x) => x !== h);
      },
      setActiveSheet: (h) => { ss._activa = h; return h; },
      moveActiveSheet: (pos) => {
        ss._hojas = ss._hojas.filter((x) => x !== ss._activa);
        ss._hojas.splice(pos - 1, 0, ss._activa);
      }
    };
    const p = crearEncadenable(ss);
    p.insertSheet('Hoja 1');
    archivos.set(id, { tipo: 'hoja', nombre, papelera: false, padres: ['raiz'], objeto: p });
    return p;
  }

  const SpreadsheetApp = {
    create: (n) => crearLibro(n),
    openById: (id) => {
      const a = archivos.get(id);
      if (!a || a.tipo !== 'hoja') throw new Error('No existe la hoja ' + id);
      return a.objeto;
    },
    flush: () => {},
    newDataValidation: () => crearEncadenable({ build: () => ({ validacion: true }) }),
    BorderStyle: { SOLID: 'SOLID' }
  };

  // ------------------------------------------------------------ Forms
  const ItemType = {
    TEXT: 'TEXT', PARAGRAPH_TEXT: 'PARAGRAPH_TEXT', MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
    CHECKBOX: 'CHECKBOX', PAGE_BREAK: 'PAGE_BREAK', SECTION_HEADER: 'SECTION_HEADER'
  };

  function crearItem(tipo) {
    const it = {
      _tipo: tipo, _titulo: '', _obligatoria: false, _opciones: [], _otro: false, _validacion: null, _ayuda: '',
      getType: () => tipo,
      getTitle: () => it._titulo,
      setTitle: (t) => { it._titulo = t; return p; },
      setHelpText: (t) => { it._ayuda = t; return p; },
      setRequired: (b) => { it._obligatoria = b; return p; },
      isRequired: () => it._obligatoria,
      setChoiceValues: (v) => { it._opciones = v.slice(); return p; },
      getChoices: () => it._opciones.map((v) => ({ getValue: () => v })),
      showOtherOption: (b) => { it._otro = b; return p; },
      setValidation: (v) => { it._validacion = v; return p; },
      createResponse: (v) => {
        if (tipo === ItemType.MULTIPLE_CHOICE && !it._opciones.includes(v) && !it._otro) throw new Error('Opción inválida: ' + v);
        if (tipo === ItemType.CHECKBOX && v.some((x) => !it._opciones.includes(x)) && !it._otro) throw new Error('Opción inválida');
        return { item: it, valor: v };
      },
      asTextItem: () => { if (tipo !== ItemType.TEXT) throw new Error('No es TEXT'); return p; },
      asParagraphTextItem: () => { if (tipo !== ItemType.PARAGRAPH_TEXT) throw new Error('No es PARAGRAPH'); return p; },
      asMultipleChoiceItem: () => { if (tipo !== ItemType.MULTIPLE_CHOICE) throw new Error('No es MC'); return p; },
      asCheckboxItem: () => { if (tipo !== ItemType.CHECKBOX) throw new Error('No es CHECKBOX'); return p; }
    };
    const p = crearEncadenable(it);
    return p;
  }

  function crearFormulario(titulo) {
    const id = nuevoId('form');
    const f = {
      _titulo: titulo, _items: [], _destino: null, _hojaDestino: null, _publicado: false, _respuestas: 0,
      getId: () => id,
      setTitle: (t) => { f._titulo = t; return p; },
      getPublishedUrl: () => `https://docs.google.com/forms/d/e/${id}/viewform`,
      getEditUrl: () => `https://docs.google.com/forms/d/${id}/edit`,
      shortenFormUrl: () => `https://forms.gle/${id}`,
      setPublished: (b) => { f._publicado = b; },
      getItems: (tipo) => f._items.filter((i) => !tipo || i.getType() === tipo),
      addTextItem: () => agregar(ItemType.TEXT),
      addParagraphTextItem: () => agregar(ItemType.PARAGRAPH_TEXT),
      addMultipleChoiceItem: () => agregar(ItemType.MULTIPLE_CHOICE),
      addCheckboxItem: () => agregar(ItemType.CHECKBOX),
      addPageBreakItem: () => agregar(ItemType.PAGE_BREAK),
      addSectionHeaderItem: () => agregar(ItemType.SECTION_HEADER),
      setDestination: (_t, ssId) => {
        const ss = SpreadsheetApp.openById(ssId);
        const h = ss.insertSheet('Respuestas de formulario 1');
        h._formUrl = `https://docs.google.com/forms/d/${id}/viewform`;
        const preguntas = f._items.filter((i) => ![ItemType.PAGE_BREAK, ItemType.SECTION_HEADER].includes(i.getType()));
        h.getRange(1, 1, 1, preguntas.length + 1).setValues([['Marca temporal', ...preguntas.map((i) => i.getTitle())]]);
        f._hojaDestino = h;
        return p;
      },
      createResponse: () => {
        const items = [];
        const r = {
          withItemResponse: (ir) => { items.push(ir); return r; },
          submit: () => {
            f._respuestas++;
            if (!f._hojaDestino) return;
            const h = f._hojaDestino;
            const cab = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
            const fila = cab.map(() => '');
            fila[0] = new Date(Date.UTC(2026, 10, 10, 12, 0, f._respuestas));
            for (const ir of items) {
              const c = cab.indexOf(ir.item._titulo);
              const v = Array.isArray(ir.valor) ? ir.valor.join(', ') : ir.valor;
              // Google Forms guarda las respuestas como texto, nunca como fórmula.
              fila[c] = typeof v === 'string' && v.startsWith('=') ? "'" + v : v;
            }
            h.getRange(h.getLastRow() + 1, 1, 1, fila.length).setValues([fila]);
          }
        };
        return r;
      }
    };
    function agregar(tipo) { const it = crearItem(tipo); f._items.push(it); return it; }
    const p = crearEncadenable(f);
    archivos.set(id, { tipo: 'form', nombre: titulo, papelera: false, padres: ['raiz'], objeto: p });
    return p;
  }

  const validador = () => crearEncadenable({ build: () => ({ validacion: true }) });
  const FormApp = {
    create: (t) => crearFormulario(t),
    openById: (id) => {
      const a = archivos.get(id);
      if (!a || a.tipo !== 'form') throw new Error('No existe el formulario ' + id);
      return a.objeto;
    },
    createTextValidation: validador,
    createParagraphTextValidation: validador,
    createCheckboxValidation: validador,
    ItemType,
    DestinationType: { SPREADSHEET: 'SPREADSHEET' }
  };

  // ------------------------------------------------------------ Otros servicios
  const iterador = (lista) => {
    let i = 0;
    return { hasNext: () => i < lista.length, next: () => lista[i++] };
  };
  const crearArchivoSuelto = (nombre, contenido, padre) => {
    const id = nuevoId('archivo');
    archivos.set(id, { tipo: 'archivo', nombre, papelera: false, padres: [padre], contenido });
    return { getUrl: () => `https://drive.google.com/file/d/${id}`, getId: () => id };
  };
  const crearCarpeta = (nombre) => {
    const id = nuevoId('carpeta');
    const c = { nombre, papelera: false, descripcion: '' };
    c.objeto = {
      getId: () => id,
      getName: () => nombre,
      getUrl: () => `https://drive.google.com/drive/folders/${id}`,
      isTrashed: () => c.papelera,
      setDescription: (d) => { c.descripcion = d; return c.objeto; },
      createFile: (n, contenido) => crearArchivoSuelto(n, contenido, id)
    };
    carpetas.set(id, c);
    return c.objeto;
  };
  const DriveApp = {
    getFileById: (id) => {
      const a = archivos.get(id);
      if (!a) throw new Error('No existe ' + id);
      return {
        setTrashed: (b) => { a.papelera = b; },
        isTrashed: () => a.papelera,
        getUrl: () => `https://drive.google.com/file/d/${id}`,
        moveTo: (carpeta) => { a.padres = [carpeta.getId()]; },
        getParents: () => iterador(a.padres.map((pid) => ({ getId: () => pid })))
      };
    },
    createFile: (nombre, contenido) => crearArchivoSuelto(nombre, contenido, 'raiz'),
    createFolder: (nombre) => crearCarpeta(nombre),
    getFolderById: (id) => {
      const c = carpetas.get(id);
      if (!c) throw new Error('No existe la carpeta ' + id);
      return c.objeto;
    },
    getFoldersByName: (nombre) => iterador([...carpetas.values()].filter((c) => c.nombre === nombre).map((c) => c.objeto))
  };

  const ScriptApp = {
    getProjectTriggers: () => disparadores.slice(),
    deleteTrigger: (t) => { disparadores.splice(disparadores.indexOf(t), 1); },
    newTrigger: (funcion) => {
      const t = { funcion, getHandlerFunction: () => funcion };
      const b = crearEncadenable({ create: () => { disparadores.push(t); return t; } });
      return b;
    }
  };

  const globales = {
    SpreadsheetApp,
    FormApp,
    DriveApp,
    ScriptApp,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (propiedades.has(k) ? propiedades.get(k) : null),
        setProperty: (k, v) => { propiedades.set(k, String(v)); }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      sleep: () => {},
      formatDate: (d) => d.toISOString().slice(0, 10)
    },
    Logger: { log: (m) => { registro.push(String(m)); } },
    Charts: { ChartType: { BAR: 'BAR', COLUMN: 'COLUMN', PIE: 'PIE' } },
    MimeType: { CSV: 'text/csv' }
  };

  return { globales, archivos, carpetas, registro, disparadores, propiedades };
}

