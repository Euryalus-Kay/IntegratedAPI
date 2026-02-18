import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    // Core
    'index': 'src/index.ts',

    // Database
    'db/index': 'src/db/index.ts',

    // Auth
    'auth/index': 'src/auth/index.ts',
    'auth/middleware': 'src/auth/middleware.ts',
    'auth/components/index': 'src/auth/components/index.ts',

    // Storage
    'storage/index': 'src/storage/index.ts',

    // Email
    'email/index': 'src/email/index.ts',

    // Realtime
    'realtime/index': 'src/realtime/index.ts',
    'realtime/client': 'src/realtime/client.ts',

    // Observability
    'observability/index': 'src/observability/index.ts',

    // Secrets
    'secrets/index': 'src/secrets/index.ts',

    // Environments
    'environments/index': 'src/environments/index.ts',

    // Deploy
    'deploy/index': 'src/deploy/index.ts',

    // Webhooks
    'webhooks/index': 'src/webhooks/index.ts',

    // Utils
    'utils/errors': 'src/utils/errors.ts',
    'testing/index': 'src/testing/index.ts',
    'config/validator': 'src/config/validator.ts',
    'notifications/index': 'src/notifications/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  external: ['@neondatabase/serverless', 'react', 'react-dom', 'hono'],
})
