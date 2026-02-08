# Deployment en Render

Guía paso a paso para desplegar NomadShift en Render.

---

## Por qué Render?

| Característica | Render | Hostinger |
|----------------|--------|-----------|
| **NestJS** | ✅ Nativo | ❌ No soportado |
| **PostgreSQL** | ✅ 90 días gratis | ❌ Pago adicional |
| **Redis** | ✅ 90 días gratis | ❌ No incluido |
| **Deploy** | ✅ Auto desde GitHub | ⚠️ Manual |
| **SSL** | ✅ Gratis | ✅ Gratis |

---

## Paso 1: Crear Cuenta en Render

1. Ve a: https://render.com/
2. Click en **"Get Started"**
3. Regístrate con:
   - **GitHub** (recomendado) - más fácil
   - Google
   - Email

---

## Paso 2: Conectar Repositorio de GitHub

1. En el dashboard, click en **"New +"**
2. Selecciona **"Web Service"**
3. Click en **"Connect GitHub"**
4. Autoriza Render para acceder a tus repositorios
5. Busca y selecciona: **`softvibeslab/nomadas`**
6. Selecciona la rama: **`hostinger-deploy`** (o cámbiale el nombre a `main`)

---

## Paso 3: Configurar el Web Service

Completa el formulario:

| Campo | Valor |
|-------|-------|
| **Name** | `nomadas-api` |
| **Region** | `Oregon (US West)` o la más cercana |
| **Branch** | `hostinger-deploy` |
| **Runtime** | `Node 20` |
| **Build Command** | `npx prisma generate && npm run build` |
| **Start Command** | `npx prisma migrate deploy && node dist/main` |

**Importante:** Render ejecutará automáticamente `npm install` antes del build.

---

## Paso 4: Crear Base de Datos PostgreSQL

1. En el dashboard de Render, click en **"New +"**
2. Selecciona **"PostgreSQL"**
3. Configura:

| Campo | Valor |
|-------|-------|
| **Name** | `nomadas-db` |
| **Database** | `nomadas` |
| **User** | `nomadas_admin` |
| **Region** | Igual que tu Web Service |
| **Plan** | **Starter** (90 días gratis) |

4. Click en **"Create Database"**
5. Espera unos segundos a que se cree

6. **Copia la Internal Database URL** que aparecerá en la sección de conexiones

---

## Paso 5: Crear Redis (Opcional pero Recomendado)

1. Click en **"New +"** > **"Redis"**
2. Configura:

| Campo | Valor |
|-------|-------|
| **Name** | `nomadas-redis` |
| **Region** | Igual que tu Web Service |
| **Plan** | **Starter** (90 días gratis) |

3. Click en **"Create Redis"**

---

## Paso 6: Configurar Variables de Entorno

En tu Web Service (`nomadas-api`), ve a la sección **"Environment"** y agrega:

### Variables Esenciales

```
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://tu-frontend.com
```

### Variables de Base de Datos

**Opción A: Conectar a Render PostgreSQL (Recomendado)**

No necesitas poner la URL manualmente. Render inyectará automáticamente la variable `DATABASE_URL` si conectas el servicio.

Para conectar:
1. Ve a la sección **"Environment"**
2. Click en **"Advanced"**
3. Busca **"Databases"**
4. Selecciona tu base de datos `nomadas-db`

**Opción B: Usar tu Supabase existente**

```
DATABASE_URL=postgresql://postgres:Rogermck2403%40@db.ssedsiaxtvmidumqelql.supabase.co:5432/postgres?sslmode=require
```

### Variables de Redis

**Opción A: Conectar a Render Redis**

Render inyectará automáticamente `REDIS_URL`.

**Opción B: Usar tu Upstash existente**

```
REDIS_URL=redis://default:AcIQAAIncDI4MjZkNzE0ZTRjYjk0ZTUwOGEwMjEwMjNjYWU2NmMzMHAyNDk2ODA@careful-anchovy-49680.upstash.io:6379
```

### JWT Secrets (Generar automáticamente o manual)

```
JWT_SECRET=tu-secret-aqui
JWT_REFRESH_SECRET=tu-otro-secret-aqui
```

**Para generar secrets seguros:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Otras Variables (Opcionales)

```
AWS_REGION=eu-central-1
AWS_ACCESS_KEY_ID=tu-key
AWS_SECRET_ACCESS_KEY=tu-secret
S3_BUCKET_PHOTOS=tu-bucket

SES_REGION=eu-central-1
SES_FROM_EMAIL=noreply@tudominio.com
```

---

## Paso 7: Hacer Deploy

1. Click en **"Create Web Service"**
2. Render comenzará el deploy automáticamente
3. Verás el progreso en tiempo real
4. Espera unos 5-10 minutos

**Si el deploy falla:**
- Click en la pestaña **"Logs"** para ver el error
- Los problemas más comunes son:
  - Build falla por dependencias faltantes
  - Migraciones fallan por problemas de conexión a DB

---

## Paso 8: Verificar el Deploy

Una vez completado, verás:

```
✅ Service is live
https://nomadas-api.onrender.com
```

Prueba el endpoint de salud:

```bash
curl https://nomadas-api.onrender.com/api/health
```

Deberías ver:
```json
{"status":"ok","timestamp":"..."}
```

---

## Dominio Personalizado (Opcional)

1. En tu Web Service, ve a **"Custom Domain"**
2. Click en **"Add Domain"**
3. Ingresa tu dominio: `api.tudominio.com`
4. Render te dará los DNS para configurar en tu registrador de dominios

---

## Costos Estimados (Después de 90 días gratis)

| Servicio | Plan | Costo Mensual |
|----------|------|---------------|
| Web Service | Starter | ~\$7 |
| PostgreSQL | Starter | ~\$7 |
| Redis | Starter | ~\$5 |
| **Total** | | **~\$19/mes** |

---

## Troubleshooting

### El build falla

- Verifica que la rama tenga todos los archivos necesarios
- Revisa los logs en la pestaña "Logs"
- Asegúrate de que `package.json` tenga los scripts correctos

### Error de conexión a base de datos

- Verifica que la variable `DATABASE_URL` esté configurada
- Si usas Supabase/Upstash externos, asegúrate de que las URLs sean correctas
- Si usas Render DB, verifica que el servicio esté conectado

### La app se reinicia constantemente

- Revisa los logs para errores de runtime
- Verifica que todas las variables de entorno estén configuradas
- Asegúrate de que las migraciones se ejecutaron correctamente

### Error "Cannot find module"

- Verifica que `node_modules` se esté instalando correctamente
- El comando `npm install` se ejecuta automáticamente antes del build

---

## Próximos Pasos

1. ✅ Cuenta en Render creada
2. ✅ Repositorio conectado
3. ✅ Web Service configurado
4. ✅ Base de datos creada
5. ✅ Redis creado (opcional)
6. ✅ Variables de entorno configuradas
7. ✅ Deploy exitoso
8. 📱 Configura tu frontend
9. 🌐 Configura dominio personalizado (opcional)
