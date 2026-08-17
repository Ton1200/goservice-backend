/**
 * Real-shaped Didit `status.updated` webhook payload fixtures, matching the
 * documented example in the Identity Verification implementation plan's
 * section 2 (docs.didit.me) — used by `didit-identity-verification.adapter.spec.ts`
 * and `handle-identity-verification-webhook.service.spec.ts`. Deliberately
 * NOT real captured data of any kind — every id/score/timestamp below is
 * synthetic.
 */

const BASE_EVENT = {
  event_id: 'a3f8e6d2-0000-4000-8000-000000000001',
  webhook_type: 'status.updated',
  timestamp: 1774970000,
  session_id: 'b1c2d3e4-0000-4000-8000-000000000002',
};

export function diditApprovedWebhookPayload(vendorData: string): unknown {
  return {
    ...BASE_EVENT,
    status: 'Approved',
    vendor_data: vendorData,
    decision: {
      id_verifications: [
        {
          status: 'Approved',
          document_type: 'Identity Card',
        },
      ],
      liveness_checks: [
        { status: 'Approved', method: 'ACTIVE_3D', score: 95.4 },
      ],
      face_matches: [{ status: 'Approved', score: 96.1 }],
    },
  };
}

export function diditDocumentRejectedWebhookPayload(
  vendorData: string,
): unknown {
  return {
    ...BASE_EVENT,
    status: 'Declined',
    vendor_data: vendorData,
    decision: {
      id_verifications: [
        {
          status: 'Declined',
          document_type: 'Identity Card',
        },
      ],
      liveness_checks: [
        { status: 'Approved', method: 'ACTIVE_3D', score: 95.4 },
      ],
      face_matches: [{ status: 'Approved', score: 96.1 }],
    },
  };
}

export function diditBiometricRejectedWebhookPayload(
  vendorData: string,
): unknown {
  return {
    ...BASE_EVENT,
    status: 'Declined',
    vendor_data: vendorData,
    decision: {
      id_verifications: [
        {
          status: 'Approved',
          document_type: 'Passport',
        },
      ],
      liveness_checks: [
        { status: 'Declined', method: 'ACTIVE_3D', score: 40.1 },
      ],
      face_matches: [{ status: 'Approved', score: 96.1 }],
    },
  };
}

export function diditInProgressWebhookPayload(vendorData: string): unknown {
  return {
    ...BASE_EVENT,
    status: 'In Progress',
    vendor_data: vendorData,
    // No `decision` object yet — matches Didit's real behavior for
    // in-flight sessions (Not Started/In Progress/Abandoned/In Review) per
    // the implementation plan's section 2.
  };
}

export function diditAbandonedWebhookPayload(vendorData: string): unknown {
  return {
    ...BASE_EVENT,
    status: 'Abandoned',
    vendor_data: vendorData,
  };
}
