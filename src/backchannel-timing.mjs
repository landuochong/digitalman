export const BACKCHANNEL_DECISION_MS=700;
// Send the private preparation cue early enough for cached PCM and the first
// DINet segment to overlap the remaining grace window. A formal sentence can
// still cancel a committed segment until playback has actually started.
export const BACKCHANNEL_OFFER_MS=200;
export const BACKCHANNEL_GRACE_MS=BACKCHANNEL_DECISION_MS-BACKCHANNEL_OFFER_MS;
