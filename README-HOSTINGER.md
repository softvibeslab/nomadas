# Deployment en Hostinger Cloud

Rama: `hostinger-deploy` - Adaptación para Hostinger Cloud Hosting

## Archivos de Configuración Creados

| Archivo | Propósito |
|---------|-----------|
| `.htaccess` | Configuración de Apache para Node.js |
| `hostinger.json` | Configuración de la app para Hostinger |
| `hostinger.env.template` | Plantilla de variables de entorno (Supabase + Upstash) |
| `hostinger-build.sh` | Script de build para producción |
| `scripts/test-connections.js` | Script para probar conexiones |
| `docs/SUPABASE_SETUP.md` | Guía completa de Supabase |
| `docs/UPSTASH_SETUP.md` | Guía completa de Upstash |
| `README-HOSTINGER.md` | Esta documentación |

## Limitaciones Conocidas

| Característica | Estado | Nota |
|----------------|--------|------|
| REST API | ✅ Funcional | 100% de los endpoints |
| PostgreSQL (Supabase) | ✅ Funcional | Gratis hasta 500MB |
| Redis (Upstash) | ✅ Funcional | Gratis hasta 10K comandos/día |
| S3/AWS | ✅ Funcional | Configura tus credenciales AWS |
| Socket.io/WebSocket | ❌ NO Soportado | Mensajería en tiempo real no funciona |
| OpenSearch | ⚠️ Opcional | Deshabilítalo si no lo necesitas |

---

## Servicios Externos Requeridos

Este deployment utiliza servicios gratuitos para base de datos y caché:

| Servicio | Uso | Costo | Guía |
|----------|-----|-------|------|
| **Supabase** | PostgreSQL | Gratis (500MB) | [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) |
| **Upstash** | Redis Cache | Gratis (10K cmds/día) | [docs/UPSTASH_SETUP.md](docs/UPSTASH_SETUP.md) |

---

## Paso 1: Configurar Supabase (Base de Datos)

📘 **Guía completa:** [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)

1. Ve a: https://supabase.com/
2. Regístrate y crea un **nuevo proyecto**
3. Ve a **Settings** > **Database**
4. Copia la **Connection Pooling URL** (recomendado):

```
postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?sslmode=require
```

---

## Paso 2: Configurar Upstash (Redis Cache)

📘 **Guía completa:** [docs/UPSTASH_SETUP.md](docs/UPSTASH_SETUP.md)

1. Ve a: https://upstash.com/
2. Regístrate y crea un **nuevo database**
3. Copia la **Redis URL**:

```
redis://default:[PASSWORD]@[DATABASE]-[ID].upstash.io:6379
```

---

## Paso 3: Probar Conexiones

Antes de hacer deploy, verifica que todo funcione:

```bash
# Instala dependencias (si no lo has hecho)
npm install

# Ejecuta el script de prueba
DATABASE_URL="tu-url-supabase" REDIS_URL="tu-url-upstash" node scripts/test-connections.js
```

Salida esperada:
```
✅ Conexión exitosa a Supabase!
✅ Conexión exitosa a Upstash!
🎉 Todas las conexiones funcionan correctamente!
```

---

## Paso 4: Preparación Local

```bash
# Clona el repositorio y cambia a la rama hostinger-deploy
git clone https://github.com/tu-usuario/nomadas.git
cd nomadas
git checkout hostinger-deploy

# Instala dependencias
npm install

# Construye la aplicación
npm run build

# Genera cliente de Prisma
npx prisma generate
```

---

## Paso 5: Configurar Variables de Entorno en Hostinger

En el panel de Hostinger, ve a tu proyecto Node.js y configura las variables:

```
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://tu-frontend.com
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=tu-secret-aleatorio-min-32-caracteres
JWT_REFRESH_SECRET=tu-otro-secret-aleatorio-min-32-caracteres
```

### Generar JWT Secrets Seguros

```bash
# Genera dos secretos aleatorios
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Paso 6: Ejecutar Migraciones de Base de Datos

```bash
# Desde tu terminal local, con las credenciales de producción
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

---

## Paso 7: Deploy en Hostinger

### Método 1: Importar desde GitHub (Recomendado)

1. Sube los cambios a GitHub:
```bash
git add .
git commit -m "chore: adapt for Hostinger deployment"
git push origin hostinger-deploy
```

2. En Hostinger:
   - Ve a **Hosting** > **Manage**
   - Click en **Upload files**
   - Selecciona **Import from GitHub**
   - Autoriza tu cuenta de GitHub
   - Selecciona el repositorio y la rama `hostinger-deploy`
   - Click en **Import**

### Método 2: Subir archivos manualmente

```bash
# Crea un zip con los archivos necesarios
zip -r nomadas-hostinger.zip \
  dist/ \
  node_modules/ \
  prisma/ \
  .htaccess \
  hostinger.json \
  package.json \
  package-lock.json \
  .env.production

# Súbelo via FTP o panel de Hostinger
```

---

## Paso 8: Post-Deployment

1. **Verifica que la app esté corriendo:**
   ```
   https://tu-dominio.com/api/health
   ```

2. **Revisa los logs en el panel de Hostinger**

3. **Ejecuta el seed de datos iniciales (opcional):**
   ```bash
   # Desde tu terminal con DB de producción
   DATABASE_URL="..." npx prisma db seed
   ```

---

## Variables de Entorno Obligatorias

Estas son las variables mínimas requeridas:

```bash
NODE_ENV=production
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=... (mínimo 32 caracteres)
JWT_REFRESH_SECRET=... (mínimo 32 caracteres)
FRONTEND_URL=https://tu-frontend.com
```

---

## Solución de Problemas

### Error: Cannot connect to database

- Verifica que la IP de Hostinger tenga acceso a tu base de datos
- En Supabase: Settings > Database > Connection Pooling

### Error: Redis connection timeout

- Verifica que usas la URL correcta de Upstash
- Asegúrate de que el plan gratuito de Upstash esté activo

### Error: Port already in use

- Hostinger asigna el puerto automáticamente
- No configures PORT manualmente, déjalo en 3000

### La app no inicia

- Revisa los logs en el panel de Hostinger
- Verifica que Node.js versión 20 esté seleccionado
- Asegúrate de que la carpeta `dist/` existe

---

## Características NO Disponibles en Hostinger

Las siguientes características están deshabilitadas en esta rama:

- ❌ Mensajería en tiempo real (Socket.io/WebSocket)
- ❌ Notificaciones push en tiempo real
- ⚠️ Búsqueda con OpenSearch (opcional)

### Alternativas:

- **Mensajería**: Usa polling desde el frontend cada 30-60 segundos
- **Notificaciones**: Usa email-only o servicio externo como OneSignal
- **Búsqueda**: La búsqueda básica de PostgreSQL funciona bien

---

## Costos Estimados (Hostinger + Servicios Gratuitos)

| Servicio | Costo Mensual |
|----------|---------------|
| Hostinger Cloud | ~\$10-15/mes |
| Supabase PostgreSQL | Gratis (500MB) |
| Upstash Redis | Gratis (10K cmds/día) |
| **Total** | **~\$10-15/mes** |

---

## Alternativas a Considerar

Si necesitas WebSocket o quieres evitar configuraciones complejas:

| Servicio | Ventaja | Costo |
|----------|---------|-------|
| **Railway** | Todo incluido, fácil deploy | ~\$5-20/mes |
| **Render** | PostgreSQL gratis (hasta 90 días) | ~\$7/mes |
| **VPS Hostinger** | Control total, Docker | ~\$5-10/mes |

---

## Soporte

Para problemas específicos de Hostinger:
- Panel: https://hpanel.hostinger.com/
- Docs: https://support.hostinger.com/
