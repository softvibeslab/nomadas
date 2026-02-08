/**
 * NomadShift Platform - Hostinger Entry Point
 * Servidor Express para Hostinger Cloud Hosting
 *
 * Este archivo inicia la aplicación NestJS compilada
 * de una manera compatible con Hostinger Cloud.
 */

const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

// Importar NestJS y el módulo compilado
const { NestFactory } = require('@nestjs/core');
const { ExpressAdapter } = require('@nestjs/platform-express');
const { AppModule } = require('./dist/main.module');

// Crear la app de Express
const server = express();

// Configurar puerto
const PORT = process.env.PORT || 3000;

// Middleware básico
server.use(helmet({
  contentSecurityPolicy: false, // Deshabilitar CSP para Hostinger
}));
server.use(compression());
server.use(cookieParser());
server.use(express.json({ limit: '10mb' }));
server.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint (Hostinger lo requiere)
server.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Inicializar NestJS
async function bootstrap() {
  const adapter = new ExpressAdapter(server);
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

  // Prefijo global
  app.setGlobalPrefix('api');

  // Iniciar servidor
  await app.listen(PORT);

  console.log(`Application is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
}

// Iniciar la aplicación
bootstrap().catch((err) => {
  console.error('Error starting application:', err);
  process.exit(1);
});

// Exportar para Hostinger
module.exports = server;
