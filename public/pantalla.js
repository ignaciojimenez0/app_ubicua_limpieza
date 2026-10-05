// Conectamos con el servidor
const conexion = io();

// Guardamos la última posición por donde hemos pasado para poder dibujar el trazo
let ultimaPosicionX = null;
let ultimaPosicionY = null;

// Creamos un cursor visual (un puntito rojo) para saber dónde estamos limpiando
const puntoEscoba = document.createElement('div');
puntoEscoba.id = 'cursor-escoba';
puntoEscoba.style.position = 'absolute';
puntoEscoba.style.width = '18px';
puntoEscoba.style.height = '18px';
puntoEscoba.style.backgroundColor = '#ff3b30';
puntoEscoba.style.border = '2px solid white';
puntoEscoba.style.borderRadius = '50%';
puntoEscoba.style.transform = 'translate(-50%, -50%)';
puntoEscoba.style.pointerEvents = 'none';
puntoEscoba.style.zIndex = '1000';
puntoEscoba.style.boxShadow = '0 2px 6px rgba(0,0,0,0.5)';
puntoEscoba.style.display = 'none';
puntoEscoba.style.transition = 'left 0.05s linear, top 0.05s linear';
document.body.appendChild(puntoEscoba);

// Agrupamos las vistas para acceder a ellas fácilmente
const pantallas = {
    menuPrincipal: document.getElementById('vista-menu'),
    pantallaLimpieza: document.getElementById('vista-limpieza'),
    pantallaResultados: document.getElementById('vista-resultados'),
    pantallaAnalisis: document.getElementById('vista-analisis')
};

// Referenciamos botones e indicadores del menú
const botonRecomendacion = document.getElementById('btn-recomendacion');
const indicadorRacha = document.getElementById('texto-racha');

// Controlamos el estado actual de nuestra aplicación
let habitacionElegida = 'salon';
let queremosRecomendacion = false;
let estamosLimpiando = false;
let asistenteHablando = false;
let temporizadorVoz = null;

// Preparamos nuestro lienzo donde vamos a representar la limpieza
const lienzoSuelo = document.getElementById('piso');
const contextoLienzo = lienzoSuelo.getContext('2d');
const textoProgreso = document.getElementById('indicador-progreso');

// Controlamos qué porcentajes se han alcanzado y avisado al usuario
let porcentajesAvisados = new Set();
let marcosDibujados = 0;

// Configuramos nuestro cronómetro y sistema de rachas
let tiempoTranscurrido = 0;
let reloj = null;
let relojEnMarcha = false;
let rachaGanadora = parseInt(localStorage.getItem('rachaLimpieza')) || 0;

// Cargamos la racha de victorias al iniciar
indicadorRacha.innerText = `🔥 Racha: ${rachaGanadora} limpiezas`;

// Cambiamos de pantalla ocultando todas y mostrando solo la que queremos
function mostrarPantalla(nombrePantalla) {
    Object.values(pantallas).forEach(pantalla => pantalla.classList.remove('activa'));
    pantallas[nombrePantalla].classList.add('activa');
}

// Escogemos qué habitación vamos a limpiar y actualizamos los botones
window.seleccionarZona = function (identificadorZona) {
    document.querySelectorAll('.opcion-zona').forEach(elemento => {
        if (elemento.id.startsWith('zona-')) elemento.classList.remove('activa');
    });
    document.getElementById(`zona-${identificadorZona}`).classList.add('activa');
    habitacionElegida = identificadorZona;
};

// Activamos o desactivamos la ayuda para elegir producto
window.toggleRecomendacion = function () {
    queremosRecomendacion = !queremosRecomendacion;
    botonRecomendacion.innerText = queremosRecomendacion ? "💡 Recomendación: ACTIVADA" : "💡 Recomendación: DESACTIVADA";
    botonRecomendacion.style.borderColor = queremosRecomendacion ? "#2ecc71" : "transparent";
};

// Empezamos la partida, pidiendo foto si queremos recomendación o yendo directo a limpiar
window.iniciarLimpieza = function () {
    if (queremosRecomendacion) {
        mostrarPantalla('pantallaAnalisis');
        conexion.emit('solicitar_foto');
        comunicarPorVoz("Por favor, manda una foto del suelo desde tu dispositivo móvil.");
    } else {
        document.getElementById('tarjeta-producto').style.display = 'none';
        comenzarAccionLimpieza();
    }
};

// Configuramos nuestro lienzo y cronómetro para ponernos a limpiar
window.comenzarAccionLimpieza = function (productoSugerido = null) {
    mostrarPantalla('pantallaLimpieza');
    estamosLimpiando = true;

    // Si nos han sugerido un producto, lo mostramos y lo anunciamos
    if (productoSugerido) {
        document.getElementById('producto-img').src = productoSugerido.img;
        document.getElementById('producto-titulo').innerText = productoSugerido.titulo;
        document.getElementById('producto-desc').innerText = productoSugerido.desc;
        document.getElementById('tarjeta-producto').style.display = 'flex';
        comunicarPorVoz(`Comenzando limpieza de ${habitacionElegida}. Te recomiendo usar ${productoSugerido.titulo}. `);
    } else {
        comunicarPorVoz(`Comenzando limpieza de ${habitacionElegida}. Recuerda usar la escoba.`);
    }

    // Ensuciamos el suelo para poder iniciar la limpieza
    ensuciarLienzo();

    // Reiniciamos contadores y avisos
    porcentajesAvisados.clear();
    marcosDibujados = 0;
    textoProgreso.innerText = `0% Limpio`;

    // Ponemos en marcha nuestro cronómetro
    document.getElementById('indicador-tiempo').style.display = 'block';
    tiempoTranscurrido = 0;
    refrescarReloj();

    // Paramos el tiempo hasta que hagamos el primer movimiento
    clearInterval(reloj);
    relojEnMarcha = false;
};

// Ponemos el tiempo en formato minutos y segundos
function refrescarReloj() {
    const minutos = Math.floor(tiempoTranscurrido / 60).toString().padStart(2, '0');
    const segundos = (tiempoTranscurrido % 60).toString().padStart(2, '0');
    document.getElementById('indicador-tiempo').innerText = `${minutos}:${segundos}`;
}

// Terminamos de limpiar, paramos el reloj y revisamos si hemos batido un récord
window.terminarLimpieza = function () {
    estamosLimpiando = false;
    mostrarPantalla('pantallaResultados');

    // Paramos de contar el tiempo
    clearInterval(reloj);

    // Mostramos el tiempo total que hemos tardado
    const minutos = Math.floor(tiempoTranscurrido / 60).toString().padStart(2, '0');
    const segundos = (tiempoTranscurrido % 60).toString().padStart(2, '0');
    document.getElementById('res-tiempo').innerText = `Tiempo: ${minutos}:${segundos}`;
    document.getElementById('res-tiempo').style.display = 'block';

    // Comprobamos si hemos superado nuestra mejor marca
    const mejorTiempoAnterior = localStorage.getItem('record_' + habitacionElegida);
    const cartelRecord = document.getElementById('res-record');

    if (!mejorTiempoAnterior || tiempoTranscurrido < parseInt(mejorTiempoAnterior)) {
        localStorage.setItem('record_' + habitacionElegida, tiempoTranscurrido);
        cartelRecord.innerText = "¡NUEVO RÉCORD DE VELOCIDAD!";
        cartelRecord.style.display = 'block';
        cartelRecord.style.color = '#f1c40f';
        cartelRecord.classList.add('record');
        comunicarPorVoz(`¡Impresionante! Nuevo récord establecido.`);
    } else {
        const marcaMinutos = Math.floor(mejorTiempoAnterior / 60).toString().padStart(2, '0');
        const marcaSegundos = (mejorTiempoAnterior % 60).toString().padStart(2, '0');
        cartelRecord.innerText = `(Mejor tiempo: ${marcaMinutos}:${marcaSegundos})`;
        cartelRecord.style.display = 'block';
        cartelRecord.style.color = '#ccc';
        cartelRecord.classList.remove('record');
    }

    // Sumamos una victoria a nuestra racha
    rachaGanadora++;
    localStorage.setItem('rachaLimpieza', rachaGanadora);
    indicadorRacha.innerText = `🔥 Racha: ${rachaGanadora} limpiezas`;

    const mensajeRacha = document.getElementById('res-racha');
    mensajeRacha.innerText = `¡Racha aumentada a ${rachaGanadora}! 🔥`;
    mensajeRacha.style.display = 'block';

    conexion.emit('limpieza_completada');

    // Indicamos en los resultados la zona que hemos terminado
    const nombresAmigables = { salon: 'Salón', cocina: 'Cocina', bano: 'Baño' };
    document.getElementById('res-zona').innerText = `Zona Limpiada: ${nombresAmigables[habitacionElegida]}`;
};

// Volvemos a la pantalla principal
window.volverMenu = function () {
    mostrarPantalla('menuPrincipal');
};

// Preparamos la capa de suciedad pintando un color sobre todo el lienzo
function ensuciarLienzo() {
    lienzoSuelo.width = window.innerWidth;
    lienzoSuelo.height = window.innerHeight;

    // Pintamos de forma normal
    contextoLienzo.globalCompositeOperation = 'source-over';

    // Elegimos el color de la representación de la suciedad según la habitación
    if (habitacionElegida === 'salon') contextoLienzo.fillStyle = '#5c4033';
    if (habitacionElegida === 'cocina') contextoLienzo.fillStyle = '#4a4a4a';
    if (habitacionElegida === 'bano') contextoLienzo.fillStyle = '#8fbc8f';

    contextoLienzo.fillRect(0, 0, lienzoSuelo.width, lienzoSuelo.height);

    // Cambiamos el pincel para que ahora borre la pintura en lugar de pintar
    contextoLienzo.globalCompositeOperation = 'destination-out';
}

// Usamos el altavoz del navegador para leer mensajes en voz alta
function comunicarPorVoz(frase) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        if (temporizadorVoz) clearTimeout(temporizadorVoz);

        const dictado = new SpeechSynthesisUtterance(frase);
        dictado.lang = 'es-ES';
        dictado.rate = 1.1;
        dictado.onstart = () => { asistenteHablando = true; };
        dictado.onend = () => {
            temporizadorVoz = setTimeout(() => { asistenteHablando = false; }, 2500);
        };
        window.speechSynthesis.speak(dictado);
    }
}

// Miramos cuántos píxeles están transparentes para calcular el progreso
function averiguarAvanceLimpieza() {
    const bordeIgnorado = 100;
    const anchoRevisado = lienzoSuelo.width - (bordeIgnorado * 2);
    const altoRevisado = lienzoSuelo.height - (bordeIgnorado * 2);

    if (anchoRevisado <= 0 || altoRevisado <= 0) return 0;

    const datosImagen = contextoLienzo.getImageData(bordeIgnorado, bordeIgnorado, anchoRevisado, altoRevisado);
    const canalesPixel = datosImagen.data;
    let pixelesBorrados = 0;

    for (let i = 3; i < canalesPixel.length; i += 4) {
        if (canalesPixel[i] === 0) pixelesBorrados++;
    }

    const pixelesTotales = canalesPixel.length / 4;
    return Math.floor((pixelesBorrados / pixelesTotales) * 100);
}

// Manejamos las posiciones que nos envían desde el móvil para mover nuestro cursor allí
let objetivoX = null;
let objetivoY = null;
let xActualLienzo = null;
let yActualLienzo = null;

conexion.on('dibujar_limpieza', (coordenadasDispositivo) => {
    if (!estamosLimpiando) return;

    if (!relojEnMarcha) {
        relojEnMarcha = true;
        reloj = setInterval(() => {
            tiempoTranscurrido++;
            refrescarReloj();
        }, 1000);
    }

    objetivoX = (coordenadasDispositivo.x / 100) * lienzoSuelo.width;
    objetivoY = (coordenadasDispositivo.y / 100) * lienzoSuelo.height;
});

// Suavizamos el movimiento de la escoba conectando suavemente los puntos que recibimos
function animarMovimientoEscoba() {
    if (estamosLimpiando && objetivoX !== null && objetivoY !== null) {
        if (xActualLienzo === null) {
            xActualLienzo = objetivoX;
            yActualLienzo = objetivoY;
        } else {
            // Arrastramos suavemente el punto actual hacia el objetivo
            const velocidadFriccion = 0.25;
            xActualLienzo += (objetivoX - xActualLienzo) * velocidadFriccion;
            yActualLienzo += (objetivoY - yActualLienzo) * velocidadFriccion;
        }

        if (ultimaPosicionX !== null && ultimaPosicionY !== null) {
            // Borramos el trazo que hay de la última posición a esta
            contextoLienzo.beginPath();
            contextoLienzo.moveTo(ultimaPosicionX, ultimaPosicionY);
            contextoLienzo.lineTo(xActualLienzo, yActualLienzo);

            contextoLienzo.strokeStyle = "rgb(255, 255, 255)";
            contextoLienzo.lineWidth = 100;
            contextoLienzo.lineCap = "round";
            contextoLienzo.lineJoin = "round";
            contextoLienzo.stroke();
        }

        ultimaPosicionX = xActualLienzo;
        ultimaPosicionY = yActualLienzo;

        // Comprobamos cuánto llevamos limpado de vez en cuando y felicitamos
        marcosDibujados++;
        if (marcosDibujados % 15 === 0) {
            const progresoActualMismo = averiguarAvanceLimpieza();
            textoProgreso.innerText = `${progresoActualMismo}% Limpio`;

            if (progresoActualMismo >= 25 && progresoActualMismo < 50 && !porcentajesAvisados.has(25)) {
                porcentajesAvisados.add(25);
                comunicarPorVoz("Llevas un 25 por ciento. ¡Sigue así!");
            }
            else if (progresoActualMismo >= 50 && progresoActualMismo < 75 && !porcentajesAvisados.has(50)) {
                porcentajesAvisados.add(50);
                comunicarPorVoz("¡Mitad del suelo limpio!");
            }
            else if (progresoActualMismo >= 75 && progresoActualMismo < 99 && !porcentajesAvisados.has(75)) {
                porcentajesAvisados.add(75);
                comunicarPorVoz("Ya casi terminas. ¡Remata la faena!");
            }
            else if (progresoActualMismo >= 99 && !porcentajesAvisados.has(100)) {
                porcentajesAvisados.add(100);
                textoProgreso.innerText = `100% Limpio`;
                comunicarPorVoz("¡Enhorabuena! Has limpiado toda la zona.");
                terminarLimpieza();
            }
        }

        puntoEscoba.style.display = 'block';

        const cajaLienzo = lienzoSuelo.getBoundingClientRect();
        const topologiaCursorX = cajaLienzo.left + xActualLienzo;
        const topologiaCursorY = cajaLienzo.top + yActualLienzo;

        puntoEscoba.style.left = `${topologiaCursorX}px`;
        puntoEscoba.style.top = `${topologiaCursorY}px`;
    } else {
        if (!estamosLimpiando) {
            xActualLienzo = null; yActualLienzo = null;
            objetivoX = null; objetivoY = null;
            ultimaPosicionX = null; ultimaPosicionY = null;
            puntoEscoba.style.display = 'none';
        }
    }

    requestAnimationFrame(animarMovimientoEscoba);
}
requestAnimationFrame(animarMovimientoEscoba);

// Capturamos la foto que nos envían desde el teléfono para analizarla
conexion.on('foto_recibida', (imagenCodificada) => {
    if (!pantallas.pantallaAnalisis.classList.contains('activa')) return;

    document.getElementById('contenedor-foto-recibida').style.display = 'flex';
    document.getElementById('foto-preview').src = imagenCodificada;
});

// Averiguamos si tenemos baldosa o madera analizando los colores de la foto
function decidirProductoSegunFoto(imagenCruda) {
    const foto = new Image();
    foto.src = imagenCruda;
    foto.onload = () => {
        // Pintamos la foto en un lienzo escondido para obtener los pixeles
        const lienzoEscondido = document.createElement('canvas');
        lienzoEscondido.width = foto.width;
        lienzoEscondido.height = foto.height;
        const brochaOculta = lienzoEscondido.getContext('2d');
        brochaOculta.drawImage(foto, 0, 0);

        try {
            const dataPixeles = brochaOculta.getImageData(0, 0, lienzoEscondido.width, lienzoEscondido.height).data;
            let sumaRojo = 0, sumaVerde = 0, sumaAzul = 0;
            const saltoPixeles = 4 * 10;
            let totalMuestras = 0;
            for (let i = 0; i < dataPixeles.length; i += saltoPixeles) {
                sumaRojo += dataPixeles[i];
                sumaVerde += dataPixeles[i + 1];
                sumaAzul += dataPixeles[i + 2];
                totalMuestras++;
            }
            sumaRojo = Math.floor(sumaRojo / totalMuestras);
            sumaVerde = Math.floor(sumaVerde / totalMuestras);
            sumaAzul = Math.floor(sumaAzul / totalMuestras);

            // Medimos cuánta luz tiene y cómo son los colores
            const iluminacion = (sumaRojo * 299 + sumaVerde * 587 + sumaAzul * 114) / 1000;

            let detectamosMadera = false;
            // Si tiene poca luz o si el rojo es muy predominante como en los pisos de madera oscuros, lo contamos como madera
            if (iluminacion < 130 || (sumaRojo > sumaVerde + 20 && sumaRojo > sumaAzul + 20)) {
                detectamosMadera = true;
            }

            let elegido;
            if (detectamosMadera) {
                elegido = {
                    titulo: 'Friegasuelos para baldosas',
                    desc: 'Ideal para suelos de baldosa.',
                    img: 'ceramica.png'
                };
            } else {
                elegido = {
                    titulo: 'Friegasuelos para baldosas',
                    desc: 'Ideal para suelos de baldosa.',
                    img: 'ceramica.png'
                };
            }

            document.getElementById('contenedor-foto-recibida').style.display = 'none';
            comenzarAccionLimpieza(elegido);

        } catch (errorAnalisis) {
            console.error(errorAnalisis);
            comenzarAccionLimpieza(null);
        }
    };
}

// Repintamos la suciedad si nos cambian el tamaño de nuestra ventana mientras jugamos
window.addEventListener('resize', () => {
    if (estamosLimpiando) {
        ensuciarLienzo();
        porcentajesAvisados.clear();
        textoProgreso.innerText = `Se ha reiniciado el suelo por cambio de pantalla`;
    }
});

// Preparamos el micrófono para escuchar comandos de voz desde la Pantalla
const MotorDeVozPantalla = window.SpeechRecognition || window.webkitSpeechRecognition;
let escuchadorPantalla = null;
const avisoMicrofonoPantalla = document.getElementById('estado-microfono');

if (MotorDeVozPantalla) {
    escuchadorPantalla = new MotorDeVozPantalla();
    escuchadorPantalla.continuous = true;
    escuchadorPantalla.lang = 'es-ES';
    escuchadorPantalla.interimResults = false;

    // Analizamos lo que hemos escuchado y tomamos una decisión
    escuchadorPantalla.onresult = (eventoVozPantalla) => {
        if (asistenteHablando) return;
        const ordenEscuchadaPantalla = eventoVozPantalla.results[eventoVozPantalla.results.length - 1][0].transcript.toLowerCase().trim();
        console.log("Comando escuchado: ", ordenEscuchadaPantalla);

        if (pantallas.menuPrincipal.classList.contains('activa')) {
            if (ordenEscuchadaPantalla.includes('salón') || ordenEscuchadaPantalla.includes('salon')) {
                seleccionarZona('salon');
                comunicarPorVoz('Zona elegida: Salón');
            }
            else if (ordenEscuchadaPantalla.includes('cocina')) {
                seleccionarZona('cocina');
                comunicarPorVoz('Zona elegida: Cocina');
            }
            else if (ordenEscuchadaPantalla.includes('baño') || ordenEscuchadaPantalla.includes('bano')) {
                seleccionarZona('bano');
                comunicarPorVoz('Zona elegida: Baño');
            }
            else if (ordenEscuchadaPantalla.includes('recomendación') || ordenEscuchadaPantalla.includes('recomendacion') || ordenEscuchadaPantalla.includes('producto')) {
                toggleRecomendacion();
                comunicarPorVoz(queremosRecomendacion ? 'Recomendación de producto activada' : 'Recomendación de producto desactivada');
            }
            else if (ordenEscuchadaPantalla.includes('empezar') || ordenEscuchadaPantalla.includes('comenzar') || ordenEscuchadaPantalla.includes('jugar') || ordenEscuchadaPantalla.includes('limpiar')) {
                iniciarLimpieza();
            }
        }
    };

    // Si el micrófono se apaga por inactividad, lo volvemos a encender
    escuchadorPantalla.onend = () => {
        if (escuchadorPantalla && pantallas.menuPrincipal.classList.contains('activa')) {
            try {
                escuchadorPantalla.start();
            } catch (errorReactivar) { }
        }
    };

    // Detectamos problemas con el micrófono
    escuchadorPantalla.onerror = (falloMicro) => {
        console.error("Error microfono: ", falloMicro.error);
        if (falloMicro.error === 'not-allowed') {
            if (avisoMicrofonoPantalla) avisoMicrofonoPantalla.innerText = "❌ Permiso de micrófono denegado.";
            if (avisoMicrofonoPantalla) avisoMicrofonoPantalla.style.color = "#e74c3c";
        }
    };

    // Encendemos el micrófono por primera vez
    try {
        escuchadorPantalla.start();
    } catch (errorIniciar) { }

} else {
    // Si el navegador no soporta voz, avisamos
    if (avisoMicrofonoPantalla) {
        avisoMicrofonoPantalla.innerText = "❌ Tu navegador no soporta comandos de voz.";
        avisoMicrofonoPantalla.style.color = "#e74c3c";
    }
}