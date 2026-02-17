import { isLocal } from '../config/index.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const levelPriority: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

function getMinLevel(): LogLevel {
  return (process.env.VIBEKIT_LOG_LEVEL as LogLevel) || (isLocal() ? 'debug' : 'info')
}

function shouldLog(level: LogLevel): boolean {
  return levelPriority[level] >= levelPriority[getMinLevel()]
}

function formatMessage(level: LogLevel, module: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString()
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${module}]`
  const dataStr = data ? ` ${JSON.stringify(data)}` : ''
  return `${prefix} ${message}${dataStr}`
}

export function createLogger(module: string) {
  return {
    debug(message: string, data?: unknown) {
      if (shouldLog('debug')) console.debug(formatMessage('debug', module, message, data))
    },
    info(message: string, data?: unknown) {
      if (shouldLog('info')) console.info(formatMessage('info', module, message, data))
    },
    warn(message: string, data?: unknown) {
      if (shouldLog('warn')) console.warn(formatMessage('warn', module, message, data))
    },
    error(message: string, data?: unknown) {
      if (shouldLog('error')) console.error(formatMessage('error', module, message, data))
    },
  }
}
