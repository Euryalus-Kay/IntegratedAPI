#!/usr/bin/env node

import { Command } from 'commander'
import { registerInitCommand } from './commands/init.js'
import { registerDevCommand } from './commands/dev.js'
import { registerDbCommands } from './commands/db.js'
import { registerAuthCommands } from './commands/auth.js'
import { registerStorageCommands } from './commands/storage.js'
import { registerEnvCommands } from './commands/env.js'
import { registerStatusCommand } from './commands/status.js'
import { registerLoginCommand, registerLogoutCommand, registerWhoamiCommand } from './commands/account.js'
import { registerDeployCommand } from './commands/deploy.js'

const program = new Command()

program
  .name('vibekit')
  .description('VibeKit CLI - The complete backend for AI-coded apps')
  .version('0.1.0')

registerLoginCommand(program)
registerLogoutCommand(program)
registerWhoamiCommand(program)
registerInitCommand(program)
registerDevCommand(program)
registerStatusCommand(program)
registerDbCommands(program)
registerAuthCommands(program)
registerStorageCommands(program)
registerEnvCommands(program)
registerDeployCommand(program)

program.parse(process.argv)
