import type { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'

export function registerInitCommand(program: Command): void {
  program
    .command('init [name]')
    .description('Initialize a new VibeKit project')
    .option('--template <template>', 'Use a starter template: nextjs, react, hono, html, saas')
    .action(async (name?: string, options?: { template?: string }) => {
      const projectName = name || path.basename(process.cwd())
      const configPath = path.join(process.cwd(), 'vibekit.json')

      if (fs.existsSync(configPath)) {
        console.log('vibekit.json already exists in this directory.')
        return
      }

      const config = {
        name: projectName,
        projectId: '',
        region: 'us-east-1',
        framework: options?.template || 'custom',
        modules: {
          db: true,
          auth: {
            enabled: true,
            methods: ['email-code'],
            sessionDuration: '30d',
            allowSignup: true,
            redirectAfterLogin: '/',
          },
          storage: { enabled: true, maxFileSize: '50MB' },
          email: { enabled: true, from: `noreply@${projectName}.vibekit.app` },
          realtime: false,
        },
      }

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
      console.log(`Created vibekit.json for "${projectName}"`)
      console.log('')
      console.log('Next steps:')
      console.log('  1. npm install vibekit')
      console.log('  2. npx vibekit dev')
    })
}
