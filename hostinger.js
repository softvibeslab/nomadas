/**
 * NomadShift Platform - Hostinger Entry Point
 * Servidor Express para Hostinger Cloud Hosting
 *
 * Hostinger no soporta NestJS directamente, así que usamos
 * este archivo como punto de entrada que carga la app compilada.
 */

const express = require('express');
const { NestFactory } = require('@nestjs/core');
const { ExpressAdapter } = require('@nestjs/platform-express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

// Importar el módulo principal compilado
const { AppModule } = require('./dist/main.module');

let cachedApp = null;

async function bootstrap() {
  if (cachedApp) {
    return cachedApp;
  }

  const server = express();
  const adapter = new ExpressAdapter(server);

  // Middleware básico antes de NestJS
  server.use(helmet({
    contentSecurityPolicy: false, // Hostinger ya maneja esto
  }));
  server.use(compression());
  server.use(cookieParser());

  // Crear la app NestJS
  const app = await NestFactory.create(AppModule, adapter, {
    bufferLogs: true,
  });

  // Configuración de CORS
  const frontendUrl = process.env.FRONTEND_URL || '*';
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Prefix global
  app.setGlobalPrefix('api');

  // Iniciar la app
  await app.listen(process.env.PORT || 3000);

  cachedApp = app;
  return app;
}

// Para Hostinger: exportar la app de Express
module.exports = async (req, res) => {
  await bootstrap();
  // NestJS maneja las peticiones directamente, no necesitamos hacer nada más
};
