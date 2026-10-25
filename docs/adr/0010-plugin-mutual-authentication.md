# ADR 0010: mutually authenticate and encrypt the local Figma bridge

Status: implemented v3 candidate for issue #12; focused automated tests and the
bounded live Figma experiment below passed on 2026-10-26. Independent review and
release verification remain separate gates. This does not alter the published
0.1.1 binary.

## Boundary and decision

The earlier plugin sent its reusable pairing token to any listener on localhost
and accepted an unsigned welcome as permission to execute source commands. A
local port squatter must neither receive that token nor cause source reads.

An initial authentication-only v2 candidate required the numeric IPv4 endpoint.
A live Figma Desktop import rejected its `ws://127.0.0.1:4177` development
allowlist as an invalid URL. That candidate was withdrawn. The v3 plugin connects
to `ws://localhost:4177/bridge`, with the previously accepted exact
`ws://localhost:4177` manifest allowlist and no wildcard. A separate IPv6 localhost
listener can relay to the genuine IPv4 service, so authentication alone does not
protect subsequent source commands and responses. V3 also encrypts and
authenticates every application record.

The production server signs the endpoint derived from the accepted HTTP socket's
actual IPv4 local address and port, never from Host, Origin or handshake fields.
The plugin maps its configured localhost endpoint to that exact numeric service
identity. A trusted test embedder may configure another loopback port; messages
cannot select endpoints.

## V3 handshake and records

Protocol `fsb-bridge-v3` has four handshake messages:

1. `hello`: protocol, client ID and a fresh 256-bit client nonce; no secret.
2. `challenge`: both nonces, client ID, fresh 256-bit session ID, actual endpoint
   and a server HMAC-SHA256 proof.
3. `authenticate`: session ID and a client HMAC proof, sent only after verifying
   the server's proof and exact expected endpoint/client ID/client nonce.
4. `welcome`: session ID and a separate server completion proof. Only then may
   the plugin relay encrypted commands or source responses.

The HMAC transcript is a JSON array containing the application name, protocol,
direction/purpose, endpoint, client ID, client nonce, server nonce and session ID.
Distinct `server-challenge`, `client-authentication` and `server-welcome` purposes
prevent reflection across steps. The existing random pairing token is the key;
no message carries it. The broker consumes each challenge once on its specific
socket. It replaces an existing session only after validating the client proof.
Authentication messages are bounded to 4096 bytes/characters and deadlines
remain enforced.

After authentication, HKDF-SHA256 derives separate 256-bit keys for
`server-to-plugin` and `plugin-to-server`, using the token, a hash of the complete
fresh `channel-keys` transcript, and protocol/direction/cipher-specific info.
ChaCha20-Poly1305 seals every command, response, progress, ping, pong and cancel.
Each direction starts its sequence at zero and requires exactly the next number;
the 96-bit nonce contains the 32-bit sequence counter. The protocol, record
purpose, direction, session ID and sequence are authenticated associated data.
Distinct keys and fresh session transcripts prevent cross-direction or
cross-session reuse. Counter exhaustion, any authentication/decode error, replay,
gap or plaintext application frame closes the channel and clears its keys.

Source response plaintext remains bounded to 16,000,000 bytes. Commands retain
the existing 32,768 JavaScript-character limit, with a bounded UTF-8 allowance.
Wire limits account for the AEAD tag and base64 expansion before parsing or
decoding; canonical base64 is required. The server WebSocket payload limit uses
the same exported bound. HTTP request limits are independent.

HMAC, SHA-256 and HKDF use bundled `@noble/hashes`; ChaCha20-Poly1305 uses bundled
`@noble/ciphers`. Nonces use the existing `crypto.getRandomValues` iframe
capability and Node crypto on the server. Crypto is synchronous, so disconnects
cannot leave asynchronous proof work that later authenticates an old generation.
Socket/generation guards, pending response cancellation and reconnect handling
remain enforced. The plugin requires neither `crypto.subtle` nor
`crypto.randomUUID`. Both dependency licenses are included in plugin packaging.

## Compatibility, verification and limits

Legacy token hello, unsigned welcome and plaintext application messages fail
closed. Update the server and imported plugin together; there is no protocol
fallback. Capture, preview, selection, progress, cancellation, reconnect and
explicit session replacement retain their application contracts. No source
document mutation or automatic approval is added.

Automated tests include comparison with Node's independent HKDF/AEAD
implementation, both directions' forgery/replay/reflection/cross-session cases,
maximum payloads, lifecycle cancellation, and an actual IPv6 listener relaying
the handshake and encrypted records to the genuine IPv4 service on the same
port. This relay can forward opaque records but cannot read source payloads or
forge a command/response without the token. Tampering either direction is
rejected. These tests and a bundled iframe VM establish automated behavior;
live Figma import, connection and source-read acceptance are separate gates.

The rebuilt v3 plugin subsequently connected in actual Figma Desktop using the
localhost manifest. An isolated owned synthetic Dev Mode harness read two
metadata IDs, nine immediate children across three pages with cached replay, a
two-node branch in one chunk, and an 800×600 overview attached to a 21-node
collection. Scripted HTTP actions matched a region, confirmed its source set,
approved and exported context, and requested a current node preview. The original
selection was unchanged. This verifies the bounded live transport and source-read
path; it is not a human semantic study, the reported original large-file test or
an installed-app release acceptance result.

That live run also exposed Figma's sandbox rejecting an `import()` spelling in a
bundled Zod 4 comment. The plugin build now strips comments using whitespace
minification and `legalComments: 'none'`; dependency notices remain separate
packaged files. The focused build regression passed, and the rebuilt plugin then
passed the live experiment. No sandbox permissions or validation dependency were
weakened to obtain that result.

A relay can still deny service and observe message sizes and timing. The
pre-shared-key protocol has no forward secrecy: later token compromise exposes
recorded sessions. A process that can read the pairing token, compromise either
endpoint or alter the plugin bundle is outside this boundary. Desktop bootstrap
and MCP credentials use separate authenticated transport paths.
