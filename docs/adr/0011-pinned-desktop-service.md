# ADR 0011: pin the desktop service for every TLS connection

Status: implemented; focused native controls executed; final independent review
and repository gate are recorded separately (2026-10-26).

## Problem and boundary

Issue #11 describes an untrusted local listener receiving the desktop pairing
token before its identity is known. A health-response proof alone would leave a
second gap: the native application subsequently loads HTML, scripts, API
responses and reloads from that address. Listener replacement between requests
would still expose the bootstrap credential or substitute application content.

The protected boundary is therefore each native-to-service transport connection,
including WebKit subresources and downloads, not a single startup check. A process
able to read or change this user's private token/key files is outside this boundary.

## Decision

- Native application traffic uses only `https://127.0.0.1:4178`. Existing HTTP/WS
  port 4177 remains the browser/plugin transport; the native application never
  falls back to it. MCP peer authentication is separately implemented over the
  same pinned HTTPS endpoint; the native configuration points to that endpoint.
- The bundled Node process creates a persistent P-256 server key and self-signed
  certificate with the established `@peculiar/x509` library and Node WebCrypto.
  It does not invoke system OpenSSL, install a root certificate or modify Keychain.
  The leaf lifetime is 365 days to satisfy the native platform's TLS lifetime
  policy. Expired identities fail closed and require local maintenance while the
  service is stopped; network failures never trigger automatic pin replacement.
- The certificate DER pin and key live in a private, user-owned subdirectory of
  the existing application data folder. Files must be regular, user-owned, mode
  600, non-symlinks, bounded in size; the directory must be private and not a
  symlink. Existing invalid/partial identities fail closed instead of rotating
  silently or accepting a network-provided pin.
- Native URLSession and WebKit server-trust challenges require the exact locally
  loaded leaf DER certificate, correct numeric host and TLS port. They also
  validate the certificate's signature, lifetime and hostname against that private
  anchor. All other authentication challenge types and redirects are rejected.
- The native process retains one immutable pin for a running workspace. A peer
  that takes the listener after a successful health check still cannot complete
  TLS without the private key. Every new connection repeats trust validation;
  existing TLS connections retain their authenticated peer.
- The native app can reuse a compatible genuine TLS service. A first install with
  no pin starts only its bundled server, then reads the locally created pin before
  sending any credential. An older HTTP-only service causes an explicit upgrade/
  stop-and-retry failure. Projects, pairing token and approved records are preserved.
- TLS Host/Origin checks remain scoped to the actual listener and loopback address;
  browser origin authorization is not widened to all ports. TLS is an additional
  native listener over the existing request handler and persistence model.

## Verification plan

Focused tests must show a genuine pinned TLS control, rejection of a wrong
certificate before any HTTP credential, and rejection after replacing a genuine
listener at the same address. Native tests exercise the shared production trust
delegate; WebKit tests cover bootstrap/asset isolation. File tests cover private
permissions, symlinks, invalid/partial identities and stable reuse. Compile the
actual native application and retain existing startup/reuse and origin controls.

`tests/product-desktop-tls.test.ts` now executes private-file rejection, genuine
TLS API/static control and actual Swift URLSession/WebKit runs. The native cases
reject a wrong pin before HTTP, reject listener replacement between health and
HTML, and reject replacement after a genuine document before its script/API
load. The genuine control loads the document, script and authenticated request.
`tests/product-desktop-runtime.test.ts` exercises CLI startup outside the checkout,
HTTPS readiness, packaged assets and absence of tokens in output. Native policy,
locale and source-transfer self-tests run from the compiled application binary.

Native TLS does not prove enterprise policy approval, Figma Dev-only access,
macOS notarization or confidentiality against a compromised same-user account.
