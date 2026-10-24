# Native verification lab

These scripts create self-generated geometry in a **new, dedicated Figma Design
test file**. They are not product plugin commands and must never run against an
existing source document. `create-geometry.js` rejects a nonempty page. Absolute
positions, covered shapes and overflow are intentional experimental inputs.

After construction, use the normal read-only product bridge to capture explicit
roots. Keep generated file/node identities and measured responses in ignored local
reports. The synthetic source scripts may be public; no real design content is
included. Remote creation or rendering does not establish Desktop bridge behavior.

The geometry scope covers negative coordinates, scale, clipping, an alpha mask,
hidden and zero-opacity ancestors, equal-position coverage within one parent and
across two branches, an outside overlay, and rotated descendant/root behavior.
The separate Section probes an unsupported image-coordinate boundary. Expected
source roles come from construction; they are not independent human semantic labels.

The [native Desktop acceptance measurements](../../docs/evaluation/native-desktop-acceptance.json)
record actual product-plugin captures on 2026-10-24: eight landmark edges within
one pixel, fourteen color checks, four individual-node export comparisons, and
five cold plus five warm captures for each 101/1,001/5,001-node scope. The thirty
performance samples are frozen; cancellation, close, timeout and recovery
checks are recorded separately. Timings include the local HTTP capture path;
sampled process RSS is not peak plugin memory. Section PNG mapping remains an
explicit unsupported boundary.

Two native file sessions also verified connection replacement, explicit re-pairing
and rejection of wrong-file navigation without changing the current selection.
