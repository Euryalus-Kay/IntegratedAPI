import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'db/index': 'src/db/index.ts',
    'auth/index': 'src/auth/index.ts',
    'auth/middleware': 'src/auth/middleware.ts',
    'auth/components/index': 'src/auth/components/index.ts',
    'storage/index': 'src/storage/index.ts',
    'email/index': 'src/email/index.ts',
    'realtime/index': 'src/realtime/index.ts',
    'realtime/client': 'src/realtime/client.ts',
    'utils/errors': 'src/utils/errors.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  external: ['@neondatabase/serverless', 'react', 'react-dom', 'hono'],
})
