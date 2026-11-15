# Attraction Triangle

**An interactive experiment in mathematical classification of sexual orientation.** Explore how an individual's traits and multiple preferred partner profiles map onto an orientation triangle.

![Attraction Triangle interface](preview-desktop-top.png)

## Run & technology

Built with **vanilla JavaScript (ES modules), HTML, and CSS**. No framework, dependencies, or build step; deployable directly to **GitHub Pages**. The interface is in Russian.

```bash
python3 -m http.server 8000
```

Open **http://localhost:8000**. To publish, use **Settings → Pages → Deploy from a branch → `main` → `/ (root)`**. Optional tests require Node.js 20+:

```bash
node --test tests/*.test.mjs
```

## Philosophical premises

> Sexual orientation is determined by attraction to the combination of a person's sex-related and gender-related characteristics, rather than by their biological sex as such.

We **postulate**, rather than establish, that:

- A person's sexual representation can be expressed by a weighted binary trait vector with a **nonzero** feminine–masculine score.
- **What someone is** and **which representations attract them** are distinct inputs to classification.
- Attraction to **both strongly feminine and strongly masculine profiles** differs from attraction to **near-androgynous profiles**.

## Model in brief

Each person is represented in the binary trait space \(V=\{0,1\}^n\), with identity score \(I(x)\in[-1,1]\setminus\{0\}\). A person can select **multiple preferred vectors** \(y_j\), each with a normalized weight \(\pi_j\).

Preferences are a **weighted set of unique complete binary vectors**, including answers to disabled traits when comparing profiles. The first stored profile supplies each vector's explicit weight, including zero; copies never add weight. All duplicate records and their original weights remain in saved projects and JSON exports, and can be edited into distinct profiles.

$$
\mu=\sum_j\pi_j I(y_j),\qquad
r=\sum_j\pi_j|I(y_j)|,\qquad
b=r-|\mu|
$$

The resulting point \(H_2(x)=(e,h,b)\) lies in a **triangle**: its coordinates describe heterosexual alignment, homosexual alignment, and preference spanning both polarized models. The original scalar model is preserved as a projection:

$$
h-e=I(x)\mu.
$$

You can edit the questionnaire and its weights, build preferred profiles, and observe the triangle update live. For the full assumptions, derivation, and limitations, see the **[mathematical paper (Word)](docs/model-v2-english-thesis.docx)**.

---

**Disclaimer:** This is a philosophical and mathematical thought experiment, **not a scientifically validated test**, a statement about anyone's identity, or an attempt to offend or invalidate anyone. Its classifications follow chosen assumptions and are open to criticism.

**License:** MIT (source code).
