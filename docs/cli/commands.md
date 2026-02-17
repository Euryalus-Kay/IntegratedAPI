# CLI Reference

## Project Management

- `vibekit init [name]` - Initialize a new project
- `vibekit dev` - Start local dev server
- `vibekit status` - Show project info
- `vibekit deploy` - Deploy to production [FUTURE]

## Database

- `vibekit db push` - Sync schema to database
- `vibekit db pull` - Export current schema
- `vibekit db reset` - Reset database
- `vibekit db studio` - Interactive table browser
- `vibekit db seed` - Run seed file
- `vibekit db migrate` - Generate migration

## Authentication

- `vibekit auth enable` - Enable auth module
- `vibekit auth disable` - Disable auth module
- `vibekit auth status` - Show auth config
- `vibekit auth users` - List users
- `vibekit auth users:delete <email>` - Delete user

## Storage

- `vibekit storage list [folder]` - List files
- `vibekit storage upload <path> [folder]` - Upload file
- `vibekit storage delete <path>` - Delete file

## Environment

- `vibekit env list` - List env vars
- `vibekit env set <key> <value>` - Set env var
- `vibekit env get <key>` - Get env var
- `vibekit env remove <key>` - Remove env var

## Account

- `vibekit login` - Log in
- `vibekit logout` - Log out
- `vibekit whoami` - Show current user
