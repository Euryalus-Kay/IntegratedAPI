import chalk from 'chalk'
import ora from 'ora'

// ─── Chalk Wrappers ──────────────────────────────────────────────────────────

export const dim = (text: string): string => chalk.dim(text)
export const bold = (text: string): string => chalk.bold(text)
export const green = (text: string): string => chalk.green(text)
export const red = (text: string): string => chalk.red(text)
export const yellow = (text: string): string => chalk.yellow(text)
export const cyan = (text: string): string => chalk.cyan(text)

// ─── Table ───────────────────────────────────────────────────────────────────

export function table(headers: string[], rows: string[][]): string {
  const columnCount = headers.length
  const colWidths: number[] = []

  for (let i = 0; i < columnCount; i++) {
    let max = stripAnsi(headers[i]).length
    for (const row of rows) {
      const cellLen = stripAnsi(row[i] ?? '').length
      if (cellLen > max) max = cellLen
    }
    colWidths.push(max)
  }

  const pad = (text: string, width: number): string => {
    const stripped = stripAnsi(text)
    const diff = width - stripped.length
    return text + ' '.repeat(Math.max(0, diff))
  }

  const topBorder = '┌' + colWidths.map(w => '─'.repeat(w + 2)).join('┬') + '┐'
  const midBorder = '├' + colWidths.map(w => '─'.repeat(w + 2)).join('┼') + '┤'
  const botBorder = '└' + colWidths.map(w => '─'.repeat(w + 2)).join('┴') + '┘'

  const headerRow = '│' + headers.map((h, i) => ' ' + bold(pad(h, colWidths[i])) + ' ').join('│') + '│'

  const dataRows = rows.map(row =>
    '│' + row.map((cell, i) => ' ' + pad(cell ?? '', colWidths[i]) + ' ').join('│') + '│'
  )

  const lines = [topBorder, headerRow, midBorder, ...dataRows, botBorder]
  return lines.join('\n')
}

// ─── Box ─────────────────────────────────────────────────────────────────────

export interface BoxOptions {
  title?: string
  color?: 'green' | 'red' | 'yellow' | 'cyan' | 'white'
  padding?: number
}

export function box(lines: string[], options: BoxOptions = {}): string {
  const { title, color = 'white', padding = 1 } = options
  const colorFn = chalk[color] ?? chalk.white

  const maxContentWidth = Math.max(
    ...lines.map(l => stripAnsi(l).length),
    title ? stripAnsi(title).length + 4 : 0,
    40
  )
  const innerWidth = maxContentWidth + padding * 2

  const padLine = (text: string): string => {
    const stripped = stripAnsi(text)
    const remaining = innerWidth - stripped.length
    return ' '.repeat(padding) + text + ' '.repeat(Math.max(0, remaining - padding))
  }

  const emptyLine = colorFn('│') + ' '.repeat(innerWidth) + colorFn('│')

  let topLine: string
  if (title) {
    const titleStr = ` ${title} `
    const remaining = innerWidth - titleStr.length - 2
    const left = Math.floor(remaining / 2)
    const right = remaining - left
    topLine = colorFn('┌' + '─'.repeat(left + 1) + titleStr + '─'.repeat(right + 1) + '┐')
  } else {
    topLine = colorFn('┌' + '─'.repeat(innerWidth) + '┐')
  }
  const bottomLine = colorFn('└' + '─'.repeat(innerWidth) + '┘')

  const contentLines = lines.map(l => colorFn('│') + padLine(l) + colorFn('│'))

  return [topLine, emptyLine, ...contentLines, emptyLine, bottomLine].join('\n')
}

// ─── Badge ───────────────────────────────────────────────────────────────────

export function badge(text: string, color: 'green' | 'red' | 'yellow' | 'cyan' | 'white' = 'white'): string {
  const colorFn = chalk[color] ?? chalk.white
  return colorFn(`[${text}]`)
}

// ─── Spinner ─────────────────────────────────────────────────────────────────

export interface SpinnerHandle {
  succeed: (msg: string) => void
  fail: (msg: string) => void
  update: (msg: string) => void
}

export function spinner(text: string): SpinnerHandle {
  const instance = ora({ text, spinner: 'dots' }).start()
  return {
    succeed(msg: string) { instance.succeed(msg) },
    fail(msg: string) { instance.fail(msg) },
    update(msg: string) { instance.text = msg },
  }
}

// ─── Progress Bar ────────────────────────────────────────────────────────────

export function progressBar(current: number, total: number, width: number = 30): string {
  const ratio = total > 0 ? Math.min(current / total, 1) : 0
  const filled = Math.round(ratio * width)
  const empty = width - filled
  const percent = Math.round(ratio * 100)
  const bar = '█'.repeat(filled) + '░'.repeat(empty)
  return `[${bar}] ${percent}%`
}

// ─── Format Bytes ────────────────────────────────────────────────────────────

export function formatBytes(n: number): string {
  if (n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  const idx = Math.min(i, units.length - 1)
  const value = n / Math.pow(1024, idx)
  return `${value < 10 && idx > 0 ? value.toFixed(1) : Math.round(value)} ${units[idx]}`
}

// ─── Format Duration ─────────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

// ─── Banner ──────────────────────────────────────────────────────────────────

export function banner(): string {
  const version = '0.1.0'
  const lines = [
    '',
    cyan(bold('  ╦  ╦╦╔╗ ╔═╗╦╔═╦╔╦╗')),
    cyan(bold('  ╚╗╔╝║╠╩╗║╣ ╠╩╗║ ║ ')),
    cyan(bold('   ╚╝ ╩╚═╝╚═╝╩ ╩╩ ╩ ')),
    '',
    dim(`  v${version}`),
    '',
  ]
  return lines.join('\n')
}

// ─── Error Box ───────────────────────────────────────────────────────────────

export function errorBox(title: string, message: string, suggestion?: string): string {
  const lines = [
    red(bold(title)),
    '',
    message,
  ]
  if (suggestion) {
    lines.push('', yellow('Suggestion: ') + suggestion)
  }
  return box(lines, { color: 'red', title: 'ERROR' })
}

// ─── Success Box ─────────────────────────────────────────────────────────────

export function successBox(title: string, message: string): string {
  const lines = [
    green(bold(title)),
    '',
    message,
  ]
  return box(lines, { color: 'green', title: 'SUCCESS' })
}

// ─── List ────────────────────────────────────────────────────────────────────

export function list(items: string[], marker: string = '•'): string {
  return items.map(item => `  ${dim(marker)} ${item}`).join('\n')
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}
