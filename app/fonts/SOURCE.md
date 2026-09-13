# Where these fonts came from

Bricolage Grotesque, by the Bricolage Grotesque Project Authors
(https://github.com/ateliertriay/bricolage), licensed under the SIL Open Font
License 1.1 — the full text is [OFL.txt](OFL.txt), which must travel with the files.
The licence declares no Reserved Font Name.

The three files are Google Fonts' own subsets of version 9, unmodified, fetched on
2026-09-13 from the stylesheet
`https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,200..800&display=swap`.
Each is a variable woff2 with the weight (200–800) and optical-size (12–96) axes.

| File                                   | Subset       | Source                                                                                                               | SHA-256                                                            |
| -------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `bricolage-grotesque-latin.woff2`      | `latin`      | `https://fonts.gstatic.com/s/bricolagegrotesque/v9/3y9K6as8bTXq_nANBjzKo3IeZx8z6up5BeSl9D4dj_x9PpZBMlGIInE.woff2`    | `a79fdb52d4a5c76552452f69202add96e287401fff03d3e8c0e38b4dcb5a99cd` |
| `bricolage-grotesque-latin-ext.woff2`  | `latin-ext`  | `https://fonts.gstatic.com/s/bricolagegrotesque/v9/3y9K6as8bTXq_nANBjzKo3IeZx8z6up5BeSl9D4dj_x9PpZBMlGGInHEVA.woff2` | `776f6dcaf03636cd69a5802c94808cc8896c0a66c8e9ce0fe147231b6ee01957` |
| `bricolage-grotesque-vietnamese.woff2` | `vietnamese` | `https://fonts.gstatic.com/s/bricolagegrotesque/v9/3y9K6as8bTXq_nANBjzKo3IeZx8z6up5BeSl9D4dj_x9PpZBMlGHInHEVA.woff2` | `b50a9d90a5264f20d1e45be0b948fe947ddb3644557f1e85ef5d3bd06427c944` |

The `unicode-range` each face declares in `app/layout.tsx` is the one that
stylesheet serves the file with, character for character.

**Replacing a file** means fetching it from the same kind of source, updating its
row here, its hash in `tests/unit/invariants.test.ts` — which fails on any other
bytes — and its range in `app/layout.tsx`. A binary diff shows nothing a reviewer
can read; this table and the pinned hash are what make the change checkable.
