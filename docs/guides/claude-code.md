# Using VibeKit with Claude Code

VibeKit is designed to work with Claude Code. This guide explains how to set up the MCP server.

## Install the MCP Server

Add to your Claude Code configuration:

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

Restart Claude Code. You now have access to all VibeKit tools.

## What Claude Code Can Do

With the MCP server active, Claude Code can:

- Create and manage database tables
- Enable authentication, storage, and email
- Run SQL queries
- Check project status
- Deploy your app (coming soon)

## Example Workflow

1. Tell Claude: "Build me a todo app with user accounts"
2. Claude creates the project, defines tables, enables auth
3. Run `npx vibekit dev` to start building
