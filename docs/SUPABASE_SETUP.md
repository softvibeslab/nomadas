# Configuración de Supabase para NomadShift

Guía paso a paso para configurar Supabase como base de datos PostgreSQL.

---

## PASO 1: Crear Cuenta en Supabase

1. Ve a: https://supabase.com/
2. Click en **"Start your project"**
3. Regístrate con:
   - GitHub (recomendado)
   - Email + contraseña

---

## PASO 2: Crear un Nuevo Proyecto

1. Click en **"New Project"**
2. Configura tu proyecto:

   | Campo | Valor |
   |-------|-------|
   | **Name** | `nomadas-production` |
   | **Database Password** | Genera una contraseña segura (guárdala!) |
   | **Region** | Selecciona la más cercana a tus usuarios:
   | - Europa: `EU West (Ireland)` o `EU Central (Frankfurt)` |
   | - USA: `US East` o `US West` |
   | **Pricing Plan** | **Free** (hasta 500MB, 50MB/file) |

3. Click en **"Create new project"**
4. Espera 2-3 minutos mientras se crea el proyecto

---

## PASO 3: Obtener la URL de Conexión

1. En el panel de Supabase, ve a **Settings** > **Database**
2. Busca la sección **Connection Info**
3. Copia la **Connection String** (formato: `postgresql://...`)

### Formato de la Connection String:

```
postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

### Alternativa: Connection Pooling (Recomendado para Producción)

Para mejor rendimiento, usa el pool de conexiones:

1. En **Settings** > **Database**
2. Busca **Connection pooling**
3. Copia la **Transaction mode** connection string:

```
postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
```

---

## PASO 4: Configurar la Base de Datos

### Opción A: Ejecutar Migraciones desde tu Terminal

```bash
# Instala Supabase CLI (opcional, para desarrollo local)
npm install -g supabase

# Configura la variable de entorno con tu connection string
export DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres"

# Ejecuta las migraciones de Prisma
npx prisma migrate deploy
```

### Opción B: Desde el Panel de Supabase

1. Ve a **SQL Editor** en el panel lateral
2. Click en **"New query"**
3. Pega el contenido de tus migraciones de Prisma
4. Click en **"Run"**

---

## PASO 5: Configurar Seguridad (IP Whitelist)

Supabase Free tier tiene restricciones de seguridad:

### Opción A: Sin restricción de IP (No recomendado)

El plan gratuito de Supabase ya permite conexiones desde cualquier lugar con la contraseña correcta.

### Opción B: Configurar SSL (Recomendado)

Asegúrate que tu connection string use `?sslmode=require`

```
postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres?sslmode=require
```

---

## PASO 6: Verificar la Conexión

Crea un archivo de prueba `test-db-connection.js`:

```javascript
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testConnection() {
  try {
    await prisma.$connect();
    console.log('✅ Conectado a Supabase PostgreSQL!');

    // Verifica tablas
    const tables = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `;
    console.log('Tablas:', tables);

    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
    process.exit(1);
  }
}

testConnection();
```

Ejecuta:
```bash
DATABASE_URL="tu-connection-string" node test-db-connection.js
```

---

## PASO 7: Copiar la URL para Variables de Entorno

Una vez verificada la conexión, copia esta URL para usarla en Hostinger:

```
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres?sslmode=require"
```

---

## LÍMITES DEL PLAN GRATUITO DE SUPABASE

| Característica | Límite Gratis | Plan Pro (\$25/mes) |
|----------------|---------------|---------------------|
| Almacenamiento | 500 MB | 8 GB |
| Archivos | 50 MB/archivo | 5 GB/archivo |
| Transferencia | 1 GB/mes | 50 GB/mes |
| Conexiones DB | 60 simultáneas | Ilimitadas |
| Filas leídas | 50 millones/mes | 500 millones/mes |
| Filas escritas | 500K/mes | 5 millones/mes |

Para MVP/tráfico inicial, el plan gratuito es suficiente.

---

## TROUBLESHOOTING

### Error: "connection timeout"

- Verifica que la URL sea correcta
- Asegúrate de incluir `?sslmode=require`
- Revisa que tu firewall no bloquee el puerto 5432

### Error: "password authentication failed"

- Verifica la contraseña en la connection string
- Los caracteres especiales necesitan URL encoding:
  - `@` → `%40`
  - `:` → `%3A`
  - `/` → `%2F`

### Error: "too many connections"

El plan gratuito tiene límite de 60 conexiones simultáneas. Soluciones:
- Usa connection pooling (puerto 6543)
- Configura Prisma con pool limitado

---

## LISTO PARA EL SIGUIENTE PASO

Una vez configurado Supabase, continúa con: **UPSTASH_SETUP.md**
