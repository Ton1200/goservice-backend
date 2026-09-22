/**
 * GOS-125 — the placeholder copy for each Engagement lifecycle-transition
 * system chat message, emitted by `EmitEngagementLifecycleSystemMessageService`.
 * Exact wording is UX's call (GOS-49), not decided here — kept as one named
 * constant per transition so it's replaced in a single place, rather than a
 * literal repeated at each of the 5 call sites.
 */
export const ENGAGEMENT_LIFECYCLE_SYSTEM_MESSAGES = {
  WORK_STARTED: 'El profesional inició el trabajo',
  WORK_FINISHED: 'El profesional marcó el trabajo como terminado',
  COMPLETION_CONFIRMED: 'El cliente confirmó la finalización del trabajo',
  CANCELLED_BY_CUSTOMER: 'El cliente canceló el trabajo',
  CANCELLED_BY_PROFESSIONAL: 'El profesional canceló el trabajo',
} as const;
