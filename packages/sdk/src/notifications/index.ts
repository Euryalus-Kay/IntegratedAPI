// ──────────────────────────────────────────────────────────────────────────────
// VibeKit — Notification System
// Sends email notifications for builds, deploys, security alerts, and usage.
// ──────────────────────────────────────────────────────────────────────────────

import { email } from '../email/index.js'
import { createLogger } from '../utils/logger.js'
import type { NotificationPreferences, NotificationEvent, NotificationResult } from './types.js'

const log = createLogger('notifications')

const defaultPreferences: NotificationPreferences = {
  buildFailed: true,
  buildSucceeded: false,
  deployRollback: true,
  usageLimitWarning: true,
  securityAlert: true,
  teamInvite: true,
}

let _preferences: NotificationPreferences = { ...defaultPreferences }
let _dashboardUrl = 'https://dashboard.vibekit.dev'

const _notificationLog: Array<{ event: string; to: string; sentAt: string; status: 'sent' | 'failed'; error?: string }> = []
const MAX_LOG = 500

function addLog(entry: typeof _notificationLog[number]) {
  _notificationLog.unshift(entry)
  if (_notificationLog.length > MAX_LOG) _notificationLog.length = MAX_LOG
}

export const notifications = {
  configure(opts: { preferences?: Partial<NotificationPreferences>; dashboardUrl?: string }) {
    if (opts.preferences) {
      _preferences = { ..._preferences, ...opts.preferences }
    }
    if (opts.dashboardUrl) {
      _dashboardUrl = opts.dashboardUrl
    }
    log.info('Notification preferences updated', { preferences: _preferences })
  },

  getPreferences(): NotificationPreferences {
    return { ..._preferences }
  },

  async notifyBuildFailed(opts: {
    to: string
    projectName: string
    projectId: string
    buildId: string
    environment: string
    branch: string
    commitHash: string
    triggeredBy: string
    duration: string
    failedAt: string
    errorMessage?: string
  }): Promise<NotificationResult> {
    if (!_preferences.buildFailed) {
      return { sent: false, reason: 'Build failure notifications disabled' }
    }

    try {
      const result = await email.send({
        to: opts.to,
        template: 'build-failed',
        data: {
          ...opts,
          dashboardUrl: _dashboardUrl,
        },
      })
      addLog({ event: 'build-failed', to: opts.to, sentAt: new Date().toISOString(), status: 'sent' })
      log.info('Build failure notification sent', { to: opts.to, buildId: opts.buildId })
      return { sent: true, messageId: result.messageId }
    } catch (err: any) {
      addLog({ event: 'build-failed', to: opts.to, sentAt: new Date().toISOString(), status: 'failed', error: err.message })
      log.error('Failed to send build failure notification', { to: opts.to, error: err.message })
      return { sent: false, reason: err.message }
    }
  },

  async notifyBuildSucceeded(opts: {
    to: string
    projectName: string
    projectId: string
    buildId: string
    environment: string
    branch: string
    commitHash: string
    duration: string
    deployedAt: string
    deployUrl: string
  }): Promise<NotificationResult> {
    if (!_preferences.buildSucceeded) {
      return { sent: false, reason: 'Build success notifications disabled' }
    }

    try {
      const result = await email.send({
        to: opts.to,
        template: 'build-succeeded',
        data: {
          ...opts,
          dashboardUrl: _dashboardUrl,
        },
      })
      addLog({ event: 'build-succeeded', to: opts.to, sentAt: new Date().toISOString(), status: 'sent' })
      log.info('Build success notification sent', { to: opts.to, buildId: opts.buildId })
      return { sent: true, messageId: result.messageId }
    } catch (err: any) {
      addLog({ event: 'build-succeeded', to: opts.to, sentAt: new Date().toISOString(), status: 'failed', error: err.message })
      log.error('Failed to send build success notification', { to: opts.to, error: err.message })
      return { sent: false, reason: err.message }
    }
  },

  async notifyDeployRollback(opts: {
    to: string
    projectName: string
    projectId: string
    environment: string
    fromBuildId: string
    toBuildId: string
    reason: string
    initiatedBy: string
    rolledBackAt: string
  }): Promise<NotificationResult> {
    if (!_preferences.deployRollback) {
      return { sent: false, reason: 'Deploy rollback notifications disabled' }
    }

    try {
      const result = await email.send({
        to: opts.to,
        template: 'deploy-rollback',
        data: {
          ...opts,
          dashboardUrl: _dashboardUrl,
        },
      })
      addLog({ event: 'deploy-rollback', to: opts.to, sentAt: new Date().toISOString(), status: 'sent' })
      log.info('Deploy rollback notification sent', { to: opts.to, projectId: opts.projectId })
      return { sent: true, messageId: result.messageId }
    } catch (err: any) {
      addLog({ event: 'deploy-rollback', to: opts.to, sentAt: new Date().toISOString(), status: 'failed', error: err.message })
      return { sent: false, reason: err.message }
    }
  },

  async notifyUsageLimitWarning(opts: {
    to: string
    projectName: string
    projectId: string
    resourceType: string
    usagePercent: number
    currentUsage: string
    planLimit: string
    planName: string
  }): Promise<NotificationResult> {
    if (!_preferences.usageLimitWarning) {
      return { sent: false, reason: 'Usage limit notifications disabled' }
    }

    try {
      const result = await email.send({
        to: opts.to,
        template: 'usage-limit-warning',
        data: {
          ...opts,
          dashboardUrl: _dashboardUrl,
        },
      })
      addLog({ event: 'usage-limit-warning', to: opts.to, sentAt: new Date().toISOString(), status: 'sent' })
      log.info('Usage limit warning sent', { to: opts.to, resourceType: opts.resourceType, usagePercent: opts.usagePercent })
      return { sent: true, messageId: result.messageId }
    } catch (err: any) {
      addLog({ event: 'usage-limit-warning', to: opts.to, sentAt: new Date().toISOString(), status: 'failed', error: err.message })
      return { sent: false, reason: err.message }
    }
  },

  async notifySecurityAlert(opts: {
    to: string
    projectName: string
    projectId: string
    alertType: string
    alertDescription: string
    severity: 'low' | 'medium' | 'high' | 'critical'
    alertTime: string
    ipAddress?: string
    userEmail?: string
  }): Promise<NotificationResult> {
    if (!_preferences.securityAlert) {
      return { sent: false, reason: 'Security alert notifications disabled' }
    }

    try {
      const result = await email.send({
        to: opts.to,
        template: 'security-alert',
        data: {
          ...opts,
          isHigh: opts.severity === 'high' || opts.severity === 'critical',
          dashboardUrl: _dashboardUrl,
        },
      })
      addLog({ event: 'security-alert', to: opts.to, sentAt: new Date().toISOString(), status: 'sent' })
      log.warn('Security alert notification sent', { to: opts.to, alertType: opts.alertType, severity: opts.severity })
      return { sent: true, messageId: result.messageId }
    } catch (err: any) {
      addLog({ event: 'security-alert', to: opts.to, sentAt: new Date().toISOString(), status: 'failed', error: err.message })
      return { sent: false, reason: err.message }
    }
  },

  async notifyTeamInvite(opts: {
    to: string
    projectName: string
    role: string
    inviterName: string
    inviterEmail: string
    acceptUrl: string
  }): Promise<NotificationResult> {
    if (!_preferences.teamInvite) {
      return { sent: false, reason: 'Team invite notifications disabled' }
    }

    try {
      const result = await email.send({
        to: opts.to,
        template: 'invite-team-member',
        data: opts,
      })
      addLog({ event: 'team-invite', to: opts.to, sentAt: new Date().toISOString(), status: 'sent' })
      log.info('Team invite notification sent', { to: opts.to, projectName: opts.projectName })
      return { sent: true, messageId: result.messageId }
    } catch (err: any) {
      addLog({ event: 'team-invite', to: opts.to, sentAt: new Date().toISOString(), status: 'failed', error: err.message })
      return { sent: false, reason: err.message }
    }
  },

  async notify(event: NotificationEvent): Promise<NotificationResult> {
    switch (event.type) {
      case 'build-failed':
        return this.notifyBuildFailed(event)
      case 'build-succeeded':
        return this.notifyBuildSucceeded(event)
      case 'deploy-rollback':
        return this.notifyDeployRollback(event)
      case 'usage-limit-warning':
        return this.notifyUsageLimitWarning(event)
      case 'security-alert':
        return this.notifySecurityAlert(event)
      case 'team-invite':
        return this.notifyTeamInvite(event)
      default:
        return { sent: false, reason: `Unknown notification type: ${(event as any).type}` }
    }
  },

  getLog() {
    return [..._notificationLog]
  },

  getRecentLog(count: number = 20) {
    return _notificationLog.slice(0, count)
  },

  clearLog() {
    _notificationLog.length = 0
  },
}
