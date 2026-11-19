export const CONSENT_PURPOSES = ['terms', 'privacy_notice', 'bank_data_processing', 'document_processing', 'ai_processing'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** Per-organization data-use consents; terms and the privacy notice are account-level. */
export const DATA_USE_PURPOSES = ['bank_data_processing', 'document_processing', 'ai_processing'] as const satisfies readonly ConsentPurpose[];

// Placeholder document versions until counsel approves the terms and the privacy notice is
// published as reviewed content (W3b-08, gate G3). A new version asks users to consent again.
export const CONSENT_DOCUMENT_VERSIONS: Record<ConsentPurpose, string> = {
  terms: 'draft-2026-11',
  privacy_notice: 'draft-2026-11',
  bank_data_processing: 'draft-2026-11',
  document_processing: 'draft-2026-11',
  ai_processing: 'draft-2026-11',
};
