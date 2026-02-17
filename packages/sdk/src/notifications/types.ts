export interface NotificationPreferences {
  buildFailed: boolean
  buildSucceeded: boolean
  deployRollback: boolean
  usageLimitWarning: boolean
  securityAlert: boolean
  teamInvite: boolean
}

export interface NotificationResult {
  sent: boolean
  messageId?: string
  reason?: string
}

export type NotificationEvent =
  | ({ type: 'build-failed' } & BuildFailedEvent)
  | ({ type: 'build-succeeded' } & BuildSucceededEvent)
  | ({ type: 'deploy-rollback' } & DeployRollbackEvent)
  | ({ type: 'usage-limit-warning' } & UsageLimitWarningEvent)
  | ({ type: 'security-alert' } & SecurityAlertEvent)
  | ({ type: 'team-invite' } & TeamInviteEvent)

export interface BuildFailedEvent {
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
}

export interface BuildSucceededEvent {
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
}

export interface DeployRollbackEvent {
  to: string
  projectName: string
  projectId: string
  environment: string
  fromBuildId: string
  toBuildId: string
  reason: string
  initiatedBy: string
  rolledBackAt: string
}

export interface UsageLimitWarningEvent {
  to: string
  projectName: string
  projectId: string
  resourceType: string
  usagePercent: number
  currentUsage: string
  planLimit: string
  planName: string
}

export interface SecurityAlertEvent {
  to: string
  projectName: string
  projectId: string
  alertType: string
  alertDescription: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  alertTime: string
  ipAddress?: string
  userEmail?: string
}

export interface TeamInviteEvent {
  to: string
  projectName: string
  role: string
  inviterName: string
  inviterEmail: string
  acceptUrl: string
}
