export const BACKCHANNEL_DECISION_MS=900;
// This advances speculative preparation only. Speech still cannot start until
// BACKCHANNEL_DECISION_MS, so a fast formal sentence retains the same window.
export const BACKCHANNEL_OFFER_MS=200;
export const BACKCHANNEL_GRACE_MS=BACKCHANNEL_DECISION_MS-BACKCHANNEL_OFFER_MS;
