# ADR 0004: packaged macOS alpha runtime

Status: historical 0.1.0 alpha packaging decision, subsequently implemented.
The published 0.1.1 baseline is MIT licensed; the 0.2.0 candidate's pinned native
transport and release verification are described in [ADR 0011](0011-pinned-desktop-service.md)
and [release readiness](../release-readiness.md). The original decision text below
is retained as its dated scope, not a description of the current native channel.

## Scope and acceptance

A user can install a prebuilt macOS Apple Silicon application, open it without
Node.js, npm, a repository checkout or a development server, connect a prebuilt
Figma plugin, review a bounded capture, save/export and configure a local MCP
agent using the bundled executable. Existing human annotations and source Figma
documents remain unchanged by installation. Release assets contain no local data,
credentials or real design images. Actual packaged startup, persistence, import,
export, MCP and native plugin connection must be exercised before publishing.

## Decision

- A small AppKit/WKWebView host starts the production Node HTTP/WS runtime. This
  uses the existing local application architecture and macOS system WebKit rather
  than introducing an additional cross-platform browser runtime for this alpha.
- The macOS 13+ arm64 application contains a pinned official Node distribution,
  bundled production server/MCP code, static web assets, the prebuilt plugin and
  an offline setup guide. Dependencies and their license notices are included.
- Resources use `runtime/node`, `app/server.mjs`, `app/mcp.mjs`, `app/web/`,
  `plugins/semantic-bridge/` and `setup-guide.html`. The app is named
  `Figma Semantic Bridge.app`; its executable is `FigmaSemanticBridge`.
- The server still binds only `127.0.0.1:4177` and requires the existing random
  token. Data stays in `~/.figma-semantic-bridge`; installation never replaces it.
  Desktop startup suppresses secret output and selects packaged static assets.
- An existing listener is reused only after authenticated service, exact release
  version and schema checks. Unknown/incompatible listeners produce an actionable
  error. The application never kills a process it did not start.
- The host owns child-process lifetime, uses a single-instance lock, and injects
  the token only into the exact local main-frame origin in a nonpersistent web
  view. Navigation, new windows and external resources are restricted. Explicit
  native file-open/save dialogs support capture import and review exports.
- Native menus expose pairing-token copy, plugin location, offline instructions,
  data location and MCP setup without printing credentials. Child environment is
  allowlisted; external inference is not implicitly enabled by inherited secrets.
- The release contains a DMG, application ZIP, prebuilt plugin ZIP, checksums,
  release manifest and installation documentation. Public artifact assembly uses
  an allowlist, never a recursive copy of the working checkout or user data.

## Distribution boundaries

The existing plugin uses Figma's private file-key API to validate source identity.
The alpha plugin is delivered prebuilt for Figma Desktop's local development
import channel. This packaging is not a claim of Community publication or of an
organization's private-plugin approval. An alternate channel requires its own
manifest/network settings, assigned plugin identity and actual acceptance.

Signing/notarization status must be reported exactly. An ad-hoc signed local build
is not Developer ID signing or Apple notarization. No security setting or
quarantine attribute is automatically bypassed by an installer or setup agent.
License choice remains an owner decision until explicitly provided.

## Unchanged product boundaries

Dev-only/source-can-view acceptance, independent semantic evaluation and human
productivity measurements remain unverified. The release is an opt-in alpha,
not a blanket enterprise approval. It does not infer old/new design identity,
modify source documents or automatically approve semantic interpretations.
