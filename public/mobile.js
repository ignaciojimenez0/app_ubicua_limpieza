// Nos conectamos al servidor
const servidor = window.io ? window.io() : io();

// Referenciamos nuestros botones y elementos de la interfaz
const botonMesa = document.getElementById('btn-trapo');
const botonSuelo = document.getElementById('btn-escoba');
const botonConfirmarMarca = document.getElementById('btn-confirmar-color');
const botonCalibrar = document.getElementById('btn-empezar-calibracion');
const botonFinalizar = document.getElementById('btn-terminar');
const textoEstado = document.getElementById('estado');
const textoInstruccion = document.getElementById('subestado');
const panelBotones = document.getElementById('botones-seleccion');

// Componentes para acceder a la cámara
const elementoVideo = document.getElementsByClassName('input_video')[0];
const elementoLienzo = document.getElementsByClassName('output_canvas')[0];
const brochaLienzo = elementoLienzo.getContext('2d');
const contenedorVideo = document.getElementById('video-container');

// Creamos un lienzo oculto para que OpenCV lea rápido sin fallos
const lienzoOculto = document.createElement('canvas');
const brochaOculta = lienzoOculto.getContext('2d', { willReadFrequently: true });

function obtenerImagenParaOpenCV() {
    if (!elementoVideo.videoWidth || !elementoVideo.videoHeight) return null;
    lienzoOculto.width = elementoVideo.videoWidth;
    lienzoOculto.height = elementoVideo.videoHeight;
    brochaOculta.drawImage(elementoVideo, 0, 0, lienzoOculto.width, lienzoOculto.height);
    try {
        return cv.imread(lienzoOculto);
    } catch (fallo) {
        console.error("OpenCV ha fallado al leer", fallo);
        return null;
    }
}

// Definimos nuestras fases de la aplicación
const FASES = {
    ELEGIR_MODO: 0,
    CAPTURAR_COLOR: 1,
    CALIBRAR_ESQUINAS: 2,
    LIMPIANDO: 3,
    TERMINADO: 4,
    PREPARAR_CAMARA: 5
};

let faseActual = FASES.ELEGIR_MODO;
let tipoLimpieza = null;
let asistenteHablando = false;
let temporizadorVoz = null;

// Guardamos dónde estamos para suavizar el movimiento
let posicionX = 50, posicionY = 50;
let ultimaXMandada = -1, ultimaYMandada = -1;

// Guardamos los puntos de nuestra habitación y su matemáticas
let esquinasGuardadas = [];
let contadorEsquinas = 0;
let formulaGeometria = null;
let podemosGuardarEsquina = true;

// Guardamos datos sobre el color de nuestra escoba
let colorBuscado = { minimo: [0, 0, 0], maximo: [255, 255, 255] };
let ultimoAvisoColor = 0;
let fotogramasAnalizados = 0;
let sumaColor = [0, 0, 0];
let estamosRegistrandoColor = false;

// Preparamos la inteligencia artificial para detectar manos (Modo Mesa)
const detectorManos = new window.Hands({ locateFile: (fichero) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${fichero}` });
detectorManos.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

// Hablamos al usuario para indicarle qué hacer
function comunicarPorVoz(frase) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        if (temporizadorVoz) clearTimeout(temporizadorVoz);

        let dictado = new SpeechSynthesisUtterance(frase);
        dictado.lang = 'es-ES';
        dictado.rate = 1.1;
        dictado.onstart = () => { asistenteHablando = true; };
        dictado.onend = () => {
            temporizadorVoz = setTimeout(() => { asistenteHablando = false; }, 2500);
        };
        window.speechSynthesis.speak(dictado);
    }
}

// Transformamos el punto de la cámara al punto real en la pantalla plana
function calcularCoordenadaReal(puntoX, puntoY) {
    if (!formulaGeometria) return { x: -1, y: -1 };

    let entrada = cv.matFromArray(1, 1, cv.CV_32FC2, [puntoX, puntoY]);
    let salida = new cv.Mat();
    cv.perspectiveTransform(entrada, salida, formulaGeometria);

    let valorX = salida.data32F[0];
    let valorY = salida.data32F[1];

    entrada.delete();
    salida.delete();

    return { x: valorX, y: valorY };
}

// Esperamos a que todo cargue para arrancar
function comprobarArranque() {
    if (window.cvLoaded && window.Hands) {
        textoEstado.innerText = "¿Qué modo usamos hoy?";
        textoInstruccion.innerText = "Suelo (Escoba) o Mesa (Trapo)";
        panelBotones.style.display = 'flex';
        encenderMicrofono();
    } else {
        setTimeout(comprobarArranque, 500);
    }
}
comprobarArranque();

// Preparamos el micrófono para escuchar comandos de voz desde la Aplicación Móvil
function encenderMicrofono() {
    const MotorDeVozMovil = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (MotorDeVozMovil) {
        const escuchadorMovil = new MotorDeVozMovil();
        escuchadorMovil.lang = 'es-ES';
        escuchadorMovil.continuous = true;

        // Analizamos lo que hemos escuchado y tomamos una decisión
        escuchadorMovil.onresult = (eventoVozMovil) => {
            if (asistenteHablando) return;
            let ordenEscuchadaMovil = eventoVozMovil.results[eventoVozMovil.results.length - 1][0].transcript.toLowerCase();

            if (faseActual === FASES.ELEGIR_MODO) {
                if (ordenEscuchadaMovil.includes('escoba') || ordenEscuchadaMovil.includes('suelo')) prepararEscoba();
                if (ordenEscuchadaMovil.includes('trapo') || ordenEscuchadaMovil.includes('mesa')) prepararMesa();
            }
            if (faseActual === FASES.PREPARAR_CAMARA) {
                if (ordenEscuchadaMovil.includes('empezar') || ordenEscuchadaMovil.includes('comenzar') || ordenEscuchadaMovil.includes('calibración') || ordenEscuchadaMovil.includes('listo')) {
                    empezarCalibrado();
                }
            }
            if (faseActual === FASES.CALIBRAR_ESQUINAS && tipoLimpieza === 'escoba') {
                if (ordenEscuchadaMovil.includes('calibra la esquina') || ordenEscuchadaMovil.includes('calibrar la esquina')) {
                    registrarPuntoVoz();
                }
            }
            if (faseActual === FASES.LIMPIANDO || faseActual === FASES.CALIBRAR_ESQUINAS) {
                if (ordenEscuchadaMovil.includes('terminar')) apagarYSalir();
            }
        };

        // Si el micrófono se apaga por inactividad, lo volvemos a encender
        escuchadorMovil.onend = () => {
            if (faseActual !== FASES.TERMINADO) escuchadorMovil.start();
        };

        // Encendemos el micrófono por primera vez
        escuchadorMovil.start();
    }
}

// Iniciamos la calibración diciéndoselo al usuario
function empezarCalibrado() {
    if (faseActual !== FASES.PREPARAR_CAMARA) return;
    botonCalibrar.style.display = 'none';
    faseActual = FASES.CALIBRAR_ESQUINAS;
    comunicarPorVoz("Coloca el objeto en la esquina Arriba Izquierda y di exactamente la orden: Calibra la esquina 1.");
    textoEstado.innerText = "Escoba: Arriba Izquierda (Movil en Vertical)";
    textoInstruccion.innerText = "Pon el color en la esquina y di 'Calibra la esquina 1'";
}

// Guardamos la esquina si detectamos el color al dar la orden
function registrarPuntoVoz() {
    let manchaEncontrada = buscarNuestroColor();
    if (manchaEncontrada) {
        guardarNuevasCoordenadas(manchaEncontrada.x, manchaEncontrada.y);
    } else {
        comunicarPorVoz("No detecto el color. Asegúrate de que se vea bien y repite la orden.");
    }
}

// Encendemos la cámara oficial con MediaPipe
let gestorCamara = null;
function iniciarVisorCamara() {
    panelBotones.style.display = 'none';
    document.getElementById('titulo').style.display = 'none';
    botonFinalizar.style.display = 'block';
    contenedorVideo.style.display = 'block';

    gestorCamara = new window.Camera(elementoVideo, {
        onFrame: analizarFotograma,
        width: 480, height: 640,
        facingMode: "environment"
    });
    gestorCamara.start().catch((fallo) => {
        textoEstado.innerText = "Error: Da permisos de cámara.";
        textoEstado.style.backgroundColor = "red";
    });
}

// Configuramos la aplicación para limpiar la mesa con los dedos
function prepararMesa() {
    tipoLimpieza = 'trapo';
    faseActual = FASES.CALIBRAR_ESQUINAS;
    contadorEsquinas = 0;
    esquinasGuardadas = [];
    comunicarPorVoz("Modo Trapo iniciado. Mantén el móvil en vertical. Sitúa tu mano en la esquina Arriba Izquierda y junta índice y pulgar.");
    textoEstado.innerText = "Trapo: Arriba Izquierda (Movil Vertical)";
    textoInstruccion.innerText = "Pon la mano en la esquina de la mesa y junta índice con pulgar.";
    iniciarVisorCamara();
}

// Configuramos la aplicación para registrar nuestra escoba
function prepararEscoba() {
    tipoLimpieza = 'escoba';
    faseActual = FASES.CAPTURAR_COLOR;
    fotogramasAnalizados = 0;
    sumaColor = [0, 0, 0];
    estamosRegistrandoColor = false;
    comunicarPorVoz("Modo Escoba. Acerca la marca de color al cuadro amarillo y pulsa confirmar.");
    textoEstado.innerText = "Escoba: Preparando Color";
    textoInstruccion.innerText = "Sitúa el color llamativo en el cuadro central y pulsa Confirmar Color.";
    botonConfirmarMarca.style.display = 'block';
    iniciarVisorCamara();
}

// Registramos el click de los botones
botonMesa.addEventListener('click', prepararMesa);
botonSuelo.addEventListener('click', prepararEscoba);
botonConfirmarMarca.addEventListener('click', () => {
    estamosRegistrandoColor = true;
    fotogramasAnalizados = 0;
    sumaColor = [0, 0, 0];
    botonConfirmarMarca.style.display = 'none';
    textoEstado.innerText = "Capturando... (mantén quieto)";
    textoInstruccion.innerText = "Procesando promedios de luz para no fallar luego";
    comunicarPorVoz("Capturando color. Mantén quieto un segundo.");
});
botonCalibrar.addEventListener('click', empezarCalibrado);
botonFinalizar.addEventListener('click', apagarYSalir);

// Detenemos la cámara y reiniciamos
function apagarYSalir() {
    faseActual = FASES.TERMINADO;
    comunicarPorVoz("Limpieza terminada.");
    if (gestorCamara) gestorCamara.stop();
    window.location.reload();
}

// Procesamos lo que vemos fotograma a fotograma
async function analizarFotograma() {
    if (elementoLienzo.width !== elementoVideo.videoWidth || elementoLienzo.height !== elementoVideo.videoHeight) {
        elementoLienzo.width = elementoVideo.videoWidth || 480;
        elementoLienzo.height = elementoVideo.videoHeight || 640;
    }

    brochaLienzo.save();
    brochaLienzo.clearRect(0, 0, elementoLienzo.width, elementoLienzo.height);

    if (faseActual === FASES.CAPTURAR_COLOR) {
        obtenerPromedioColor();
    }
    else if (faseActual === FASES.CALIBRAR_ESQUINAS) {
        if (tipoLimpieza === 'trapo') {
            await detectorManos.send({ image: elementoVideo });
        } else {
            let marcaEncontrada = buscarNuestroColor();
            if (marcaEncontrada) {
                brochaLienzo.beginPath();
                brochaLienzo.arc(marcaEncontrada.x, marcaEncontrada.y, 20, 0, 2 * Math.PI);
                brochaLienzo.fillStyle = 'cyan'; brochaLienzo.fill();
            }
        }
    }
    else if (faseActual === FASES.LIMPIANDO) {
        if (tipoLimpieza === 'trapo') {
            await detectorManos.send({ image: elementoVideo });
        } else {
            let puntoCentro = buscarNuestroColor();
            if (puntoCentro) {
                brochaLienzo.beginPath();
                brochaLienzo.arc(puntoCentro.x, puntoCentro.y, 20, 0, 2 * Math.PI);
                brochaLienzo.fillStyle = 'blue'; brochaLienzo.fill();

                mandarUbicacionAlServidor(puntoCentro.x, puntoCentro.y);
            }
        }
    }

    // Dibujamos unos puntitos verdes para saber qué esquinas hemos marcado ya
    if (formulaGeometria || esquinasGuardadas.length > 0) {
        brochaLienzo.fillStyle = 'lime';
        esquinasGuardadas.forEach(punto => {
            brochaLienzo.beginPath();
            brochaLienzo.arc(punto.x, punto.y, 10, 0, Math.PI * 2);
            brochaLienzo.fill();
        });
    }

    brochaLienzo.restore();
}

// Calculamos la media del color de algo brillante (la marca de la escoba) para que sea robusto
function obtenerPromedioColor() {
    let imagenLeida = obtenerImagenParaOpenCV();
    if (!imagenLeida || imagenLeida.cols === 0 || imagenLeida.rows === 0) {
        if (imagenLeida) imagenLeida.delete();
        return;
    }

    let medioX = imagenLeida.cols / 2;
    let medioY = imagenLeida.rows / 2;
    let tamanoCaja = 150;

    // Dibujamos un marco para ayudar a que el usuario apunte bien
    let guiX = elementoLienzo.width / 2;
    let guiY = elementoLienzo.height / 2;
    brochaLienzo.strokeStyle = 'yellow';
    brochaLienzo.lineWidth = 4;
    brochaLienzo.strokeRect(guiX - tamanoCaja / 2, guiY - tamanoCaja / 2, tamanoCaja, tamanoCaja);

    if (!estamosRegistrandoColor) {
        imagenLeida.delete();
        return;
    }

    // Recortamos el pedazo de imagen del centro
    let inicioX = Math.max(0, medioX - tamanoCaja / 2);
    let inicioY = Math.max(0, medioY - tamanoCaja / 2);
    let recorteAncho = Math.min(tamanoCaja, imagenLeida.cols - inicioX);
    let recorteAlto = Math.min(tamanoCaja, imagenLeida.rows - inicioY);

    if (recorteAncho <= 0 || recorteAlto <= 0) {
        imagenLeida.delete();
        return;
    }

    let rectanguloRecorte = new cv.Rect(inicioX, inicioY, recorteAncho, recorteAlto);
    let porcionImagen = imagenLeida.roi(rectanguloRecorte);

    let imagenColoresSaturados = new cv.Mat();
    cv.cvtColor(porcionImagen, imagenColoresSaturados, cv.COLOR_RGBA2RGB);
    cv.cvtColor(imagenColoresSaturados, imagenColoresSaturados, cv.COLOR_RGB2HSV);

    let promedio = cv.mean(imagenColoresSaturados);
    sumaColor[0] += promedio[0];
    sumaColor[1] += promedio[1];
    sumaColor[2] += promedio[2];
    fotogramasAnalizados++;

    // Si ya leímos suficientes veces (unos 15 frames), guardamos el color definitivo
    if (fotogramasAnalizados > 15) {
        let mediaMatiz = sumaColor[0] / fotogramasAnalizados;
        let mediaSaturacion = Math.max(30, (sumaColor[1] / fotogramasAnalizados) - 50);
        let mediaLuz = Math.max(30, (sumaColor[2] / fotogramasAnalizados) - 50);

        let margenMatiz = 20;
        colorBuscado.minimo = [Math.max(0, mediaMatiz - margenMatiz), mediaSaturacion, mediaLuz, 0];
        colorBuscado.maximo = [Math.min(180, mediaMatiz + margenMatiz), 255, 255, 255];

        estamosRegistrandoColor = false;
        faseActual = FASES.PREPARAR_CAMARA;
        comunicarPorVoz("Color registrado. Coloca el teléfono en VERTICAL enfocando al suelo. Di exactamente la orden: Empezar calibración.");
        textoEstado.innerText = "Posicionando cámara (Vertical)";
        textoInstruccion.innerText = "Coloca el móvil y di 'Empezar calibración'";
        botonCalibrar.style.display = 'block';
    }

    imagenLeida.delete(); porcionImagen.delete(); imagenColoresSaturados.delete();
}

// Encontramos nuestra escoba buscando el color en la imagen entera
function buscarNuestroColor() {
    let imagenTotal = obtenerImagenParaOpenCV();
    if (!imagenTotal) return null;
    let matrizSaturada = new cv.Mat();
    cv.cvtColor(imagenTotal, matrizSaturada, cv.COLOR_RGBA2RGB);
    cv.cvtColor(matrizSaturada, matrizSaturada, cv.COLOR_RGB2HSV);

    let valorDebajo = new cv.Mat(matrizSaturada.rows, matrizSaturada.cols, matrizSaturada.type(), colorBuscado.minimo);
    let valorArriba = new cv.Mat(matrizSaturada.rows, matrizSaturada.cols, matrizSaturada.type(), colorBuscado.maximo);
    let mascaraFiltro = new cv.Mat();

    cv.inRange(matrizSaturada, valorDebajo, valorArriba, mascaraFiltro);

    let manchas = new cv.MatVector();
    let esquema = new cv.Mat();
    cv.findContours(mascaraFiltro, manchas, esquema, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    // Nos quedamos con la mancha más grande que tenga el color
    let areaMasGrande = 0, manchaGanadora = -1;
    for (let j = 0; j < manchas.size(); ++j) {
        let area = cv.contourArea(manchas.get(j));
        if (area > areaMasGrande) { areaMasGrande = area; manchaGanadora = j; }
    }

    let resultadoFinal = null;
    if (manchaGanadora !== -1 && areaMasGrande > 200) {
        let centroCalculado = cv.moments(manchas.get(manchaGanadora));
        let posCentroX = centroCalculado.m10 / centroCalculado.m00;
        let posCentroY = centroCalculado.m01 / centroCalculado.m00;
        resultadoFinal = { x: posCentroX, y: posCentroY };
    }

    imagenTotal.delete(); matrizSaturada.delete(); valorDebajo.delete(); valorArriba.delete(); mascaraFiltro.delete(); manchas.delete(); esquema.delete();
    return resultadoFinal;
}

const listaNombresEsquinas = ["Arriba Izquierda", "Arriba Derecha", "Abajo Derecha", "Abajo Izquierda"];

// Guardamos cada esquina una a una evitando rebotes (que guarde dos seguidas)
async function guardarNuevasCoordenadas(puntoRealX, puntoRealY) {
    if (Date.now() - ultimoAvisoColor < 1500) return;
    esquinasGuardadas.push({ x: puntoRealX, y: puntoRealY });
    contadorEsquinas++;

    // Dibujamos un parpadeo blanco para dar aviso visual 
    brochaLienzo.beginPath(); brochaLienzo.arc(puntoRealX, puntoRealY, 40, 0, Math.PI * 2);
    brochaLienzo.fillStyle = 'white'; brochaLienzo.fill();

    if (contadorEsquinas < 4) {
        let tituloSiguiente = listaNombresEsquinas[contadorEsquinas];
        if (tipoLimpieza === 'escoba') {
            const numeroOrden = contadorEsquinas + 1;
            comunicarPorVoz(`Pon el objeto en la esquina ${tituloSiguiente} y di exactamente la orden: Calibra la esquina ${numeroOrden}.`);
            textoEstado.innerText = `Calibrando: ${tituloSiguiente} (Paso ${numeroOrden})`;
            textoInstruccion.innerText = `Di 'Calibra la esquina ${numeroOrden}'`;
        } else {
            comunicarPorVoz(`Esquina registrada. Ve a la esquina ${tituloSiguiente}`);
            textoEstado.innerText = `Calibración: ${tituloSiguiente}`;
            textoInstruccion.innerText = "Mantén el móvil vertical y junta los dedos";
        }
    } else {
        // Cuando tenemos las cuatro, calculamos el cuadrado gigante (La transformada de la perspectiva)
        comunicarPorVoz("Calibración completada. Puedes empezar a limpiar.");
        faseActual = FASES.LIMPIANDO;
        textoEstado.innerText = "MODO ACTIVO: LIMPIANDO";
        textoInstruccion.innerText = "";

        let esquinasOrigen = [];
        esquinasGuardadas.forEach(p => { esquinasOrigen.push(p.x, p.y) });
        let esquinasDestino = [0, 0, 100, 0, 100, 100, 0, 100];

        let matrizOrigen = cv.matFromArray(4, 1, cv.CV_32FC2, esquinasOrigen);
        let matrizDestino = cv.matFromArray(4, 1, cv.CV_32FC2, esquinasDestino);
        formulaGeometria = cv.getPerspectiveTransform(matrizOrigen, matrizDestino);

        matrizOrigen.delete(); matrizDestino.delete();
    }
    ultimoAvisoColor = Date.now();
}

// MediaPipe rastrea nuestras manos (Para modo Trapo)
detectorManos.onResults((trazado) => {
    if (!trazado.multiHandLandmarks || trazado.multiHandLandmarks.length === 0) return;

    let palma = trazado.multiHandLandmarks[0];
    let manoX = palma[9].x * elementoLienzo.width;
    let manoY = palma[9].y * elementoLienzo.height;

    if (faseActual === FASES.CALIBRAR_ESQUINAS && tipoLimpieza === 'trapo') {
        const dedoGordo = palma[4];
        const dedoIndice = palma[8];
        let distanciaDedos = Math.hypot(dedoGordo.x - dedoIndice.x, dedoGordo.y - dedoIndice.y);

        brochaLienzo.beginPath(); brochaLienzo.arc(manoX, manoY, 20, 0, Math.PI * 2);
        brochaLienzo.fillStyle = (distanciaDedos < 0.05) ? 'yellow' : 'cyan'; brochaLienzo.fill();

        // Si los juntamos mucho, guardamos esquina
        if (distanciaDedos < 0.05) {
            if (podemosGuardarEsquina) {
                podemosGuardarEsquina = false;
                guardarNuevasCoordenadas(manoX, manoY);
            }
        } else {
            podemosGuardarEsquina = true;
        }
    }
    else if (faseActual === FASES.LIMPIANDO && tipoLimpieza === 'trapo') {
        brochaLienzo.beginPath(); brochaLienzo.arc(manoX, manoY, 25, 0, Math.PI * 2);
        brochaLienzo.fillStyle = '#ff8800'; brochaLienzo.fill();
        mandarUbicacionAlServidor(manoX, manoY);
    }
});

// Empaquetamos nuestra posición y se la pasamos a la pantalla grande
function mandarUbicacionAlServidor(lugarX, lugarY) {
    if (!formulaGeometria) return;

    let calculadoFinal = calcularCoordenadaReal(lugarX, lugarY);
    let valorXRecto = calculadoFinal.x;
    let valorYRecto = calculadoFinal.y;

    // Quitamos picos locos (Si nos salimos, no pintamos)
    if (valorXRecto < -5 || valorXRecto > 105 || valorYRecto < -5 || valorYRecto > 105) return;

    // Con suavizado evitamos que salte mucho si cerramos la mano o perdemos la escoba de vista
    const filtroSuave = 0.6;
    posicionX = posicionX * (1 - filtroSuave) + valorXRecto * filtroSuave;
    posicionY = posicionY * (1 - filtroSuave) + valorYRecto * filtroSuave;

    // Evitamos saturar el socket enviando datos si no nos hemos movido casi
    if (Math.abs(posicionX - ultimaXMandada) > 0.1 || Math.abs(posicionY - ultimaYMandada) > 0.1) {
        servidor.emit('mover_escoba', { x: posicionX, y: posicionY });
        ultimaXMandada = posicionX; ultimaYMandada = posicionY;
    }
}

// Mostramos la interfaz de hacer fotos cuando nos lo piden
servidor.on('peticion_foto', () => {
    document.getElementById('controles-principales').style.display = 'none';
    document.getElementById('panel-camara').style.display = 'block';
});

// Reiniciamos si la pantalla acaba la limpieza
servidor.on('reiniciar_movil', () => {
    if (faseActual === FASES.LIMPIANDO || faseActual === FASES.CALIBRAR_ESQUINAS || faseActual === FASES.CAPTURAR_COLOR) {
        apagarYSalir();
    }
});

// Enviamos la foto que echamos
document.getElementById('input-camara').addEventListener('change', function (eventoSacaFoto) {
    const imagenCapturada = eventoSacaFoto.target.files[0];
    if (!imagenCapturada) return;

    document.getElementById('estado-envio').innerText = "Procesando foto...";

    const lectorDigital = new FileReader();
    lectorDigital.onload = function (eventoProcesado) {
        const fotoTemporal = new Image();
        fotoTemporal.onload = function () {
            const limiteAncho = 400;
            const factorEscala = limiteAncho / fotoTemporal.width;
            const lienzoFoto = document.createElement('canvas');
            lienzoFoto.width = limiteAncho;
            lienzoFoto.height = fotoTemporal.height * factorEscala;

            const brochaFoto = lienzoFoto.getContext('2d');
            brochaFoto.drawImage(fotoTemporal, 0, 0, lienzoFoto.width, lienzoFoto.height);

            servidor.emit('enviar_foto', lienzoFoto.toDataURL('image/jpeg', 0.6));
            document.getElementById('estado-envio').innerText = "✅ ¡Foto enviada!";

            setTimeout(() => {
                document.getElementById('panel-camara').style.display = 'none';
                document.getElementById('controles-principales').style.display = 'flex';
            }, 2000);
        }
        fotoTemporal.src = eventoProcesado.target.result;
    }
    lectorDigital.readAsDataURL(imagenCapturada);
});
