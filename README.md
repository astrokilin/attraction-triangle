# Attraction Triangle

**An interactive thought experiment in mathematically classifying sexual orientation.** Select your own characteristics and several preferred partner profiles, then explore the resulting point inside an orientation triangle.

## Stack & run

Vanilla **JavaScript (ES modules), HTML, and CSS**. No framework, dependencies, server-side processing, or build step. The UI is in Russian; the site can be hosted on **GitHub Pages**.

```bash
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). To publish: **GitHub → Settings → Pages → Deploy from a branch → `main` / `(root)`**.

Run tests with Node.js 20+ (browser smoke tests additionally need Python, Playwright, and Chromium):

```bash
node --test tests/*.test.mjs
python3 tests/e2e_browser.py
```

The E2E suite starts a temporary local static server and opens the actual site at
`/attraction-triangle/`, loading its real ES modules and native localStorage.
It checks desktop/mobile interactions, persistence, JSON, exact-weight warnings,
and narrow layouts. Set `CHROMIUM_PATH` if Chromium is not at `/usr/bin/chromium`.
No test server or Python dependency is needed to deploy the application.

For detailed individual test counts on Node.js 22, use
`node --test --experimental-test-isolation=none --test-reporter=spec tests/*.test.mjs`.
The older `tests/browser_check.py` and `tests/smoke_inline.py` are supplementary
inlined-page checks, not substitutes for the real-module E2E suite.
The independent review, reproduced defects, exact commands and results are in
[REVIEW_REPORT.md](REVIEW_REPORT.md).

## Philosophical premises

> Sexual orientation is determined by attraction to the combination of a person's sex-related and gender-related characteristics, rather than by their biological sex as such.

This model **postulates**, rather than proves, that:

- A person's representation can be approximated with a weighted binary vector, classified by a nonzero feminine–masculine score.
- **What a person is** and **which profiles attract them** are distinct inputs.
- Attraction to **both polarized representations** differs from attraction to **near-androgynous representations**.

## Model in brief

Each profile is a vector in \(V=\{0,1\}^n\). For each enabled trait, \(x_i=0\) is feminine-coded and \(x_i=1\) masculine-coded. All traits share one normalized weighted identity score:

$$
I(x)=\frac{\sum_{i=1}^{n} w_i(2x_i-1)}{\sum_{i=1}^{n}w_i},\qquad I(x)\ne0.
$$

An individual can select several preferred partner vectors \(y_j\) with normalized preference weights \(\pi_j\). Identical binary vectors are counted only once, regardless of how often they appear in the editor.

$$
\mu=\sum_j\pi_j I(y_j),\qquad
r=\sum_j\pi_j|I(y_j)|,\qquad
b=r-|\mu|.
$$

The resulting triangle coordinates are

$$
H_2(x)=(e,h,b)=\left(\frac{1-b-I(x)\mu}{2},\frac{1-b+I(x)\mu}{2},b\right),
$$

with the original scalar model embedded as \(h-e=I(x)\mu\). For the full assumptions and derivations, read the **[mathematical paper (Word)](docs/model-thesis.docx)**.

The built-in questionnaire contains **23 traits**: 17 physical/presentation traits (including height) and six culturally coded romantic/sexual behavioral traits. Their experimental individual weights are documented in [TRAIT_CATALOG.md](TRAIT_CATALOG.md). No fixed 80/20 weighting of categories is used.

**Nonzero-identity constraint:** The built-in weights guarantee \(I(x)\ne0\) for every binary answer vector. User-defined weights are *never corrected automatically*: the questionnaire editor warns if the weights permit a zero score, and a profile that actually reaches zero receives no orientation result. Existing V3 project exports remain importable; the obsolete `behaviorContribution` field in custom legacy data is retained for compatibility but ignored in calculations.

---

**Disclaimer:** An experimental mathematical and philosophical construction, **not a scientifically validated test** and not a statement about anyone's identity or sexuality. Trait coding, weights, and labels are hypotheses open to criticism. Answers stay in the browser unless explicitly exported by the user.

**Code license:** MIT.
