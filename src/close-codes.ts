/**
 * WebSocket close codes for the device connection (server -> device).
 *
 * 4000-4003 close the connection during the hello/challenge handshake. 4004 closes an
 * established connection that claim_account's replace_device_id retired — another phone was
 * claimed in its place.
 */

/** No hello (or an unparsable/schema-invalid one) as the first message. */
export const CLOSE_EXPECTED_HELLO_FIRST = 4000;
/** A schema-valid hello whose protocol_version isn't one the server supports. */
export const CLOSE_UNSUPPORTED_PROTOCOL_VERSION = 4001;
/** hello.device_id has never been registered (POST /devices/register first). */
export const CLOSE_UNKNOWN_DEVICE = 4002;
/** The challenge_response was malformed, arrived too late, or its signature didn't verify. */
export const CLOSE_CHALLENGE_FAILED = 4003;
/** An established connection whose phone was retired by claim_account's replace_device_id. */
export const CLOSE_REPLACED = 4004;
