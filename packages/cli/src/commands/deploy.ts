import type { Command } from 'commander'

export function registerDeployCommand(program: Command): void {
  program
    .command('deploy')
    .description('Deploy to production [FUTURE]')
    .option('--preview', 'Deploy to preview URL')
    .action(async (options: { preview?: boolean }) => {
      console.log('Deployment is not yet available.')
      console.log('VibeKit deployment to production is coming soon.')
      console.log('')
      console.log('For now, use "vibekit dev" for local development.')
    })

  program
    .command('deployments')
    .description('List deployments [FUTURE]')
    .action(() => {
      console.log('Deployment history is not yet available.')
    })

  program
    .command('rollback [id]')
    .description('Rollback to a deployment [FUTURE]')
    .action(() => {
      console.log('Rollback is not yet available.')
    })

  program
    .command('open')
    .description('Open deployed app URL in browser')
    .action(() => {
      console.log('No deployment found. Deploy first with "vibekit deploy".')
    })

  program
    .command('logs')
    .description('Stream production logs [FUTURE]')
    .option('--since <duration>', 'Filter by time')
    .option('--filter <text>', 'Filter by content')
    .action(() => {
      console.log('Production logs are not yet available.')
    })

  program
    .command('domains')
    .description('Manage custom domains [FUTURE]')
    .action(() => {
      console.log('Custom domains are not yet available.')
    })

  program
    .command('billing')
    .description('Billing management [FUTURE]')
    .action(() => {
      console.log('Billing is not yet available. VibeKit is free during the beta.')
    })
}
