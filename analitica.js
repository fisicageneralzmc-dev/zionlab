/* ZionLab: analítica de visitas y actividad, sin datos personales. */
(() => {
  'use strict';
  if (window.__zionlabAnalitica) return;
  window.__zionlabAnalitica = true;
  const script = document.currentScript;
  const pagina = script && script.dataset.pagina;
  if (!/^(inicio|sim[1-7])$/.test(pagina || '')) return;
  const endpoint = 'https://script.google.com/macros/s/AKfycbxKCa24ubesWhijow_uQxsX8V_i6nKdnsUeOAB5l3nStXXRH8xWxICGI5hvtDEqVClA/exec';
  const uid = () => {
    if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'zl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  };
  let sesion;
  try {
    sesion = sessionStorage.getItem('zionlab_sesion_v1');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(sesion || '')) {
      sesion = uid();
      sessionStorage.setItem('zionlab_sesion_v1', sesion);
    }
  } catch (_) { sesion = uid(); }
  const visita = uid();
  let activoMs = 0;
  let anterior = performance.now();
  let ultimaInteraccion = anterior;
  let suspendido = false;
  let salidaEnviada = false;
  let ultimoTiempoActividad = 0;
  function actualizar() {
    const ahora = performance.now();
    if (!suspendido && document.visibilityState === 'visible' && document.hasFocus()) {
      // Máximo 60 s sin interacción; ignora saltos largos por suspensión del equipo.
      if (ahora - anterior <= 10000) {
        activoMs += Math.max(0, Math.min(ahora, ultimaInteraccion + 60000) - anterior);
      }
    }
    anterior = ahora;
  }
  function enviar(evento, alSalir = false, detalle = {}) {
    actualizar();
    const segundos = Math.min(604800, Math.floor(activoMs / 1000));
    if (evento === 'actividad') {
      if (segundos <= ultimoTiempoActividad) return;
      ultimoTiempoActividad = segundos;
      detalle = {
        accion: 'Actualizar tiempo de uso',
        control: nombresLaboratorio[pagina],
        valorNuevo: String(segundos), unidad: 's',
        detalle: 'Tiempo activo acumulado de esta visita; no sumar entre filas.',
        ...detalle
      };
    } else if (evento === 'salida') {
      detalle = {
        accion: 'Salir de la página', control: nombresLaboratorio[pagina],
        valorNuevo: String(segundos), unidad: 's',
        detalle: 'Tiempo activo acumulado al salir de esta visita.', ...detalle
      };
    }
    const cuerpo = JSON.stringify({
      idEvento: uid(), sesion, visita, pagina, evento,
      segundosActivos: segundos, ...detalle
    });
    if (alSalir && navigator.sendBeacon) {
      try {
        if (navigator.sendBeacon(endpoint, new Blob([cuerpo], {type: 'text/plain;charset=UTF-8'}))) return;
      } catch (_) { /* Continúa con fetch. */ }
    }
    // text/plain evita la solicitud previa CORS. La respuesta opaca no confirma la recepción.
    try {
      fetch(endpoint, {
        method: 'POST', mode: 'no-cors', credentials: 'omit',
        headers: {'Content-Type': 'text/plain;charset=UTF-8'},
        body: cuerpo, keepalive: true, referrerPolicy: 'no-referrer'
      }).catch(() => {});
    } catch (_) { /* La analítica nunca interrumpe el simulador. */ }
  }
  ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'].forEach(tipo => {
    window.addEventListener(tipo, () => {
      actualizar(); ultimaInteraccion = performance.now();
    }, {passive: true, capture: true});
  });
  document.addEventListener('visibilitychange', () => {
    actualizar();
    if (document.visibilityState === 'hidden') enviar('actividad', true);
    else { anterior = performance.now(); ultimaInteraccion = anterior; }
  });
  window.addEventListener('blur', actualizar);
  window.addEventListener('focus', () => {
    anterior = performance.now(); ultimaInteraccion = anterior;
  });
  window.addEventListener('pagehide', () => {
    if (!salidaEnviada) { enviar('salida', true); salidaEnviada = true; }
    suspendido = true;
  });
  window.addEventListener('pageshow', e => {
    if (e.persisted) {
      suspendido = false; salidaEnviada = false;
      anterior = performance.now(); ultimaInteraccion = anterior;
    }
  });
  setInterval(actualizar, 1000);
  setInterval(() => {
    if (!suspendido && document.visibilityState === 'visible') enviar('actividad');
  }, 60000);
  // Instrumentación detallada solo para Sim 1; no modifica sus cálculos.
  if (pagina === 'sim1') {
    const campos = [
      ['cartMass', 'Masa del carro', 'g'],
      ['hangMass', 'Masa suspendida', 'g'],
      ['angle', 'Ángulo de rampa', '°'],
      ['friction', 'Coeficiente de rozamiento', ''],
      ['distance', 'Distancia', 'm'],
      ['gravity', 'Gravedad', 'm/s²']
    ];
    const porId = id => document.getElementById(id);
    const estado = () => Object.fromEntries(campos.map(([id]) => [id, porId(id).value]).concat([
      ['montaje', porId('pullUp').checked ? 'Polea arriba' : 'Polea abajo']
    ]));
    let previo = estado();
    const registrar = (accion, control, extra = {}) => enviar('interaccion', false, {
      accion, control, ...extra
    });
    function cambios() {
      const actual = estado();
      campos.concat([['montaje', 'Montaje de polea', '']]).forEach(([id, nombre, unidad]) => {
        if (actual[id] !== previo[id]) registrar('cambio_magnitud_opcion', nombre, {
          valorAnterior: previo[id], valorNuevo: actual[id], unidad
        });
      });
      previo = actual;
    }
    document.addEventListener('change', e => {
      if (campos.some(([id]) => [id, id + 'Manual', id + 'Slider'].includes(e.target.id)) ||
          ['pullUp', 'pullDown'].includes(e.target.id)) cambios();
      if (e.target.id === 'labMenu' && e.target.value) {
        registrar('seleccionar_simulador', 'Menú de laboratorios', {
          valorNuevo: e.target.selectedOptions[0].textContent.trim()
        });
      }
    }, true);
    // Diales: registra al soltar el puntero o finalizar una pulsación de teclado.
    ['angleDial', 'frictionDial'].forEach(id => {
      porId(id).addEventListener('pointerup', cambios);
      porId(id).addEventListener('pointercancel', cambios);
      porId(id).addEventListener('keyup', cambios);
    });
    const botones = {
      startBtn: ['boton', 'Iniciar'], pauseBtn: ['boton', 'Pausar'],
      resetBtn: ['boton', 'Restablecer'],
      graphsTab: ['cambiar_pestana', 'Gráficas'], dataTab: ['cambiar_pestana', 'Datos'],
      themeBtn: ['boton', 'Cambiar modo claro/oscuro'],
      exportBtn: ['solicitar_descarga', 'Descargar CSV']
    };
    function comprobar() {
      const respuesta = porId('studentAcceleration').value;
      const feedback = porId('calcFeedback');
      registrar('comprobar_calculo', 'Aceleración calculada', {
        valorNuevo: respuesta, unidad: 'm/s²',
        resultado: feedback.classList.contains('ok') ? 'Correcto' :
          (!respuesta.trim() || Number(respuesta) < 0 ? 'Entrada inválida' : 'Revisar'),
        detalle: feedback.textContent.trim()
      });
    }
    document.addEventListener('click', e => {
      const boton = e.target.closest('button');
      if (boton && !boton.disabled) {
        cambios();
        if (botones[boton.id]) {
          const [accion, control] = botones[boton.id];
          registrar(accion, control, {
            detalle: boton.id === 'startBtn' ? JSON.stringify(estado()) : ''
          });
        }
        if (boton.id === 'resetBtn') setTimeout(() => { previo = estado(); }, 0);
        if (boton.id === 'checkBtn') setTimeout(comprobar, 0);
      }
      const enlace = e.target.closest('a');
      if (enlace && enlace.getAttribute('href') === 'index.html') registrar('navegar', 'Inicio');
    }, true);
    porId('studentAcceleration').addEventListener('keydown', e => {
      if (e.key === 'Enter') setTimeout(comprobar, 0);
    });
  }
  // Controles y resultados propios de SIM 2–7.
  if (/^sim[2-7]$/.test(pagina)) {
    const configuraciones = {
      sim2: {
        campos: [['height','Altura inicial','m'],['angle','Ángulo de lanzamiento','°'],['speed','Velocidad inicial','m/s'],['wallDistance','Distancia de pared','m'],['gravity','Gravedad','m/s²']],
        opciones: [['wallOn','Pared activada','radio']],
        pruebas: {checkBtn:['studentTime','Tiempo de impacto calculado','s','calcFeedback']}
      },
      sim3: {
        campos: [['barMassManual','Masa de barra','kg'],['barTmaxManual','Tensión máxima de cables de barra','N'],['x1','Posición cable 1','m'],['x2','Posición cable 2','m'],['g1','Gravedad de barra','m/s²'],['blockMassManual','Masa de bloque','kg'],['blockTmaxManual','Tensión máxima de cables de bloque','N'],['theta1','Ángulo cable 1','°'],['theta2','Ángulo cable 2','°'],['g2','Gravedad de bloque','m/s²']],
        pruebas: {checkBarCalcBtn:['barStudentT1','Tensión T₁ de barra','N','barCalcResult'],checkBlockCalcBtn:['blockStudentT1','Tensión T₁ de bloque','N','blockCalcResult'],testBarBtn:[null,'Equilibrio de barra','','barFeedback'],releaseBtn:[null,'Equilibrio de bloque','','blockFeedback']}
      },
      sim4: {
        campos: [['mass','Masa','kg'],['speed','Velocidad tangencial','m/s'],['radius','Radio','m'],['limitNum','Fuerza máxima admisible','N']],
        pruebas: {testBtn:['studentFc','Fuerza centrípeta calculada','N','feedback']}
      },
      sim5: {
        campos: [['mass','Masa de carga','kg'],['height','Altura','m'],['time','Tiempo de elevación','s'],['g','Gravedad','m/s²']],
        pruebas: {start:['answer','Potencia calculada','W','feedback']}
      },
      sim6: {
        campos: [['m','Masa del carrito','kg'],['l','Longitud de rampa','m'],['d','Distancia al resorte','m'],['k','Constante del resorte','N/m'],['mu','Coeficiente de rozamiento',''],['a','Ángulo de rampa','°']],
        opciones: [['graphTrial','Ensayo de la gráfica','select']],
        pruebas: {start:['ans','Compresión calculada','m','feed']}
      },
      sim7: {
        campos: [['M','Masa de plataforma','kg'],['m','Masa de carga','kg'],['R','Radio de plataforma','m'],['r','Posición radial de carga','m'],['F','Fuerza tangencial','N'],['b','Brazo de palanca','m'],['time','Tiempo de aplicación','s'],['barL','Longitud de barra','m'],['m1','Masa izquierda','kg'],['x1','Posición izquierda','m'],['m2','Masa derecha','kg'],['x2','Posición derecha','m']],
        opciones: [['geometry','Geometría','select']],
        pruebas: {start:['answer','Resultado calculado',null,'feed']}
      }
    };
    const cfg = configuraciones[pagina];
    const elemento = id => document.getElementById(id);
    const emitir = (accion, control, extra = {}) => enviar('interaccion', false, {accion, control, ...extra});
    const limpiar = texto => String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 150);
    function fotografia() {
      const valores = {};
      cfg.campos.forEach(([id, nombre, unidad]) => {
        const el = elemento(id);
        if (el) valores[id] = {nombre, unidad, valor: el.value};
      });
      (cfg.opciones || []).forEach(([id, nombre, tipo]) => {
        const el = elemento(id);
        if (el) valores[id] = {nombre, unidad:'', valor: tipo === 'radio' ? (el.checked ? 'Sí' : 'No') : limpiar(el.selectedOptions[0]?.textContent || el.value)};
      });
      if (pagina === 'sim3') {
        document.querySelectorAll('[data-load]').forEach(fila => {
          const indice = fila.dataset.load;
          [['.load-mass','Masa de pesa','kg'],['.load-x','Posición de pesa','m']].forEach(([selector,nombre,unidad]) => {
            const el=fila.querySelector(selector);
            if(el) valores['pesa_'+indice+selector]={nombre:nombre+' '+(Number(indice)+1),unidad,valor:el.value};
          });
        });
      }
      return valores;
    }
    let anteriorDetalle = fotografia();
    function registrarCambios() {
      const actual = fotografia();
      for (const [id, dato] of Object.entries(actual)) {
        const previo = anteriorDetalle[id];
        if (previo && previo.valor !== dato.valor) emitir('cambio_magnitud_opcion',dato.nombre,{valorAnterior:previo.valor,valorNuevo:dato.valor,unidad:dato.unidad});
      }
      anteriorDetalle = actual;
    }
    function resultadoPrueba(id, respuestaCapturada) {
      const spec=cfg.pruebas[id];
      if(!spec) return;
      const [entrada,nombre,unidad,feedbackId]=spec;
      const feedback=elemento(feedbackId);
      if(!feedback) return;
      const texto=limpiar(feedback.textContent);
      const invalida = entrada && (respuestaCapturada === '' || !Number.isFinite(Number(respuestaCapturada)));
      const correcto=feedback.classList.contains('ok') || feedback.classList.contains('success');
      const resultado=invalida?'Entrada inválida':correcto?'Correcto':/primero|válid[ao]/i.test(texto)?'Entrada inválida':'Revisar';
      emitir('comprobar_calculo', nombre, {
        valorNuevo: entrada ? respuestaCapturada : '',
        unidad: unidad === null ? limpiar(elemento('answerUnit')?.textContent) : unidad,
        resultado, detalle: feedback.textContent.trim().slice(0,1500)
      });
    }
    document.addEventListener('change', e => {
      if(e.target.id === 'labMenu' && e.target.value) {
        emitir('seleccionar_simulador','Menú de laboratorios',{valorNuevo:limpiar(e.target.selectedOptions[0]?.textContent)});
        return;
      }
      if(e.target.matches('input,select')) setTimeout(registrarCambios,0);
    },true);
    // Los diales actualizan sus inputs mediante código; se lee el valor final.
    document.querySelectorAll('[id$="Dial"]').forEach(dial => {
      ['pointerup','pointercancel','keyup'].forEach(tipo => dial.addEventListener(tipo,()=>setTimeout(registrarCambios,0)));
    });
    document.addEventListener('click', e => {
      const boton=e.target.closest('button');
      if(boton && !boton.disabled) {
        registrarCambios();
        const id=boton.id || '';
        const nombre=limpiar(boton.getAttribute('aria-label') || boton.getAttribute('title') || boton.textContent || id);
        const respuesta=cfg.pruebas[id]?.[0] ? elemento(cfg.pruebas[id][0])?.value : '';
        const esModo=/mode/i.test(id);
        const accion=/export/i.test(id)?'solicitar_descarga':/tab/i.test(id)?'cambiar_pestana':esModo?'seleccionar_opcion':boton.classList.contains('preset')?'seleccionar_valor_predefinido':boton.classList.contains('remove-load')?'eliminar_pesa':id==='addLoadBtn'?'agregar_pesa':'boton';
        const fila=boton.closest('[data-load]');
        emitir(accion,nombre,{
          valorNuevo:esModo?nombre:boton.dataset.m || '',
          unidad:boton.dataset.m?'kg':'',
          detalle:fila?'Pesa '+(Number(fila.dataset.load)+1):JSON.stringify(Object.fromEntries(Object.values(anteriorDetalle).map(x=>[x.nombre,x.valor+(x.unidad?' '+x.unidad:'')]))).slice(0,1500)
        });
        setTimeout(()=>{
          resultadoPrueba(id,respuesta);
          if(/reset|mode/i.test(id) || boton.classList.contains('remove-load') || id==='addLoadBtn') anteriorDetalle=fotografia();
          else registrarCambios();
        },0);
      }
      const enlace=e.target.closest('a');
      if(enlace && enlace.getAttribute('href')==='index.html') emitir('navegar','Inicio',{valorNuevo:'Inicio ZionLab'});
    },true);
    // Comprobaciones que el simulador permite ejecutar mediante Enter.
    for(const [id,spec] of Object.entries(cfg.pruebas)) {
      const input=spec[0] && elemento(spec[0]);
      if(input && ['sim2','sim3'].includes(pagina)) input.addEventListener('keydown',e=>{
        if(e.key==='Enter') {const respuesta=input.value;setTimeout(()=>resultadoPrueba(id,respuesta),0);}
      });
    }
  }
  const nombresLaboratorio = {
    inicio: 'Inicio ZionLab',
    sim1: 'SIM 1 · Análisis Dinámico del Móvil',
    sim2: 'SIM 2 · Zona de Impacto',
    sim3: 'SIM 3 · Equilibrio con cables',
    sim4: 'SIM 4 · Fuerza centrípeta en acción',
    sim5: 'SIM 5 · Elevador de Carga',
    sim6: 'SIM 6 · Sistema de Amortiguación',
    sim7: 'SIM 7 · Plataforma de Clasificación'
  };
  enviar('visita', false, {
    accion: 'ingresar', control: 'Laboratorio o página',
    valorNuevo: nombresLaboratorio[pagina]
  });
})();
