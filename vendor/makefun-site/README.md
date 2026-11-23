# makefun-site 1.0.0

make.fun's own static site generator. `build(input)` turns one site's sources into its output tree. The code is the reference: where this file and the code differ, the code's answer is the answer. Everything here is makefun-site's own dialect. It is not Jekyll's, Hugo's, Eleventy's or metalsmith's, and its Markdown is not CommonMark.

## Provenance

This source is make.fun's own `makefun-site` 1.0.0 reference implementation, released under the MIT license in `LICENSE`. Its code derives from metalsmith 2.7.0 and marked 18.2.1; `NOTICE` carries their licenses and copyright notices.

## Input and output

`{ site: { title, base_url, per_page, recent }, templates: { <name>: <source> }, files: [{ path, content }] }` produces an object mapping output paths to text. The build reads no clock, environment, randomness or files.

The implementation is kept byte-compatible with the included competition reference. See the competition's public `RULES.txt` for its detailed front matter, Markdown, template and path semantics.
