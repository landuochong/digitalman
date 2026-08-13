export const BACKCHANNEL_DECISION_MS=900;
// Send the private preparation cue early enough for cached PCM and the first
// DINet segment to be ready before the unchanged 900 ms speaking decision.
export const BACKCHANNEL_OFFER_MS=200;
export const BACKCHANNEL_GRACE_MS=BACKCHANNEL_DECISION_MS-BACKCHANNEL_OFFER_MS;
