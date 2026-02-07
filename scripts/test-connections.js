#!/usr/bin/env node
/**
 * NomadShift Platform - Connection Test Script
 * Prueba las conexiones a Supabase y Upstash
 *
 * Uso:
 *   DATABASE_URL="..." REDIS_URL="..." node scripts/test-connections.js
 */

const { PrismaClient } = require('@prisma/client');
const { Redis } = require('ioredis');

// Colors para terminal
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title) {
  console.log('\n' + '='.repeat(50));
  log(title, 'blue');
  console.log('='.repeat(50));
}

// ============================================
// TEST 1: Supabase PostgreSQL
// ============================================
async function testSupabase() {
  section('📦 TEST 1: SUPABASE POSTGRESQL');

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    log('❌ DATABASE_URL no está configurada', 'red');
    log('   Ejemplo: DATABASE_URL="postgresql://..."', 'yellow');
    return false;
  }

  // Mostrar info de la conexión (ocultando password)
  const maskedUrl = databaseUrl.replace(/:([^@/:]{8})[^@]*@/, ':****@');
  log(`URL: ${maskedUrl}`, 'blue');

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  try {
    log('Conectando a Supabase...', 'yellow');

    await prisma.$connect();
    log('✅ Conexión exitosa a Supabase!', 'green');

    // Obtener información del servidor
    const result = await prisma.$queryRaw`SELECT version()`;
    log(`📊 Versión PostgreSQL: ${result[0].version}`, 'blue');

    // Contar tablas
    const tables = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    log(`📋 Tablas en la base de datos: ${tables[0].count}`, 'blue');

    // Verificar si existe la tabla User
    const userTableExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'User'
      )
    `;
    if (userTableExists[0].exists) {
      log('✅ Tabla "User" encontrada', 'green');
    } else {
      log('⚠️  Tabla "User" NO encontrada - Ejecuta las migraciones', 'yellow');
    }

    await prisma.$disconnect();
    return true;

  } catch (error) {
    log(`❌ Error conectando a Supabase: ${error.message}`, 'red');

    if (error.message.includes('authentication failed')) {
      log('   Verifica tu password en la DATABASE_URL', 'yellow');
    } else if (error.message.includes('connect')) {
      log('   Verifica que la URL sea correcta y que TLS esté habilitado', 'yellow');
      log('   Asegúrate de incluir ?sslmode=require', 'yellow');
    }

    await prisma.$disconnect();
    return false;
  }
}

// ============================================
// TEST 2: Upstash Redis
// ============================================
async function testUpstash() {
  section('🚀 TEST 2: UPSTASH REDIS');

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    log('❌ REDIS_URL no está configurada', 'red');
    log('   Ejemplo: REDIS_URL="redis://..."', 'yellow');
    return false;
  }

  // Mostrar info de la conexión (ocultando password)
  const maskedUrl = redisUrl.replace(/:([^@/:]{4})[^@]*@/, ':****@');
  log(`URL: ${maskedUrl}`, 'blue');

  const redis = new Redis(redisUrl, {
    tls: {}, // Upstash requiere TLS
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 3) return null;
      return Math.min(times * 100, 3000);
    },
  });

  return new Promise((resolve) => {
    redis.on('error', (err) => {
      log(`❌ Error conectando a Upstash: ${err.message}`, 'red');

      if (err.message.includes('NOAUTH')) {
        log('   Verifica tu password en la REDIS_URL', 'yellow');
      } else if (err.message.includes('ECONNREFUSED')) {
        log('   Asegúrate de que TLS esté habilitado', 'yellow');
        log('   En ioredis: new Redis(url, { tls: {} })', 'yellow');
      }

      redis.disconnect();
      resolve(false);
    });

    redis.on('connect', async () => {
      try {
        log('✅ Conexión exitosa a Upstash!', 'green');

        // Test: PING
        const pong = await redis.ping();
        log(`📡 PING: ${pong}`, 'blue');

        // Test: SET y GET
        await redis.set('nomadas:test', 'conexion-exitosa', { EX: 60 });
        const value = await redis.get('nomadas:test');
        log(`📝 SET/GET test: ${value}`, 'blue');

        // Test: INFO
        const info = await redis.info('server');
        const version = info.match(/redis_version:([^\r\n]+)/)?.[1];
        log(`📊 Versión Redis: ${version}`, 'blue');

        // Limpiar
        await redis.del('nomadas:test');
        log('🧹 Test key eliminada', 'blue');

        await redis.disconnect();
        resolve(true);

      } catch (error) {
        log(`❌ Error en las pruebas: ${error.message}`, 'red');
        await redis.disconnect();
        resolve(false);
      }
    });
  });
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   NomadShift - Connection Test Tool      ║');
  console.log('║   Supabase + Upstash                      ║');
  console.log('╚══════════════════════════════════════════╝');

  const supabaseOk = await testSupabase();
  const upstashOk = await testUpstash();

  // Resumen final
  section('📋 RESUMEN');
  log(`Supabase PostgreSQL: ${supabaseOk ? '✅ OK' : '❌ FALLO'}`, supabaseOk ? 'green' : 'red');
  log(`Upstash Redis:       ${upstashOk ? '✅ OK' : '❌ FALLO'}`, upstashOk ? 'green' : 'red');

  if (supabaseOk && upstashOk) {
    log('\n🎉 Todas las conexiones funcionan correctamente!', 'green');
    log('   Ya puedes hacer deploy en Hostinger', 'green');
    process.exit(0);
  } else {
    log('\n⚠️  Algunas conexiones fallaron. Revisa los errores arriba.', 'yellow');
    process.exit(1);
  }
}

main();
