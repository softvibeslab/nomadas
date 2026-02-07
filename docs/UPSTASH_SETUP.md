# Configuración de Upstash para NomadShift

Guía paso a paso para configurar Upstash como Redis cache.

---

## PASO 1: Crear Cuenta en Upstash

1. Ve a: https://upstash.com/
2. Click en **"Sign Up"** o **"Get Started"**
3. Regístrate con:
   - GitHub (recomendado)
   - Google
   - Email + contraseña

---

## PASO 2: Crear una Nueva Base de Datos Redis

1. En el dashboard, click en **"Create Database"**
2. Configura tu database:

   | Campo | Valor |
   |-------|-------|
   | **Database Name** | `nomadas-redis` |
   | **Region** | Selecciona la más cercana:
   | - Europa: `eu-central-1` (Frankfurt) |
   | - USA: `us-east-1` (N. Virginia) |
   | **Tier** | **Free** (10K comandos/día) |
   | **Enable TLS** | ✅ Enabled (por seguridad) |

3. Click en **"Create"**
4. Tu database estará lista en segundos

---

## PASO 3: Obtener la URL de Conexión

1. En el dashboard de Upstash, selecciona tu database `nomadas-redis`
2. Ve a la sección **"Details"** o **"Connection"**
3. Copia la **REST API URL** o **Redis URL`

### Formato de la URL:

```
redis://default:[YOUR-PASSWORD]@nomadas-redis-[ID].upstash.io:6379
```

### Ejemplo real:

```
redis://default:U2FsdGVkX1@nomadas-redis-a1b2c3d4.upstash.io:6379
```

---

## PASO 4: Probar la Conexión

Crea un archivo `test-redis-connection.js`:

```javascript
const Redis = require('redis');

async function testRedisConnection() {
  const redis = Redis.createClient({
    url: 'redis://default:[PASSWORD]@nomadas-redis-xxx.upstash.io:6379',
    socket: {
      tls: {} // Upstash requiere TLS
    }
  });

  redis.on('error', (err) => console.error('Redis Client Error', err));

  try {
    await redis.connect();
    console.log('✅ Conectado a Upstash Redis!');

    // Test: Set y Get
    await redis.set('test', 'Hola desde NomadShift!');
    const value = await redis.get('test');
    console.log('Valor recuperado:', value);

    // Test: Expiración
    await redis.set('temp', 'Expira en 10 segundos', { EX: 10 });

    // Test: Info del servidor
    const info = await redis.info('server');
    console.log('Info servidor:', info.split('\n').slice(0, 5).join('\n'));

    await redis.disconnect();
    console.log('✅ Test completado exitosamente!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testRedisConnection();
```

Ejecuta:
```bash
REDIS_URL="tu-url-redis" node test-redis-connection.js
```

---

## PASO 5: Configurar en Prisma/NestJS

Upstash es compatible con Redis estándar, así que no necesitas cambios en el código.

Solo configura la variable de entorno:

```bash
REDIS_URL="redis://default:[PASSWORD]@nomadas-redis-xxx.upstash.io:6379"
```

---

## PASO 6: Verificar Uso y Límites

En el dashboard de Upstash puedes ver:

1. **Metrics** - Comandos usados hoy
2. **Data Browser** - Ver las keys almacenadas
3. **Slow Log** - Comandos lentos

### Límites del Plan Gratuito:

| Característica | Límite Gratis | Plan Scale (\$10/mes) |
|----------------|---------------|----------------------|
| Comandos/día | 10,000 | 30,000,000 |
| Almacenamiento | 256 MB | 10 GB |
| Conexiones simultáneas | 10 | 500 |
| Máximo comandos/seg | 10 | 5,000 |

---

## PASO 7: Copiar la URL para Variables de Entorno

Para Hostinger, usa esta URL:

```
REDIS_URL="redis://default:[PASSWORD]@nomadas-redis-xxx.upstash.io:6379"
```

---

## CONFIGURACIÓN DE PRODUCCIÓN

### Habilitar TLS (Requerido por Upstash)

Asegúrate que tu cliente Redis use TLS. Con el paquete `redis` v4+, se configura así:

```javascript
const redis = Redis.createClient({
  url: process.env.REDIS_URL,
  socket: {
    tls: {} // Habilita TLS para Upstash
  }
});
```

### Configuración de NestJS para Upstash

En tu `src/shared/infrastructure/redis/redis.service.ts`:

```typescript
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL, {
      tls: {} // TLS para Upstash
    });
  }

  // ... resto del código
}
```

---

## TROUBLESHOOTING

### Error: "Connection timeout"

- Verifica que la URL sea correcta
- Asegúrate de que TLS esté habilitado
- Revisa las reglas de firewall de tu red

### Error: "NOAUTH Authentication required"

- Verifica que el password esté incluido en la URL
- La contraseña es la parte después de `default:`

### Error: "ECONNREFUSED"

- Upstash requiere TLS. Asegúrate de configurarlo:
  ```javascript
  socket: { tls: {} }
  ```

### Error: "Too many commands"

El plan gratuito tiene límite de 10K comandos/día. Soluciones:
- Optimiza el uso de caché
- Actualiza al plan Scale (\$10/mes)

---

## COMANDOS ÚTILES DE UPSTASH

### Desde el Dashboard (Data Browser):

```
# Ver todas las keys
KEYS *

# Ver valor de una key
GET mi_key

# Establecer valor con expiración (1 hora)
SETEX mi_key 3600 "mi_valor"

# Ver tiempo de vida restante
TTL mi_key

# Eliminar una key
DEL mi_key
```

### Desde Terminal (con redis-cli):

```bash
# Conectar a Upstash
redis-cli -u "redis://default:[PASSWORD]@nomadas-redis-xxx.upstash.io:6379"

# Dentro de redis-cli
> KEYS *
> GET mi_key
> SET mi_key "valor" EX 3600
> INFO server
```

---

## LÍMITES DE RATE LIMITING DEL PLAN GRATUITO

| Tipo | Límite |
|------|--------|
| Comandos por día | 10,000 |
| Comandos por segundo | 10 |
| Conexiones simultáneas | 10 |
| Tamaño máximo de valor | 2 MB |

Para una app con:
- 100 usuarios activos/día
- 50 requests/usuario
- ~5,000 comandos/día

El plan gratuito es suficiente.

---

## MEJORES PRÁCTICAS

1. **Usa expiración en todas las keys**
   ```javascript
   await redis.set('key', 'value', { EX: 3600 }); // 1 hora
   ```

2. **Agrupa múltiples operaciones con pipeline**
   ```javascript
   const pipeline = redis.pipeline();
   pipeline.set('key1', 'value1');
   pipeline.set('key2', 'value2');
   await pipeline.exec();
   ```

3. **Usa patrones de key organizados**
   ```javascript
   const keys = {
     session: `session:${userId}`,
     cache: `cache:jobs:${jobId}`,
     rateLimit: `ratelimit:${userId}:${endpoint}`
   };
   ```

---

## LISTO

Tu Redis Upstash está configurado. La URL final:

```
REDIS_URL="redis://default:[PASSWORD]@nomadas-redis-xxx.upstash.io:6379"
```

Usa esta URL en:
- Variables de entorno de Hostinger
- Archivo `.env.local` para desarrollo
