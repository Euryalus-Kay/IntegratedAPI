# MCP Server Tools

The VibeKit MCP server gives AI coding agents access to the following tools:

## vibekit_init
Initialize a new VibeKit project. Creates vibekit.json.

## create_table
Create or update a database table with column definitions.

## add_auth
Enable email + code authentication.

## add_storage
Enable file storage.

## add_email
Enable transactional email.

## add_realtime
Enable WebSocket realtime.

## project_status
Get current project status.

## db_query
Run a SQL query against the database.

## deploy
Deploy to production. [FUTURE]

## Setup

Add to your Claude Code settings:

```json
{
  "mcpServers": {
    "vibekit": {
      "command": "npx",
      "args": ["vibekit-mcp"]
    }
  }
}
```
