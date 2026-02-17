import type { Command } from 'commander'

export function registerStorageCommands(program: Command): void {
  const storageCmd = program
    .command('storage')
    .description('Storage management commands')

  storageCmd
    .command('list [folder]')
    .description('List files in storage')
    .action(async (folder?: string) => {
      const { storage } = await import('vibekit')
      try {
        const result = await storage.list({ folder })
        if (result.files.length === 0) {
          console.log('No files found.')
          return
        }
        console.log('Files:')
        for (const file of result.files) {
          console.log(`  ${file.path} (${file.size} bytes) - ${file.contentType}`)
        }
      } catch (e: any) {
        console.error('Error:', e.message)
      }
    })

  storageCmd
    .command('upload <path> [folder]')
    .description('Upload a local file to storage')
    .action(async (filePath: string, folder?: string) => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const { storage } = await import('vibekit')
      try {
        if (!fs.existsSync(filePath)) {
          console.log(`File not found: ${filePath}`)
          return
        }
        const data = fs.readFileSync(filePath)
        const filename = path.basename(filePath)
        const result = await storage.upload(data, { filename, folder })
        console.log(`Uploaded: ${result.path}`)
        console.log(`URL: ${result.url}`)
      } catch (e: any) {
        console.error('Error:', e.message)
      }
    })

  storageCmd
    .command('delete <path>')
    .description('Delete a file from storage')
    .action(async (filePath: string) => {
      const { storage } = await import('vibekit')
      try {
        await storage.delete(filePath)
        console.log(`Deleted: ${filePath}`)
      } catch (e: any) {
        console.error('Error:', e.message)
      }
    })
}
