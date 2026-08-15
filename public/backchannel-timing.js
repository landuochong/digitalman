export const BACKCHANNEL_DECISION_MS=700;
// Preparation overlaps the grace window. If the media is not ready at the
// decision point, a formal sentence can still cancel it until real playback.
export const BACKCHANNEL_OFFER_MS=200;
export const BACKCHANNEL_GRACE_MS=BACKCHANNEL_DECISION_MS-BACKCHANNEL_OFFER_MS;
export const LONG_WAIT_BACKCHANNEL_OFFER_MS=3200;
