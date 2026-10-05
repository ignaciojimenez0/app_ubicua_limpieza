const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const socketServidor = new Server(server);

// Servimos nuestros archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Guardamos cuánto hemos limpiado
let progreso = 0;

// Configuramos las conexiones en tiempo real
socketServidor.on('connection', (cliente) => {
    console.log('Nuevo cliente unido:', cliente.id);

    // Mandamos el progreso actual al entrar
    cliente.emit('actualizar_progreso', progreso);

    // Registramos cuando alguien limpia
    cliente.on('registrar_limpieza', () => {
        if (progreso < 100) {
            progreso += 5;
            if (progreso > 100) progreso = 100;

            // Avisamos a todos del nuevo avance
            socketServidor.emit('actualizar_progreso', progreso);
        }
    });

    // Compartimos la posición para dibujar
    cliente.on('mover_escoba', (posicion) => {
        socketServidor.emit('dibujar_limpieza', posicion);
    });

    // Pedimos a los demás que envíen una foto
    cliente.on('solicitar_foto', () => {
        cliente.broadcast.emit('peticion_foto');
    });

    // Repartimos la foto que ha llegado
    cliente.on('enviar_foto', (imagen) => {
        cliente.broadcast.emit('foto_recibida', imagen);
    });

    // Empezamos la limpieza desde cero
    cliente.on('reiniciar_limpieza', () => {
        progreso = 0;
        socketServidor.emit('actualizar_progreso', progreso);
    });

    // Avisamos a todos para reiniciar los móviles
    cliente.on('limpieza_completada', () => {
        socketServidor.emit('reiniciar_movil');
    });

    cliente.on('disconnect', () => {
        console.log('Cliente desconectado:', cliente.id);
    });
});

// Arrancamos nuestro servidor
const puerto = 5500;
server.listen(puerto, () => {
    console.log(`Servidor activo en http://localhost:${puerto}`);
});