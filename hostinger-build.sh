#!/bin/bash
# NomadShift Platform - Hostinger Build Script
# Este script prepara el proyecto para deployment en Hostinger Cloud

set -e

echo "==================================="
echo "NomadShift - Hostinger Build Script"
echo "==================================="

# Verificar Node.js versión
NODE_VERSION=$(node -v)
echo "Node.js version: $NODE_VERSION"

# Instalar dependencias de producción
echo "Installing production dependencies..."
npm ci --only=production

# Generar cliente de Prisma
echo "Generating Prisma client..."
npx prisma generate

# Construir la aplicación
echo "Building application..."
npm run build

# Verificar que la carpeta dist existe
if [ ! -d "dist" ]; then
  echo "ERROR: dist folder not found!"
  exit 1
fi

echo "Build completed successfully!"
echo "Files ready for Hostinger deployment:"
echo "  - dist/"
echo "  - node_modules/"
echo "  - prisma/"
echo ""
echo "Next steps:"
echo "  1. Upload files to Hostinger"
echo "  2. Configure environment variables"
echo "  3. Run database migrations"
